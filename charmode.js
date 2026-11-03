/* 逐字模式（?preview=1 时加载）：
   把校订后的口播稿逐字铺在时间轴上，可以点选 / 删掉某个词。
   删掉 = 这段视频消失、后面整体提前 —— 预览里立刻生效（视频跳过、字幕前移），
   真正剪片由「重建」按钮在后台跑完整流水线。

   性能：字轨用 canvas 画（几百个字也只几十微秒），不做 DOM；
        命中测试用二分查找，不用逐字遍历。
   数据：字 = build.mjs 编进来的 meta.chars（原片时间 + 成片时间）；
        待删区间 = meta.dels（原片时间）；切片映射 = meta.cuts。 */
(function () {
  if (!/preview/.test(location.search) || !window.__PV) return;
  const PV = window.__PV, T = window.__TIMELINE__;
  if (!PV.chars || !PV.chars.length || !PV.rm) return;

  const RM = PV.rm;
  /* ---- 每个字的当前位置（新成片时间） ---- */
  const CH = PV.chars.map(function (c) {
    const o = RM.srcToOut(c.s0);
    const o2 = RM.srcToOut(c.s1);
    return { ch: c.c, s0: c.s0, s1: c.s1, g: c.g, o: o, n: RM.oldToNew(o), d: Math.max(0, RM.oldToNew(o2) - RM.oldToNew(o)) };
  });
  const SENT = {};                       // 句号分组（用 g 索引）
  CH.forEach(function (c) { (SENT[c.g] = SENT[c.g] || []).push(c); });

  /* ---- 待删区间（原片时间）---- */
  let DELS = (T.meta.dels || []).map(function (d) { return { s0: d.s0, s1: d.s1 }; });
  function inDel(c) {
    if (DELS.some(function (d) { return c.s1 > d.s0 + 1e-6 && c.s0 < d.s1 - 1e-6; })) return true;
    return RM.srcToOutStrict(c.s0) === null;   // 已经剪进成片里（原片这一段不再出现）
  }

  /* ================= UI ================= */
  const bar = document.getElementById('pvbar');
  const strip = document.createElement('div');
  strip.id = 'pvchars';
  strip.innerHTML =
    '<div class="tools">'
    + '<button id="cvfit" title="看全片">全片</button>'
    + '<button id="cvin" title="放大">＋</button>'
    + '<button id="cvout" title="缩小">－</button>'
    + '<span class="sep"></span>'
    + '<button id="cvdel" class="danger" title="删掉选中的字（Delete）">删掉选中</button>'
    + '<button id="cvundo" title="撤销上一次删除">撤销</button>'
    + '<span class="sep"></span>'
    + '<button id="cvquote" title="把选中内容复制到对话">引用</button>'
    + '<button id="cvsave">保存</button>'
    + '<button id="cvrebuild" class="primary">重建</button>'
    + '<span class="info" id="cvinfo"></span>'
    + '</div>'
    + '<canvas id="cvcanvas"></canvas>'
    + '<div class="hint" id="cvhint"></div>';
  document.body.appendChild(strip);
  const cv = strip.querySelector('#cvcanvas');
  const ctx = cv.getContext('2d');

  const btn = document.createElement('button');
  btn.id = 'cvbtn'; btn.textContent = '字'; btn.title = '逐字模式';
  btn.onclick = function () { toggle(); };
  bar.insertBefore(btn, bar.firstChild);

  const S = {
    on: false,
    view: [0, PV.total],
    sel: null,        // {a, b} char index 区间
    hover: -1,
    drag: null,
    scrub: false,
  };

  function toggle(on) {
    S.on = (on === undefined) ? !S.on : on;
    strip.classList.toggle('on', S.on);
    btn.style.background = S.on ? '#FEBD0D' : '#1a1e26';
    btn.style.color = S.on ? '#111' : '#FEBD0D';
    document.body.classList.toggle('charmode', S.on);
    if (S.on) { fit(); draw(); }
  }

  function fit() { S.view = [0, PV.total]; draw(); }

  /* ---- 画 ---- */
  function draw() {
    if (!S.on) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const v0 = S.view[0], v1 = S.view[1], span = Math.max(0.001, v1 - v0);
    const X = function (t) { return (t - v0) / span * w; };

    /* 句子底色 */
    Object.keys(SENT).forEach(function (g) {
      const arr = SENT[g]; if (!arr.length) return;
      const a = arr[0].n, b = arr[arr.length - 1].n + arr[arr.length - 1].d;
      if (b < v0 || a > v1) return;
      ctx.fillStyle = 'rgba(255,255,255,.045)';
      ctx.fillRect(X(a), 20, Math.max(1, X(b) - X(a)), h - 20);
    });

    /* 已删区间（红条） */
    RM.iv.forEach(function (iv) {
      if (iv[1] < v0 || iv[0] > v1) return;
      ctx.fillStyle = 'rgba(255,59,48,.30)';
      ctx.fillRect(X(RM.oldToNew(iv[0])), 20, Math.max(2, X(RM.oldToNew(iv[1])) - X(RM.oldToNew(iv[0]))), h - 20);
    });

    /* 字 */
    for (let i = 0; i < CH.length; i++) {
      const c = CH[i];
      if (c.n + c.d < v0 || c.n > v1) continue;
      const x0 = X(c.n), x1 = X(c.n + c.d);
      const bw = Math.max(2, x1 - x0 - 1);
      const dead = inDel(c);
      const sel = S.sel && i >= S.sel.a && i <= S.sel.b;
      ctx.fillStyle = dead ? 'rgba(255,59,48,.45)'
        : sel ? '#FEBD0D'
        : (c.g % 2 ? 'rgba(200,215,235,.55)' : 'rgba(235,243,255,.80)');
      ctx.fillRect(x0, 26, bw, h - 26);
      if (bw >= 11 && h > 34) {
        ctx.fillStyle = dead ? '#ffd7d3' : sel ? '#111' : '#0b0c0e';
        ctx.font = '600 12px ui-monospace,Menlo,monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.ch, x0 + (bw - 7) / 2, 26 + (h - 26) / 2 + 1);
      }
    }

    /* 播放头（要把「老成片时间」换成「删完之后的新时间」） */
    const px = X(RM.oldToNew(PV.vid.currentTime));
    if (px >= -2 && px <= w + 2) {
      ctx.fillStyle = '#FF3B30';
      ctx.fillRect(px - 1, 16, 2, h - 16);
    }

    /* 视图提示 */
    strip.querySelector('#cvhint').textContent =
      '窗口 ' + v0.toFixed(1) + '–' + v1.toFixed(1) + 's ／ 全片 ' + PV.total.toFixed(1)
      + 's　滚轮缩放 · 拖红色播放头定位 · 点字选中 · 双击放大到句 · Delete 删掉选中';
  }

  /* ---- 命中测试 ---- */
  function hit(t) {
    let lo = 0, hi = CH.length - 1, best = -1;
    for (let i = 0; i < CH.length; i++) {
      const c = CH[i];
      if (c.n <= t && t <= c.n + Math.max(c.d, 0.001)) return i;
      if (c.n <= t) best = i;
    }
    return best;
  }
  function timeAt(e) {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left;
    return S.view[0] + (x / r.width) * (S.view[1] - S.view[0]);
  }
  /* 红色播放头在画布上的像素位置 */
  function playheadX() {
    const r = cv.getBoundingClientRect();
    const t = RM.oldToNew(PV.vid.currentTime);
    return (t - S.view[0]) / Math.max(0.001, S.view[1] - S.view[0]) * r.width;
  }

  /* ---- 交互 ---- */
  cv.addEventListener('mousedown', function (e) {
    if (!S.on) return;
    const rr = cv.getBoundingClientRect();
    const mx = e.clientX - rr.left;
    /* 抓住红色播放头 -> 拖动定位（不选字） */
    if (Math.abs(mx - playheadX()) <= 8) {
      S.scrub = true;
      PV.seek(S.view[0] + (Math.max(0, Math.min(rr.width, mx)) / rr.width) * (S.view[1] - S.view[0]));
      draw();
      return;
    }
    const t = timeAt(e);
    const i = hit(t);
    S.drag = { i: i, moved: false, pan: e.shiftKey };
    if (i < 0) { S.sel = null; info(); draw(); return; }
    if (e.shiftKey && S.sel) S.sel = { a: Math.min(S.sel.a, i), b: Math.max(S.sel.b, i) };
    else S.sel = { a: i, b: i };
    PV.seek(CH[i].n);
    info(); draw();
  });
  cv.addEventListener('mousemove', function (e) {
    if (!S.on) return;
    if (S.scrub) {
      const rr = cv.getBoundingClientRect();
      const mx = Math.max(0, Math.min(rr.width, e.clientX - rr.left));
      PV.seek(S.view[0] + (mx / rr.width) * (S.view[1] - S.view[0]));
      draw();
      return;
    }
    if (S.drag && S.drag.pan) {
      const r = cv.getBoundingClientRect();
      const dt = (e.clientX - S.drag.x) / r.width * (S.view[1] - S.view[0]);
      S.view[0] -= dt; S.view[1] -= dt;
      draw(); return;
    }
    if (S.drag) {
      const i = hit(timeAt(e));
      if (i >= 0 && i !== S.drag.i) {
        S.sel = { a: Math.min(S.drag.i, i), b: Math.max(S.drag.i, i) };
        S.drag.i = i; info(); draw();
      }
      return;
    }
    const i = hit(timeAt(e));
    if (i !== S.hover) { S.hover = i; cv.title = i >= 0 ? (CH[i].ch + '  ' + CH[i].n.toFixed(2) + 's') : ''; }
  });
  window.addEventListener('mouseup', function () { S.drag = null; S.scrub = false; });
  cv.addEventListener('wheel', function (e) {
    if (!S.on) return;
    e.preventDefault();
    const t = timeAt(e);
    const k = e.deltaY > 0 ? 1.18 : 1 / 1.18;
    let a = t - (t - S.view[0]) * k, b = t + (S.view[1] - t) * k;
    const minSpan = 1.5;
    if (b - a < minSpan) { const c = (a + b) / 2; a = c - minSpan / 2; b = c + minSpan / 2; }
    S.view = [a, b]; draw();
  }, { passive: false });
  cv.addEventListener('dblclick', function (e) {
    if (!S.on) return;
    const i = hit(timeAt(e));
    if (i < 0) return;
    const arr = SENT[CH[i].g] || [];
    const a = arr[0].n, b = arr[arr.length - 1].n + arr[arr.length - 1].d;
    S.view = [a - 0.3, b + 0.3]; draw();
  });

  /* ---- 选中信息 ---- */
  function selChars() {
    if (!S.sel) return [];
    return CH.slice(S.sel.a, S.sel.b + 1);
  }
  function info() {
    const el = strip.querySelector('#cvinfo');
    const arr = selChars();
    if (!arr.length) { el.textContent = DELS.length ? ('待删 ' + DELS.length + ' 段') : '点字选中'; return; }
    const txt = arr.map(function (c) { return c.ch; }).join('');
    el.textContent = '选中「' + txt + '」 ' + arr[0].n.toFixed(2) + '–'
      + (arr[arr.length - 1].n + arr[arr.length - 1].d).toFixed(2) + 's';
  }

  /* ---- 删除 / 撤销 ---- */
  function doDelete() {
    const arr = selChars();
    if (!arr.length) return;
    const s0 = arr[0].s0, s1 = arr[arr.length - 1].s1;
    DELS.push({ s0: s0, s1: s1 });
    DELS.sort(function (a, b) { return a.s0 - b.s0; });
    const m = [];
    DELS.forEach(function (d) {
      if (m.length && d.s0 <= m[m.length - 1].s1 + 1e-4) m[m.length - 1].s1 = Math.max(m[m.length - 1].s1, d.s1);
      else m.push({ s0: d.s0, s1: d.s1 });
    });
    DELS = m;
    S.sel = null;
    RM.setDels(DELS);
    info(); draw();
  }
  function undo() {
    if (!DELS.length) return;
    DELS.pop();
    RM.setDels(DELS);
    info(); draw();
  }

  /* ---- 引用 ---- */
  async function quote() {
    const arr = selChars();
    if (!arr.length) return;
    const g = arr[0].g;
    const sent = (SENT[g] || []).map(function (c) { return c.ch; }).join('');
    const txt = arr.map(function (c) { return c.ch; }).join('');
    const lines = [
      '【引用 · ' + (T.meta.title || 'EP') + ' · 第 ' + (g + 1) + ' 句】',
      '选中：' + txt,
      '成片时间：' + arr[0].n.toFixed(2) + '–' + (arr[arr.length - 1].n + arr[arr.length - 1].d).toFixed(2) + 's',
      '原片时间：' + arr[0].s0.toFixed(2) + '–' + arr[arr.length - 1].s1.toFixed(2) + 's',
      '原句：' + sent,
    ];
    const body = lines.join('\n');
    try { await navigator.clipboard.writeText(body); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = body;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    strip.querySelector('#cvinfo').textContent = '已复制引用';
  }

  /* ---- 保存 / 重建 ---- */
  async function post(url, data) {
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(data) });
    return await r.json();
  }
  async function save(silent) {
    const info2 = strip.querySelector('#cvinfo');
    info2.textContent = '保存中…';
    try {
      const r = await post('/api/save', { file: 'deletions.json', data: { dels: DELS } });
      info2.textContent = r && r.ok ? ('已保存 ' + DELS.length + ' 段删除') : ('保存失败：' + JSON.stringify(r));
    } catch (e) { info2.textContent = '保存失败：' + e; }
  }
  async function rebuild() {
    const info2 = strip.querySelector('#cvinfo');
    info2.textContent = '重建中…';
    await save(true);
    let done = false, lastLog = '';
    try {
      await post('/api/rebuild', {});
      const t0 = Date.now();
      while (!done && Date.now() - t0 < 30 * 60 * 1000) {
        await new Promise(function (r) { setTimeout(r, 1500); });
        let pr = null;
        try { pr = await (await fetch('/api/progress')).json(); } catch (e) { continue; }
        if (pr && pr.log) {
          const lines = pr.log.trim().split('\n');
          const tail = lines[lines.length - 1] || '';
          if (tail !== lastLog) {
            lastLog = tail;
            info2.textContent = /已有重建在跑/.test(tail) ? '已有一个重建在跑，等它跑完' : ('重建中 · ' + tail.slice(0, 42));
          }
        }
        if (pr && pr.running === false && pr.log && /==== 结束/.test(pr.log)) done = true;
      }
      if (done && /已有重建在跑/.test(lastLog || '') === false && /已有重建在跑/.test(String(info2.textContent)) === false) {
        info2.textContent = '重建完成，正在刷新…';
        setTimeout(function () { location.reload(); }, 900);
      } else if (done) {
        info2.textContent = '已有一个重建在跑，等它跑完再点';
      } else info2.textContent = '重建超时，看 .rebuild.log';
    } catch (e) { info2.textContent = '重建失败：' + e; }
  }

  strip.querySelector('#cvfit').onclick = fit;
  strip.querySelector('#cvin').onclick = function () {
    const c = (S.view[0] + S.view[1]) / 2, h = (S.view[1] - S.view[0]) / 2.6;
    S.view = [c - h, c + h]; draw();
  };
  strip.querySelector('#cvout').onclick = function () {
    const c = (S.view[0] + S.view[1]) / 2, h = (S.view[1] - S.view[0]) * 1.9;
    S.view = [c - h, c + h]; draw();
  };
  strip.querySelector('#cvdel').onclick = doDelete;
  strip.querySelector('#cvundo').onclick = undo;
  strip.querySelector('#cvquote').onclick = quote;
  strip.querySelector('#cvsave').onclick = function () { save(); };
  strip.querySelector('#cvrebuild').onclick = rebuild;

  window.addEventListener('keydown', function (e) {
    if (!S.on) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { doDelete(); e.preventDefault(); }
    if (e.key === 'Escape') { S.sel = null; info(); draw(); }
  });

  /* 播放时：红色播放头跟着走；走出窗口就把窗口带过去（留 5% 余量） */
  setInterval(function () {
    if (!S.on) return;
    const t = RM.oldToNew(PV.vid.currentTime);
    const span = S.view[1] - S.view[0];
    if (t < S.view[0] + span * 0.05 || t > S.view[1] - span * 0.05) {
      let a = t - span * 0.35, b = t + span * 0.65;
      if (a < 0) { b -= a; a = 0; }
      if (b > PV.total) { a -= (b - PV.total); b = PV.total; }
      if (a < 0) a = 0;
      S.view = [a, b];
    }
    draw();
  }, 200);

  window.addEventListener('resize', draw);
  info();
})();
