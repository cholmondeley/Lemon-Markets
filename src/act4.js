// Act IV: counter-offers. The stage shows everyone with an outside offer (the
// employed pool), the slice whose employer counters, and within that the slice you
// win when the employer matches up to its own valuation. Steps set data-view:
//   pool | split | countered | won | ladder
// The playground is a calculator plus the employed-pool ladder under counter-offers.

import { PRESET_HIRING, CHANNELS, displayMax, counterOffers, counterProbs, sourceChannel } from './model.js';
import { getDist, onJobChange, COUNTER, K_REF, counterLadder } from './jobs.js';
import { C, readColors, fitCanvas, lerp } from './colors.js';
import { GRID, gridFor, honestyGradient, drawAxis } from './density.js';
import { createStepper, watchVisible } from './stepper.js';
import { buildLadder } from './act3.js';

const GAMMA = PRESET_HIRING;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Densities on the display grid for given counter settings.
function curves(dist, xs, { c, rE, q }) {
  const co = counterOffers(dist, GAMMA, c, rE, q);
  const pool = new Float64Array(GRID), cnt = new Float64Array(GRID), won = new Float64Array(GRID);
  let area = 0; const dx = xs[1] - xs[0];
  for (let i = 0; i < GRID; i++) {
    const x = xs[i], f = dist.pdf(x) * x / (GAMMA + x);
    const { pC, pW } = counterProbs(dist, x, rE, co.t, co.tq, q);
    pool[i] = f; cnt[i] = f * pC; won[i] = f * pW; area += f * dx;
  }
  for (let i = 0; i < GRID; i++) { pool[i] /= area; cnt[i] /= area; won[i] /= area; }
  return { co, pool, cnt, won };
}

