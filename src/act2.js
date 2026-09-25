// Act II: reading one candidate. The stage shows what one person from the looking
// pool might really be worth, before and after an interview of validity r.
// Steps set data-r (the interview's validity; 0 hides the "after" row) and
// data-mode="slate" to switch to the best-of-five comparison.

import { PRESET_HIRING, steadyState, poolDensity, bestOfK, displayMax, exactNarrowing, gauss, mulberry32 } from './model.js';
import { getDist, onJobChange } from './jobs.js';
import { C, readColors, fitCanvas, lerp } from './colors.js';
import { GRID, gridFor, summarize, honestyGradient, drawRow, drawAxis } from './density.js';
import { createStepper, watchVisible } from './stepper.js';

const GAMMA = PRESET_HIRING;
const STORY_SIGNAL = 1.0;   // "the interview goes well": about a 1-in-6 result
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The floating inset: exact narrowing against validity r, for the current job type.
function drawCurve(svg, dist) {
  const X = (r) => 34 + r * 176, Y = (v) => 112 - v * 100;
  const pts = [];
  for (let r = 0; r <= 0.951; r += 0.05) pts.push(X(r).toFixed(1) + ',' + Y(exactNarrowing(dist, GAMMA, +r.toFixed(2))).toFixed(1));
  const dots = [[0.18, '.18'], [0.44, '.44'], [0.9, '.9']].map(([r, lab]) => {
    const v = exactNarrowing(dist, GAMMA, r), far = r > 0.8;
    return `<circle cx="${X(r)}" cy="${Y(v)}" r="3.5" class="c-dot"/>` +
      `<text x="${far ? X(r) - 7 : X(r)}" y="${far ? Y(v) + 3 : Y(v) + 16}" text-anchor="${far ? 'end' : 'middle'}" class="c-lab">r ${lab}: ${Math.round(v * 100)}%</text>`;
  }).join('');
  svg.innerHTML = '<line x1="34" y1="112" x2="210" y2="112" class="c-axis"/><line x1="34" y1="12" x2="34" y2="112" class="c-axis"/>' +
    '<text x="30" y="16" text-anchor="end" class="c-tick">100%</text><text x="30" y="115" text-anchor="end" class="c-tick">0</text>' +
    '<text x="34" y="126" class="c-tick">r = 0</text><text x="210" y="126" text-anchor="end" class="c-tick">.95</text>' +
    `<polyline points="${pts.join(' ')}" class="c-line"/>` + dots;
}

