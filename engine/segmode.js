/* 按段删除（?preview=1 时加载）：
   时间轴上两条蓝线之间 = 一句话/一个短语 = 一个可删除单位。
   点它选中 → 「删掉这一段」→ 预览里立刻跳过、后面整体前移，时间轴上留一道红色切痕。 */
(function () {
  if (!/preview/.test(location.search) || !window.__PV) return;
  const PV = window.__PV, T = window.__TIMELINE__, RM = PV.rm;
  if (!RM) return;

  /* 待删的段：s0/s1 = 原片时间；label/t0/t1 = 用来画切痕和提示 */
  let DELS = (T.meta.dels || []).map(d => {
    const a = RM.srcToOut(d.s0), b = RM.srcToOut(d.s1);
    return { s0: d.s0, s1: d.s1, pv0: a, pv1: b, label: '已删', oldT0: 0, oldT1: 0, gid: '' };
  });
  let selId = null, on = false, savedN = DELS.length;

  /* ---- 工具条 ---- */
  const bar = document.getElementById('pvbar');
  const btn = document.createElement('button');
  btn.id = 'segbtn'; btn.textContent = '段'; btn.title = '按段删除（点时间轴上的蓝段）';
  btn.onclick = () => setOn(!on);
  bar.insertBefore(btn, bar.firstChild);

  const sb = document.createElement('div');
  sb.id = 'segbar';
  sb.innerHTML = '<span id="seginfo">点时间轴上的蓝色段，选中一句话</span>'
    + '<button id="segdel" class="danger">删掉这一段</button>'
    + '<button id="segundo" title="撤销最近一次删除（会自动保存）">撤销上一次删除</button>'
    + '<button id="segquote" title="把这一段复制到剪贴板，粘到对话里继续改">引用</button>'
    + '<button id="segrebuild" class="primary" title="保存删除清单并重新剪出成片">保存并重建</button>';
  document.body.appendChild(sb);
  const cutBox = document.getElementById('pvcuts');

  function setOn(v) {
    on = v;
    document.body.classList.toggle('segmode', on);
    btn.style.background = on ? '#FEBD0D' : '#1a1e26';
    btn.style.color = on ? '#111' : '#FEBD0D';
    if (!on) { selId = null; paintSel(); }
    info();
  }

  /* ---- 选中 ---- */
  function group() { return selId ? T.groups.find(g => g.id === selId) : null; }
  function paintSel() {
    document.querySelectorAll('#pvtrack .seg').forEach(el => {
      el.classList.toggle('sel', el.dataset.gid === selId);
    });
  }
  function select(id) {
    selId = id; paintSel(); info();
    const g = group();
    if (g) PV.seek(g.t0 + 0.01);
  }

  /* ---- 时间轴上的红色切痕（删掉的地方）---- */
  function renderCuts() {
    if (!cutBox) return;
    cutBox.innerHTML = '';
    DELS.forEach(function (d) {
      const g = T.groups.find(x => x.id === d.gid);
      const nt = g ? g.t0 : d.oldT0;
      const dur = Math.max(0.05, d.oldT1 - d.oldT0);
      const el = document.createElement('div');
      el.className = 'cut';
      el.style.left = (nt / PV.total * 100) + '%';
      el.style.width = Math.max(0.4, dur / PV.total * 100) + '%';
      el.title = '已删：' + d.label + '（' + dur.toFixed(2) + 's）';
      cutBox.appendChild(el);
    });
  }

  /* ---- 提示行 ---- */
  function info() {
    const el = sb.querySelector('#seginfo');
    const g = group();
    let html = g
      ? '已选「' + (g.items.find(i => i.role === 'main') || { text: g.id }).text.replace(/\*/g, '') + '」 '
        + g.t0.toFixed(2) + '–' + g.t1.toFixed(2) + 's'
      : (DELS.length
          ? '已删 ' + DELS.length + ' 段 · 播放时这几段会被跳过（不用等重建）'
          : '点蓝色段选中 · 删了立刻在预览生效，重建只是导出成片');
    if (DELS.length) {
      html += DELS.map(d => '<span class="chip">✕ ' + d.label + ' ' + Math.max(0.05, d.oldT1 - d.oldT0).toFixed(1) + 's</span>').join('');
    }
    el.innerHTML = html;
    sb.querySelector('#segundo').disabled = !DELS.length;
  }

  /* ---- 点时间轴上的段块 ----
     段模式下 index.html 的 mousedown 不再抢着 seek，所以点段就是点段；
     只有拖动（>4px）才算擦洗，不会误选。 */
  let downX = 0, downY = 0, moved = false;
  bar.addEventListener('mousedown', function (e) {
    downX = e.clientX; downY = e.clientY; moved = false;
  }, true);
  bar.addEventListener('mousemove', function (e) {
    if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) moved = true;
  });
  bar.addEventListener('click', function (e) {
    if (!on || moved) return;
    const el = e.target.closest('.seg');
    if (!el) return;
    select(el.dataset.gid);
  });

  /* ---- 这一段对应的原片区间 ---- */
  function groupRange(id) {
    const idx = parseInt(id.slice(1), 10) - 1;
    const rs = (T.meta.cuts || []).filter(r => r.gid === idx);
    if (!rs.length) return null;
    return {
      s0: Math.min.apply(null, rs.map(r => r.src0)),
      s1: Math.max.apply(null, rs.map(r => r.src1)),
    };
  }

  function doDelete() {
    const g = group();
    if (!g) return;
    const r = groupRange(g.id);
    if (!r) return;
    /* 保存/重建要的是原片时间；即时预览要的是当前预览视频时间。
       必须从 BASE 取，不能用已经被前几次预览删除平移过的 g.t0/t1。 */
    const pv = RM.baseGroupRange(g.id);
    if (!pv) return;
    const main = (g.items.find(i => i.role === 'main') || { text: g.id }).text.replace(/\*/g, '');
    DELS.push({ s0: r.s0, s1: r.s1, pv0: pv.t0, pv1: pv.t1,
      label: main, oldT0: pv.t0, oldT1: pv.t1, gid: g.id });
    DELS.sort((a, b) => a.s0 - b.s0);
    const m = [];
    DELS.forEach(d => {
      if (m.length && d.s0 <= m[m.length - 1].s1 + 1e-4) {
        const last = m[m.length - 1];
        last.s1 = Math.max(last.s1, d.s1);
        last.pv1 = Math.max(last.pv1, d.pv1);
      }
      else m.push(d);
    });
    DELS = m;
    selId = null;
    RM.setOutDels(DELS.map(d => ({ s0: d.pv0, s1: d.pv1 })));   // 预览立刻重映射
    renderCuts(); paintSel(); info();
    window.__pvToast && window.__pvToast('已删掉「' + main + '」 · 撤销可反悔');
  }

  function undo() {
    if (!DELS.length) return;
    const last = DELS.pop();
    RM.setOutDels(DELS.map(d => ({ s0: d.pv0, s1: d.pv1 })));
    renderCuts(); info();
    save(true);                       // 撤销后同步写回，避免磁盘上是旧的
    window.__pvToast && window.__pvToast('已撤销删除「' + last.label + '」');
  }

  /* ---- 引用 ---- */
  async function quote() {
    const g = group();
    if (!g) { window.__pvToast && window.__pvToast('先选中一段再引用'); return; }
    const m = g.items.find(i => i.role === 'main');
    const s = g.items.find(i => i.role === 'sub');
    const f = n => Number(n).toFixed(2);
    const L = [
      '【引用 · ' + (T.meta.title || 'EP') + ' · ' + g.id + '】',
      '成片时间：' + f(g.t0) + '–' + f(g.t1) + 's',
      '文字：' + (m ? m.text : ''),
    ];
    if (s) L.push('副字：' + s.text);
    L.push('动效：' + (m ? m.device : '') + '  字号：' + (m ? m.size : '') + '  y=' + g.y);
    const body = L.join('\n');
    let ok = true;
    try { await navigator.clipboard.writeText(body); }
    catch (e) {
      ok = false;
      const ta = document.createElement('textarea'); ta.value = body;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok = true; } catch (e2) {}
      ta.remove();
    }
    window.__pvToast && window.__pvToast(ok ? '已复制引用 · 粘贴到对话框里就能继续改' : '复制失败，请手动选中文字');
  }

  /* ---- 保存 / 重建 ---- */
  async function post(url, data) {
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(data) });
    return await r.json();
  }
  async function save(silent) {
    const el = sb.querySelector('#seginfo');
    if (!silent) el.textContent = '保存中…';
    try {
      const r = await post('/api/save', { file: 'deletions.json', data: { dels: DELS.map(d => ({ s0: d.s0, s1: d.s1 })) } });
      savedN = DELS.length;
      if (!silent) window.__pvToast && window.__pvToast(r && r.ok ? ('已保存 ' + DELS.length + ' 段删除') : '保存失败');
      return r;
    } catch (e) { if (!silent) window.__pvToast && window.__pvToast('保存失败：' + e); return null; }
  }

  async function rebuild() {
    if (document.body.classList.contains('locked')) return;
    PV.lock(true, '切片子 → 纯人声版 → 逐帧文字层 → 配乐音效 → 合成（约 5–8 分钟）');
    try {
      await save(true);
      const r = await post('/api/rebuild', {});
      if (r && r.busy) { PV.lock(false); window.__pvToast && window.__pvToast('已有一个重建在跑，等它结束'); return; }
      let last = '';
      const t0 = Date.now();
      while (Date.now() - t0 < 40 * 60 * 1000) {
        await new Promise(res => setTimeout(res, 1500));
        let pr = null;
        try { pr = await (await fetch('/api/progress')).json(); } catch (e) { continue; }
        if (pr && pr.log) {
          const lines = pr.log.trim().split('\n');
          const tail = lines[lines.length - 1] || '';
          if (tail !== last) { last = tail; PV.busyLog(lines.slice(-14).join('\n')); }
        }
        if (pr && pr.running === false && pr.log && /==== 结束/.test(pr.log)) {
          PV.lock(false);
          window.__pvToast && window.__pvToast('重建完成，正在刷新…');
          setTimeout(() => location.reload(), 700);
          return;
        }
      }
      PV.lock(false);
      window.__pvToast && window.__pvToast('重建超时，看 .rebuild.log');
    } catch (e) {
      PV.lock(false);
      window.__pvToast && window.__pvToast('重建失败：' + e);
    }
  }

  sb.querySelector('#segdel').onclick = doDelete;
  sb.querySelector('#segundo').onclick = undo;
  sb.querySelector('#segquote').onclick = quote;
  sb.querySelector('#segrebuild').onclick = rebuild;

  window.addEventListener('keydown', function (e) {
    if (!on || document.body.classList.contains('locked')) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { doDelete(); e.preventDefault(); }
    if (e.key === 'Escape') { selId = null; paintSel(); info(); }
  });

  renderCuts();
  info();
})();
