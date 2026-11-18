/* Baja & Baja — PDF dielnička. Všetko beží lokálne v prehliadači.
   Aplikácia pridáva do PDF vlastné doplnky (text, obrázky, kresby, poznámky),
   spravuje strany, vypĺňa formuláre a konvertuje. Needituje pôvodný text v súbore. */

/* ---------- Čakanie na pdf.js ---------- */
const whenPdfReady = new Promise((res) => {
  if (globalThis.pdfjsLib) return res();
  globalThis.addEventListener('pdfjs-ready', () => res(), { once: true });
});

/* ---------- Pomocníci ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};
const b64ToBytes = (b64) => {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};
const download = (bytes, name, type = 'application/pdf') => {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
const status = (m) => { $('#status').textContent = m; };

/* ---------- Mravček pri práci ---------- */
const busy = {
  show(text = 'Pracujem…') { $('#busyText').textContent = text; $('#busyFill').style.width = '15%'; $('#busy').classList.remove('hidden'); },
  prog(p) { $('#busyFill').style.width = Math.max(5, Math.min(100, p * 100)) + '%'; },
  text(t) { $('#busyText').textContent = t; },
  hide() { $('#busy').classList.add('hidden'); },
};

/* ---------- Stav ---------- */
const PDFLib = globalThis.PDFLib;
const fontkit = globalThis.fontkit;
const FONTS = window.__ASSETS__.fonts; // base64 TTF

const state = {
  name: null,          // názov súboru
  bytes: null,         // Uint8Array pôvodného/aktuálneho PDF
  pdf: null,           // pdf.js dokument
  scale: 1.2,
  tool: 'select',
  annos: {},           // {pageIndex: [anno]}
  pageViews: [],       // {pageEl, canvas, annoLayer, viewport, vp1}
  opt: { color: '#e23b3b', size: 16, fontFamily: 'sans', bold: false, italic: false, draw: 4, hlColor: '#ffe14d', coverColor: '#000000' },
  selected: null,
  dirty: false,
};
let annoSeq = 1;

/* ---------- pdf.js inicializácia ---------- */
async function initPdfjs() {
  await whenPdfReady;
  const workerBlob = new Blob([b64ToBytes(window.__ASSETS__.worker)], { type: 'text/javascript' });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
}

/* ---------- Načítanie PDF ---------- */
async function loadPdf(bytes, name) {
  busy.show('Otváram dokument…');
  try {
    state.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    state.name = name || 'dokument.pdf';
    // Vlastná kópia pre pdf.js (ten si buffer „zoberie“)
    if (state.pdf) { try { await state.pdf.destroy(); } catch {} }
    state.pdf = await pdfjsLib.getDocument({ data: state.bytes.slice(), useSystemFonts: true }).promise;
    state.annos = {};
    state.selected = null;
    state.dirty = false;
    $('#fileName').textContent = state.name;
    $('#btnSave').disabled = false;
    $('#btnPrint').disabled = false;
    $('#welcome').classList.add('hidden');
    await renderAll();
    $('#pageTotal').textContent = state.pdf.numPages;
    $('#goPage').max = state.pdf.numPages; $('#goPage').value = 1;
    status(`${state.pdf.numPages} strán · ${state.name}`);
    toast('Dokument je otvorený 🐜');
  } catch (e) {
    console.error(e); toast('Súbor sa nepodarilo otvoriť. Je to platné PDF?', 4000);
    $('#welcome').classList.remove('hidden');
  } finally { busy.hide(); }
}

async function renderAll() {
  const pagesBox = $('#pages'); pagesBox.innerHTML = '';
  state.pageViews = [];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (let i = 1; i <= state.pdf.numPages; i++) {
    const page = await state.pdf.getPage(i);
    const viewport = page.getViewport({ scale: state.scale });
    const vp1 = page.getViewport({ scale: 1 });
    const wrap = el('div', { class: 'page-wrap' });
    wrap.style.width = viewport.width + 'px';
    wrap.style.height = viewport.height + 'px';
    wrap.append(el('div', { class: 'page-num', text: `Strana ${i} / ${state.pdf.numPages}` }));
    const canvas = el('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    const ctx = canvas.getContext('2d');
    wrap.append(canvas);
    const textLayer = el('div', { class: 'textLayer' });
    wrap.append(textLayer);
    const annoLayer = el('div', { class: 'anno-layer' });
    annoLayer.dataset.page = i - 1;
    wrap.append(annoLayer);
    pagesBox.append(wrap);

    await page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
    // Textová vrstva (výber a vyhľadávanie)
    try {
      pdfjsLib.setLayerDimensions(textLayer, viewport);
      const tl = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport });
      await tl.render();
    } catch (e) { /* textová vrstva nie je kritická */ }

    const pv = { page, wrap, canvas, textLayer, annoLayer, viewport, vp1, index: i - 1 };
    state.pageViews.push(pv);
    attachLayerHandlers(pv);
    renderAnnos(pv);
  }
}

