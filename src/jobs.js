// The page-wide job type. Any [data-job] button switches it; any [data-th] element
// shows a steady-state number for the current job type at the hiring churn, so
// the essay's copy stays true when the reader flips the switch.
//   <span data-th="PXlt1_A" data-fmt="pct">75%</span>

import STOP from './data/stopping.json';
import { JOB_TYPES, DEFAULT_JOB, PRESET_HIRING, steadyState, bestOfK, exactNarrowing, ladder, counterOffers, sourceChannel, CHANNELS, Z99 } from './model.js';

let current = DEFAULT_JOB;
const subs = [];

export const getJob = () => current;
export const getDist = () => JOB_TYPES[current].dist;
export function onJobChange(fn) { subs.push(fn); }
// Act III's standard sourcing ladder for the current job type: you interview five;
// a referrer weighs three people they know and sends you one.
export const K_REF = 3;
export const standardLadder = () => ladder(getDist(), PRESET_HIRING, { n: 20000, kRef: K_REF });

// Best case: a 99th-percentile referrer (rho = .8) weighing three people. Cached per job type.
const bestCaseCache = new Map();
function bestCase() {
  if (!bestCaseCache.has(current)) {
    const ch = CHANNELS.find((c) => c.id === 'ap8');
    bestCaseCache.set(current, sourceChannel(getDist(), PRESET_HIRING, ch, { k: K_REF, n: 20000, zRef: Z99, seed: 99 }).EX);
  }
  return bestCaseCache.get(current);
}

// Act IV defaults: 12% of people with an outside offer get a counter (Faberman et al.,
// 2022). The employer's read has validity .7: supervisors' ratings of overall
// performance agree at about .52 (Viswesvaran, Ones & Schmidt, 1996), so one rating
// tracks true performance at about sqrt(.52) = .72. You win the half of counters the
// employer valued least. An as-advertised hire in the example role creates
// $300,000 a year of value on a $150,000 salary.
export const COUNTER = { c: 0.12, rE: 0.7, q: 0.5, salary: 150000, value: 300000, years: 3 };
export const standardCounter = () => counterOffers(getDist(), PRESET_HIRING, COUNTER.c, COUNTER.rE, COUNTER.q);

// Random poach, poach + structured and A-player referral (rho = .8) rows with no counters, walking away from
// every counter, and winning the counter-counters for the half the employer valued
// least (winner's curse). Cached per job type.
const counterLadderCache = new Map();
export function counterLadder() {
  if (counterLadderCache.has(current)) return counterLadderCache.get(current);
  const d = getDist(), { t, tq } = standardCounter(), res = {};
  ['poach', 'poachS', 'ap8'].forEach((id, i) => {
    const ch = CHANNELS.find((c) => c.id === id);
    [['none', null], ['walk', t], ['half', tq]].forEach(([mode, win], j) => {
      res[id + '_' + mode] = sourceChannel(d, PRESET_HIRING, ch, {
        k: ch.referral ? K_REF : 5, n: 20000, seed: 71 + i * 3 + j,
        counter: win == null ? null : { rE: COUNTER.rE, t, tq: win },
      });
    });
  });
  counterLadderCache.set(current, res);
  return res;
}

const formats = {
  pct: (v) => Math.round(v * 100) + '%',
  pct1: (v) => (v * 100).toFixed(1) + '%',
  dec2: (v) => v.toFixed(2),
  cents: (v) => Math.round(v * 100) + ' cents',
  plus2: (v) => (v >= 0 ? '+' : '\u2212') + Math.abs(v).toFixed(2),
  ord: (v) => ordinal(Math.round(v * 100)),
  n100: (v) => String(Math.round(v * 100)),
  // Break-even extra pay as a share of salary, as a sentence.
  headroom: (v) => (v >= 1 ? 'You could double their current comp and still come out ahead!'
    : 'You could raise their pay by ' + Math.round(v * 100) + '% and still come out ahead.'),
  plusPct: (v) => (v >= 0 ? '+' : '\u2212') + Math.round(Math.abs(v) * 100) + '%',
  usd: (v) => '$' + (Math.round(v / 1000) * 1000).toLocaleString('en-US'),
};
export function ordinal(n) {
  const t = n % 100, s = t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return n + s;
}

