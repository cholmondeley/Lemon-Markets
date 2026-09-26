// Small chart kit for the dating page: canvas line charts and histograms with a hover layer, plus
// HTML bar charts and tables. Colors come from CSS custom properties at draw time, so charts follow
// light/dark mode; every chart redraws on resize and on a color-scheme change.

const charts = new Set();
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const color = (name) => (name.startsWith('--') ? css(name) : name);

let tipEl = null;
function tip() {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'dtip'; document.body.appendChild(tipEl); }
  return tipEl;
}
export function showTip(html, x, y) {
  const t = tip();
  t.innerHTML = html;
  t.classList.add('on');
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px';
  t.style.top = Math.max(8, y - h - 10) + 'px';
}
export function hideTip() { tip().classList.remove('on'); }

export function redrawAll() { charts.forEach((c) => c.draw()); }
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawAll);
new ResizeObserver(() => redrawAll()).observe(document.documentElement);

function setup(canvas, height) {
  const dpr = window.devicePixelRatio || 1;
  const host = canvas.parentElement;
  const w = host.clientWidth || 300;
  const h = height === 'fill' ? (host.clientHeight || 240) : height;
  if (height !== 'fill') canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const fmtDefault = (v) => String(v);

// Line chart. spec: { height, x: {min, max, ticks, fmt, label}, y: {min, max, ticks, fmt, label},
//   series: [{ label, color, points: [[x, y]], dash, width, dots }], bands: [{x0, x1, label}],
//   marks: [{x, y, text, color}], endLabels: true }
export function lineChart(host, spec) {
  host.classList.add('chart');
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  canvas.setAttribute('role', 'img');
  if (spec.aria) canvas.setAttribute('aria-label', spec.aria);
  const state = { spec, hoverX: null };
  const pad = { l: 44, r: spec.endLabels === false ? 16 : 118, t: 14, b: 30 };

  function geom(w, h) {
    const { x, y } = state.spec;
    const narrow = w < 520;
    const pr = narrow && state.spec.endLabels !== false ? 70 : pad.r;
    const X = (v) => pad.l + ((v - x.min) / (x.max - x.min)) * (w - pad.l - pr);
    const Y = (v) => pad.t + (1 - (v - y.min) / (y.max - y.min)) * (h - pad.t - pad.b);
    return { X, Y, pr };
  }

  function draw() {
    const { ctx, w, h } = setup(canvas, state.spec.height ?? 280);
    const { x, y, series } = state.spec;
    const { X, Y, pr } = geom(w, h);
    const ink = css('--ink'), muted = css('--ink-muted'), faint = css('--ink-faint'), rule = css('--rule');
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px "IBM Plex Mono", monospace';
    // Shaded bands
    (state.spec.bands || []).forEach((b) => {
      ctx.fillStyle = css('--surface-2');
      ctx.fillRect(X(b.x0), pad.t, X(b.x1) - X(b.x0), h - pad.t - pad.b);
      if (b.label) { ctx.fillStyle = faint; ctx.textAlign = 'left'; ctx.fillText(b.label, X(b.x0) + 4, pad.t + 12); }
    });
    // Grid and y ticks
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.fillStyle = faint; ctx.textAlign = 'right';
    (y.ticks || []).forEach((t) => {
      const yy = Math.round(Y(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pr, yy); ctx.stroke();
      ctx.fillText((y.fmt || fmtDefault)(t), pad.l - 6, yy + 4);
    });
    ctx.textAlign = 'center';
    (x.ticks || []).forEach((t) => ctx.fillText((x.fmt || fmtDefault)(t), X(t), h - pad.b + 16));
    if (x.label) { ctx.textAlign = 'right'; ctx.fillStyle = muted; ctx.font = '11px "IBM Plex Sans", sans-serif'; ctx.fillText(x.label, w - pr, h - 2); }
    if (y.label) { ctx.textAlign = 'left'; ctx.fillStyle = muted; ctx.font = '11px "IBM Plex Sans", sans-serif'; ctx.fillText(y.label, pad.l, pad.t - 3 < 10 ? 10 : pad.t - 3); }
    // Series
    const ends = [];
    series.forEach((s) => {
      const col = color(s.color);
      ctx.strokeStyle = col; ctx.lineWidth = s.width ?? 2; ctx.setLineDash(s.dash || []);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      let started = false;
      s.points.forEach(([px, py]) => {
        if (py == null || Number.isNaN(py)) { started = false; return; }
        if (!started) { ctx.moveTo(X(px), Y(py)); started = true; } else ctx.lineTo(X(px), Y(py));
      });
      ctx.stroke(); ctx.setLineDash([]);
      if (s.dots) s.points.forEach(([px, py]) => {
        if (py == null) return;
        ctx.beginPath(); ctx.arc(X(px), Y(py), 4, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = css('--surface'); ctx.stroke();
      });
      const last = [...s.points].reverse().find((p) => p[1] != null);
      if (last && state.spec.endLabels !== false) ends.push({ y: Y(last[1]), x: X(last[0]), label: s.label, col });
    });
    // Direct end labels, nudged apart.
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'left';
    ends.forEach((e) => { ctx.fillStyle = ink; ctx.fillText(e.label, e.x + 8, e.y + 4); ctx.fillStyle = e.col; ctx.fillRect(e.x + 2, e.y - 1, 4, 3); });
    // Marks
    (state.spec.marks || []).forEach((m) => {
      ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), 4.5, 0, Math.PI * 2); ctx.fillStyle = color(m.color || '--ink'); ctx.fill();
      ctx.fillStyle = ink; ctx.font = '11px "IBM Plex Sans", sans-serif'; ctx.textAlign = m.align || 'left';
      ctx.fillText(m.text, X(m.x) + (m.align === 'right' ? -8 : 8), Y(m.y) - 8);
    });
    // Hover crosshair
    if (state.hoverX != null) {
      ctx.strokeStyle = css('--rule-strong'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(state.hoverX), pad.t); ctx.lineTo(X(state.hoverX), h - pad.b); ctx.stroke();
      series.forEach((s) => {
        const p = s.points.find((q) => q[0] === state.hoverX);
        if (!p || p[1] == null) return;
        ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 4, 0, Math.PI * 2); ctx.fillStyle = color(s.color); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = css('--surface'); ctx.stroke();
      });
    }
  }

  canvas.addEventListener('pointermove', (ev) => {
    const r = canvas.getBoundingClientRect();
    const { X } = geom(r.width, r.height);
    const xs = [...new Set(state.spec.series.flatMap((s) => s.points.map((p) => p[0])))];
    let best = null, bd = Infinity;
    xs.forEach((v) => { const d = Math.abs(X(v) - (ev.clientX - r.left)); if (d < bd) { bd = d; best = v; } });
    if (best == null || bd > 40) { state.hoverX = null; hideTip(); draw(); return; }
    state.hoverX = best; draw();
    const rows = state.spec.series.map((s) => {
      const p = s.points.find((q) => q[0] === best);
      return p && p[1] != null ? `<div><i style="background:${color(s.color)}"></i>${s.label}: <b>${(state.spec.y.tipFmt || state.spec.y.fmt || fmtDefault)(p[1])}</b></div>` : '';
    }).join('');
    showTip(`<div class="k">${(state.spec.x.tipFmt || state.spec.x.fmt || fmtDefault)(best)}</div>${rows}`, ev.clientX, ev.clientY);
  });
  canvas.addEventListener('pointerleave', () => { state.hoverX = null; hideTip(); draw(); });

  const api = { draw, update(next) { state.spec = { ...state.spec, ...next }; draw(); } };
  charts.add(api);
  draw();
  return api;
}