/* ---------- Nástroje ---------- */
function setTool(t) {
  state.tool = t;
  $$('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  $$('.anno-layer').forEach((l) => { l.style.cursor = (t === 'select') ? 'default' : 'crosshair'; });
  renderOptions();
  if (t !== 'select') selectAnno(null);
}

function renderOptions() {
  const box = $('#options'); box.innerHTML = '';
  const colorRow = (label, key, colors) => {
    const g = el('div', { class: 'opt-group' }, [el('h4', { text: label })]);
    const sw = el('div', { class: 'swatches' });
    colors.forEach((c) => {
      const s = el('div', { class: 'swatch' + (state.opt[key] === c ? ' sel' : ''), style: `background:${c}` });
      s.onclick = () => { state.opt[key] = c; renderOptions(); if (state.selected) applyOptToSelected(); };
      sw.append(s);
    });
    g.append(sw); return g;
  };
  const palette = ['#e23b3b', '#1f6feb', '#13a463', '#f0a202', '#8a3ffc', '#111111', '#ffffff'];
  if (state.tool === 'text' || state.tool === 'note') {
    box.append(colorRow('Farba textu', 'color', palette));
    const g = el('div', { class: 'opt-group' }, [el('h4', { text: 'Písmo' })]);
    const famRow = el('div', { class: 'opt-row' });
    const sel = el('select');
    [['sans', 'Bezpätkové'], ['serif', 'Pätkové'], ['mono', 'Strojopis']].forEach(([v, t]) => sel.append(el('option', { value: v, text: t, ...(state.opt.fontFamily === v ? { selected: 'selected' } : {}) })));
    sel.onchange = () => { state.opt.fontFamily = sel.value; if (state.selected) applyOptToSelected(); };
    famRow.append(sel); g.append(famRow);
    const sizeRow = el('div', { class: 'opt-row' }, [el('label', { text: 'Veľkosť' })]);
    const size = el('input', { type: 'number', min: 6, max: 96, value: state.opt.size });
    size.oninput = () => { state.opt.size = +size.value || 16; if (state.selected) applyOptToSelected(); };
    sizeRow.append(size); g.append(sizeRow);
    const bi = el('div', { class: 'opt-row' });
    const bBtn = el('button', { class: 'btn' + (state.opt.bold ? ' primary' : ''), text: 'B', style: 'font-weight:800;flex:1' });
    bBtn.onclick = () => { state.opt.bold = !state.opt.bold; renderOptions(); if (state.selected) applyOptToSelected(); };
    const iBtn = el('button', { class: 'btn' + (state.opt.italic ? ' primary' : ''), text: 'I', style: 'font-style:italic;flex:1' });
    iBtn.onclick = () => { state.opt.italic = !state.opt.italic; renderOptions(); if (state.selected) applyOptToSelected(); };
    bi.append(bBtn, iBtn); g.append(bi);
    box.append(g);
    box.append(el('p', { class: 'note-small', text: 'Klikni do strany a píš. Text vieš potiahnuť a kedykoľvek prepísať.' }));
  } else if (state.tool === 'draw') {
    box.append(colorRow('Farba pera', 'color', palette));
    const g = el('div', { class: 'opt-group' }, [el('h4', { text: 'Hrúbka' })]);
    const row = el('div', { class: 'opt-row' });
    const r = el('input', { type: 'range', min: 1, max: 20, value: state.opt.draw });
    r.oninput = () => { state.opt.draw = +r.value; };
    row.append(r); g.append(row); box.append(g);
  } else if (state.tool === 'highlight') {
    box.append(colorRow('Farba zvýraznenia', 'hlColor', ['#ffe14d', '#9dff7a', '#7ad0ff', '#ff9ad0', '#ffb366']));
    box.append(el('p', { class: 'note-small', text: 'Ťahaj cez text, ktorý chceš zvýrazniť.' }));
  } else if (state.tool === 'cover') {
    box.append(colorRow('Farba prekrytia', 'coverColor', ['#000000', '#ffffff', '#e23b3b', '#1f6feb', '#808080']));
    box.append(el('p', { class: 'note-small', text: 'Ťahom spravíš nepriehľadný obdĺžnik cez časť strany. Je viditeľný — každý vidí, že tam je prekrytie.' }));
  } else if (state.tool === 'rect' || state.tool === 'line') {
    box.append(colorRow('Farba', 'color', palette));
    const g = el('div', { class: 'opt-group' }, [el('h4', { text: 'Hrúbka' })]);
    const row = el('div', { class: 'opt-row' });
    const r = el('input', { type: 'range', min: 1, max: 16, value: state.opt.draw });
    r.oninput = () => { state.opt.draw = +r.value; };
    row.append(r); g.append(row); box.append(g);
  } else if (state.tool === 'image') {
    box.append(el('div', { class: 'opt-group' }, [el('h4', { text: 'Obrázok' }), el('button', { class: 'btn primary', text: 'Vybrať obrázok…', style: 'width:100%', onclick: () => $('#hiddenImg').click() })]));
    box.append(el('p', { class: 'note-small', text: 'Obrázok sa vloží do strany. Potom ho vieš posúvať a meniť veľkosť rožtekom.' }));
  } else if (state.tool === 'erase') {
    box.append(el('p', { class: 'note-small', text: 'Klikni na doplnok, ktorý chceš zmazať. (Pôvodný obsah PDF ostáva nedotknutý.)' }));
  } else {
    box.append(el('div', { class: 'opt-empty', text: 'Výber: klikni na doplnok, posuň ho alebo uprav.' }));
  }
}

/* ---------- Anotácie: dátový model ----------
   Súradnice ukladáme vo „vizuálnych bodoch“ (scale 1), origin vľavo hore, y nadol. */
function addAnno(pageIndex, anno) {
  anno.id = annoSeq++;
  (state.annos[pageIndex] ||= []).push(anno);
  state.dirty = true;
  const pv = state.pageViews[pageIndex];
  renderAnnos(pv);
  return anno;
}
function deleteAnno(pageIndex, id) {
  const arr = state.annos[pageIndex] || [];
  const i = arr.findIndex((a) => a.id === id);
  if (i >= 0) { arr.splice(i, 1); state.dirty = true; renderAnnos(state.pageViews[pageIndex]); selectAnno(null); }
}
function selectAnno(sel) {
  state.selected = sel;
  $$('.anno').forEach((n) => n.classList.remove('editing'));
  if (sel) { const node = sel.pv.annoLayer.querySelector(`[data-id="${sel.anno.id}"]`); node?.classList.add('editing'); renderOptions(); }
}
function applyOptToSelected() {
  const a = state.selected?.anno; if (!a) return;
  if (a.type === 'text' || a.type === 'note') {
    a.color = state.opt.color; a.size = state.opt.size; a.font = state.opt.fontFamily; a.bold = state.opt.bold; a.italic = state.opt.italic;
  } else if (a.type === 'rect' || a.type === 'line' || a.type === 'ink') { a.color = state.opt.color; }
  state.dirty = true; renderAnnos(state.selected.pv);
}

/* ---------- Vykreslenie anotácií ---------- */
function renderAnnos(pv) {
  if (!pv) return;
  const s = state.scale;
  pv.annoLayer.innerHTML = '';
  const list = state.annos[pv.index] || [];
  // SVG pre kresby, čiary, rámiky, zvýraznenia
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'draw-svg');
  svg.setAttribute('width', pv.viewport.width); svg.setAttribute('height', pv.viewport.height);
  pv.annoLayer.append(svg);
  for (const a of list) {
    if (a.type === 'ink') {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', 'M ' + a.points.map((pt) => `${pt.x * s} ${pt.y * s}`).join(' L '));
      p.setAttribute('stroke', a.color); p.setAttribute('stroke-width', a.width * s);
      p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
      svg.append(p);
    } else if (a.type === 'highlight') {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', a.x * s); r.setAttribute('y', a.y * s); r.setAttribute('width', a.w * s); r.setAttribute('height', a.h * s);
      r.setAttribute('fill', a.color); r.setAttribute('fill-opacity', '0.4'); svg.append(r);
    } else if (a.type === 'cover') {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', a.x * s); r.setAttribute('y', a.y * s); r.setAttribute('width', a.w * s); r.setAttribute('height', a.h * s);
      r.setAttribute('fill', a.color || '#000000'); svg.append(r);
    } else if (a.type === 'rect') {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', a.x * s); r.setAttribute('y', a.y * s); r.setAttribute('width', a.w * s); r.setAttribute('height', a.h * s);
      r.setAttribute('fill', 'none'); r.setAttribute('stroke', a.color); r.setAttribute('stroke-width', a.width * s); svg.append(r);
    } else if (a.type === 'line') {
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', a.x1 * s); l.setAttribute('y1', a.y1 * s); l.setAttribute('x2', a.x2 * s); l.setAttribute('y2', a.y2 * s);
      l.setAttribute('stroke', a.color); l.setAttribute('stroke-width', a.width * s); l.setAttribute('stroke-linecap', 'round'); svg.append(l);
    }
  }
  // HTML pre text, poznámky, obrázky
  for (const a of list) {
    if (a.type === 'text') pv.annoLayer.append(buildTextAnno(pv, a));
    else if (a.type === 'note') pv.annoLayer.append(buildNoteAnno(pv, a));
    else if (a.type === 'image') pv.annoLayer.append(buildImageAnno(pv, a));
    else if (a.type === 'ink' || a.type === 'highlight' || a.type === 'rect' || a.type === 'cover' || a.type === 'line') {
      // neviditeľný „hit“ prvok na výber/zmazanie
      pv.annoLayer.append(buildHitAnno(pv, a));
    }
  }
}
const fontCss = (fam) => fam === 'serif' ? 'Georgia,"Times New Roman",serif' : fam === 'mono' ? '"Courier New",monospace' : 'Arial,Helvetica,sans-serif';

