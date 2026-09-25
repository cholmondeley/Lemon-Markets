// Act I scrollytelling: one seeded population drawn as a mirrored dot histogram.
// Horizontal position = truth ratio; above the axis = looking, below = employed.
// Each .step element in the page says what the stage should show through data
// attributes, so the copy can be edited without touching this file:
//   data-layout  cloud | mirror
//   data-clock   zero | scrub | live   (scrub maps scroll progress onto time)
//   data-focus   all | looking         (looking dims the employed)
//   data-marks   space-separated: ghost q1 mean employed

import { BETA, DT, PRESET_HIRING, mulberry32, steadyState, displayMax } from './model.js';
import { getDist, onJobChange } from './jobs.js';
import { createStepper, watchVisible } from './stepper.js';
import { C, readColors, honestyRgb, hexToRgb, fitCanvas, lerp } from './colors.js';

const GAMMA = PRESET_HIRING;
const SCRUB_T = 12;           // model time covered by the scrub step (1 unit = one average search)
const MONTHS_PER_UNIT = 3.5;  // illustrative: a 3.5-month search per ~4-year job gives gamma = 0.07
const LIVE_RATE = 0.5;        // model time units per second once the market is "live"
const SEED = 20260924;

// Tallest column share times the column count (independent of the count for fine
// bins): how much taller than a flat block the starting population stands.
function peakFactor(dist, xMax, B = 60, M = 6000) {
  const counts = new Array(B).fill(0);
  for (let i = 0; i < M; i++) counts[Math.min(B - 1, Math.floor((dist.quantile((i + 0.5) / M) / xMax) * B))]++;
  return (Math.max(...counts) / M) * B;
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createStory(root) {
  const stage = root.querySelector('.stage');
  const plot = stage.querySelector('.stage-plot');
  const canvas = plot.querySelector('canvas');
  const stepper = createStepper(root, stage);
  const clockEl = stage.querySelector('[data-clock-readout]');
  const liveEls = Array.from(stage.querySelectorAll('[data-live]'));
  const callout = stage.querySelector('.callout');

  let bins = 0, agents = [], simTick = 0, rng = null;
  let tick = 0, liveTick = 0;
  let reveal = 0, dimEmployed = 0, labelEmployed = 0;
  const markAlpha = { ghost: 0, q1: 0, mean: 0 };
  let visible = true, time = 0;
  let geom = null;
  let dist = getDist(), th = steadyState(dist, GAMMA), q20 = dist.quantile(0.2), xMax = displayMax(dist);
  let startCounts = [], maxStack = 10, nPeople = 0, peak = peakFactor(dist, xMax);

  // Stratified by quantile: person j of n sits in the j-th slice of the distribution,
  // so every reader sees the population's true shape. Truth ratios above 2 share
  // the last column.
  function build(nBins, n) {
    const old = agents;
    bins = nBins; nPeople = n;
    rng = mulberry32(SEED + nBins);
    agents = [];
    startCounts = new Array(bins).fill(0);
    for (let j = 0; j < n; j++) {
      const x = dist.quantile((j + 0.5 + (rng() - 0.5) * 0.98) / n);
      const bin = Math.min(bins - 1, Math.floor((x / xMax) * bins));
      startCounts[bin]++;
      const prev = old[j];
      agents.push({
        x, bin, flips: [], cur: 'A',
        hx: rng(), hy: rng(), phase: rng() * Math.PI * 2, wob: 0.6 + rng() * 0.8,
        ease: 5 + rng() * 5, px: prev ? prev.px : NaN, py: prev ? prev.py : NaN, s: 'A', last: -1,
      });
    }
    maxStack = Math.max(4, ...startCounts);
    simTick = 0;
    document.querySelectorAll('[data-total]').forEach((el) => { el.textContent = String(agents.length); });
  }

  // Extend the seeded trajectory so every agent's flip ticks are known up to t.
  function extendTo(t) {
    while (simTick < t) {
      simTick++;
      for (const a of agents) {
        if (a.cur === 'A') {
          if (rng() < BETA * DT) { a.cur = 'U'; a.flips.push(simTick); }
        } else if (rng() < (GAMMA / a.x) * DT) {
          a.cur = 'A'; a.flips.push(simTick);
        }
      }
    }
  }

  // Number of flips at or before tick t (binary search), which gives state and last flip.
  function flipsUpTo(a, t) {
    let lo = 0, hi = a.flips.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a.flips[m] <= t) lo = m + 1; else hi = m; }
    return lo;
  }

  function layoutGeom(w, h) {
    const padX = 14, topPad = 30, botPad = 30, axisGap = 13;
    const colW = (w - padX * 2) / bins;
    const half = (h - topPad - botPad) / 2 - axisGap;
    const pitch = Math.min(colW, half / (maxStack + 0.5));
    const axisY = topPad + half + axisGap;
    return {
      w, h, padX, colW, pitch, axisY, axisGap, r: Math.max(1.6, Math.min(colW, pitch) * 0.4),
      xAt: (x) => padX + (Math.min(x, xMax) / xMax) * (w - padX * 2),
      colX: (b) => padX + (b + 0.5) * colW,
    };
  }

  function frame(dtReal) {
    if (!visible) return;
    time += dtReal;
    const { step, progress } = stepper.update();
    const layout = step.layout || 'mirror';
    const clock = step.clock || 'zero';
    const marks = (step.marks || '').split(/\s+/);

    // Pick the column count so columns are about as wide as the tallest stack's dots
    // are tall: B^2 = W * N * peak / H, with N people and a half-height H.
    const pw = plot.clientWidth, ph = plot.clientHeight;
    const wantN = pw < 560 ? 300 : 500;
    const wantB = Math.max(20, Math.min(90, Math.round(Math.sqrt(pw * wantN * peak / Math.max(80, ph / 2 - 43)))));
    if (wantB !== bins || wantN !== nPeople) build(wantB, wantN);

    if (clock === 'zero') { tick = 0; liveTick = 0; }
    else if (clock === 'scrub') { tick = progress * SCRUB_T / DT; liveTick = tick; }
    else {
      liveTick = Math.max(liveTick, SCRUB_T / DT);
      if (!reduceMotion) liveTick += dtReal * LIVE_RATE / DT;
      tick = liveTick;
    }
    const t = Math.floor(tick);
    extendTo(t + 1);

    const k = reduceMotion ? 1 : 1 - Math.exp(-dtReal * 6);
    reveal = lerp(reveal, layout === 'cloud' ? 0 : 1, k);
    dimEmployed = lerp(dimEmployed, step.focus === 'looking' ? 1 : 0, k);
    labelEmployed = lerp(labelEmployed, marks.includes('employed') ? 1 : 0, k);
    for (const m in markAlpha) markAlpha[m] = lerp(markAlpha[m], marks.includes(m) ? 1 : 0, k);

    const { ctx, w, h } = fitCanvas(canvas, 'fill');
    geom = layoutGeom(w, h);
    const g = geom;

    // Current state per agent, then stack order: earlier arrivals at the bottom.
    const stacks = { A: new Array(bins), U: new Array(bins) };
    for (let b = 0; b < bins; b++) { stacks.A[b] = []; stacks.U[b] = []; }
    let nA = 0, sumA = 0, liarsA = 0, q1A = 0;
    agents.forEach((a, i) => {
      const n = flipsUpTo(a, t);
      a.s = n % 2 === 0 ? 'A' : 'U';
      a.last = n ? a.flips[n - 1] : -1;
      a.i = i;
      stacks[a.s][a.bin].push(a);
      if (a.s === 'A') { nA++; sumA += a.x; if (a.x < 1) liarsA++; if (a.x < q20) q1A++; }
    });
    const tallestLeft = { h: 0, b: 1 };
    for (let b = 0; b < bins; b++) {
      for (const z of ['A', 'U']) {
        stacks[z][b].sort((p, q) => (p.last - q.last) || (p.i - q.i));
        stacks[z][b].forEach((a, slot) => {
          a.tx = g.colX(b);
          a.ty = z === 'A' ? g.axisY - g.axisGap - (slot + 0.5) * g.pitch : g.axisY + g.axisGap + (slot + 0.5) * g.pitch;
        });
      }
      if (b / bins < 0.5 && stacks.A[b].length >= tallestLeft.h) { tallestLeft.h = stacks.A[b].length; tallestLeft.b = b; }
    }
    if (layout === 'cloud') {
      agents.forEach((a) => {
        a.tx = 20 + a.hx * (w - 40) + Math.sin(time * a.wob + a.phase) * 5;
        a.ty = 30 + a.hy * (h - 60) + Math.cos(time * a.wob * 0.8 + a.phase) * 5;
      });
    }

    readColors();
    ctx.clearRect(0, 0, w, h);
    const m = reveal;

    // Marks drawn under the dots.
    const base = g.axisY - g.axisGap;
    const topOfGhost = base - maxStack * g.pitch;
    if (markAlpha.ghost > 0.01) {
      // Silhouette of the starting population, column by column.
      ctx.globalAlpha = markAlpha.ghost * 0.45;
      ctx.fillStyle = C.surface3;
      ctx.beginPath(); ctx.moveTo(g.padX, base);
      startCounts.forEach((c, b) => {
        const y = base - c * g.pitch;
        ctx.lineTo(g.padX + b * g.colW, y); ctx.lineTo(g.padX + (b + 1) * g.colW, y);
      });
      ctx.lineTo(w - g.padX, base); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = markAlpha.ghost;
      ctx.setLineDash([3, 4]); ctx.strokeStyle = C.ruleStrong; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      const peak = startCounts.indexOf(Math.max(...startCounts));
      ctx.fillStyle = C.inkFaint; ctx.font = '500 11px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('where everyone started', g.padX + (peak + 1.5) * g.colW, topOfGhost + 10);
      ctx.globalAlpha = 1;
    }
    if (markAlpha.q1 > 0.01) {
      ctx.globalAlpha = markAlpha.q1;
      ctx.fillStyle = C.redSoft;
      const x0 = g.xAt(0), x1 = g.xAt(q20);
      ctx.fillRect(x0, topOfGhost, x1 - x0, g.axisY - g.axisGap - topOfGhost + 2);
      ctx.fillStyle = C.red; ctx.font = '600 11px "IBM Plex Sans", sans-serif';
      ctx.fillText('bottom fifth', x0 + 5, topOfGhost + 14);
      ctx.globalAlpha = 1;
    }

    if (m > 0.02) {
      // Axis, honest line and scale.
      ctx.globalAlpha = m;
      ctx.strokeStyle = C.ruleStrong; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(g.padX, g.axisY); ctx.lineTo(w - g.padX, g.axisY); ctx.stroke();
      ctx.setLineDash([2, 4]); ctx.strokeStyle = C.inkFaint;
      ctx.beginPath(); ctx.moveTo(g.xAt(1), 22); ctx.lineTo(g.xAt(1), h - 22); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = C.inkFaint; ctx.textBaseline = 'middle';
      const ticks = [];
      for (let v = 0; v <= xMax + 1e-9; v += 0.5) ticks.push(v);
      ticks.forEach((v) => {
        const last = v === xMax;
        ctx.textAlign = v === 0 ? 'left' : last ? 'right' : 'center';
        const label = v === 1 ? '1.0 as advertised' : last && dist.kind !== 'uniform' ? v.toFixed(1) + '+' : v.toFixed(1);
        ctx.fillStyle = C.surface;
        const tw = ctx.measureText(label).width + 8;
        const lx = v === 0 ? g.xAt(v) - 2 : last ? g.xAt(v) - tw + 2 : g.xAt(v) - tw / 2;
        ctx.fillRect(lx, g.axisY - 7, tw, 14);
        ctx.fillStyle = v === 1 ? C.inkMuted : C.inkFaint;
        ctx.fillText(label, v === 0 ? g.xAt(v) + 2 : last ? g.xAt(v) - 2 : g.xAt(v), g.axisY);
      });
      ctx.textBaseline = 'alphabetic';

      ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'left';
      ctx.fillStyle = C.ink;
      ctx.fillText('LOOKING', g.padX, 16);
      ctx.fillStyle = C.inkFaint; ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillText(String(nA), g.padX + 62, 16);
      ctx.globalAlpha = m * labelEmployed;
      ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.fillStyle = C.ink;
      ctx.fillText('EMPLOYED', g.padX, h - 8);
      ctx.fillStyle = C.inkFaint; ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillText(String(agents.length - nA), g.padX + 70, h - 8);
      ctx.globalAlpha = w < 480 ? 0 : m;
      ctx.textAlign = 'right'; ctx.font = '11px "IBM Plex Sans", sans-serif';
      ctx.fillStyle = C.red; ctx.fillText('← oversells', g.xAt(1) - 8, 16);
      ctx.textAlign = 'left'; ctx.fillStyle = C.blue; ctx.fillText('undersells →', g.xAt(1) + 8, 16);
      ctx.globalAlpha = 1;
    }

    // Dots.
    const neutral = hexToRgb(C.inkFaint);
    const pulseTicks = 0.9 / DT;
    agents.forEach((a) => {
      if (isNaN(a.px)) { a.px = a.tx; a.py = a.ty; }
      const ka = reduceMotion ? 1 : 1 - Math.exp(-dtReal * a.ease);
      a.px = lerp(a.px, a.tx, ka); a.py = lerp(a.py, a.ty, ka);
      const hr = honestyRgb(a.x);
      const col = [0, 1, 2].map((j) => Math.round(lerp(neutral[j], hr[j], m)));
      const alpha = a.s === 'U' ? 1 - 0.8 * dimEmployed : 1;
      const age = tick - a.last;
      if (layout !== 'cloud' && a.last > 0 && age >= 0 && age < pulseTicks && a.s === 'A') {
        const p = age / pulseTicks;
        ctx.beginPath(); ctx.arc(a.px, a.py, g.r + p * g.r * 2.4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(' + col.join(',') + ',' + (1 - p) * 0.8 + ')'; ctx.lineWidth = 1.3; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(a.px, a.py, g.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + col.join(',') + ',' + alpha + ')';
      ctx.fill();
    });

    const meanA = nA ? sumA / nA : NaN;
    if (markAlpha.mean > 0.01) {
      const mx = g.xAt(th.EXA);
      ctx.globalAlpha = markAlpha.mean;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(mx, topOfGhost - 2); ctx.lineTo(mx, g.axisY - g.axisGap + 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(mx, topOfGhost - 2, 3, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();
      ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('expected average ' + th.EXA.toFixed(2), mx + 7, topOfGhost + 2);
      ctx.globalAlpha = 1;
    }

    // DOM readouts.
    if (clockEl) clockEl.textContent = 'Month ' + Math.round(tick * DT * MONTHS_PER_UNIT);
    const live = {
      looking: nA, total: agents.length, liars: liarsA, q1: q1A,
      lookingPct: Math.round(100 * nA / agents.length) + '%',
      mean: isNaN(meanA) ? '—' : meanA.toFixed(2),
    };
    liveEls.forEach((el) => {
      const v = String(live[el.dataset.live]);
      if (el.textContent !== v) el.textContent = v;
    });
    if (callout) {
      const b = tallestLeft.b;
      callout.style.left = g.colX(b) + g.colW + 10 + 'px';
      callout.style.top = g.axisY - g.axisGap - (tallestLeft.h + 0.5) * g.pitch + 'px';
    }
  }

  onJobChange(() => {
    dist = getDist(); th = steadyState(dist, GAMMA); q20 = dist.quantile(0.2); xMax = displayMax(dist);
    peak = peakFactor(dist, xMax);
    bins = 0; // the next frame rebuilds at a column count that suits the new shape
  });

  watchVisible(root, (v) => { visible = v; });

  return { frame };
}
