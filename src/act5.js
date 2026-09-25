// Act V: when to stop looking. Two views share the stage:
//   conveyor: candidates arriving left to right; height is how good they look (their
//             true percentile under a perfect read, or their interview read), colour is
//             their true quintile. Shows the look-then-leap window, benchmark and pick.
//   chart:    chance of a top-5% / top-10% hire against the share evaluated first,
//             from precomputed simulations (scripts/stopping-data.mjs).
// Steps set data-mode (conveyor | chart), data-r (1, 0.44), data-recall (0 | 1 | both),
// data-window (the evaluated share) and data-reveal (scrub arrivals with scroll).

import { PRESET_HIRING, mulberry32, gauss, normCdf } from './model.js';
import { getDist, getJob, onJobChange } from './jobs.js';
import { C, readColors, fitCanvas, lerp } from './colors.js';
import { createStepper, watchVisible } from './stepper.js';
import DATA from './data/stopping.json';

const GAMMA = PRESET_HIRING;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const QCOL = ['--q1', '--q2', '--q3', '--q4', '--q5'];

export const series = (job, n, r, recall) => DATA.results[[job, n, r, recall ? 1 : 0].join('|')];
const fIndex = (f) => DATA.fractions.indexOf(f);
export const stopAt = (job, n, r, recall, f) => series(job, n, r, recall)[fIndex(f)];

// Seeded conveyor: n people from the looking pool with a fixed interview noise each.
function conveyor(dist, n = 40, seed = 17) {
  const rng = mulberry32(seed), M = 4000, xs = [], cum = [];
  let tot = 0;
  for (let i = 0; i < M; i++) { const x = dist.quantile((i + 0.5) / M); xs.push(x); tot += GAMMA / (GAMMA + x); cum.push(tot); }
  const people = [];
  for (let i = 0; i < n; i++) {
    const t = rng() * tot; let lo = 0, hi = M - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < t) lo = m + 1; else hi = m; }
    const x = xs[lo], p = cum[lo] / tot, e = gauss(rng);
    const s44 = 0.44 * (x - 1) / dist.cv + Math.sqrt(1 - 0.44 * 0.44) * e;
    people.push({ p, look44: normCdf(s44), y: NaN });
  }
  return people;
}

// Look-then-leap on a list of "looks"; returns { m, bench, pick }.
function leap(looks, f) {
  const m = Math.max(1, Math.round(f * looks.length));
  let bench = -1;
  for (let i = 0; i < m; i++) bench = Math.max(bench, looks[i]);
  for (let i = m; i < looks.length; i++) if (looks[i] > bench) return { m, bench, pick: i };
  return { m, bench, pick: looks.length - 1 };
}

const ordinal = (n) => { const t = n % 100; return n + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); };

function drawConveyor(ctx, w, h, people, a) {
  const padL = 14, padR = 14, top = 30, bot = h - 34, n = people.length;
  const X = (i) => padL + (i + 0.5) * ((w - padL - padR) / n), Y = (v) => bot - v * (bot - top);
  const shown = Math.round(a.reveal * n);
  // evaluation window
  if (a.window > 0.01) {
    const m = a.leap.m;
    ctx.save(); ctx.globalAlpha = a.window;
    ctx.fillStyle = C.surface3; ctx.fillRect(padL, top - 6, X(m - 1) + (X(1) - X(0)) / 2 - padL, bot - top + 12);
    ctx.fillStyle = C.inkMuted; ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('LOOK ONLY', padL + 6, top + 6);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
    const by = Y(a.leap.bench);
    ctx.beginPath(); ctx.moveTo(padL, by); ctx.lineTo(w - padR, by); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.ink; ctx.textAlign = 'right';
    ctx.fillText('best so far', w - padR, by - 6);
    ctx.restore();
  }
  // axis
  ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, bot + 8); ctx.lineTo(w - padR, bot + 8); ctx.stroke();
  ctx.fillStyle = C.inkFaint; ctx.font = '11px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('first candidate', padL, bot + 24); ctx.textAlign = 'right'; ctx.fillText('last →', w - padR, bot + 24);
  ctx.textAlign = 'left';
  const r = Math.max(3, Math.min(8, (w - padL - padR) / n * 0.32));
  const cs = getComputedStyle(document.documentElement);
  people.forEach((pp, i) => {
    if (i >= shown) return;
    const target = lerp(pp.p, pp.look44, a.noisy);
    pp.y = isNaN(pp.y) ? target : lerp(pp.y, target, a.k);
    ctx.beginPath(); ctx.arc(X(i), Y(pp.y), r, 0, Math.PI * 2);
    ctx.fillStyle = cs.getPropertyValue(QCOL[Math.min(4, Math.floor(pp.p * 5))]).trim();
    ctx.globalAlpha = a.window > 0.5 && i < a.leap.m ? 0.55 : 1;
    ctx.fill(); ctx.globalAlpha = 1;
  });
  if (a.window > 0.5 && shown >= n) {
    const i = a.leap.pick, pp = people[i], px = X(i), py = Y(pp.y);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, r + 5, 0, Math.PI * 2); ctx.stroke();
    const right = px < w * 0.6;
    ctx.fillStyle = C.ink; ctx.font = '600 12px "IBM Plex Sans", sans-serif'; ctx.textAlign = right ? 'left' : 'right';
    ctx.fillText('you hire: truly ' + ordinal(Math.round(pp.p * 100)) + ' percentile', px + (right ? -r : r), py - r - 12);
    ctx.textAlign = 'left';
  }
}