function commonNodeSetup(pv, a, node) {
  node.dataset.id = a.id;
  const delBtn = el('button', { class: 'anno-del', text: '✕', onclick: (e) => { e.stopPropagation(); deleteAnno(pv.index, a.id); } });
  node.append(delBtn);
  node.addEventListener('pointerdown', (e) => {
    if (state.tool === 'erase') { deleteAnno(pv.index, a.id); return; }
    if (state.tool !== 'select') return;
    if (e.target.classList.contains('anno-handle') || e.target.isContentEditable) return;
    selectAnno({ pv, anno: a });
    startDrag(e, pv, a, node);
  });
  return node;
}
function buildTextAnno(pv, a) {
  const s = state.scale;
  const node = el('div', { class: 'anno' });
  node.style.left = a.x * s + 'px'; node.style.top = a.y * s + 'px';
  const edit = el('div', { class: 'anno-text', contenteditable: 'true' });
  edit.textContent = a.text;
  edit.style.cssText = `color:${a.color};font-family:${fontCss(a.font)};font-size:${a.size * s}px;font-weight:${a.bold ? 700 : 400};font-style:${a.italic ? 'italic' : 'normal'};line-height:1.25`;
  edit.addEventListener('input', () => { a.text = edit.textContent; state.dirty = true; });
  edit.addEventListener('focus', () => selectAnno({ pv, anno: a }));
  node.append(edit);
  commonNodeSetup(pv, a, node);
  if (a._focus) { a._focus = false; setTimeout(() => { edit.focus(); document.getSelection().selectAllChildren(edit); }, 0); }
  return node;
}
function buildNoteAnno(pv, a) {
  const s = state.scale;
  const node = el('div', { class: 'anno' });
  node.style.left = a.x * s + 'px'; node.style.top = a.y * s + 'px';
  const box = el('div', { class: 'anno-note' });
  box.style.width = (a.w || 160) * s + 'px';
  const edit = el('div', { class: 'anno-text', contenteditable: 'true', style: `font-size:${14 * s}px` });
  edit.textContent = a.text; edit.addEventListener('input', () => { a.text = edit.textContent; state.dirty = true; });
  box.append(edit); node.append(box);
  commonNodeSetup(pv, a, node);
  if (a._focus) { a._focus = false; setTimeout(() => edit.focus(), 0); }
  return node;
}
function buildImageAnno(pv, a) {
  const s = state.scale;
  const node = el('div', { class: 'anno anno-img' });
  node.style.left = a.x * s + 'px'; node.style.top = a.y * s + 'px';
  node.style.width = a.w * s + 'px'; node.style.height = a.h * s + 'px';
  node.append(el('img', { src: a.dataUrl, draggable: 'false' }));
  const handle = el('div', { class: 'anno-handle' });
  handle.addEventListener('pointerdown', (e) => { e.stopPropagation(); startResize(e, pv, a, node, true); });
  node.append(handle);
  commonNodeSetup(pv, a, node);
  return node;
}
function buildHitAnno(pv, a) {
  const s = state.scale;
  let x, y, w, h;
  if (a.type === 'ink') {
    const xs = a.points.map((p) => p.x), ys = a.points.map((p) => p.y);
    x = Math.min(...xs); y = Math.min(...ys); w = Math.max(...xs) - x; h = Math.max(...ys) - y;
  } else if (a.type === 'line') { x = Math.min(a.x1, a.x2); y = Math.min(a.y1, a.y2); w = Math.abs(a.x2 - a.x1); h = Math.abs(a.y2 - a.y1); }
  else { x = a.x; y = a.y; w = a.w; h = a.h; }
  const node = el('div', { class: 'anno' });
  node.style.left = x * s + 'px'; node.style.top = y * s + 'px';
  node.style.width = Math.max(10, w * s) + 'px'; node.style.height = Math.max(10, h * s) + 'px';
  node.style.background = 'transparent';
  commonNodeSetup(pv, a, node);
  return node;
}

/* ---------- Drag & resize ---------- */
function startDrag(e, pv, a, node) {
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  a._orig = snapshotPos(a);
  const move = (ev) => dragStep(ev, pv, a, sx, sy);
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); state.dirty = true; };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}
function snapshotPos(a) {
  if (a.type === 'line') return { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 };
  if (a.type === 'ink') return { points: a.points.map((p) => ({ ...p })) };
  return { x: a.x, y: a.y };
}
function dragStep(ev, pv, a, sx, sy) {
  const s = state.scale; const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s; const o = a._orig;
  if (a.type === 'line') { a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; }
  else if (a.type === 'ink') { a.points = o.points.map((p) => ({ x: p.x + dx, y: p.y + dy })); }
  else { a.x = o.x + dx; a.y = o.y + dy; }
  renderAnnos(pv); pv.annoLayer.querySelector(`[data-id="${a.id}"]`)?.classList.add('editing');
}
function startResize(e, pv, a, node, keepRatio) {
  e.preventDefault();
  const s = state.scale; const sx = e.clientX, sy = e.clientY; const ow = a.w, oh = a.h; const ratio = ow / oh;
  const move = (ev) => {
    let nw = ow + (ev.clientX - sx) / s; let nh = oh + (ev.clientY - sy) / s;
    if (keepRatio) { nh = nw / ratio; }
    a.w = Math.max(12, nw); a.h = Math.max(12, nh);
    renderAnnos(pv); pv.annoLayer.querySelector(`[data-id="${a.id}"]`)?.classList.add('editing');
  };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); state.dirty = true; };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}

/* ---------- Kreslenie na vrstvu ---------- */
function attachLayerHandlers(pv) {
  const layer = pv.annoLayer;
  layer.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.anno') && state.tool === 'select') return;
    const s = state.scale; const rect = layer.getBoundingClientRect();
    const x = (e.clientX - rect.left) / s, y = (e.clientY - rect.top) / s;
    const t = state.tool;
    if (t === 'text') {
      selectTool('select');
      const a = addAnno(pv.index, { type: 'text', x, y, text: 'Napíš text…', color: state.opt.color, size: state.opt.size, font: state.opt.fontFamily, bold: state.opt.bold, italic: state.opt.italic, _focus: true });
      selectAnno({ pv, anno: a });
    } else if (t === 'note') {
      selectTool('select');
      const a = addAnno(pv.index, { type: 'note', x, y, w: 170, text: 'Poznámka…', _focus: true });
      selectAnno({ pv, anno: a });
    } else if (t === 'draw') { startInk(e, pv, x, y); }
    else if (t === 'highlight') { startRectDrag(e, pv, x, y, 'highlight'); }
    else if (t === 'cover') { startRectDrag(e, pv, x, y, 'cover'); }
    else if (t === 'rect') { startRectDrag(e, pv, x, y, 'rect'); }
    else if (t === 'line') { startLineDrag(e, pv, x, y); }
    else if (t === 'select') { selectAnno(null); }
  });
}
function layerPoint(pv, e) {
  const s = state.scale; const rect = pv.annoLayer.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
}
function startInk(e, pv, x, y) {
  const a = { type: 'ink', color: state.opt.color, width: state.opt.draw, points: [{ x, y }] };
  a.id = annoSeq++; (state.annos[pv.index] ||= []).push(a);
  const move = (ev) => { const p = layerPoint(pv, ev); a.points.push(p); renderAnnos(pv); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); state.dirty = true; renderAnnos(pv); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function startRectDrag(e, pv, x0, y0, type) {
  const a = { type, x: x0, y: y0, w: 1, h: 1, color: type === 'highlight' ? state.opt.hlColor : (type === 'cover' ? state.opt.coverColor : state.opt.color), width: state.opt.draw };
  a.id = annoSeq++; (state.annos[pv.index] ||= []).push(a);
  const move = (ev) => { const p = layerPoint(pv, ev); a.x = Math.min(x0, p.x); a.y = Math.min(y0, p.y); a.w = Math.abs(p.x - x0); a.h = Math.abs(p.y - y0); renderAnnos(pv); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (a.w < 3 && a.h < 3) deleteAnno(pv.index, a.id); else { state.dirty = true; renderAnnos(pv); } };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function startLineDrag(e, pv, x0, y0) {
  const a = { type: 'line', x1: x0, y1: y0, x2: x0, y2: y0, color: state.opt.color, width: state.opt.draw };
  a.id = annoSeq++; (state.annos[pv.index] ||= []).push(a);
  const move = (ev) => { const p = layerPoint(pv, ev); a.x2 = p.x; a.y2 = p.y; renderAnnos(pv); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); state.dirty = true; renderAnnos(pv); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
const selectTool = setTool;

/* ---------- Vkladanie obrázka ---------- */
$('#hiddenImg').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
  const img = new Image(); img.src = dataUrl;
  await img.decode().catch(() => {});
  const pv = state.pageViews[0]; if (!pv) return;
  const maxW = pv.vp1.width * 0.5; let w = Math.min(img.naturalWidth || 200, maxW); let h = w * ((img.naturalHeight || 150) / (img.naturalWidth || 200));
  const a = addAnno(0, { type: 'image', x: pv.vp1.width / 2 - w / 2, y: pv.vp1.height / 2 - h / 2, w, h, dataUrl });
  selectTool('select'); selectAnno({ pv, anno: a });
  toast('Obrázok vložený. Potiahni ho na miesto.');
});

/* ---------- Embedovanie písiem do pdf-lib ---------- */
async function embedFonts(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);
  const cache = {};
  const pick = (fam, bold, italic) => {
    const key = fam + (bold ? 'B' : '') + (italic ? 'I' : '');
    const map = {
      sans: 'sans', sansB: 'sansB', sansI: 'sansI', sansBI: 'sansBI',
      serif: 'serif', serifB: 'serifB', serifI: 'serifI', serifBI: 'serifBI',
      mono: 'mono', monoB: 'monoB', monoI: 'monoI', monoBI: 'monoBI',
    };
    let variant = fam;
    if (bold && italic) variant = fam + 'BI'; else if (bold) variant = fam + 'B'; else if (italic) variant = fam + 'I';
    return map[variant] || fam;
  };
  const get = async (fam, bold, italic) => {
    const v = pick(fam, bold, italic);
    if (!cache[v]) cache[v] = await pdfDoc.embedFont(b64ToBytes(FONTS[v] || FONTS.sans), { subset: true });
    return cache[v];
  };
  return get;
}

