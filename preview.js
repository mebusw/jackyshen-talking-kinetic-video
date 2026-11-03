/* 预览编辑器：只在 ?preview=1 时由 index.html 加载。
   依赖 window.__PV（预览控制器暴露的 vid / seek / paint）。 */
(function () {
  if (!/preview/.test(location.search) || !window.__PV) return;
  const PV = window.__PV, T = window.__TIMELINE__;
  if (!T || !T.groups) return;

  const DEV_CN = { drop:'drop 落下', wipe:'wipe 左擦入', slam:'slam 砸入',
    slideL:'slideL 滑入', type:'type 逐字', fade:'fade 淡入', split:'split 上下裂开' };

  /* ---------- 1. 编辑开关 ---------- */
  const bar = document.getElementById('pvbar');
  const btn = document.createElement('button');
  btn.id = 'pveditbtn'; btn.textContent = '✎'; btn.title = '编辑文字（E）';
  bar.insertBefore(btn, bar.firstChild);

  const panel = document.createElement('div');
  panel.id = 'pvedit';
  panel.innerHTML =
    '<div class="hd"><b>文字编辑</b><span id="pvedev" class="tag"></span>'
  + '<button id="pvclose" title="关闭 (Esc)">✕</button></div>'
  + '<label>文字（用 *包裹* 表示高亮）</label>'
  + '<textarea id="pvtext" rows="3" spellcheck="false"></textarea>'
  + '<div class="row"><label>字号</label><input id="pvsize" type="number" min="30" max="200" step="2">'
  + '<button id="pvhi" title="把选中的字变成高亮">高亮选中</button></div>'
  + '<div class="row"><label>Y</label><input id="pvy" type="number" step="5">'
  + '<button id="pvsave">保存并重建</button></div>'
  + '<div class="row"><button id="pvquote" style="flex:1">引用到对话</button></div>'
  + '<div class="msg" id="pvmsg"></div>';
  document.body.appendChild(panel);

  let editing = false, sel = null;   // sel = {g, it, el}

  function setEditing(on) {
    editing = on;
    document.body.classList.toggle('editing', on);
    btn.style.background = on ? '#FEBD0D' : '#1a1e26';
    btn.style.color = on ? '#111' : '#FEBD0D';
    if (!on) deselect();
  }
  btn.onclick = () => setEditing(!editing);

  function itemEl(it) { return document.getElementById(it.id); }
  function plain(s) { return s.replace(/\*/g, ''); }
  // 这一行在组内的基准偏移（主字 0，副字在主字下方）
  function baseTop(g, it) {
    if (it.role === 'main' || it.role === 'crack') return 0;
    const m = g.items.find(x => x.role === 'main');
    return m ? m.size * 1.16 + 22 : 0;
  }
  function absTop(g, it) { return g.y + baseTop(g, it) + (it.dy || 0); }

  /* ---------- 2. 选中 / 面板 ---------- */
  function select(g, it) {
    sel = { g, it, el: itemEl(it) };
    if (!sel.el) return;
    panel.classList.add('on');
    document.getElementById('pvedev').textContent = DEV_CN[it.device] || it.device;
    const ta = document.getElementById('pvtext');
    ta.value = it.text;
    document.getElementById('pvsize').value = it.size;
    document.getElementById('pvy').value = Math.round(absTop(g, it));
    document.getElementById('pvmsg').textContent = it.id;
    applyOutline();
  }
  function deselect() {
    sel = null; panel.classList.remove('on');
    document.querySelectorAll('.item').forEach(e => e.classList.remove('sel'));
  }
  function applyOutline() {
    document.querySelectorAll('.item').forEach(e => e.classList.remove('sel'));
    if (sel && sel.el) sel.el.classList.add('sel');
  }

  /* ---------- 3. 实时改文字 / 字号 / Y ---------- */
  function rebuildText(el, text) {
    const tw = el.querySelector('.tw');
    if (!tw) return;
    tw.innerHTML = '';
    let acc = false;
    for (const ch of text) {
      if (ch === '*') { acc = !acc; continue; }
      const s = document.createElement('span');
      s.className = 'ch' + (acc ? ' em' : '');
      s.textContent = ch;
      tw.appendChild(s);
    }
  }
  function applyText() {
    if (!sel) return;
    const v = document.getElementById('pvtext').value;
    sel.it.text = v;
    rebuildText(sel.el, v);
    PV.seek(PV.vid.currentTime);            // 重算一次，让新字入场
  }
  function applySize() {
    if (!sel) return;
    const v = Math.max(30, Math.min(200, Number(document.getElementById('pvsize').value) || 0));
    sel.it.size = v;
    sel.el.style.fontSize = v + 'px';
    PV.seek(PV.vid.currentTime);
  }
  function applyY() {   // 只改「这一行」自己的 dy，同组另一行不动
    if (!sel) return;
    const want = Number(document.getElementById('pvy').value) || 0;
    sel.it.dy = (sel.it.dy || 0) + (want - absTop(sel.g, sel.it));
    sel.el.style.top = (baseTop(sel.g, sel.it) + sel.it.dy) + 'px';
    PV.seek(PV.vid.currentTime);
  }
  document.getElementById('pvtext').addEventListener('input', applyText);
  document.getElementById('pvsize').addEventListener('change', applySize);
  document.getElementById('pvy').addEventListener('change', applyY);

  document.getElementById('pvhi').onclick = () => {
    const ta = document.getElementById('pvtext');
    const a = ta.selectionStart, b = ta.selectionEnd;
    if (a === b) { document.getElementById('pvmsg').textContent = '先在文本框里选中几个字'; return; }
    const v = ta.value;
    const picked = v.slice(a, b).replace(/\*/g, '');
    ta.value = v.slice(0, a) + '*' + picked + '*' + v.slice(b);
    ta.dispatchEvent(new Event('input'));
    document.getElementById('pvmsg').textContent = '已高亮：' + picked;
  };

  document.getElementById('pvclose').onclick = deselect;

  /* ---------- 4. 保存 ---------- */
  document.getElementById('pvsave').onclick = async () => {
    const msg = document.getElementById('pvmsg');
    msg.textContent = '保存中…';
    try {
      const r = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'timeline.json', data: T }) });
      const j = await r.json();
      msg.textContent = '已保存 ✅ ' + (j.build || '');
    } catch (e) {
      msg.textContent = '保存失败：需要 preview_server（' + e.message + '）';
    }
  };

  /* ---------- 4b. 引用：把这一片的所有信息拷进剪贴板，粘到对话里 ---------- */
  function toast(m) {
    let t = document.getElementById('pvtoast');
    if (!t) { t = document.createElement('div'); t.id = 'pvtoast'; document.body.appendChild(t); }
    t.textContent = m; t.classList.add('on');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200);
  }
  document.getElementById('pvquote').onclick = async () => {
    if (!sel) return;
    const { g, it } = sel;
    const main = g.items.find(x => x.role === 'main');
    const sub = g.items.find(x => x.role === 'sub');
    const crack = g.items.find(x => x.role === 'crack');
    const f = n => Number(n).toFixed(2);
    const L = [
      `【引用 · ${T.meta.title || 'EP'} · 切片 ${g.id}】`,
      `时间轴：${f(g.t0)}–${f(g.t1)}s（成片时间）`,
      `动效：${DEV_CN[it.device] || it.device}`,
      `位置：y=${Math.round(absTop(g, it))}  dx=${it.dx || 0}  dy=${it.dy || 0}`,
      `字号：${it.size}`,
      `文字：${it.text}`,
    ];
    if (main && sub) {
      L.push(`主字：${main.text}（${main.size}px，${DEV_CN[main.device] || main.device}）`);
      L.push(`副字：${sub.text}（${sub.size}px）`);
    }
    if (crack) L.push(`裂开后第二句：${crack.text}（${crack.size}px）`);
    L.push(`当前播放位置：${f(PV.vid.currentTime)}s`);
    const txt = L.join('\n');
    try {
      await navigator.clipboard.writeText(txt);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    document.getElementById('pvmsg').textContent = '已复制引用';
    toast('已复制到剪贴板 · 直接粘贴到对话里');
  };

  /* ---------- 5. 点选 / 拖动 / 缩放 ---------- */
  document.addEventListener('click', e => {
    if (!editing) return;
    if (e.target.closest('#pvedit') || e.target.closest('#pvbar')) return;
    const el = e.target.closest('.item');
    if (!el) { deselect(); return; }
    const g = T.groups.find(x => x.id === el.closest('.group').id);
    const it = g && g.items.find(x => x.id === el.id);
    if (g && it) select(g, it);
  }, true);

  // 拖动：按住选中的字块移动；右下角小方块缩放
  let drag = null;
  panel.insertAdjacentHTML('beforeend', '<div class="hint">拖动字块移动 · 右下角方块缩放</div>');
  document.addEventListener('mousedown', e => {
    if (!editing || !sel) return;
    if (e.target.closest('#pvedit') || e.target.closest('#pvbar')) return;
    const el = sel.el;
    if (!el.contains(e.target)) return;
    const scale = PV.stageScale ? PV.stageScale() : 1;
    const corner = e.target.classList.contains('rz');
    drag = { x: e.clientX, y: e.clientY, corner, scale,
             dy0: sel.it.dy || 0, dx0: sel.it.dx || 0, size0: sel.it.size,
             s: sel, moved: false };
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / drag.scale;
    const dy = (e.clientY - drag.y) / drag.scale;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    const { g, it, el } = drag.s;
    if (drag.corner) {
      const v = Math.max(30, Math.min(200, Math.round(drag.size0 + dx * 0.35)));
      it.size = v; el.style.fontSize = v + 'px';
      document.getElementById('pvsize').value = v;
    } else {
      it.dy = Math.round(drag.dy0 + dy);
      it.dx = Math.round(drag.dx0 + dx);
      el.style.left = it.dx + 'px';
      el.style.top = (baseTop(g, it) + it.dy) + 'px';
      document.getElementById('pvy').value = Math.round(absTop(g, it));
    }
    PV.seek(PV.vid.currentTime);
  });
  document.addEventListener('mouseup', () => { drag = null; });

  // 给选中块加缩放手柄
  /* 只有「看得见」的字块才响应点击 —— 否则会点到 opacity:0 的隐藏字块 */
  setInterval(() => {
    if (!editing) return;
    document.querySelectorAll('#band .item').forEach(el => {
      const op = parseFloat(el.style.opacity || '0');
      const tw = el.querySelector('.tw');
      if (tw) tw.style.pointerEvents = op > 0.15 ? 'auto' : 'none';
    });
  }, 120);

  setInterval(() => {
    if (!editing || !sel || !sel.el) return;
    if (!sel.el.querySelector('.rz')) {
      const h = document.createElement('div'); h.className = 'rz';
      sel.el.appendChild(h);
    }
    if (sel.el.querySelectorAll('.rz').length > 1)
      [...sel.el.querySelectorAll('.rz')].slice(1).forEach(n => n.remove());
  }, 400);

  /* ---------- 6. 快捷键 ---------- */
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'e' || e.key === 'E') { setEditing(!editing); e.preventDefault(); }
    if (e.key === 'Escape') deselect();
  });
})();