// Histogram of relative counts in bins. spec: { height, bins: number[], binLabel(i), color, xTicks: [[i, label]], tip(i, share) }
export function histChart(host, spec) {
  host.classList.add('chart');
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  canvas.setAttribute('role', 'img');
  if (spec.aria) canvas.setAttribute('aria-label', spec.aria);
  const state = { spec, hover: -1 };
  const pad = { l: 12, r: 12, t: 12, b: 28 };
  const lastBin = () => { const b = state.spec.bins; let k = b.length - 1; while (k > 0 && b[k] === 0) k--; return Math.min(b.length, (state.spec.maxBin ?? k + 1)); };
  function draw() {
    const { ctx, w, h } = setup(canvas, state.spec.height ?? 240);
    const { bins } = state.spec, n = lastBin(), max = Math.max(...bins.slice(0, n)), tot = bins.reduce((s, v) => s + v, 0);
    const bw = (w - pad.l - pad.r) / n;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = css('--rule'); ctx.beginPath(); ctx.moveTo(pad.l, h - pad.b + 0.5); ctx.lineTo(w - pad.r, h - pad.b + 0.5); ctx.stroke();
    const col = color(state.spec.color);
    for (let i = 0; i < n; i++) {
      const bh = (bins[i] / max) * (h - pad.t - pad.b);
      if (bh <= 0) continue;
      ctx.fillStyle = col; ctx.globalAlpha = state.hover === -1 || state.hover === i ? 1 : 0.55;
      const x = pad.l + i * bw + (bw > 5 ? 1 : 0);
      ctx.beginPath(); ctx.roundRect(x, h - pad.b - bh, Math.max(1, bw - (bw > 5 ? 2 : 0.5)), bh, [Math.min(3, bw / 3), Math.min(3, bw / 3), 0, 0]); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = css('--ink-faint'); ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    (state.spec.xTicks || []).forEach(([i, lab]) => { if (i <= n) ctx.fillText(lab, pad.l + i * bw, h - pad.b + 16); });
    (state.spec.marks || []).forEach((m) => {
      const x = pad.l + m.bin * bw;
      ctx.strokeStyle = css('--ink'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = css('--ink'); ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'left'; ctx.fillText(m.text, x + 5, pad.t + 12);
    });
    state.tot = tot; state.bw = bw; state.n = n;
  }
  canvas.addEventListener('pointermove', (ev) => {
    const r = canvas.getBoundingClientRect();
    const i = Math.floor((ev.clientX - r.left - pad.l) / state.bw);
    if (i < 0 || i >= state.n) { state.hover = -1; hideTip(); draw(); return; }
    state.hover = i; draw();
    showTip(state.spec.tip(i, state.spec.bins[i] / state.tot), ev.clientX, ev.clientY);
  });
  canvas.addEventListener('pointerleave', () => { state.hover = -1; hideTip(); draw(); });
  const api = { draw, update(next) { state.spec = { ...state.spec, ...next }; draw(); } };
  charts.add(api);
  draw();
  return api;
}

// HTML horizontal bars. rows: [{ label, sub, value, cls, text, hl }], max. Returns { update(rows) }.
export function bars(host, rows, { max = null, cls = '' } = {}) {
  host.classList.add('bars');
  if (cls) host.classList.add(...cls.split(' '));
  function update(next) {
    const m = max ?? Math.max(...next.map((r) => r.value)) * 1.05;
    host.innerHTML = '';
    next.forEach((r) => {
      if (r.group) { const g = document.createElement('div'); g.className = 'bar-group-title'; g.textContent = r.group; host.appendChild(g); return; }
      const row = document.createElement('div');
      row.className = 'bar-row' + (r.hl ? ' hl' : '');
      row.innerHTML = `<span class="bl">${r.label}${r.sub ? `<small>${r.sub}</small>` : ''}</span><span class="bt"><i class="bf ${r.cls || ''}" style="width:${Math.max(0, Math.min(100, (r.value / m) * 100)).toFixed(2)}%"></i></span><span class="bv">${r.text}</span>`;
      if (r.tip) {
        row.addEventListener('pointermove', (ev) => showTip(r.tip, ev.clientX, ev.clientY));
        row.addEventListener('pointerleave', hideTip);
      }
      host.appendChild(row);
    });
  }
  update(rows);
  return { update };
}

// HTML table. head: string[], rows: (string|{text, cls})[][], hl: row index to highlight.
export function table(host, head, rows, { hl = -1, caption = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const t = document.createElement('table');
  t.className = 'dtable';
  if (caption) t.createCaption().textContent = caption;
  t.innerHTML += `<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>`;
  const tb = document.createElement('tbody');
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (i === hl) tr.className = 'hl';
    tr.innerHTML = r.map((c, j) => (j === 0 ? `<th scope="row" style="text-align:left;font-weight:500;font-size:0.84rem;color:var(--ink);border-bottom:1px solid var(--rule);padding:6px 8px">${c.text ?? c}</th>` : `<td class="${c.cls ?? ''}">${c.text ?? c}</td>`)).join('');
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  wrap.appendChild(t);
  host.innerHTML = '';
  host.appendChild(wrap);
}

export const pct = (v, d = 0) => (v == null ? '—' : (v * 100).toFixed(d) + '%');
export const ord = (n) => { n = Math.round(n); const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'); return n + s; };
export const money = (x) => (x >= 1e6 ? '$' + (x / 1e6).toFixed(x >= 1e7 ? 0 : 1) + 'M' : '$' + Math.round(x / 1000) + 'k');
export const num = (x) => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x >= 10 ? Math.round(x).toString() : x.toFixed(1));