/* ---------- Uloženie PDF s doplnkami ---------- */
async function buildOutputPdf() {
  const { PDFDocument, rgb, degrees } = PDFLib;
  const pdfDoc = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
  const getFont = await embedFonts(pdfDoc);
  const pages = pdfDoc.getPages();
  const hex = (h) => { const n = h.replace('#', ''); return rgb(parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255); };

  for (let i = 0; i < pages.length; i++) {
    const list = state.annos[i]; if (!list || !list.length) continue;
    const page = pages[i];
    const pv = state.pageViews[i];
    // prevod vizuálneho bodu (scale1, origin vľavo-hore) na user-space pdf-lib
    const conv = (vx, vy) => { const [ux, uy] = pv.vp1.convertToPdfPoint(vx, vy); return { x: ux, y: uy }; };
    const rot = (pv.vp1.rotation || 0);
    const angleFor = () => {
      // uhol „doprava“ vo vizuále → user space
      const p0 = conv(0, 0), pr = conv(1, 0);
      return Math.atan2(pr.y - p0.y, pr.x - p0.x) * 180 / Math.PI;
    };
    const ang = angleFor();

    for (const a of list) {
      try {
        if (a.type === 'text' || a.type === 'note') {
          const font = await getFont(a.font || 'sans', !!a.bold, !!a.italic);
          const size = a.size || 14;
          const lines = (a.text || '').split('\n');
          const startTop = a.type === 'note' ? a.y + 8 : a.y;
          const startLeft = a.type === 'note' ? a.x + 8 : a.x;
          if (a.type === 'note') {
            // žlté pozadie lístka
            const w = (a.w || 160), lineH = 14 * 1.25, h = Math.max(30, lines.length * lineH + 12);
            const tl = conv(a.x, a.y), br = conv(a.x + w, a.y + h);
            page.drawRectangle({ x: Math.min(tl.x, br.x), y: Math.min(tl.y, br.y), width: Math.abs(br.x - tl.x), height: Math.abs(br.y - tl.y), color: rgb(1, 0.957, 0.72), opacity: 0.95 });
          }
          const nsize = a.type === 'note' ? 14 : size;
          lines.forEach((ln, k) => {
            const topY = startTop + k * nsize * 1.25;
            const base = conv(startLeft, topY + nsize * 0.8);
            page.drawText(ln, { x: base.x, y: base.y, size: nsize, font, color: a.type === 'note' ? rgb(0.1, 0.1, 0.1) : hex(a.color || '#111111'), rotate: degrees(ang) });
          });
        } else if (a.type === 'image') {
          const isPng = a.dataUrl.startsWith('data:image/png');
          const bytes = b64ToBytes(a.dataUrl.split(',')[1]);
          const img = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes).catch(async () => await pdfDoc.embedPng(bytes));
          const bl = conv(a.x, a.y + a.h); // vizuálny ľavý-dolný roh
          page.drawImage(img, { x: bl.x, y: bl.y, width: a.w, height: a.h, rotate: degrees(ang) });
        } else if (a.type === 'highlight' || a.type === 'rect' || a.type === 'cover') {
          const tl = conv(a.x, a.y), br = conv(a.x + a.w, a.y + a.h);
          const x = Math.min(tl.x, br.x), y = Math.min(tl.y, br.y), w = Math.abs(br.x - tl.x), h = Math.abs(br.y - tl.y);
          if (a.type === 'highlight') page.drawRectangle({ x, y, width: w, height: h, color: hex(a.color), opacity: 0.4 });
          else if (a.type === 'cover') page.drawRectangle({ x, y, width: w, height: h, color: hex(a.color || '#000000'), opacity: 1 });
          else page.drawRectangle({ x, y, width: w, height: h, borderColor: hex(a.color), borderWidth: a.width || 2, opacity: 0 });
        } else if (a.type === 'line') {
          const p1 = conv(a.x1, a.y1), p2 = conv(a.x2, a.y2);
          page.drawLine({ start: p1, end: p2, thickness: a.width || 2, color: hex(a.color) });
        } else if (a.type === 'ink') {
          for (let k = 1; k < a.points.length; k++) {
            const p1 = conv(a.points[k - 1].x, a.points[k - 1].y), p2 = conv(a.points[k].x, a.points[k].y);
            page.drawLine({ start: p1, end: p2, thickness: a.width || 2, color: hex(a.color) });
          }
        }
      } catch (err) { console.warn('anno skip', err); }
    }
  }
  return pdfDoc;
}

async function savePdf() {
  if (!state.bytes) return;
  busy.show('Skladám hotové PDF…');
  try {
    const pdfDoc = await buildOutputPdf();
    const out = await pdfDoc.save({ useObjectStreams: true });
    download(out, outName(state.name));
    toast('Uložené 🐜  Hľadaj v stiahnutých súboroch.');
    status('Hotové PDF bolo uložené.');
  } catch (e) { console.error(e); toast('Pri ukladaní nastala chyba.', 4000); }
  finally { busy.hide(); }
}
const outName = (n) => n.replace(/\.pdf$/i, '') + '-upravene.pdf';

/* ---------- Zoom ---------- */
async function setZoom(z) {
  state.scale = Math.max(0.3, Math.min(4, z));
  $('#zoomVal').textContent = Math.round(state.scale * 100) + ' %';
  if (state.pdf) { const sc = $('#viewer').scrollTop; await renderAll(); $('#viewer').scrollTop = sc; }
}

