// Pure model code: no DOM, no rendering. See docs/methodology.md for the math.
//
// Each agent has a fixed "truth ratio" x = actual quality / advertised quality and
// is either Available ('A') or Taken ('U'). Time is measured so the hiring rate
// beta = 1; a taken agent returns to the market at rate gamma / x.

export const GAMMA_MIN = 0.03;
export const GAMMA_MAX = 1.3;
// Search time / tenure for an as-advertised person: about a 3.5-month search per four-year
// job, close to the source essay's white-collar example (~1/15). See docs/methodology.md.
export const PRESET_HIRING = 0.07;
export const PRESET_DATING = 0.33;
export const BETA = 1;
export const DT = 0.05;

// Market Churn slider (0-100) <-> gamma, log scale.
export const gammaFromSlider = (v) => GAMMA_MIN * Math.pow(GAMMA_MAX / GAMMA_MIN, v / 100);
export const sliderFromGamma = (g) => 100 * Math.log(g / GAMMA_MIN) / Math.log(GAMMA_MAX / GAMMA_MIN);

// Screening skill r (validity correlation) -> sqrt(1 - r^2), the share of the
// spread a single assessment leaves unexplained. Used by Act II, not the market.
export function spreadWidth(r) { return Math.sqrt(1 - r * r); }

// ---------- Truth-ratio distributions (all have mean 1) ----------
// A job type fixes how far real performance strays from what the résumé says.
//   professional: lognormal, CV 0.48. Complex white-collar work; Hunter, Schmidt &
//                 Judiesch (1990) put the SD of output at ~48% of the mean for
//                 high-complexity jobs (to be verified).
//   unskilled:    lognormal, CV 0.19 (same source, low-complexity jobs).
//   uniform:      Uniform(0, 2], the source essay's worst case (CV 0.58, heavy mass near 0).
//
// No floor on x: sample() never returns 0, so gamma / x is always finite. For
// x < gamma * dt the per-step return probability is 1, and the discrete chain's
// stationary P(A | x) = q / (dt + q) equals gamma / (gamma + x) whenever
// q = gamma * dt / x < 1. A floor (clamp or resample at 0.02) biases E[X | A] by
// +2% or +11% under the uniform at gamma = 0.04.

export function gauss(rng = Math.random) {
  const u = 1 - rng(), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Acklam's inverse normal CDF (relative error < 1.2e-9).
export function normInv(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function lognormal(cv) {
  const s2 = Math.log(1 + cv * cv), s = Math.sqrt(s2), mu = -s2 / 2;
  return {
    kind: 'lognormal', cv,
    sample: (rng = Math.random) => Math.exp(mu + s * gauss(rng)),
    quantile: (p) => Math.exp(mu + s * normInv(p)),   // p in (0, 1)
    pdf: (x) => (x <= 0 ? 0 : Math.exp(-((Math.log(x) - mu) ** 2) / (2 * s2)) / (x * s * Math.sqrt(2 * Math.PI))),
  };
}
const uniform02 = {
  kind: 'uniform', cv: 1 / Math.sqrt(3),
  sample: (rng = Math.random) => 2 * (1 - rng()),
  quantile: (p) => 2 * p,
  pdf: (x) => (x > 0 && x <= 2 ? 0.5 : 0),
};

export const JOB_TYPES = {
  professional: { label: 'Professional', dist: lognormal(0.48) },
  unskilled: { label: 'Unskilled', dist: lognormal(0.19) },
  uniform: { label: 'Worst case', dist: uniform02 },
};
export const DEFAULT_JOB = 'professional';

// Right edge of the truth-ratio axis on charts: 2 for the uniform, otherwise the
// 99.5th percentile rounded up to a half (the last column holds anything above).
export const displayMax = (dist) => (dist.kind === 'uniform' ? 2 : Math.ceil(dist.quantile(0.995) * 2) / 2);

export function genAgents(n, dist = JOB_TYPES[DEFAULT_JOB].dist, rng = Math.random) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({ x: dist.sample(rng), s: 'A', flip: -999 });
  return arr;
}

// Steady state for any distribution, by quadrature over quantiles:
// E[f(X)] = integral_0^1 f(Q(u)) du, midpoint rule. Quintiles are of the whole
// population (u < 0.2 is the bottom fifth of true quality).
const theoryCache = new Map();
export function steadyState(dist, gamma, M = 20000) {
  const key = dist.kind + dist.cv + ':' + gamma;
  if (theoryCache.has(key)) return theoryCache.get(key);
  let PA = 0, xA = 0, xxA = 0, xAll = 0, overA = 0, over0 = 0, q1A = 0, q5A = 0;
  const cumA = new Float64Array(M), xs = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const u = (i + 0.5) / M, x = dist.quantile(u), a = gamma / (gamma + x);
    PA += a; xA += a * x; xxA += a * x * x; xAll += x;
    xs[i] = x; cumA[i] = PA;
    if (x < 1) { overA += a; over0 += 1; }
    if (u < 0.2) q1A += a;
    if (u >= 0.8) q5A += a;
  }
  // Quantiles of X within the available pool (x rises with u, so cumA is in x order).
  const poolQ = (p) => { let lo = 0, hi = M - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cumA[m] < p * PA) lo = m + 1; else hi = m; } return xs[lo]; };
  const EXA = xA / PA;
  const res = {
    PA: PA / M, EXA, EXU: (xAll - xA) / (M - PA), SDA: Math.sqrt(xxA / PA - EXA * EXA),
    PXlt1_A: overA / PA, PXlt1: over0 / M, PQ1_A: q1A / PA, PQ5_A: q5A / PA,
    P10A: poolQ(0.1), P50A: poolQ(0.5), P90A: poolQ(0.9),
  };
  theoryCache.set(key, res);
  return res;
}