function area(ctx, g, f, yBase, scale, fill, alpha) {
  if (alpha < 0.01) return;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.moveTo(g.xAt(0), yBase);
  for (let i = 0; i < g.xs.length; i++) ctx.lineTo(g.xAt(g.xs[i]), yBase - Math.min(g.rowH, f[i] * scale));
  ctx.lineTo(g.xAt(g.xMax), yBase); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.restore();
}
function outline(ctx, g, f, yBase, scale, alpha) {
  if (alpha < 0.01) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < g.xs.length; i++) { const y = yBase - Math.min(g.rowH, f[i] * scale); i ? ctx.lineTo(g.xAt(g.xs[i]), y) : ctx.moveTo(g.xAt(g.xs[i]), y); }
  ctx.stroke();
  ctx.strokeStyle = C.ruleStrong; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(g.xAt(0), yBase); ctx.lineTo(g.xAt(g.xMax), yBase); ctx.stroke();
  ctx.restore();
}
// A labelled mean marker below a row's baseline; `lane` staggers labels.
function marker(ctx, g, x, yBase, label, color, alpha, lane = 0) {
  if (alpha < 0.01) return;
  ctx.save(); ctx.globalAlpha = alpha;
  const px = g.xAt(x), y = yBase + 12 + lane * 15;
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(px, yBase); ctx.lineTo(px, y - 4); ctx.stroke();
  ctx.beginPath(); ctx.arc(px, yBase, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.fillStyle = C.ink;
  const right = px < g.w * 0.62;
  ctx.textAlign = right ? 'left' : 'right';
  ctx.fillText(label, px + (right ? 5 : -5), y + 4);
  ctx.restore();
}

// Draws the two rows. a = alphas: split, row2, won.
function drawCounterChart(canvas, dist, cv, a, height) {
  readColors();
  const { ctx, w, h } = fitCanvas(canvas, height || 'fill');
  ctx.clearRect(0, 0, w, h);
  const xMax = displayMax(dist), xs = cv.xs;
  const padX = 12, top = 22, axisY = h - 6, rowH = (axisY - top - 104) / 2;
  const g = { w, padX, top, rowH, xs, xMax, plus: dist.kind !== 'uniform', xAt: (x) => padX + (Math.min(x, xMax) / xMax) * (w - padX * 2) };
  const grad = honestyGradient(ctx, g.xAt(0), g.xAt(xMax), xMax);
  const y1 = top + rowH, y2 = y1 + 52 + rowH;
  const s1 = (rowH * 0.95) / Math.max(...cv.pool);
  // Row 1: everyone with an outside offer; the countered slice in colour.
  area(ctx, g, cv.pool, y1, s1, C.surface3, 1);
  area(ctx, g, cv.cnt, y1, s1, grad, a.split * 0.85);
  outline(ctx, g, cv.pool, y1, s1, 1);
  ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.fillStyle = C.ink; ctx.textAlign = 'left';
  ctx.fillText('EVERYONE WITH AN OUTSIDE OFFER', padX, top - 6);
  marker(ctx, g, cv.co.not.EX, y1, 'not countered ' + cv.co.not.EX.toFixed(2), C.inkFaint, a.split, 0);
  marker(ctx, g, cv.co.countered.EX, y1, 'countered ' + cv.co.countered.EX.toFixed(2), C.blue, a.split, 1);
  // Row 2: the countered group, scaled up; the part you win in colour.
  if (a.row2 > 0.01) {
    const s2 = (rowH * 0.95) / Math.max(...cv.cnt);
    ctx.save(); ctx.globalAlpha = a.row2;
    area(ctx, g, cv.cnt, y2, s2, C.surface3, 1);
    area(ctx, g, cv.won, y2, s2, grad, a.won * 0.85);
    outline(ctx, g, cv.cnt, y2, s2, 1);
    ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.fillStyle = C.ink; ctx.textAlign = 'left';
    ctx.fillText('JUST THE COUNTERED, SCALED UP', padX, y2 - rowH - 6);
    ctx.restore();
    marker(ctx, g, cv.co.countered.EX, y2, 'all countered ' + cv.co.countered.EX.toFixed(2), C.blue, a.row2 * (1 - a.won * 0.6), 0);
    marker(ctx, g, cv.co.won.EX, y2, 'the ones you win ' + cv.co.won.EX.toFixed(2), C.accent, a.won, 1);
  }
  drawAxis(ctx, g, axisY);
}

export function createAct4Story(root) {
  const stage = root.querySelector('.stage');
  const canvas = stage.querySelector('canvas');
  const stepper = createStepper(root, stage);
  const mini = buildLadder(stage.querySelector('.ladder-host'), [
    { id: 'poachS_none', group: 'Poach + structured', label: 'No counters' },
    { id: 'poachS_walk', group: 'Poach + structured', label: 'Countered: you walk away' },
    { id: 'poachS_half', group: 'Poach + structured', label: 'Countered: you win the cheaper half' },
    { id: 'ap8_none', group: 'A-player referral (ρ = .8)', label: 'No counters' },
    { id: 'ap8_walk', group: 'A-player referral (ρ = .8)', label: 'Countered: you walk away' },
    { id: 'ap8_half', group: 'A-player referral (ρ = .8)', label: 'Countered: you win the cheaper half' },
  ]);
  Object.values(mini.rows).forEach((R) => R.row.classList.add('shown'));
  let visible = false, cv = null, dist = null;
  const a = { split: 0, row2: 0, won: 0 };
  watchVisible(root, (v) => { visible = v; });

  function setup() {
    dist = getDist();
    const xs = gridFor(displayMax(dist));
    cv = { xs, ...curves(dist, xs, COUNTER) };
    mini.update(counterLadder());
  }
  setup();
  onJobChange(setup);

  function frame(dt) {
    if (!visible) return;
    const { step } = stepper.update();
    const view = step.view || 'pool';
    stage.dataset.view = view === 'ladder' ? 'ladder' : 'chart';
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 5);
    const order = ['pool', 'split', 'countered', 'won'];
    const at = view === 'ladder' ? 3 : order.indexOf(view);
    a.split = lerp(a.split, at >= 1 ? 1 : 0, k);
    a.row2 = lerp(a.row2, at >= 2 ? 1 : 0, k);
    a.won = lerp(a.won, at >= 3 ? 1 : 0, k);
    if (view !== 'ladder') drawCounterChart(canvas, dist, cv, a);
  }
  return { frame };
}

// ---------- Try it yourself ----------
const fmtUsd = (v) => '$' + (Math.round(v / 1000) * 1000).toLocaleString('en-US');
const pctl = (u) => Math.round(u * 100);