export function createAct2Story(root) {
  const stage = root.querySelector('.stage');
  const plot = stage.querySelector('.stage-plot');
  const canvas = plot.querySelector('canvas');
  const stepper = createStepper(root, stage);
  let visible = false;
  watchVisible(root, (v) => { visible = v; });

  let dist, xMax, xs, prior, priorStats, after, afterR = -1, scale, marks;
  const alpha = { after: 0, slate: 0 };
  function setup() {
    dist = getDist(); xMax = displayMax(dist); xs = gridFor(xMax);
    prior = poolDensity(dist, GAMMA, xs); priorStats = summarize(xs, prior);
    after = Float64Array.from(prior); afterR = -1;
    const svg = root.querySelector('#a2curve');
    if (svg) drawCurve(svg, dist);
    const sharpest = poolDensity(dist, GAMMA, xs, 0.9, STORY_SIGNAL);
    scale = 1 / Math.max(...prior, ...sharpest);
    marks = [
      { v: steadyState(dist, GAMMA).EXA, label: 'one candidate, any interview' },
      { v: bestOfK(dist, GAMMA, 0.18, 5), label: 'best of 5, unstructured' },
      { v: bestOfK(dist, GAMMA, 0.44, 5), label: 'best of 5, structured' },
    ];
  }
  setup();
  onJobChange(setup);

  function frame(dt) {
    if (!visible) return;
    const { step } = stepper.update();
    const r = +(step.r || 0), slate = step.mode === 'slate';
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 5);
    const target = r > 0 ? poolDensity(dist, GAMMA, xs, r, STORY_SIGNAL) : prior;
    for (let i = 0; i < GRID; i++) after[i] = lerp(after[i], target[i], k);
    alpha.after = lerp(alpha.after, r > 0 && !slate ? 1 : 0, k);
    alpha.slate = lerp(alpha.slate, slate ? 1 : 0, k);

    readColors();
    const { ctx, w, h } = fitCanvas(canvas, 'fill');
    ctx.clearRect(0, 0, w, h);
    const padX = 14, top = 24, axisY = h - 8;
    const rowH = (axisY - top - 90) / 2;
    const g = {
      w, padX, top, rowH, xs, xMax, plus: dist.kind !== 'uniform',
      xAt: (x) => padX + (Math.min(x, xMax) / xMax) * (w - padX * 2),
    };
    g.grad = honestyGradient(ctx, g.xAt(0), g.xAt(xMax), xMax);
    const y1 = top + rowH, y2 = y1 + 46 + rowH;
    const sc = scale * rowH * 0.95;
    drawRow(ctx, g, prior, y1, sc, 'BEFORE THE INTERVIEW', slate ? 0.18 + 0.82 * (1 - alpha.slate) : 1, priorStats);
    drawRow(ctx, g, after, y2, sc, 'AFTER' + (r > 0 ? ' (r = ' + String(r).replace(/^0/, '') + ', it went well)' : ''), alpha.after, summarize(xs, after));
    ctx.globalAlpha = 1 - alpha.slate; drawAxis(ctx, g, axisY); ctx.globalAlpha = 1;

    if (alpha.slate > 0.01) {
      // A zoomed number line for the three expected hires.
      ctx.save(); ctx.globalAlpha = alpha.slate;
      const vals = marks.map((m) => m.v).concat(1);
      const zLo = Math.floor((Math.min(...vals) - 0.08) * 10) / 10, zHi = Math.ceil((Math.max(...vals) + 0.08) * 10) / 10;
      const L = padX + 10, Rr = w - padX - 10, zx = (v) => L + ((v - zLo) / (zHi - zLo)) * (Rr - L);
      const yS = y2 - 6;
      ctx.fillStyle = C.surface; ctx.globalAlpha = alpha.slate * 0.92;
      ctx.fillRect(0, y2 - rowH - 30, w, rowH + 64);
      ctx.globalAlpha = alpha.slate;
      ctx.strokeStyle = C.ruleStrong; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, yS); ctx.lineTo(Rr, yS); ctx.stroke();
      ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = C.inkFaint; ctx.textAlign = 'center';
      for (let v = zLo; v <= zHi + 1e-9; v += 0.1) {
        ctx.beginPath(); ctx.moveTo(zx(v), yS); ctx.lineTo(zx(v), yS + 4); ctx.stroke();
        ctx.fillText(v.toFixed(1), zx(v), yS + 16);
      }
      ctx.setLineDash([3, 4]); ctx.strokeStyle = C.inkFaint;
      ctx.beginPath(); ctx.moveTo(zx(1), yS); ctx.lineTo(zx(1), y2 - rowH); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillText('as advertised', zx(1), y2 - rowH - 6);
      const gap = Math.min(40, (rowH - 30) / marks.length);
      marks.forEach((m, i) => {
        const x = zx(m.v), yTop = yS - 22 - i * gap, col = i === 0 ? C.inkFaint : C.accent;
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, yS); ctx.lineTo(x, yTop); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, yS, 5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        const right = x < w * 0.62, tx = x + (right ? 8 : -8);
        ctx.textAlign = right ? 'left' : 'right';
        ctx.font = '600 13px "IBM Plex Mono", monospace'; ctx.fillStyle = C.ink;
        ctx.fillText(m.v.toFixed(2), tx, yTop + 4);
        const nw = ctx.measureText(m.v.toFixed(2) + '  ').width;
        ctx.font = '12px "IBM Plex Sans", sans-serif'; ctx.fillStyle = C.inkMuted;
        ctx.fillText(m.label, right ? tx + nw : tx - nw, yTop + 4);
      });
      ctx.fillStyle = C.ink; ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('EXPECTED TRUTH RATIO OF THE PERSON YOU HIRE', padX, y2 - rowH - 16);
      ctx.restore();
    }
  }
  return { frame };
}