// Advance every agent by one step of length dt. Each agent flips with
// probability (rate * dt): A -> U at BETA, U -> A at gamma / x.
export function step(agents, gamma, dt, tick, rng = Math.random) {
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (a.s === 'A') {
      if (rng() < BETA * dt) { a.s = 'U'; a.flip = tick; }
    } else if (rng() < (gamma / a.x) * dt) {
      a.s = 'A'; a.flip = tick;
    }
  }
}

export function poolStats(pool, q20 = 0.4) {
  if (pool.length === 0) return { avgX: NaN, fracLiars: NaN, fracQ1: NaN };
  let sum = 0, liars = 0, q1 = 0;
  for (let i = 0; i < pool.length; i++) {
    sum += pool[i].x;
    if (pool[i].x < 1) liars++;
    if (pool[i].x < q20) q1++;
  }
  return { avgX: sum / pool.length, fracLiars: liars / pool.length, fracQ1: q1 / pool.length };
}

// Closed forms for X ~ Uniform(1 - w, 1 + w) (the essay's case at w = 1). Used to
// check steadyState() in the tests; the page uses steadyState().
//   PA      = P(available)
//   PXlt1_A = P(X < 1 | available)   (share of the market that is overselling)
//   PQ1_A   = P(X < 0.4 | available) (share from the bottom fifth of true quality; w = 1 only)
//   EXA     = E[X | available]
//   EXU     = E[X | taken]
export function theory(gamma, w = 1) {
  const L = Math.log((1 + w + gamma) / (1 - w + gamma));
  const PA = gamma * L / (2 * w);
  return {
    PA,
    PXlt1_A: Math.log((1 + gamma) / (1 - w + gamma)) / L,
    PQ1_A: Math.log((0.4 + gamma) / gamma) / L,
    EXA: (2 * w - gamma * L) / L,
    EXU: (1 - gamma + gamma * gamma * L / (2 * w)) / (1 - PA),
  };
}

// Small seeded PRNG so the scrollytelling run is the same for every reader.
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Act II: reading candidates ----------
// An assessment with validity r produces signal = r (x - 1) / SD + sqrt(1 - r^2) e,
// where SD is the population SD of X (its CV, since the mean is 1).
export function signal(x, r, sd, rng = Math.random) { return r * (x - 1) / sd + Math.sqrt(1 - r * r) * gauss(rng); }

// Share by which one assessment narrows the spread of what a person might be worth:
// the textbook Gaussian result, independent of the distribution.
export const narrowing = (r) => 1 - Math.sqrt(1 - r * r);