/* ---------- Tlač, skok na stranu, na šírku ---------- */
async function printPdf() {
  if (!state.bytes) return;
  busy.show('Pripravujem tlač…');
  try {
    const pdfDoc = await buildOutputPdf();
    const out = await pdfDoc.save({ useObjectStreams: true });
    const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
    const w = window.open(url, '_blank');
    if (w) { w.addEventListener('load', () => { try { w.focus(); w.print(); } catch {} }); toast('Dokument sa otvoril — vytlač ho cez ponuku prehliadača.'); }
    else { download(out, outName(state.name)); toast('Prehliadač zablokoval okno — súbor sa stiahol, otvor a vytlač ho.'); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { console.error(e); toast('Tlač zlyhala.'); } finally { busy.hide(); }
}
function goToPage(n) {
  const i = Math.max(1, Math.min(state.pdf?.numPages || 1, n | 0));
  const pv = state.pageViews[i - 1]; if (pv) pv.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function fitWidth() {
  if (!state.pdf) return;
  const pv = state.pageViews[0]; if (!pv) return;
  const avail = $('#viewer').clientWidth - 56;
  await setZoom(avail / pv.vp1.width);
}

/* ========== DIALÓGY ========== */
function openSheet(title, buildFn) {
  const body = $('#sheetBody'); body.innerHTML = '';
  body.append(el('h2', { text: title }));
  buildFn(body);
  $('#sheet').classList.remove('hidden');
}
const closeSheet = () => $('#sheet').classList.add('hidden');

/* ---------- Strany ---------- */
async function openPages() {
  if (!state.pdf) return toast('Najprv otvor PDF.');
  openSheet('Strany dokumentu', async (body) => {
    body.append(el('p', { class: 'note-small', text: 'Potiahnutím zmeníš poradie. Zmeny strán uložia aj doteraz pridané doplnky.' }));
    const actions = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0' }, [
      el('button', { class: 'btn', text: '➕ Pripojiť iné PDF', onclick: () => $('#hiddenMerge').click() }),
      el('button', { class: 'btn', text: '✂️ Rozdeliť / vybrať strany', onclick: openSplit }),
      el('button', { class: 'btn', text: '📄 Prázdna strana', onclick: addBlankPage }),
      el('button', { class: 'btn', text: '💧 Vodoznak', onclick: addWatermark }),
      el('button', { class: 'btn', text: '🔢 Číslovať strany', onclick: addPageNumbers }),
    ]);
    body.append(actions);
    const grid = el('div', { class: 'thumbs' }); body.append(grid);
    grid.append(el('div', { text: 'Načítavam náhľady…', class: 'note-small' }));
    const order = [...Array(state.pdf.numPages).keys()];
    await renderThumbs(grid, order);
  });
}
async function renderThumbs(grid, order) {
  grid.innerHTML = '';
  for (let pos = 0; pos < order.length; pos++) {
    const pi = order[pos];
    const page = await state.pdf.getPage(pi + 1);
    const vp = page.getViewport({ scale: 0.3 });
    const c = el('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const t = el('div', { class: 'thumb', draggable: 'true' });
    t.dataset.pi = pi; t.dataset.pos = pos;
    t.append(c, el('div', { class: 'tnum', text: `Strana ${pi + 1}` }));
    const tools = el('div', { class: 'thumb-tools' }, [
      el('button', { text: '↺', title: 'Otočiť vľavo', onclick: () => rotatePage(pi, -90) }),
      el('button', { text: '↻', title: 'Otočiť vpravo', onclick: () => rotatePage(pi, 90) }),
      el('button', { text: '⧉', title: 'Duplikovať stranu', onclick: () => duplicatePage(pi) }),
      el('button', { text: '🗑', title: 'Zmazať stranu', onclick: () => removePage(pi) }),
    ]);
    t.append(tools);
    t.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', pos); });
    t.addEventListener('dragover', (e) => { e.preventDefault(); t.classList.add('dragover'); });
    t.addEventListener('dragleave', () => t.classList.remove('dragover'));
    t.addEventListener('drop', async (e) => {
      e.preventDefault(); t.classList.remove('dragover');
      const from = +e.dataTransfer.getData('text/plain'); const to = pos;
      if (from === to) return;
      const arr = order.slice(); const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
      await applyReorder(arr);
    });
    grid.append(t);
  }
}
async function flattenCurrent() {
  // zapečie doplnky do bytov, aby štrukturálne operácie o ne neprišli
  if (state.dirty && Object.values(state.annos).some((a) => a && a.length)) {
    const doc = await buildOutputPdf();
    state.bytes = await doc.save({ useObjectStreams: true });
  }
}
async function reloadFrom(bytes, keepName = true) {
  await loadPdf(bytes, keepName ? state.name : state.name);
}
async function rotatePage(pi, deg) {
  busy.show('Otáčam stranu…');
  try { await flattenCurrent();
    const { PDFDocument, degrees } = PDFLib;
    const doc = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
    const p = doc.getPage(pi); const cur = p.getRotation().angle; p.setRotation(degrees((cur + deg + 360) % 360));
    state.bytes = await doc.save(); await reloadFrom(state.bytes);
  } catch (e) { console.error(e); toast('Otočenie zlyhalo.'); } finally { busy.hide(); openPages(); }
}
async function removePage(pi) {
  if (state.pdf.numPages <= 1) return toast('Dokument musí mať aspoň jednu stranu.');
  busy.show('Mažem stranu…');
  try { await flattenCurrent();
    const { PDFDocument } = PDFLib; const doc = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
    doc.removePage(pi); state.bytes = await doc.save(); await reloadFrom(state.bytes);
  } catch (e) { console.error(e); toast('Mazanie zlyhalo.'); } finally { busy.hide(); openPages(); }
}
async function applyReorder(order) {
  busy.show('Mením poradie…');
  try { await flattenCurrent();
    const { PDFDocument } = PDFLib; const src = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
    const out = await PDFDocument.create(); const copied = await out.copyPages(src, order);
    copied.forEach((p) => out.addPage(p)); state.bytes = await out.save(); await reloadFrom(state.bytes);
  } catch (e) { console.error(e); toast('Zmena poradia zlyhala.'); } finally { busy.hide(); openPages(); }
}
$('#hiddenMerge').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  busy.show('Pripájam dokumenty…');
  try { await flattenCurrent();
    const { PDFDocument } = PDFLib; const out = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
    for (const f of files) {
      const ab = await f.arrayBuffer(); const src = await PDFDocument.load(ab, { ignoreEncryption: true });
      const cp = await out.copyPages(src, src.getPageIndices()); cp.forEach((p) => out.addPage(p));
    }
    state.bytes = await out.save(); await reloadFrom(state.bytes); toast('Dokumenty spojené.');
  } catch (err) { console.error(err); toast('Spájanie zlyhalo.'); } finally { busy.hide(); openPages(); }
});
function openSplit() {
  openSheet('Rozdeliť / vybrať strany', (body) => {
    body.append(el('p', { class: 'note-small', text: `Dokument má ${state.pdf.numPages} strán. Zadaj, ktoré chceš vybrať (napr. 1-3,5,8).` }));
    const inp = el('input', { type: 'text', placeholder: 'napr. 1-3,5', style: 'width:100%;padding:8px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--ink);margin:8px 0' });
    body.append(inp);
    body.append(el('button', { class: 'btn primary', text: 'Uložiť vybrané ako nové PDF', onclick: async () => {
      const idx = parseRanges(inp.value, state.pdf.numPages);
      if (!idx.length) return toast('Zadaj platný rozsah.');
      busy.show('Vyberám strany…');
      try { await flattenCurrent();
        const { PDFDocument } = PDFLib; const src = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
        const out = await PDFDocument.create(); const cp = await out.copyPages(src, idx); cp.forEach((p) => out.addPage(p));
        const bytes = await out.save(); download(bytes, state.name.replace(/\.pdf$/i, '') + '-vyber.pdf'); toast('Výber uložený.');
      } catch (e) { console.error(e); toast('Výber zlyhal.'); } finally { busy.hide(); }
    } }));
  });
}
function parseRanges(s, max) {
  const out = new Set();
  for (const part of (s || '').split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max) out.add(i - 1);
  }
  return [...out];
}

