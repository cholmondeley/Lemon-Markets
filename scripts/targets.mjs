// Regenerates the handoff's test-target tables (sections 3-5) for any job type.
// Usage: node scripts/targets.mjs [professional|unskilled|uniform] [n]
// The uniform run should reproduce the handoff's v2 tables within Monte Carlo error.
import { JOB_TYPES, mulberry32, normInv } from '../src/model.js';

const job = process.argv[2] || 'professional';
const N = +(process.argv[3] || 200000);
const dist = JOB_TYPES[job].dist;
const rng = mulberry32(99);
const g = 0.04, SD = dist.cv;

function gauss() { const u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
// Population CDF, used for percentiles and quintiles.
const s2 = Math.log(1 + dist.cv * dist.cv), s = Math.sqrt(s2), mu = -s2 / 2;
const cdf = dist.kind === 'uniform' ? (x) => Math.min(1, x / 2) : (x) => normCdf((Math.log(x) - mu) / s);
const clampU = (u) => Math.min(1 - 1e-12, Math.max(1e-12, u));
const draw = () => dist.quantile(clampU(rng()));
const signal = (x, r) => r * (x - 1) / SD + Math.sqrt(1 - r * r) * gauss();
// Network draw: latent z ~ N(rho z_ref, 1 - rho^2) mapped through the population quantile,
// then kept with the pool's availability odds. rho = 0 is a plain draw from the pool.
function drawNet(pool, rho, zRef = 1.2816) {
  for (;;) {
    const x = rho ? dist.quantile(clampU(normCdf(rho * zRef + Math.sqrt(1 - rho * rho) * gauss()))) : draw();
    const pA = g / (g + x);
    if (rng() < (pool === 'A' ? pA : 1 - pA)) return x;
  }
}

// ---- Counter-offer threshold: employer read with validity rE, top c of the employed pool counter.
function counterThreshold(c, rE, n = 200000) {
  const ss = []; for (let i = 0; i < n; i++) ss.push(signal(drawNet('U', 0), rE));
  ss.sort((a, b) => a - b); return ss[Math.floor((1 - c) * n)];
}

function channel({ pool, r, rho }, opts = {}) {
  const q = [0, 0, 0, 0, 0]; let pct = 0, sumX = 0, n = 0;
  for (let i = 0; i < N; i++) {
    const slate = []; for (let k = 0; k < 5; k++) { const x = drawNet(pool, rho || 0); slate.push({ x, s: signal(x, r) }); }
    slate.sort((a, b) => b.s - a.s);
    let hire = slate[0];
    if (opts.counters && pool === 'U') {
      hire = null;
      for (const c of slate) {
        const countered = signal(c.x, opts.rE) > opts.t;
        if (!countered || rng() < opts.w) { hire = c; break; }
      }
      if (!hire) continue;
    }
    const F = cdf(hire.x); q[Math.min(4, Math.floor(5 * F))]++; pct += F; sumX += hire.x; n++;
  }
  return { q: q.map((v) => (100 * v / n).toFixed(1)), mean: (100 * pct / n).toFixed(1), EX: (sumX / n).toFixed(3) };
}

const channels = [
  ['Open market · charm', { pool: 'A', r: 0 }],
  ['Open market · unstructured', { pool: 'A', r: 0.18 }],
  ['Open market · structured', { pool: 'A', r: 0.44 }],
  ['Random poach', { pool: 'U', r: 0 }],
  ['Poach + structured', { pool: 'U', r: 0.44 }],
  ['Referral · job-hunting friend', { pool: 'A', r: 0.49 }],
  ['Referral · employed ex-colleague', { pool: 'U', r: 0.49 }],
  ['A-player referral rho=.3', { pool: 'U', r: 0.49, rho: 0.3 }],
  ['A-player referral rho=.5', { pool: 'U', r: 0.49, rho: 0.5 }],
];

console.log(`## ${job} (CV ${dist.cv.toFixed(2)}), gamma = ${g}, ${N} slates per row\n`);
console.log('### Section 3: sourcing ladder, quintile shares Q1..Q5 %, mean percentile\n');
console.log('| Channel | Q1 | Q2 | Q3 | Q4 | Q5 | Mean pct | E[X] |\n|---|---|---|---|---|---|---|---|');
for (const [name, ch] of channels) { const r = channel(ch); console.log(`| ${name} | ${r.q.join(' | ')} | ${r.mean} | ${r.EX} |`); }
for (const rho of [0.7, 0.9]) console.log(`| A-player referral rho=${rho} | | | | | | ${channel({ pool: 'U', r: 0.49, rho }).mean} | |`);

console.log('\n### Section 4: counter-offer calculator (E[X])\n');
console.log('| c | r_E | countered | not countered | won, q = .5 | won, q = 1 |\n|---|---|---|---|---|---|');
for (const [c, rE] of [[0.12, 0.5], [0.12, 0.7], [0.25, 0.5], [0.25, 0.7]]) {
  const n = 120000, xs = [], ss = [];
  for (let i = 0; i < n; i++) { const x = drawNet('U', 0); xs.push(x); ss.push(signal(x, rE)); }
  const t = ss.slice().sort((a, b) => a - b)[Math.floor((1 - c) * n)];
  const cs = [], cx = []; let ns = 0, nc = 0;
  for (let i = 0; i < n; i++) { if (ss[i] > t) { cs.push(ss[i]); cx.push(xs[i]); } else { ns += xs[i]; nc++; } }
  const tq = cs.slice().sort((a, b) => a - b)[Math.floor(0.5 * cs.length) - 1];
  let w = 0, wc = 0, all = 0; cs.forEach((sv, j) => { all += cx[j]; if (sv <= tq) { w += cx[j]; wc++; } });
  console.log(`| ${c} | ${rE} | ${(all / cs.length).toFixed(3)} | ${(ns / nc).toFixed(3)} | ${(w / wc).toFixed(3)} | ${(all / cs.length).toFixed(3)} |`);
}

console.log('\n### Section 4: ladder toggle (c = 12%, r_E = .5), mean percentile\n');
const t12 = counterThreshold(0.12, 0.5);
console.log('| Channel | No counters | Counters, you don\'t counter-counter | You win half |\n|---|---|---|---|');
for (const [name, ch] of channels.filter(([, c]) => c.pool === 'U' && !(c.rho === 0.5))) {
  const a = channel(ch).mean, b = channel(ch, { counters: true, rE: 0.5, t: t12, w: 0 }).mean, c = channel(ch, { counters: true, rE: 0.5, t: t12, w: 0.5 }).mean;
  console.log(`| ${name} | ${a} | ${b} | ${c} |`);
}

console.log('\n### Section 5: interview k = 5 from the available pool, hire the top signal\n');
console.log('| r | E[X] | mean pct |\n|---|---|---|');
for (const r of [0, 0.18, 0.44]) { const res = channel({ pool: 'A', r }); console.log(`| ${r} | ${res.EX} | ${res.mean} |`); }
