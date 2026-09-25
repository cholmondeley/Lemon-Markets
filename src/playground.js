// "Try it yourself" panel for Act I: the original live simulator, unscreened,
// hiring-only for now. The truth-ratio distribution follows the page's job type.

import { PRESET_HIRING, DT, gammaFromSlider, sliderFromGamma, genAgents, step, poolStats, steadyState, displayMax } from './model.js';
import { getDist, onJobChange } from './jobs.js';
import { C, readColors, honestyColor, fitCanvas } from './colors.js';

const labels = {
  zoneA: 'Looking', zoneU: 'Employed',
  viewHelpA: 'People currently job hunting: the ones a job posting reaches.',
  viewHelpU: 'People currently employed elsewhere: the ones you would have to poach.',
  liarsLabelA: 'Share of job hunters who oversell',
  liarsLabelU: 'Share of the employed who oversell',
};

export function createPlayground(root) {
  const $ = (id) => root.querySelector('#' + id);
  const poolCanvas = $('poolCanvas'), histCanvas = $('histCanvas'), timeCanvas = $('timeCanvas');
  const gammaSlider = $('gammaSlider'), nSlider = $('nSlider'), speedSlider = $('speedSlider');
  const playBtn = $('playBtn'), histScrim = $('histScrim');

  const state = {
    gamma: PRESET_HIRING, n: 260, view: 'A', playing: false, speed: 0.5, stepAccum: 0,
    t: 0, tick: 0, agents: [], history: [], recordEvery: 0.15, lastRecordT: -999,
  };
  let visible = false;

  // Population share per histogram bin for the current job type (x > 2 in the last bin).
  const HBINS = 20;
  let popShares = [], xMax = 2;
  function computePopShares() {
    const d = getDist(), M = 4000;
    xMax = displayMax(d);
    popShares = new Array(HBINS).fill(0);
    for (let i = 0; i < M; i++) popShares[Math.min(HBINS - 1, Math.floor((d.quantile((i + 0.5) / M) / xMax) * HBINS))] += 1 / M;
  }
  const theory = (g) => steadyState(getDist(), g);

  function resetSim() {
    state.agents = genAgents(state.n, getDist());
    state.t = 0; state.tick = 0; state.history = [];
    state.recordEvery = 0.15; state.lastRecordT = -999;
    recordHistory();
  }
  function simTick(dt) { step(state.agents, state.gamma, dt, state.tick); state.t += dt; state.tick++; }
  function recordHistory() {
    if (state.t - state.lastRecordT < state.recordEvery) return;
    state.lastRecordT = state.t;
    const avail = state.agents.filter((a) => a.s === 'A');
    const taken = state.agents.filter((a) => a.s === 'U');
    state.history.push({ t: state.t, avgA: poolStats(avail).avgX, avgU: poolStats(taken).avgX });
    if (state.history.length > 900) {
      state.history = state.history.filter((_, i) => i % 2 === 0);
      state.recordEvery *= 2;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function renderPool() {
    const { ctx, w, h } = fitCanvas(poolCanvas, 240);
    ctx.clearRect(0, 0, w, h);
    const pad = 10, gap = 10, zoneH = (h - pad * 2 - gap) / 2;
    const zones = [{ key: 'A', y: pad, label: labels.zoneA }, { key: 'U', y: pad + zoneH + gap, label: labels.zoneU }];
    const groups = { A: [], U: [] };
    state.agents.forEach((a) => groups[a.s].push(a));
    zones.forEach((z) => {
      ctx.fillStyle = C.surface3; roundRect(ctx, pad, z.y, w - pad * 2, zoneH, 8); ctx.fill();
      ctx.fillStyle = C.inkMuted; ctx.font = '600 11px "IBM Plex Sans", sans-serif';
      ctx.fillText(z.label.toUpperCase() + '  ' + groups[z.key].length, pad + 10, z.y + 16);
      const list = groups[z.key];
      if (!list.length) return;
      const innerPad = 8, top = z.y + 24, innerH = zoneH - 24 - innerPad, innerW = w - pad * 2 - innerPad * 2;
      const cell = Math.max(5, Math.min(16, Math.sqrt((innerW * innerH) / list.length) * 0.92));
      const cols = Math.max(1, Math.floor(innerW / cell));
      list.forEach((a, i) => {
        const cx = pad + innerPad + (i % cols) * cell + cell / 2;
        const cy = top + Math.floor(i / cols) * cell + cell / 2;
        if (cy > top + innerH) return;
        const age = (state.tick - a.flip) / 14;
        if (age < 1) {
          ctx.beginPath(); ctx.arc(cx, cy, cell * 0.34 + age * 6, 0, Math.PI * 2);
          ctx.strokeStyle = honestyColor(a.x); ctx.globalAlpha = 1 - age; ctx.lineWidth = 1.4; ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath(); ctx.arc(cx, cy, cell * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = honestyColor(a.x); ctx.fill();
      });
    });
  }

  const currentPool = () => state.agents.filter((a) => a.s === state.view);

  function renderHist() {
    const { ctx, w, h } = fitCanvas(histCanvas, 230);
    ctx.clearRect(0, 0, w, h);
    const padL = 8, padB = 20, padT = 8, padR = 8, plotW = w - padL - padR, plotH = h - padT - padB;
    const bins = HBINS, binW = xMax / bins, counts = new Array(bins).fill(0), pool = currentPool();
    pool.forEach((a) => { counts[Math.min(bins - 1, Math.floor(a.x / binW))]++; });
    let maxShare = pool.length ? Math.max(...counts) / pool.length : 0;
    maxShare = Math.max(maxShare, ...popShares) * 1.08;
    const xToPx = (x) => padL + (x / xMax) * plotW;
    const dToPy = (d) => padT + plotH - (d / maxShare) * plotH;

    // Pale silhouette: the population before any sorting.
    ctx.fillStyle = C.surface3; ctx.globalAlpha = 0.7;
    popShares.forEach((p, i) => { const y = dToPy(p); ctx.fillRect(xToPx(i * binW), y, xToPx((i + 1) * binW) - xToPx(i * binW), padT + plotH - y); });
    ctx.globalAlpha = 1;
    if (pool.length) {
      for (let i = 0; i < bins; i++) {
        const by = dToPy(counts[i] / pool.length);
        ctx.fillStyle = honestyColor(i * binW + binW / 2);
        ctx.fillRect(xToPx(i * binW), by, xToPx((i + 1) * binW) - xToPx(i * binW) - 2, padT + plotH - by);
      }
    }
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
    const x1 = xToPx(1);
    ctx.beginPath(); ctx.moveTo(x1, padT); ctx.lineTo(x1, padT + plotH);
    ctx.strokeStyle = C.inkFaint; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.inkMuted; ctx.font = '11px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'left'; ctx.fillText('← overselling', padL, h - 4);
    ctx.textAlign = 'center'; ctx.fillText('as advertised', x1, h - 4);
    ctx.textAlign = 'right'; ctx.fillText('underselling →', padL + plotW, h - 4);
    ctx.textAlign = 'left';
  }

  function renderTime() {
    const { ctx, w, h } = fitCanvas(timeCanvas, 'fill');
    ctx.clearRect(0, 0, w, h);
    const padL = 28, padB = 20, padT = 8, padR = 8, plotW = w - padL - padR, plotH = h - padT - padB;
    const maxT = Math.max(5, state.t);
    const xToPx = (t) => padL + (t / maxT) * plotW;
    const yToPx = (v) => padT + plotH - (v / 2) * plotH;
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
    [0, 0.5, 1, 1.5, 2].forEach((v) => { ctx.beginPath(); ctx.moveTo(padL, yToPx(v)); ctx.lineTo(padL + plotW, yToPx(v)); ctx.stroke(); });
    ctx.fillStyle = C.inkFaint; ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.fillText('1.0', 2, yToPx(1) + 3); ctx.fillText('2.0', 2, yToPx(2) + 9);
    const th = theory(state.gamma);
    const ref = state.view === 'A' ? th.EXA : th.EXU;
    ctx.strokeStyle = C.inkFaint; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(padL, yToPx(ref)); ctx.lineTo(padL + plotW, yToPx(ref)); ctx.stroke(); ctx.setLineDash([]);
    const key = state.view === 'A' ? 'avgA' : 'avgU';
    const pts = state.history.filter((p) => !isNaN(p[key]));
    if (pts.length > 1) {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(xToPx(p.t), yToPx(p[key])) : ctx.moveTo(xToPx(p.t), yToPx(p[key]))));
      ctx.stroke();
      const last = pts[pts.length - 1];
      ctx.beginPath(); ctx.arc(xToPx(last.t), yToPx(last[key]), 3.2, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill();
    }
    ctx.fillStyle = C.inkFaint; ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.fillText('t=0', padL - 2, h - 5);
    ctx.textAlign = 'right'; ctx.fillText('t=' + maxT.toFixed(0), padL + plotW, h - 5); ctx.textAlign = 'left';
  }

  const fmtPct = (x) => (isNaN(x) ? '—' : Math.round(x * 100) + '%');
  const setText = (id, v) => { const el = $(id); if (el.textContent !== v) el.textContent = v; };

  function updateStats() {
    const pool = currentPool();
    const availCount = state.agents.filter((a) => a.s === 'A').length;
    const ps = poolStats(pool), th = theory(state.gamma), onA = state.view === 'A';
    setText('statLiarsLabel', onA ? labels.liarsLabelA : labels.liarsLabelU);
    setText('statLiars', fmtPct(ps.fracLiars));
    setText('statLiarsTheory', onA ? 'theory: ' + fmtPct(th.PXlt1_A) + ' at steady state' : '');
    setText('statMean', isNaN(ps.avgX) ? '—' : ps.avgX.toFixed(2));
    setText('statMeanTheory', 'theory: ' + (onA ? th.EXA : th.EXU).toFixed(2) + ' at steady state');
    setText('statFracAvail', fmtPct(availCount / state.agents.length));
    setText('statFracAvailTheory', 'theory: ' + (th.PA * 100).toFixed(1) + '% at steady state');
    setText('tReadout', 't = ' + state.t.toFixed(1));
  }

  function renderAll() { readColors(); renderPool(); renderHist(); renderTime(); updateStats(); }

  function setPlaying(p) {
    state.playing = p;
    playBtn.classList.toggle('playing', p); playBtn.classList.toggle('paused', !p);
    playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
    histScrim.classList.toggle('hidden', p);
  }
  function syncGamma() {
    const th = theory(state.gamma);
    setText('gammaReadout', state.gamma.toFixed(2));
    setText('gammaShare', (th.PA * 100).toFixed(1) + '% of everyone is on the market');
    setText('nApplicants', '\u2248 ' + Math.round(state.n * th.PA));
    setText('gammaHelp', state.gamma < 0.12 ? 'Slow churn: once someone is placed, they tend to stay placed.'
      : state.gamma > 0.5 ? 'Fast churn: even people who deliver keep cycling back onto the market.'
        : 'Middling churn: some good people cycle back, most stay put.');
  }
  function setView(v) {
    state.view = v;
    $('viewAvailBtn').classList.toggle('active', v === 'A');
    $('viewTakenBtn').classList.toggle('active', v === 'U');
    setText('viewHelp', v === 'A' ? labels.viewHelpA : labels.viewHelpU);
  }

  gammaSlider.addEventListener('input', () => { state.gamma = gammaFromSlider(+gammaSlider.value); syncGamma(); });
  root.querySelector('[data-preset="hiring"]').addEventListener('click', () => {
    state.gamma = PRESET_HIRING; gammaSlider.value = sliderFromGamma(state.gamma); syncGamma();
  });
  nSlider.addEventListener('input', () => { state.n = +nSlider.value; setText('nReadout', String(state.n)); syncGamma(); resetSim(); });
  speedSlider.addEventListener('input', () => { state.speed = +speedSlider.value / 2; setText('speedReadout', state.speed.toFixed(1) + '×'); });
  $('viewAvailBtn').addEventListener('click', () => setView('A'));
  $('viewTakenBtn').addEventListener('click', () => setView('U'));
  playBtn.addEventListener('click', () => setPlaying(!state.playing));
  $('resetBtn').addEventListener('click', () => { resetSim(); setPlaying(false); renderAll(); });
  $('ffBtn').addEventListener('click', () => {
    for (let i = 0; i < 4000; i++) { simTick(DT); if (i % 40 === 0) recordHistory(); }
    recordHistory(); renderAll();
  });

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (!visible && state.playing) setPlaying(false);
  }, { rootMargin: '100px' }).observe(root);

  onJobChange(() => { computePopShares(); syncGamma(); resetSim(); });

  gammaSlider.value = sliderFromGamma(PRESET_HIRING);
  computePopShares(); syncGamma(); setView('A'); resetSim();

  function frame(dtReal) {
    if (!visible) return;
    if (state.playing) {
      state.stepAccum += state.speed * dtReal / DT * 8;
      const n = Math.floor(state.stepAccum);
      state.stepAccum -= n;
      for (let i = 0; i < n; i++) { simTick(DT); recordHistory(); }
    }
    renderAll();
  }

  return { frame, render: renderAll };
}