/* ---------- Vodoznak, číslovanie, prázdna/duplikovaná strana ---------- */
async function addWatermark() {
  openSheet('Vodoznak', (body) => {
    body.append(el('p', { class: 'note-small', text: 'Text sa šikmo pretlačí cez všetky strany (napr. NÁVRH, KÓPIA, DÔVERNÉ).' }));
    const inp = el('input', { type: 'text', value: 'NÁVRH', style: 'width:100%;padding:8px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--ink);margin:8px 0' });
    body.append(inp);
    const op = el('input', { type: 'range', min: 5, max: 60, value: 18 });
    body.append(el('div', { class: 'opt-row' }, [el('label', { text: 'Priehľadnosť' }), op]));
    body.append(el('button', { class: 'btn primary', text: 'Pridať vodoznak', onclick: async () => {
      const text = inp.value.trim(); if (!text) return;
      busy.show('Pridávam vodoznak…');
      try { await flattenCurrent();
        const { PDFDocument, degrees, rgb } = PDFLib; const doc = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
        doc.registerFontkit(fontkit); const font = await doc.embedFont(b64ToBytes(FONTS.sansB), { subset: true });
        const opacity = (+op.value) / 100;
        for (const page of doc.getPages()) {
          const { width, height } = page.getSize(); const size = Math.max(24, Math.min(width, height) / 8);
          const tw = font.widthOfTextAtSize(text, size);
          page.drawText(text, { x: width / 2 - tw / 2 * 0.7, y: height / 2 - size / 2, size, font, color: rgb(0.5, 0.5, 0.5), opacity, rotate: degrees(45) });
        }
        state.bytes = await doc.save(); await reloadFrom(state.bytes); toast('Vodoznak pridaný.');
      } catch (e) { console.error(e); toast('Vodoznak zlyhal.'); } finally { busy.hide(); }
    } }));
  });
}
async function addPageNumbers() {
  openSheet('Číslovať strany', (body) => {
    body.append(el('p', { class: 'note-small', text: 'Dole v strede pribudne číslo strany.' }));
    const fmtSel = el('select', { style: 'width:100%;padding:8px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--ink);margin:8px 0' });
    [['n', '1, 2, 3 …'], ['n_total', '1 / N'], ['strana_n', 'Strana 1']].forEach(([v, t]) => fmtSel.append(el('option', { value: v, text: t })));
    body.append(fmtSel);
    body.append(el('button', { class: 'btn primary', text: 'Pridať čísla strán', onclick: async () => {
      busy.show('Číslujem strany…');
      try { await flattenCurrent();
        const { PDFDocument, rgb } = PDFLib; const doc = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
        doc.registerFontkit(fontkit); const font = await doc.embedFont(b64ToBytes(FONTS.sans), { subset: true });
        const pages = doc.getPages();
        pages.forEach((page, i) => {
          const { width } = page.getSize(); let t = String(i + 1);
          if (fmtSel.value === 'n_total') t = `${i + 1} / ${pages.length}`; else if (fmtSel.value === 'strana_n') t = `Strana ${i + 1}`;
          const size = 10; const tw = font.widthOfTextAtSize(t, size);
          page.drawText(t, { x: width / 2 - tw / 2, y: 18, size, font, color: rgb(0.2, 0.2, 0.2) });
        });
        state.bytes = await doc.save(); await reloadFrom(state.bytes); toast('Strany očíslované.');
      } catch (e) { console.error(e); toast('Číslovanie zlyhalo.'); } finally { busy.hide(); }
    } }));
  });
}
async function addBlankPage() {
  busy.show('Pridávam prázdnu stranu…');
  try { await flattenCurrent();
    const { PDFDocument } = PDFLib; const doc = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
    const last = doc.getPage(doc.getPageCount() - 1); const { width, height } = last.getSize();
    doc.addPage([width, height]); state.bytes = await doc.save(); await reloadFrom(state.bytes); toast('Prázdna strana pridaná na koniec.');
  } catch (e) { console.error(e); toast('Nepodarilo sa.'); } finally { busy.hide(); openPages(); }
}
async function duplicatePage(pi) {
  busy.show('Duplikujem stranu…');
  try { await flattenCurrent();
    const { PDFDocument } = PDFLib; const src = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const order = []; for (let i = 0; i < src.getPageCount(); i++) { order.push(i); if (i === pi) order.push(i); }
    const cp = await out.copyPages(src, order); cp.forEach((p) => out.addPage(p));
    state.bytes = await out.save(); await reloadFrom(state.bytes); toast('Strana zduplikovaná.');
  } catch (e) { console.error(e); toast('Duplikovanie zlyhalo.'); } finally { busy.hide(); openPages(); }
}

/* ---------- Formuláre ---------- */
async function openForm() {
  if (!state.bytes) return toast('Najprv otvor PDF.');
  busy.show('Hľadám políčka formulára…');
  let fields = [];
  try {
    const { PDFDocument } = PDFLib; const doc = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
    const form = doc.getForm(); fields = form.getFields();
  } catch (e) { /* bez formulára */ }
  busy.hide();
  openSheet('Formulár', (body) => {
    if (!fields.length) { body.append(el('p', { text: 'Tento dokument neobsahuje interaktívne políčka formulára. Údaje doň vieš doplniť nástrojom Text.' })); return; }
    const rows = [];
    const fieldType = (f) => {
      if (f instanceof PDFLib.PDFTextField) return 'text';
      if (f instanceof PDFLib.PDFCheckBox) return 'check';
      if (f instanceof PDFLib.PDFDropdown) return 'dropdown';
      if (f instanceof PDFLib.PDFOptionList) return 'optionlist';
      if (f instanceof PDFLib.PDFRadioGroup) return 'radio';
      return 'other';
    };
    for (const f of fields) {
      const type = fieldType(f); const name = f.getName();
      const row = el('div', { class: 'form-field' }, [el('label', { text: name })]);
      if (type === 'text') { const i = el('input', { type: 'text', value: f.getText() || '' }); row.append(i); rows.push({ name, type, get: () => i.value }); }
      else if (type === 'check') { const i = el('input', { type: 'checkbox' }); i.checked = f.isChecked(); row.append(el('span', {}, [i])); rows.push({ name, type, get: () => i.checked }); }
      else if (type === 'dropdown' || type === 'optionlist') { const s = el('select'); (f.getOptions() || []).forEach((o) => s.append(el('option', { value: o, text: o }))); row.append(s); rows.push({ name, type, get: () => s.value }); }
      else if (type === 'radio') { const s = el('select'); (f.getOptions() || []).forEach((o) => s.append(el('option', { value: o, text: o }))); row.append(s); rows.push({ name, type, get: () => s.value }); }
      else { row.append(el('span', { class: 'note-small', text: 'nepodporované pole' })); }
      body.append(row);
    }
    body.append(el('button', { class: 'btn primary', text: 'Vyplniť a uložiť PDF', style: 'margin-top:10px', onclick: async () => {
      busy.show('Vypĺňam formulár…');
      try { await flattenCurrent();
        const { PDFDocument } = PDFLib; const doc = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
        doc.registerFontkit(fontkit); const form = doc.getForm();
        for (const r of rows) {
          try { const f = form.getField(r.name);
            if (r.type === 'text') f.setText(String(r.get() || ''));
            else if (r.type === 'check') { r.get() ? f.check() : f.uncheck(); }
            else if (r.type === 'dropdown' || r.type === 'optionlist' || r.type === 'radio') f.select(r.get());
          } catch {}
        }
        const bytes = await doc.save(); download(bytes, outName(state.name)); toast('Formulár vyplnený a uložený.');
      } catch (e) { console.error(e); toast('Vyplnenie zlyhalo.'); } finally { busy.hide(); }
    } }));
  });
}

/* ---------- OCR ---------- */
async function openOcr() {
  if (!state.pdf) return toast('Najprv otvor PDF.');
  openSheet('OCR — rozpoznanie textu zo skenu', (body) => {
    body.append(el('p', { text: 'Prečíta text z naskenovaných (obrázkových) strán a vypíše ho sem, aby sa dal skopírovať.' }));
    const langRow = el('div', { class: 'opt-row', style: 'max-width:260px' }, [el('label', { text: 'Jazyk' })]);
    const sel = el('select'); [['slk', 'Slovenčina'], ['ces', 'Čeština'], ['eng', 'Angličtina'], ['slk+ces+eng', 'Mix SK+CZ+EN']].forEach(([v, t]) => sel.append(el('option', { value: v, text: t })));
    langRow.append(sel); body.append(langRow);
    const pageRow = el('div', { class: 'opt-row', style: 'max-width:260px' }, [el('label', { text: 'Strana' })]);
    const pnum = el('input', { type: 'number', min: 1, max: state.pdf.numPages, value: 1 }); pageRow.append(pnum); body.append(pageRow);
    const out = el('textarea', { style: 'width:100%;min-height:200px;margin-top:10px;background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px', placeholder: 'Sem sa vypíše rozpoznaný text…' });
    const run = el('button', { class: 'btn primary', text: 'Spustiť OCR', onclick: async () => {
      busy.show('Pripravujem OCR…');
      try {
        const T = await loadTesseract();
        const page = await state.pdf.getPage(+pnum.value || 1);
        const vp = page.getViewport({ scale: 2 });
        const c = el('canvas'); c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        busy.text('Čítam text…');
        const worker = await T.createWorker(sel.value, 1, { logger: (m) => { if (m.status === 'recognizing text') busy.prog(m.progress); } });
        const { data } = await worker.recognize(c); await worker.terminate();
        out.value = data.text || '(nič sa nenašlo)';
        toast('OCR hotové.');
      } catch (e) { console.error(e); toast('OCR potrebuje internet (sťahuje jazykové dáta). Skús to online.', 5000); }
      finally { busy.hide(); }
    } });
    body.append(run, out);
    body.append(el('p', { class: 'note-small', text: 'Pozn.: OCR si pri prvom spustení stiahne jazykový balík z internetu. Potom funguje aj offline.' }));
  });
}
let _tess = null;
async function loadTesseract() {
  if (_tess) return _tess;
  _tess = await import('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.esm.min.js');
  return _tess;
}