// ---------- Try it yourself ----------
export function createAct2Play(root) {
  const $ = (id) => root.querySelector('#' + id);
  const bandCanvas = $('a2Band'), curveCanvas = $('a2Best');
  let visible = false;
  watchVisible(root, (v) => { visible = v; if (v) dirty = true; }, '100px');

  const rng = mulberry32(Date.now() % 1e9);
  let dist, xMax, xs, prior, priorStats, cand = null, noises = [], revealed = false, dirty = true;
  let r = 0.44;

  function setup() {
    dist = getDist(); xMax = displayMax(dist); xs = gridFor(xMax);
    prior = poolDensity(dist, GAMMA, xs); priorStats = summarize(xs, prior);
    newCandidate();
  }
  // Draw a person from the looking pool by rejection on the availability odds.
  function newCandidate() {
    for (;;) { const x = dist.sample(rng); if (rng() < GAMMA / (GAMMA + x)) { cand = x; break; } }
    noises = []; revealed = true; dirty = true; sync();
  }
  // Each interview's noise is kept, so moving the r slider re-reads the same interviews.
  // Interviews accumulate, treated as independent reads (real ones share some error).
  function interview() { noises.push(gauss(rng)); dirty = true; sync(); }
  const sigs = () => noises.map((e) => r * (cand - 1) / dist.cv + Math.sqrt(1 - r * r) * e);
  const sigMean = () => { const s = sigs(); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
  const score = (sg) => Math.max(1, Math.min(10, 5.5 + 1.5 * sg)).toFixed(1);

  function sync() {
    const sig = sigMean(), n = noises.length;
    $('a2narrow').textContent = 'one interview: ' + (exactNarrowing(dist, GAMMA, r) * 100).toFixed(1) + '% narrower on average';
    $('a2score').textContent = n === 0 ? 'none yet' : sigs().slice(-5).map(score).join(' \u00b7 ') + (n > 5 ? ' \u2026' : '');
    const post = sig === null ? priorStats : summarize(xs, poolDensity(dist, GAMMA, xs, r, sig, n));
    $('a2est').textContent = post.mean.toFixed(2) + '  (80%: ' + post.lo.toFixed(2) + '–' + post.hi.toFixed(2) + ')';
    $('a2truth').textContent = revealed ? cand.toFixed(2) : 'hidden';
    $('a2reveal').textContent = revealed ? 'Hide truth' : 'Reveal truth';
    $('a2interview').textContent = n === 0 ? 'Interview' : 'Interview again (' + (n + 1) + ')';
    $('a2hint').hidden = sig === null;
  }

  function renderBand() {
    const { ctx, w, h } = fitCanvas(bandCanvas, 250);
    ctx.clearRect(0, 0, w, h);
    const padX = 12, top = 20, axisY = h - 6, rowH = (axisY - top - 80) / 2;
    const g = { w, padX, top, rowH, xs, xMax, plus: dist.kind !== 'uniform', xAt: (x) => padX + (Math.min(x, xMax) / xMax) * (w - padX * 2) };
    g.grad = honestyGradient(ctx, g.xAt(0), g.xAt(xMax), xMax);
    const sig = sigMean(), n = noises.length;
    const post = sig === null ? null : poolDensity(dist, GAMMA, xs, r, sig, n);
    const sc = (rowH * 0.95) / Math.max(...prior, ...(post || [0]));
    const y1 = top + rowH, y2 = y1 + 40 + rowH;
    drawRow(ctx, g, prior, y1, sc, 'BEFORE', 1, priorStats);
    if (post) drawRow(ctx, g, post, y2, sc, n === 1 ? 'AFTER ONE INTERVIEW' : 'AFTER ' + n + ' INTERVIEWS', 1, summarize(xs, post));
    else { ctx.fillStyle = C.inkFaint; ctx.font = '12px "IBM Plex Sans", sans-serif'; ctx.fillText('Press Interview to read this candidate.', padX, y2 - rowH / 2); }
    drawAxis(ctx, g, axisY);
    if (revealed) {
      const x = g.xAt(cand);
      ctx.strokeStyle = C.lemon; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, y2 + 4); ctx.stroke();
      ctx.fillStyle = C.ink; ctx.font = '600 11px "IBM Plex Sans", sans-serif';
      ctx.textAlign = x > w * 0.7 ? 'right' : 'left';
      ctx.fillText('truth ' + cand.toFixed(2), x + (x > w * 0.7 ? -6 : 6), top + 10);
      ctx.textAlign = 'left';
    }
  }

  function renderBest() {
    const { ctx, w, h } = fitCanvas(curveCanvas, 250);
    ctx.clearRect(0, 0, w, h);
    const padL = 34, padR = 12, padT = 16, padB = 26, pw = w - padL - padR, ph = h - padT - padB;
    const K = 10, yMin = 0.4, yMax = 1.4;
    const X = (k) => padL + ((k - 1) / (K - 1)) * pw, Y = (v) => padT + ph - ((v - yMin) / (yMax - yMin)) * ph;
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1; ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = C.inkFaint;
    [0.6, 0.8, 1.0, 1.2].forEach((v) => {
      ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(padL + pw, Y(v)); ctx.stroke();
      ctx.fillText(v.toFixed(1), 4, Y(v) + 3);
    });
    ctx.setLineDash([3, 3]); ctx.strokeStyle = C.inkFaint;
    ctx.beginPath(); ctx.moveTo(padL, Y(1)); ctx.lineTo(padL + pw, Y(1)); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'center';
    for (let k = 1; k <= K; k++) ctx.fillText(String(k), X(k), h - 8);
    ctx.textAlign = 'left';
    const series = [{ rr: 0, col: C.inkFaint, label: 'no interview' }, { rr: r, col: C.accent, label: (r < 0.3 ? 'unstructured' : 'structured') + ' interview' }];
    series.forEach(({ rr, col, label }) => {
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      for (let k = 1; k <= K; k++) { const v = bestOfK(dist, GAMMA, rr, k, 6000, 5); k === 1 ? ctx.moveTo(X(k), Y(v)) : ctx.lineTo(X(k), Y(v)); }
      ctx.stroke();
      const vK = bestOfK(dist, GAMMA, rr, K, 6000, 5);
      ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(label, padL + pw, Y(vK) - 7); ctx.textAlign = 'left';
    });
  }

  root.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => {
    r = +b.dataset.method;
    root.querySelectorAll('[data-method]').forEach((x) => x.classList.toggle('active', x === b));
    dirty = true; sync();
  }));
  $('a2new').addEventListener('click', newCandidate);
  $('a2interview').addEventListener('click', interview);
  $('a2reveal').addEventListener('click', () => { revealed = !revealed; dirty = true; sync(); });
  onJobChange(setup);
  window.addEventListener('resize', () => { dirty = true; });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { dirty = true; });
  setup();

  function frame() {
    if (!visible || !dirty) return;
    dirty = false;
    readColors(); renderBand(); renderBest();
  }
  return { frame };
}