// Steady-state numbers plus Act II's best-of-five hires (B0, B18, B44 by validity)
// and exact narrowing of one candidate's range (N18, N44, N90).
function numbers() {
  const d = getDist(), g = PRESET_HIRING, th = steadyState(d, g);
  const B0 = th.EXA, B18 = bestOfK(d, g, 0.18, 5), B44 = bestOfK(d, g, 0.44, 5);
  const N18 = exactNarrowing(d, g, 0.18), N44 = exactNarrowing(d, g, 0.44), N90 = exactNarrowing(d, g, 0.9);
  const lad = {};
  for (const [id, v] of Object.entries(standardLadder())) { lad['L_' + id] = v.mean; lad['L_' + id + '_q1'] = v.q[0]; lad['L_' + id + '_q5'] = v.q[4]; lad['L_' + id + '_EX'] = v.EX; }
  // Act V: stopping rules at 100 interviewed candidates (fractions 20% and 37%).
  const st = (r, rec, f) => STOP.results[[current, 100, r, rec].join('|')][STOP.fractions.indexOf(f)];
  const stop = {
    S_best37: st(1, 0, 0.37).best, S_p5_20: st(1, 0, 0.2).p5, S_p5_37: st(1, 0, 0.37).p5,
    S_seen20: st(1, 0, 0.2).seen / 100, S_seen37: st(1, 0, 0.37).seen / 100,
    S_p5_20R: st(1, 1, 0.2).p5, S_p5_37R: st(1, 1, 0.37).p5,
    S_p5_20s: st(0.44, 0, 0.2).p5, S_p5_20sR: st(0.44, 1, 0.2).p5, S_p5_37s: st(0.44, 0, 0.37).p5,
    S_mean20s: st(0.44, 0, 0.2).mean, S_mean20sR: st(0.44, 1, 0.2).mean,
  };
  // The same at a realistic ten interviews.
  const st10 = (r, rec, f) => STOP.results[[current, 10, r, rec].join('|')][STOP.fractions.indexOf(f)];
  Object.assign(stop, {
    S10_p10s: st10(0.44, 0, 0.2).p10, S10_p10sR: st10(0.44, 1, 0.2).p10, S10_p10p: st10(1, 0, 0.2).p10,
    S10_means: st10(0.44, 0, 0.2).mean, S10_meansR: st10(0.44, 1, 0.2).mean,
  });
  // Interviews saved by looking at 20% instead of 37% (100 candidates).
  stop.S_cut = 1 - stop.S_seen20 / stop.S_seen37;
  lad.L_ap8_99_EX = bestCase();
  const co = standardCounter(), cl = {};
  for (const [id, v] of Object.entries(counterLadder())) { cl['LC_' + id] = v.mean; if (id.endsWith('_walk')) cl['LCF_' + id.slice(0, -5)] = v.firstCountered; }
  return {
    ...th, B0, B18, B44, LIFT44: B44 - B0, N18, N44, N90, S90: 1 - N90, ...lad, ...cl,
    C_cnt: co.countered.EX, C_not: co.not.EX, C_won: co.won.EX, C_lift: co.liftRel, C_liftX: co.lift,
    ...stop,
    C_val: co.lift * COUNTER.value, C_valShare: (co.lift * COUNTER.value) / COUNTER.salary,
  };
}

function sync() {
  const th = numbers();
  document.querySelectorAll('[data-job]').forEach((b) => {
    const on = b.dataset.job === current;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('[data-th]').forEach((el) => {
    el.textContent = formats[el.dataset.fmt || 'pct'](th[el.dataset.th]);
  });
  document.documentElement.dataset.job = current;
}

export function setJob(key) {
  if (!JOB_TYPES[key] || key === current) return;
  current = key;
  sync();
  subs.forEach((fn) => fn(key));
}

export function initJobs() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-job]');
    if (b) setJob(b.dataset.job);
  });
  sync();
}