// Density of X in the available pool on a grid of x values, and the posterior after
// n independent signals averaging s at validity r (omit r for the prior). Both
// normalized to unit area.
export function poolDensity(dist, gamma, xs, r = 0, s = 0, n = 1) {
  const sd = dist.cv, out = new Float64Array(xs.length);
  let area = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    let d = dist.pdf(x) * gamma / (gamma + x);
    if (r > 0) { const m = r * (x - 1) / sd; d *= Math.exp(-n * ((s - m) ** 2) / (2 * (1 - r * r))); }
    out[i] = d;
    if (i) area += (xs[i] - xs[i - 1]) * (d + out[i - 1]) / 2;
  }
  for (let i = 0; i < xs.length; i++) out[i] /= area || 1;
  return out;
}

// Exact narrowing in the available pool: 1 - sqrt(E_s[Var(X | s)]) / SD(X | A),
// averaging over every interview result s. Smaller than narrowing(r) when the pool
// is skewed. Grid quadrature; cached.
const narrowCache = new Map();
export function exactNarrowing(dist, gamma, r, M = 1200, ds = 0.05) {
  if (r <= 0) return 0;
  const key = [dist.kind, dist.cv, gamma, r].join(':');
  if (narrowCache.has(key)) return narrowCache.get(key);
  const xs = new Float64Array(M), w = new Float64Array(M), mu = new Float64Array(M);
  let W = 0, m1 = 0, m2 = 0;
  for (let i = 0; i < M; i++) {
    xs[i] = dist.quantile((i + 0.5) / M); w[i] = gamma / (gamma + xs[i]); mu[i] = r * (xs[i] - 1) / dist.cv;
    W += w[i]; m1 += w[i] * xs[i]; m2 += w[i] * xs[i] * xs[i];
  }
  const priorVar = m2 / W - (m1 / W) ** 2, k = 1 / (2 * (1 - r * r));
  let EV = 0, Z = 0;
  for (let s = -6; s <= 6; s += ds) {
    let z = 0, a = 0, b = 0;
    for (let i = 0; i < M; i++) { const L = w[i] * Math.exp(-k * (s - mu[i]) ** 2); z += L; a += L * xs[i]; b += L * xs[i] * xs[i]; }
    if (z > 0) { EV += b - a * a / z; Z += z; }
  }
  const res = 1 - Math.sqrt(EV / Z / priorVar);
  narrowCache.set(key, res);
  return res;
}

// Monte Carlo: interview k people from the available pool at validity r and hire the
// top signal. Returns E[X] of the hire. Seeded, cached.
const slateCache = new Map();
export function bestOfK(dist, gamma, r, k, n = 30000, seed = 11) {
  const key = [dist.kind, dist.cv, gamma, r, k, n].join(':');
  if (slateCache.has(key)) return slateCache.get(key);
  const rng = mulberry32(seed);
  // Inverse-CDF sampling from the available pool on a quantile grid.
  const M = 4000, xs = new Float64Array(M), cum = new Float64Array(M);
  let tot = 0;
  for (let i = 0; i < M; i++) { xs[i] = dist.quantile((i + 0.5) / M); tot += gamma / (gamma + xs[i]); cum[i] = tot; }
  const drawA = () => { const t = rng() * tot; let lo = 0, hi = M - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < t) lo = m + 1; else hi = m; } return xs[lo]; };
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let best = -Infinity, bx = 0;
    for (let j = 0; j < k; j++) { const x = drawA(), sg = signal(x, r, dist.cv, rng); if (sg > best) { best = sg; bx = x; } }
    sum += bx;
  }
  const res = sum / n;
  slateCache.set(key, res);
  return res;
}

// ---------- Act III: where you source ----------
// Each channel draws a slate of k from a pool (A = looking, U = employed), reads
// each person with validity r, and hires the top read. For referrals the slate is in
// the referrer's head: they weigh k people they know, read them as a co-worker would,
// and send you the best one. Referral channels draw from
// the referrer's network: latent z ~ N(rho z_ref, 1 - rho^2), mapped to a quantile
// of the population, kept with the pool's availability odds. A hire's percentile is
// its quantile u in the whole population; its quintile is floor(5u).