/* ---------- Konverzie ---------- */
function openConvert() {
  if (!state.pdf) return toast('Najprv otvor PDF.');
  openSheet('Konverzie', (body) => {
    const grid = el('div', { class: 'grid2' });
    const card = (icon, title, desc, fn) => el('button', { class: 'card-btn', onclick: fn }, [el('span', { class: 'ci', text: icon }), el('span', {}, [el('b', { text: title }), el('small', { text: desc })])]);
    grid.append(
      card('🖼️', 'PDF → obrázky (PNG)', 'Každá strana ako PNG v jednom .zip', convertToImages),
      card('📝', 'PDF → text (.txt)', 'Vytiahne text z dokumentu', convertToText),
      card('📄', 'PDF → Word (.docx)', 'Text do dokumentu Wordu', convertToDocx),
      card('🧩', 'Obrázky → PDF', 'Z fotiek/skenov spraví PDF', () => $('#hiddenImgs').click()),
      card('🗜️', 'Zmenšiť PDF', 'Prepočíta strany na menší súbor', compressPdf),
      card('🧼', 'Vyčistiť údaje', 'Odstráni meno autora, program a pod.', cleanMeta),
    );
    body.append(grid);
  });
}
async function convertToImages() {
  busy.show('Renderujem strany…');
  try {
    const files = {}; const dpr = 2;
    for (let i = 1; i <= state.pdf.numPages; i++) {
      busy.prog(i / state.pdf.numPages); busy.text(`Strana ${i}/${state.pdf.numPages}`);
      const page = await state.pdf.getPage(i); const vp = page.getViewport({ scale: dpr });
      const c = el('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      files[`strana-${String(i).padStart(3, '0')}.png`] = new Uint8Array(await blob.arrayBuffer());
    }
    const zipped = globalThis.fflate.zipSync(files, { level: 6 });
    download(zipped, state.name.replace(/\.pdf$/i, '') + '-obrazky.zip', 'application/zip');
    toast('Obrázky uložené v .zip.');
  } catch (e) { console.error(e); toast('Konverzia zlyhala.'); } finally { busy.hide(); }
}
async function extractText() {
  const parts = [];
  for (let i = 1; i <= state.pdf.numPages; i++) {
    const page = await state.pdf.getPage(i); const tc = await page.getTextContent();
    let last = 0; let line = '';
    const lines = [];
    tc.items.forEach((it) => {
      if ('str' in it) { line += it.str; if (it.hasEOL) { lines.push(line); line = ''; } }
    });
    if (line) lines.push(line);
    parts.push(lines.join('\n'));
  }
  return parts;
}
async function convertToText() {
  busy.show('Vyťahujem text…');
  try { const parts = await extractText(); const txt = parts.join('\n\n——— ďalšia strana ———\n\n');
    download(new TextEncoder().encode(txt), state.name.replace(/\.pdf$/i, '') + '.txt', 'text/plain'); toast('Text uložený.');
  } catch (e) { console.error(e); toast('Nepodarilo sa vytiahnuť text.'); } finally { busy.hide(); }
}
async function convertToDocx() {
  busy.show('Skladám Word…');
  try {
    const parts = await extractText(); const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paras = [];
    parts.forEach((p, i) => {
      if (i) paras.push('<w:p/>');
      p.split('\n').forEach((ln) => paras.push(`<w:p><w:r><w:t xml:space="preserve">${esc(ln)}</w:t></w:r></w:p>`));
    });
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr/></w:body></w:document>`;
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const enc = (s) => new TextEncoder().encode(s);
    const zip = globalThis.fflate.zipSync({ '[Content_Types].xml': enc(ct), '_rels/.rels': enc(rels), 'word/document.xml': enc(docXml) });
    download(zip, state.name.replace(/\.pdf$/i, '') + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    toast('Word dokument uložený.');
  } catch (e) { console.error(e); toast('Konverzia do Wordu zlyhala.'); } finally { busy.hide(); }
}
$('#hiddenImgs').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  busy.show('Skladám PDF z obrázkov…');
  try {
    const { PDFDocument } = PDFLib; const doc = await PDFDocument.create();
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let img; try { img = f.type.includes('png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); }
      catch { try { img = await doc.embedPng(bytes); } catch { img = await doc.embedJpg(bytes); } }
      const page = doc.addPage([img.width, img.height]); page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    const out = await doc.save(); download(out, 'obrazky.pdf'); toast('PDF z obrázkov hotové.');
  } catch (err) { console.error(err); toast('Nepodarilo sa. Podporené sú JPG a PNG.'); } finally { busy.hide(); }
});
async function compressPdf() {
  busy.show('Zmenšujem…');
  try {
    const { PDFDocument } = PDFLib; const out = await PDFDocument.create();
    for (let i = 1; i <= state.pdf.numPages; i++) {
      busy.prog(i / state.pdf.numPages);
      const page = await state.pdf.getPage(i); const vp = page.getViewport({ scale: 1.3 });
      const c = el('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const p = out.addPage([page.view[2], page.view[3]]); p.drawImage(img, { x: 0, y: 0, width: p.getWidth(), height: p.getHeight() });
    }
    const bytes = await out.save({ useObjectStreams: true });
    const before = state.bytes.length, after = bytes.length;
    download(bytes, state.name.replace(/\.pdf$/i, '') + '-mensie.pdf');
    toast(`Hotovo: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`, 4000);
  } catch (e) { console.error(e); toast('Zmenšenie zlyhalo.'); } finally { busy.hide(); }
}
async function cleanMeta() {
  busy.show('Čistím údaje dokumentu…');
  try { await flattenCurrent();
    const { PDFDocument } = PDFLib; const doc = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
    doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
    try { doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0)); } catch {}
    // updateMetadata:false → pdf-lib si späť nedopíše „Producer" ani dátumy
    const bytes = await doc.save({ useObjectStreams: true, updateMetadata: false });
    state.bytes = bytes; download(bytes, state.name.replace(/\.pdf$/i, '') + '-cisty.pdf');
    toast('Údaje odstránené.');
  } catch (e) { console.error(e); toast('Čistenie zlyhalo.'); } finally { busy.hide(); }
}

/* ---------- Info o dokumente ---------- */
async function openInfo() {
  if (!state.pdf) return toast('Najprv otvor PDF.');
  busy.show('Zisťujem detaily…');
  let meta = {}, fonts = new Set();
  try { const m = await state.pdf.getMetadata(); meta = m.info || {}; } catch {}
  try {
    for (let i = 1; i <= Math.min(state.pdf.numPages, 30); i++) {
      const page = await state.pdf.getPage(i); const ops = await page.getOperatorList();
      const cmn = page.commonObjs;
      for (const key of Object.keys(cmn._objs || {})) { const o = cmn._objs[key]?.data; if (o && o.name) fonts.add(o.name); }
    }
  } catch {}
  busy.hide();
  openSheet('O dokumente', (body) => {
    const kv = el('div', { class: 'kv' });
    const add = (k, v) => { kv.append(el('div', { text: k }), el('div', { text: v || '—' })); };
    add('Názov súboru', state.name);
    add('Počet strán', String(state.pdf.numPages));
    add('Titulok', meta.Title); add('Autor', meta.Author); add('Predmet', meta.Subject);
    add('Program', meta.Producer); add('Vytvoril', meta.Creator);
    add('PDF verzia', meta.PDFFormatVersion);
    add('Veľkosť', (state.bytes.length / 1048576).toFixed(2) + ' MB');
    body.append(kv);
    if (fonts.size) { body.append(el('h3', { text: 'Použité písma' })); body.append(el('div', { class: 'note-small', text: [...fonts].join(', ') })); }
    body.append(el('h3', { text: 'Súkromie' }));
    body.append(el('p', { class: 'note-small', text: 'Chceš odstrániť meno autora a program z dokumentu? Použi Konverzie → Vyčistiť údaje.' }));
  });
}

/* ========== DARČEKOVÁ ČASŤ ========== */
const MOODS = [
  { k: 'radost', emo: '😊', t: 'Radosť', theme: 'radost' },
  { k: 'pokoj', emo: '😌', t: 'Pokoj', theme: 'pokoj' },
  { k: 'laska', emo: '🥰', t: 'Láska', theme: 'laska' },
  { k: 'sila', emo: '💪', t: 'Sila', theme: 'sila' },
  { k: 'unava', emo: '🥱', t: 'Únava', theme: 'unava' },
  { k: 'hnev', emo: '😤', t: 'Nabrúsenosť', theme: 'hnev' },
];
const DED = `Pre Páju a Páju 🐜
od Robka Ďuriča.

Nekúpil som vám hotový program.
Radšej som vám spravil vlastný —
taký, aký ste vy dvaja.
Nech slúži a nech vás teší.`;

function initGift() {
  $('#introDed').textContent = DED;
  const who = localStorage.getItem('bb_who');
  $$('.who-btn').forEach((b) => b.onclick = () => { localStorage.setItem('bb_who', b.dataset.who); enterApp(b.dataset.who); });
  $('#introSkip').onclick = () => enterApp(who || 'obaja');
  // nálada
  const grid = $('#moodGrid'); grid.innerHTML = '';
  MOODS.forEach((m) => {
    const b = el('button', { class: 'mood-btn', onclick: () => { $$('.mood-btn').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); grid._sel = m; } }, [el('span', { class: 'emo', text: m.emo }), document.createTextNode(m.t)]);
    grid.append(b);
  });
  $('#moodSave').onclick = () => {
    const m = grid._sel || MOODS[1];
    document.body.dataset.theme = m.theme;
    saveMood(m, $('#moodNote').value);
    $('#moodModal').classList.add('hidden');
    toast(greet());
  };
}
function enterApp(who) {
  $('#intro').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#moodHi').textContent = who === 'obaja' ? 'Ako sa dnes máte? 🐜🐜' : `Ahoj ${who}! Ako sa dnes máš?`;
  // nálada raz denne
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem('bb_moodDay') !== today) $('#moodModal').classList.remove('hidden');
  else { const th = localStorage.getItem('bb_theme'); if (th) document.body.dataset.theme = th; }
}
function saveMood(m, note) {
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem('bb_moodDay', today); localStorage.setItem('bb_theme', m.theme);
  const diary = JSON.parse(localStorage.getItem('bb_diary') || '[]');
  diary.unshift({ d: today, mood: m.t, emo: m.emo, note: (note || '').slice(0, 300) });
  localStorage.setItem('bb_diary', JSON.stringify(diary.slice(0, 120)));
}
function greet() {
  const g = ['Nech sa dnes darí 🐜', 'Si šikovný/á, poďme na to!', 'Malými krokmi, ako mravčeky 🐜', 'Držím palce!'];
  return g[Math.floor(Math.random() * g.length)];
}
function openHelp() {
  openSheet('Návod — ako na to', (body) => {
    const h = (t) => body.append(el('h3', { text: t }));
    const p = (t) => body.append(el('p', { class: 'note-small', text: t }));
    p('Baja & Baja je vaša súkromná dielnička na PDF. Všetko sa deje len vo vašom počítači — žiadny súbor sa nikam neposiela.');
    h('Otvoriť dokument'); p('Klikni hore na „Otvoriť PDF“, alebo súbor jednoducho pretiahni do okna.');
    h('Pridať text / obrázok / kresbu'); p('Vľavo si vyber nástroj. Text: klikni do strany a píš, vieš meniť písmo, veľkosť aj farbu. Obrázok: vlož fotku a potiahni ju na miesto. Kresliť, zvýrazňovať, rámiky, čiary a lístky fungujú ťahaním myšou.');
    h('Posúvanie a mazanie'); p('Nástrojom „Výber“ doplnok potiahneš alebo prepíšeš. Nástrojom „Guma“ (alebo krížikom) ho zmažeš. Pôvodný obsah PDF ostáva nedotknutý.');
    h('Prekrytie'); p('Nástrojom „Prekryť“ spravíš nepriehľadný (napr. čierny) obdĺžnik cez časť strany. Je viditeľný — slúži na zakrytie, nie na skrývanie úprav.');
    h('Strany'); p('V časti „Strany“ vieš strany otáčať, mazať, duplikovať, meniť poradie ťahaním, pripojiť ďalšie PDF, vybrať strany do nového súboru, pridať prázdnu stranu, vložiť vodoznak alebo očíslovať strany.');
    h('Tlač'); p('Ikonou 🖨️ hore otvoríš hotový dokument s doplnkami na tlač.');
    h('Formulár'); p('Ak má PDF interaktívne políčka, vyplníš ich v časti „Formulár“ a uložíš.');
    h('OCR'); p('Pri naskenovaných dokumentoch prečíta text z obrázka, aby sa dal skopírovať. Prvýkrát si stiahne jazykový balík z internetu.');
    h('Konverzie'); p('PDF premeníš na obrázky, text alebo Word, z obrázkov spravíš PDF, dokument zmenšíš alebo z neho odstrániš údaje o autorovi.');
    h('Uložiť'); p('Hore klikni „Uložiť PDF“. Nový súbor s tvojimi doplnkami nájdeš v stiahnutých súboroch.');
    h('Nálada'); p('Dielnička sa ladí podľa toho, ako sa máš. Náladu zmeníš kedykoľvek ikonou 🎨. Ukladá sa len u teba.');
    body.append(el('div', { style: 'margin-top:14px;padding:14px;background:var(--panel2);border-radius:12px;white-space:pre-line', text: DED }));
  });
}

/* ---------- Drag & drop súboru ---------- */
function initDnd() {
  const v = $('#viewer');
  ['dragenter', 'dragover'].forEach((ev) => v.addEventListener(ev, (e) => { e.preventDefault(); v.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => v.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.target !== v) return; v.classList.remove('drag'); }));
  v.addEventListener('drop', async (e) => {
    const f = [...e.dataTransfer.files].find((x) => x.type === 'application/pdf' || x.name.toLowerCase().endsWith('.pdf'));
    if (f) loadPdf(await f.arrayBuffer(), f.name); else toast('Potiahni sem súbor PDF.');
  });
}

/* ---------- Napojenie tlačidiel ---------- */
function wire() {
  $('#btnOpen').onclick = () => $('#hiddenFile').click();
  $('#hiddenFile').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadPdf(await f.arrayBuffer(), f.name); });
  $('#btnSave').onclick = savePdf;
  $('#btnPrint').onclick = printPdf;
  $('#btnHelp').onclick = openHelp;
  $('#goPage').addEventListener('change', (e) => goToPage(+e.target.value));
  $('#fitWidth').onclick = fitWidth;
  $('#btnMood').onclick = () => $('#moodModal').classList.remove('hidden');
  $('#sheetClose').onclick = closeSheet;
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  $$('.tool[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  $('#btnPages').onclick = openPages;
  $('#btnForm').onclick = openForm;
  $('#btnOcr').onclick = openOcr;
  $('#btnConvert').onclick = openConvert;
  $('#btnInfo').onclick = openInfo;
  $('#zoomIn').onclick = () => setZoom(state.scale + 0.15);
  $('#zoomOut').onclick = () => setZoom(state.scale - 0.15);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (!$('#btnSave').disabled) savePdf(); }
    if (e.key === 'Delete' && state.selected && !state.selected.anno._editing) {
      if (document.activeElement && document.activeElement.isContentEditable) return;
      deleteAnno(state.selected.pv.index, state.selected.anno.id);
    }
    if (e.key === 'Escape') { closeSheet(); selectAnno(null); }
  });
}

/* ---------- Štart ---------- */
(async function main() {
  try { await initPdfjs(); } catch (e) { console.error('pdf.js init', e); }
  wire(); initGift(); initDnd(); setTool('select');
  status('Pripravené. Otvor PDF a poď tvoriť. 🐜');
})();