// Line chart of success rates against the share evaluated first.
function drawChart(ctx, w, h, lines, marks) {
  const padL = 40, padR = 14, padT = 18, padB = 36;
  const pw = w - padL - padR, ph = h - padT - padB, fx = DATA.fractions, fMax = 0.6;
  const X = (f) => padL + (f / fMax) * pw, Y = (v) => padT + ph - v * ph;
  ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = C.inkFaint; ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
  for (let v = 0; v <= 1.001; v += 0.25) {
    ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(padL + pw, Y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(Math.round(v * 100) + '%', padL - 6, Y(v) + 3);
  }
  ctx.textAlign = 'center';
  [0, 0.1, 0.2, 0.37, 0.5, 0.6].forEach((f) => ctx.fillText(Math.round(f * 100) + '%', X(f), padT + ph + 14));
  ctx.fillStyle = C.inkMuted; ctx.font = '11px "IBM Plex Sans", sans-serif';
  ctx.fillText('share of candidates you only look at first →', padL + pw / 2, h - 4);
  // the "stop here" band and the textbook line
  ctx.fillStyle = C.lemonSoft || C.surface3; ctx.globalAlpha = 0.6;
  ctx.fillRect(X(0.1), padT, X(0.2) - X(0.1), ph); ctx.globalAlpha = 1;
  ctx.setLineDash([3, 4]); ctx.strokeStyle = C.inkFaint;
  ctx.beginPath(); ctx.moveTo(X(0.37), padT); ctx.lineTo(X(0.37), padT + ph); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = C.inkMuted; ctx.font = '10px "IBM Plex Sans", sans-serif';
  ctx.fillText('10–20%', (X(0.1) + X(0.2)) / 2, padT + 10); ctx.fillText('textbook 37%', X(0.37), padT + 10);
  lines.forEach((L) => {
    if (L.alpha < 0.01) return;
    ctx.save(); ctx.globalAlpha = L.alpha; ctx.strokeStyle = L.color; ctx.lineWidth = L.width || 2.2;
    if (L.dash) ctx.setLineDash(L.dash);
    ctx.beginPath();
    L.values.forEach((v, i) => (i ? ctx.lineTo(X(fx[i]), Y(v)) : ctx.moveTo(X(fx[i]), Y(v))));
    ctx.stroke(); ctx.setLineDash([]);
    const last = L.values.length - 1;
    ctx.fillStyle = L.color; ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(L.label, X(fx[last]) - 2, Y(L.values[last]) - 7);
    ctx.restore();
  });
  (marks || []).forEach((mk) => {
    if (mk.alpha < 0.01) return;
    ctx.save(); ctx.globalAlpha = mk.alpha;
    const x = X(mk.f), y = Y(mk.v);
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = mk.color; ctx.fill();
    ctx.fillStyle = C.ink; ctx.font = '600 12px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(Math.round(mk.v * 100) + '%', x + 8, y - 6);
    ctx.restore();
  });
}

export function createAct5Story(root) {
  const stage = root.querySelector('.stage');
  const canvas = stage.querySelector('canvas');
  const stepper = createStepper(root, stage);
  let visible = false, people = conveyor(getDist());
  watchVisible(root, (v) => { visible = v; });
  onJobChange(() => { people = conveyor(getDist()); });
  const a = { conv: 1, reveal: 0, window: 0, noisy: 0, rec: 0, r44: 0, k: 1 };

  function frame(dt) {
    if (!visible) return;
    const { step, progress } = stepper.update();
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 5);
    const mode = step.mode || 'conveyor';
    stage.dataset.mode = mode;
    a.k = k;
    a.conv = lerp(a.conv, mode === 'conveyor' ? 1 : 0, k);
    a.reveal = step.reveal === 'scrub' ? Math.max(0.03, Math.min(1, progress * 1.3)) : 1;
    a.window = lerp(a.window, step.window ? 1 : 0, k);
    a.noisy = lerp(a.noisy, step.r === '0.44' ? 1 : 0, k);
    a.rec = lerp(a.rec, step.recall === '1' || step.recall === 'both' ? 1 : 0, k);
    a.r44 = lerp(a.r44, step.r === '0.44' ? 1 : 0, k);
    const f = +(step.window || 0.37);
    a.leap = leap(people.map((pp) => (step.r === '0.44' ? pp.look44 : pp.p)), f);

    readColors();
    C.lemonSoft = getComputedStyle(document.documentElement).getPropertyValue('--lemon-soft').trim();
    const { ctx, w, h } = fitCanvas(canvas, 'fill');
    ctx.clearRect(0, 0, w, h);
    if (a.conv > 0.01) { ctx.save(); ctx.globalAlpha = a.conv; drawConveyor(ctx, w, h, people, a); ctx.restore(); }
    if (a.conv < 0.99) {
      const job = getJob();
      const s1 = series(job, 100, 1, false), s1r = series(job, 100, 1, true);
      const s4 = series(job, 100, 0.44, false), s4r = series(job, 100, 0.44, true);
      const perfect = 1 - a.r44;
      const lines = [
        { values: s1.map((v) => v.p5), color: C.accent, label: 'top 5%, perfect read', alpha: perfect * (1 - 0.6 * a.rec) },
        { values: s1r.map((v) => v.p5), color: C.accent, dash: [6, 4], label: 'with recall', alpha: perfect * a.rec },
        { values: s4.map((v) => v.p5), color: C.red, label: 'top 5%, structured interview', alpha: a.r44 },
        { values: s4r.map((v) => v.p5), color: C.red, dash: [6, 4], label: 'with recall', alpha: a.r44 },
      ];
      const i20 = fIndex(0.2), i37 = fIndex(0.37);
      const marks = [
        { f: 0.2, v: s1[i20].p5, color: C.accent, alpha: perfect * (1 - a.rec) },
        { f: 0.37, v: s1[i37].p5, color: C.inkFaint, alpha: perfect * (1 - a.rec) },
        { f: 0.2, v: s1r[i20].p5, color: C.accent, alpha: perfect * a.rec },
        { f: 0.2, v: s4[i20].p5, color: C.red, alpha: a.r44 },
        { f: 0.2, v: s4r[i20].p5, color: C.red, alpha: a.r44 },
      ];
      ctx.save(); ctx.globalAlpha = 1 - a.conv; drawChart(ctx, w, h, lines, marks); ctx.restore();
    }
  }
  return { frame };
}