export function normCdf(z) {
  // Abramowitz & Stegun 7.1.26 via erf, |error| < 1.5e-7.
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export const CHANNELS = [
  { id: 'charm', group: 'Open market', label: 'Charm alone (r = 0)', pool: 'A', r: 0 },
  { id: 'unstructured', group: 'Open market', label: 'Unstructured interview (r = .18)', pool: 'A', r: 0.18 },
  { id: 'structured', group: 'Open market', label: 'Structured interview (r = .44)', pool: 'A', r: 0.44 },
  { id: 'poach', group: 'Poaching', label: 'Random poach', pool: 'U', r: 0 },
  { id: 'poachS', group: 'Poaching', label: 'Poach + structured', pool: 'U', r: 0.44 },
  { id: 'friend', group: 'Referrals', label: 'Job-hunting friend', pool: 'A', r: 0.49, referral: true },
  { id: 'excol', group: 'Referrals', label: 'Employed ex-colleague', pool: 'U', r: 0.49, referral: true },
  { id: 'ap3', group: 'Referrals', label: 'A-player referral (ρ = .3)', pool: 'U', r: 0.49, rho: 0.3, referral: true },
  { id: 'ap5', group: 'Referrals', label: 'A-player referral (ρ = .5)', pool: 'U', r: 0.49, rho: 0.5, referral: true },
  { id: 'ap8', group: 'Referrals', label: 'A-player referral (ρ = .8)', pool: 'U', r: 0.49, rho: 0.8, referral: true },
];
export const Z90 = 1.2816, Z99 = 2.3263;

// Inverse-CDF sampler for a pool on a quantile grid; returns [x, u].
const poolSamplers = new Map();
function poolSampler(dist, gamma, pool, M = 4000) {
  const key = [dist.kind, dist.cv, gamma, pool].join(':');
  if (poolSamplers.has(key)) return poolSamplers.get(key);
  const xs = new Float64Array(M), cum = new Float64Array(M);
  let tot = 0;
  for (let i = 0; i < M; i++) {
    xs[i] = dist.quantile((i + 0.5) / M);
    const a = gamma / (gamma + xs[i]);
    tot += pool === 'A' ? a : 1 - a; cum[i] = tot;
  }
  const f = (rng) => {
    const t = rng() * tot; let lo = 0, hi = M - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < t) lo = m + 1; else hi = m; }
    return [xs[lo], (lo + 0.5) / M];
  };
  poolSamplers.set(key, f);
  return f;
}

// With counter = { rE, t, tq }, employed candidates can be countered: the employer
// counters when its read (validity rE) exceeds t. You offer down your ranked slate
// and keep a countered candidate only if you win the counter-counter, which by the
// winner's curse happens when the employer's read is at most tq (tq = t: you never
// win). You hire the first who accepts. firstCountered = share of hires where your
// first choice was countered. (The handoff's ladder toggle used a coin flip for the
// counter-counter; the winner's curse keeps this consistent with counterOffers.)
export function sourceChannel(dist, gamma, ch, { k = 5, n = 30000, zRef = Z90, seed = 21, counter = null } = {}) {
  const rng = mulberry32(seed), rho = ch.rho || 0, sd = dist.cv;
  const plain = poolSampler(dist, gamma, ch.pool);
  const draw = rho === 0 ? () => plain(rng) : () => {
    for (;;) {
      const u = Math.min(1 - 1e-12, Math.max(1e-12, normCdf(rho * zRef + Math.sqrt(1 - rho * rho) * gauss(rng))));
      const x = dist.quantile(u), a = gamma / (gamma + x);
      if (rng() < (ch.pool === 'A' ? a : 1 - a)) return [x, u];
    }
  };
  const q = [0, 0, 0, 0, 0], ctr = counter && ch.pool === 'U' ? counter : null;
  let pct = 0, sumX = 0, hires = 0, firstCountered = 0;
  for (let i = 0; i < n; i++) {
    let bx = 0, bu = 0, found = true;
    if (!ctr) {
      let best = -Infinity;
      for (let j = 0; j < k; j++) {
        const [x, u] = draw(), s = signal(x, ch.r, sd, rng);
        if (s > best) { best = s; bx = x; bu = u; }
      }
    } else {
      const slate = [];
      for (let j = 0; j < k; j++) { const [x, u] = draw(); slate.push({ x, u, s: signal(x, ch.r, sd, rng) }); }
      slate.sort((a, b) => b.s - a.s);
      found = false;
      for (let j = 0; j < slate.length; j++) {
        const c = slate[j], read = signal(c.x, ctr.rE, sd, rng), countered = read > ctr.t;
        if (j === 0 && countered) firstCountered++;
        if (!countered || read <= ctr.tq) { bx = c.x; bu = c.u; found = true; break; }
      }
    }
    if (!found) continue;
    q[Math.min(4, Math.floor(5 * bu))]++; pct += bu; sumX += bx; hires++;
  }
  return { q: q.map((v) => v / hires), mean: pct / hires, EX: sumX / hires, firstCountered: firstCountered / n };
}

