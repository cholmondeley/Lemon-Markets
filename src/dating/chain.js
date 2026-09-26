// The dating models chained end to end, on one deterministic grid of people. No DOM.
//
// Each person has
//   z        looks: what an app shows (the attention market's attractiveness),
//   Q        partner quality: what matters in a long relationship. Q = rhoQz z + sqrt(1 - rhoQz^2) e,
//            so e is the part of quality nobody can see from the profile,
//   serious  whether they pair off when they meet someone they want (casual: at kc times the rate).
//
// Stages:
//   1. demand      how many matches each person gets, from the calibrated attention market;
//   2. who is left the single pool: people pair off at a rate proportional to their demand (the
//                  commitment filter) and relationships end sooner for people who are worse than they
//                  look (Connor's lemon mechanism, applied to e). By age: a frailty model fitted to
//                  the census never-married curve;
//   3. search      a searcher is shown candidates, likes a share of them by what she can read, gets
//                  liked back or not, and when matches outnumber what she can evaluate she keeps only
//                  the best-reading ones;
//   4. outcomes    how many of those she evaluates are serious and high-quality, and her odds.
import { normCdf } from '../model.js';
import { normSf, normPdf, zTop, reservation } from './model.js';

// ---------- the grid ----------
// z and e on even grids wide enough for 1-in-10,000 tails (weights from the normal density), so rare
// targets and the top 0.1% of men are represented. u = looks percentile.
export function population({ nz = 81, ne = 101, rhoQz = 0.2, casual = 0.2, zMax = 5, eMax = 6 } = {}) {
  const grid = (n, m) => {
    const pts = [];
    for (let i = 0; i < n; i++) { const x = -m + (2 * m * i) / (n - 1); pts.push({ x, w: normPdf(x) }); }
    const t = pts.reduce((s, p) => s + p.w, 0);
    return pts.map((p) => ({ x: p.x, w: p.w / t }));
  };
  const Z = grid(nz, zMax), E = grid(ne, eMax), s = Math.sqrt(1 - rhoQz * rhoQz);
  const cells = [];
  for (const { x: z, w: wz } of Z) {
    const u = normCdf(z);
    for (const { x: e, w: we } of E) {
      const Q = rhoQz * z + s * e, w = wz * we;
      cells.push({ u, z, e, Q, serious: true, w: w * (1 - casual) });
      if (casual > 0) cells.push({ u, z, e, Q, serious: false, w: w * casual });
    }
  }
  return { cells, rhoQz, casual };
}

export const normalize = (cells) => {
  const t = cells.reduce((s, c) => s + c.w, 0);
  return cells.map((c) => ({ ...c, w: c.w / t }));
};

// Demand relative to the median person, as a function of the looks percentile u, from an
// attentionMarket result (likes on a quantile grid).
export function demandCurve(market) {
  const { likes } = market, M = likes.length, med = likes[Math.floor(M / 2)];
  return (u) => likes[Math.min(M - 1, Math.max(0, Math.floor(u * M)))] / med;
}

// ---------- stage 2: who is left ----------
// Chance of being single = delta / (delta + k x50 demand(u)), with delta = exp(-lemon e): relationships
// with people worse than they look end sooner. lemon = 0.46 matches the hiring page's professional
// spread (log truth ratio SD 0.46, Connor's leaving rate proportional to 1 / truth ratio).
export function singlePool(pop, { demand, x50, kc, lemon = 0 }) {
  const cells = pop.cells.map((c) => {
    const delta = Math.exp(-lemon * c.e), k = c.serious ? 1 : kc;
    const p = delta / (delta + k * x50 * demand(c.u));
    return { ...c, pSingle: p, w: c.w * p };
  });
  return { cells: normalize(cells), singleShare: cells.reduce((s, c) => s + c.w, 0) };
}

export function describe(cells, bar = 0.9) {
  const zb = zTop(1 - bar);
  let serious = 0, qPct = 0, zPct = 0, good = 0;
  for (const c of cells) {
    serious += c.w * (c.serious ? 1 : 0);
    qPct += c.w * normCdf(c.Q);
    zPct += c.w * c.u;
    if (c.serious && c.Q >= zb) good += c.w;
  }
  return { serious, qPct, zPct, good };
}

// ---------- how picky each person is ----------
// Everyone's bar rises with their options (McCall): the like rate of a person at looks percentile u
// is the acceptance share at L = L0 * demand(u), with L0 set so the median person (u = 0.5) likes `median` of
// the profiles shown (app founder: men ~33%, women ~4.5%). Returns u -> like rate.
export function likeRateCurve(demand, median) {
  let lo = 1e-3, hi = 1e4;
  for (let it = 0; it < 80; it++) { const m = Math.sqrt(lo * hi); if (reservation(m).accept > median) lo = m; else hi = m; }
  const L0 = Math.sqrt(lo * hi) / demand(0.5), cache = new Map();
  return (u) => {
    const key = Math.round(u * 1e6);
    let a = cache.get(key);
    if (a === undefined) { a = reservation(L0 * demand(u)).accept; cache.set(key, a); }
    return a;
  };
}