export function createAct4Play(root) {
  const $ = (id) => root.querySelector('#' + id);
  const canvas = $('a4chart');
  const s = { ...COUNTER, mode: 'half' };
  const chans = CHANNELS.filter((c) => ['poach', 'poachS', 'excol', 'ap8'].includes(c.id));
  const lad = buildLadder($('a4ladder'), chans);
  Object.values(lad.rows).forEach((R) => R.row.classList.add('shown'));
  let visible = false, dirty = true, ladderDirty = true, cv = null;
  watchVisible(root, (v) => { visible = v; if (v) dirty = true; }, '100px');

  function recompute() {
    const dist = getDist(), xs = gridFor(displayMax(dist));
    cv = { xs, ...curves(dist, xs, s) };
    const co = cv.co;
    $('a4cntX').textContent = co.countered.EX.toFixed(2); $('a4cntP').textContent = pctl(co.countered.pct);
    $('a4wonX').textContent = co.won.EX.toFixed(2); $('a4wonP').textContent = pctl(co.won.pct);
    $('a4notX').textContent = co.not.EX.toFixed(2); $('a4notP').textContent = pctl(co.not.pct);
    $('a4wonX2').textContent = co.won.EX.toFixed(2); $('a4notX2').textContent = co.not.EX.toFixed(2);
    $('a4lift').textContent = Math.round(co.liftRel * 100) + '%';
    $('a4liftX').textContent = co.lift.toFixed(2);
    const extra = Math.max(0, co.lift) * s.value;
    $('a4payYr').textContent = fmtUsd(extra);
    $('a4payShare').textContent = Math.round((100 * extra) / Math.max(1, s.salary)) + '%';
    $('a4payTot').textContent = fmtUsd(extra * s.years);
    $('a4salaryTxt').textContent = fmtUsd(s.salary);
    $('a4years').textContent = s.years === 1 ? '1 year' : s.years + ' years';
  }

  function renderLadder() {
    const dist = getDist(), res = {}, base = {}, { t, tq } = cv.co;
    const win = s.mode === 'none' ? null : s.mode === 'walk' ? t : tq;
    chans.forEach((ch, i) => {
      const opts = { k: ch.referral ? K_REF : 5, n: 10000, seed: 91 + i };
      res[ch.id] = sourceChannel(dist, GAMMA, ch, { ...opts, counter: win == null ? null : { rE: s.rE, t, tq: win } });
      base[ch.id] = win == null ? res[ch.id] : sourceChannel(dist, GAMMA, ch, opts);
    });
    lad.update(res);
    for (const ch of chans) {
      const R = lad.rows[ch.id];
      R.name.textContent = ch.label + (win == null ? '' : ' \u00b7 ' + Math.round(res[ch.id].firstCountered * 100) + '% countered');
      const d = Math.round(res[ch.id].mean * 100) - Math.round(base[ch.id].mean * 100);
      if (win != null && d) R.mean.textContent += ' (' + (d > 0 ? '+' : '\u2212') + Math.abs(d) + ')';
    }
  }

  const bind = (id, key, scale, fmt) => {
    const el = $(id);
    el.addEventListener('input', () => {
      s[key] = +el.value / scale;
      if (fmt) $(id + 'Out').textContent = fmt(s[key]);
      dirty = true;
    });
  };
  bind('a4salary', 'salary', 1);
  bind('a4value', 'value', 1);
  bind('a4tenure', 'years', 1);
  root.querySelectorAll('[data-cmode]').forEach((b) => b.addEventListener('click', () => {
    s.mode = b.dataset.cmode;
    root.querySelectorAll('[data-cmode]').forEach((x) => x.classList.toggle('active', x === b));
    ladderDirty = true;
  }));
  onJobChange(() => { dirty = true; ladderDirty = true; });
  window.addEventListener('resize', () => { dirty = true; });

  function frame() {
    if (!visible) return;
    if (dirty) { dirty = false; recompute(); drawCounterChart(canvas, getDist(), cv, { split: 1, row2: 1, won: 1 }, 300); }
    if (ladderDirty && cv) { ladderDirty = false; renderLadder(); }
  }
  return { frame };
}