// The standard channels at a slate of five, cached per job type.
const ladderCache = new Map();
// opts.kRef sets how many people a referrer weighs (defaults to the slate size k).
export function ladder(dist, gamma, opts = {}) {
  const key = [dist.kind, dist.cv, gamma, JSON.stringify(opts)].join(':');
  if (ladderCache.has(key)) return ladderCache.get(key);
  const res = {}, { kRef, ...rest } = opts;
  CHANNELS.forEach((ch, i) => {
    const k = ch.referral && kRef ? kRef : rest.k;
    res[ch.id] = sourceChannel(dist, gamma, ch, { ...rest, ...(k ? { k } : {}), seed: 21 + i });
  });
  ladderCache.set(key, res);
  return res;
}

// ---------- Act IV: counter-offers ----------
// Everyone here has an outside offer and a job. Their current employer reads them
// with validity rE and counters when the read clears t, set so a share c of them
// get a counter. The employer matches up to its own valuation, so you win only the
// countered people it valued least: those whose read falls in the bottom q of the
// countered reads (q = "bid depth"). Exact, by quadrature over the employed pool.
export function counterOffers(dist, gamma, c, rE, q, M = 4000) {
  const sd = dist.cv, sig = Math.sqrt(1 - rE * rE);
  const xs = new Float64Array(M), us = new Float64Array(M), w = new Float64Array(M), mu = new Float64Array(M);
  let W = 0;
  for (let i = 0; i < M; i++) {
    us[i] = (i + 0.5) / M; xs[i] = dist.quantile(us[i]);
    w[i] = xs[i] / (gamma + xs[i]); W += w[i];
    mu[i] = rE * (xs[i] - 1) / sd;
  }
  // Share of the employed pool whose read exceeds t.
  const above = (t) => { let a = 0; for (let i = 0; i < M; i++) a += w[i] * (1 - normCdf((t - mu[i]) / sig)); return a / W; };
  const solve = (share) => { let lo = -8, hi = 8; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (above(m) > share) lo = m; else hi = m; } return (lo + hi) / 2; };
  const t = solve(c), tq = solve(c * (1 - q));   // won: t < read <= tq
  const acc = { cnt: [0, 0, 0], x: [0, 0, 0], u: [0, 0, 0] };   // countered, won, not countered
  for (let i = 0; i < M; i++) {
    const pC = 1 - normCdf((t - mu[i]) / sig), pW = q >= 1 ? pC : normCdf((tq - mu[i]) / sig) - normCdf((t - mu[i]) / sig);
    [pC, Math.max(0, pW), 1 - pC].forEach((p, g) => { acc.cnt[g] += w[i] * p; acc.x[g] += w[i] * p * xs[i]; acc.u[g] += w[i] * p * us[i]; });
  }
  const grp = (g) => ({ EX: acc.x[g] / acc.cnt[g], pct: acc.u[g] / acc.cnt[g], share: acc.cnt[g] / W });
  const countered = grp(0), won = grp(1), not = grp(2);
  return { t, tq, countered, won, not, lift: won.EX - not.EX, liftRel: won.EX / not.EX - 1 };
}