// Chance a candidate likes the searcher back: the candidate likes the top `rate(u)` of profiles by
// his (or her) read of looks, which agrees with consensus at rho. y is the searcher's looks z-score.
export function backRule(rate, rho, y = 0) {
  const s = Math.sqrt(1 - rho * rho);
  return (cell) => normSf((zTop(rate(cell.u)) - rho * y) / s);
}

// The looks shift that makes the average candidate's chance of liking her back fall to `factor` of
// what it is at y (used for age: OkCupid's interest curve). A shift, not a flat multiplier, so the
// pickiest candidates (the ones with the most options) drop away first.
export function shiftForFactor(pool, rate, rho, y, factor) {
  const avg = (yy) => { const b = backRule(rate, rho, yy); return pool.reduce((s, c) => s + c.w * b(c), 0); };
  const target = factor * avg(y);
  let lo = y - 6, hi = y;
  for (let it = 0; it < 50; it++) { const m = (lo + hi) / 2; if (avg(m) > target) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

// ---------- stage 3-4: search ----------
// The searcher's read of a candidate: S = a z + c Q + noise, scaled to unit variance in the
// population (a: how much looks drive the read, c: how much real quality shows through).
// likeRate: share of what is shown the searcher likes (her bar before volume matters).
// back(cell): chance the candidate likes her back. views: people shown over the whole search.
// n: how many she can properly evaluate over the search. If matches exceed n she keeps the n
// best-reading ones.
export function search(pool, { a, c, rhoQz, exposure = 0, likeRate, back, views, n = 10, bar = 0.9 }) {
  const varS = a * a + c * c + 2 * a * c * rhoQz;
  const sd = Math.sqrt(Math.max(1e-6, 1 - varS));
  const shown = normalize(pool.map((x) => ({ ...x, w: x.w * Math.exp(exposure * x.z) })));
  const bk = shown.map((x) => back(x));
  const mu = shown.map((x) => a * x.z + c * x.Q);
  const likeShare = (t) => shown.reduce((s, x, i) => s + x.w * normSf((t - mu[i]) / sd), 0);
  const matchShare = (t) => shown.reduce((s, x, i) => s + x.w * normSf((t - mu[i]) / sd) * bk[i], 0);
  const solve = (f, target) => {
    let lo = -10, hi = 10;
    for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (f(m) > target) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const t0 = solve(likeShare, likeRate);
  const matches0 = views * matchShare(t0);
  const t = matches0 > n ? solve(matchShare, n / views) : t0;
  const evaluated = Math.min(n, matches0);
  const ev = normalize(shown.map((x, i) => ({ ...x, w: x.w * normSf((t - mu[i]) / sd) * bk[i] })));
  const d = describe(ev, bar);
  return {
    matches: matches0, evaluated, keepShare: evaluated / Math.max(matches0, 1e-12),
    ...d, odds: 1 - Math.pow(1 - d.good, evaluated), pool: describe(pool, bar),
  };
}

// ---------- cohort: who is never married at each age ----------
// Frailty model. A man's first-marriage hazard at age A is H(A) * f, with f = k * demand(u) *
// exp(theta Q) (k = 1 serious, kc casual; theta > 0 lets real quality help, since people who know you
// long enough see it). H(A) is fitted year by year so the population never-married share matches the
// census at every age, so the only output is *who* is left: selection on f.
// census: {age: share never married}; ages from `start` to `end`.
export function cohort(pop, { demand, kc, theta = 0, census, start = 18, end = 60 }) {
  const f = pop.cells.map((c) => (c.serious ? 1 : kc) * demand(c.u) * Math.exp(theta * c.Q));
  let surv = pop.cells.map((c) => c.w * (census[start] ?? 1));
  const byAge = {};
  for (let A = start; A <= end; A++) {
    byAge[A] = { cells: normalize(pop.cells.map((c, i) => ({ ...c, w: surv[i] }))), never: surv.reduce((s, v) => s + v, 0) };
    const next = census[A + 1];
    if (next == null) break;
    let lo = 0, hi = 50;
    for (let it = 0; it < 60; it++) {
      const H = (lo + hi) / 2;
      const s = surv.reduce((acc, v, i) => acc + v * Math.exp(-H * f[i]), 0);
      if (s > next) lo = H; else hi = H;
    }
    const H = (lo + hi) / 2;
    surv = surv.map((v, i) => v * Math.exp(-H * f[i]));
  }
  return byAge;
}