// ---------- Try it yourself ----------
export function createAct5Play(root) {
  const $ = (id) => root.querySelector('#' + id);
  const s = { n: 100, r: 0.44, recall: true, f: 0.2 };
  let visible = false, dirty = true;
  watchVisible(root, (v) => { visible = v; if (v) dirty = true; }, '100px');

  const group = (attr, key, parse) => root.querySelectorAll('[' + attr + ']').forEach((b) => b.addEventListener('click', () => {
    s[key] = parse(b.getAttribute(attr));
    root.querySelectorAll('[' + attr + ']').forEach((x) => x.classList.toggle('active', x === b));
    dirty = true;
  }));
  group('data-sn', 'n', Number);
  group('data-sr', 'r', Number);
  group('data-srecall', 'recall', (v) => v === '1');
  const fSlider = $('a5f');
  fSlider.addEventListener('input', () => { s.f = DATA.fractions[+fSlider.value]; dirty = true; });
  onJobChange(() => { dirty = true; });
  window.addEventListener('resize', () => { dirty = true; });

  function frame() {
    if (!visible || !dirty) return;
    dirty = false;
    readColors();
    C.lemonSoft = getComputedStyle(document.documentElement).getPropertyValue('--lemon-soft').trim();
    const job = getJob(), ser = series(job, s.n, s.r, s.recall), i = fIndex(s.f), at = ser[i];
    const { ctx, w, h } = fitCanvas($('a5chart'), 300);
    ctx.clearRect(0, 0, w, h);
    drawChart(ctx, w, h, [
      { values: ser.map((v) => v.p5), color: C.accent, label: '', alpha: 1 },
      { values: ser.map((v) => v.p10), color: C.blue, label: '', alpha: 1, width: 1.6 },
      { values: ser.map((v) => v.p20), color: C.inkFaint, label: '', alpha: 1, width: 1.4 },
    ], [{ f: s.f, v: at.p5, color: C.accent, alpha: 1 }]);
    $('a5fOut').textContent = Math.round(s.f * 100) + '%';
    $('a5p5').textContent = Math.round(at.p5 * 100) + '%';
    $('a5p10').textContent = Math.round(at.p10 * 100) + '%';
    $('a5mean').textContent = ordinal(Math.round(at.mean * 100));
    $('a5median').textContent = ordinal(Math.round(at.median * 100));
    $('a5seen').textContent = Math.round(at.seen) + ' of ' + s.n;
  }
  return { frame };
}