// Probability of a counter, and of a counter you win, for someone with truth ratio x.
export function counterProbs(dist, x, rE, t, tq, q) {
  const m = rE * (x - 1) / dist.cv, sig = Math.sqrt(1 - rE * rE);
  const pC = 1 - normCdf((t - m) / sig);
  return { pC, pW: q >= 1 ? pC : Math.max(0, normCdf((tq - m) / sig) - normCdf((t - m) / sig)) };
}

// ---------- Act V: when to stop ----------
// Candidates arrive one at a time from the looking pool. You read each with validity
// r (r = 1 is a perfect read: the textbook secretary problem). Look-then-leap: pass on
// the first f*n, then hire the first whose read beats the best read so far. If nobody
// does, you take the last candidate, or with recall you go back to the best read you
// saw who is still available. Other employers are interviewing the same people: each
// candidate gets an independent structured read from them (r = .44), and is hired away
// at a rate proportional to exp(kappa * that read), normalized to one hire per average
// search. So the candidates who read well are the least likely to still be there.
// A passed candidate stays available with probability exp(-rate * elapsed), with the
// whole process lasting D average searches. Percentiles are within the candidate stream.
export function stoppingRun(dist, gamma, { n = 100, f = 0.37, r = 1, recall = false, D = 1, kappa = 0.54, T = 5000, seed = 5 } = {}) {
  const rng = mulberry32(seed), M = 4000;
  const xs = new Float64Array(M), cum = new Float64Array(M);
  let tot = 0;
  for (let i = 0; i < M; i++) { xs[i] = dist.quantile((i + 0.5) / M); tot += gamma / (gamma + xs[i]); cum[i] = tot; }
  const draw = () => {
    const t = rng() * tot; let lo = 0, hi = M - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < t) lo = m + 1; else hi = m; }
    return lo;
  };
  const m = Math.max(1, Math.round(f * n)), step = D / n, rO = 0.44;
  const otherRead = (x) => rO * (x - 1) / dist.cv + Math.sqrt(1 - rO * rO) * gauss(rng);
  // Normalize so the average hiring-away rate is one per average search.
  let norm = 0;
  for (let i = 0; i < 20000; i++) norm += Math.exp(kappa * otherRead(xs[draw()]));
  norm /= 20000;
  const hazard = new Float64Array(n);
  const out = { p1: 0, p5: 0, p10: 0, p20: 0, best: 0, mean: 0, seen: 0 };
  const pcts = new Float64Array(T), idx = new Int32Array(n), sig = new Float64Array(n);
  for (let k = 0; k < T; k++) {
    let bestIdx = 0;
    for (let i = 0; i < n; i++) {
      idx[i] = draw();
      sig[i] = r >= 1 ? xs[idx[i]] : r * (xs[idx[i]] - 1) / dist.cv + Math.sqrt(1 - r * r) * gauss(rng);
      if (idx[i] > idx[bestIdx]) bestIdx = i;
      hazard[i] = Math.exp(kappa * otherRead(xs[idx[i]])) / norm;
    }
    let bench = -Infinity;
    for (let i = 0; i < m; i++) if (sig[i] > bench) bench = sig[i];
    let pick = -1, stop = n;
    for (let i = m; i < n; i++) if (sig[i] > bench) { pick = i; stop = i + 1; break; }
    if (pick < 0 && recall) {
      // Best reads first; each is still available if no one else has hired them.
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => sig[b] - sig[a]);
      for (const i of order) if (rng() < Math.exp(-hazard[i] * step * (n - 1 - i))) { pick = i; break; }
    }
    if (pick < 0) pick = n - 1;
    const p = cum[idx[pick]] / tot;
    pcts[k] = p;
    out.p1 += p >= 0.99; out.p5 += p >= 0.95; out.p10 += p >= 0.9; out.p20 += p >= 0.8;
    out.best += idx[pick] === idx[bestIdx]; out.mean += p; out.seen += stop;
  }
  pcts.sort();
  for (const key of Object.keys(out)) out[key] /= T;
  out.median = pcts[T >> 1];
  return out;
}
