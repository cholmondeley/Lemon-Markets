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
// A read of a candidate: S = a z + c Q + noise, scaled to unit variance in the population (a: how
// much looks drive it, c: how much real quality shows through).
const readSd = (a, c, rhoQz) => Math.sqrt(Math.max(1e-6, 1 - (a * a + c * c + 2 * a * c * rhoQz)));

// Keep the best K of N people (distribution `cells`) by a read: returns the kept distribution and
// how many were kept. If N <= K everyone is kept.
export function keepTop(cells, N, K, { a, c, rhoQz }) {
  if (N <= K) return { cells, count: N };
  const sd = readSd(a, c, rhoQz), mu = cells.map((x) => a * x.z + c * x.Q);
  const share = (t) => cells.reduce((acc, x, i) => acc + x.w * normSf((t - mu[i]) / sd), 0);
  let lo = -10, hi = 10;
  for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (share(m) > K / N) lo = m; else hi = m; }
  const t = (lo + hi) / 2;
  return { cells: normalize(cells.map((x, i) => ({ ...x, w: x.w * normSf((t - mu[i]) / sd) }))), count: K };
}

// A whole search:
//   shown     views candidates (exposure tilts who is shown),
//   likes     the searcher likes a share likeRate of them by the up-front read (a, c),
//   matches   each candidate likes the searcher back with chance back(cell),
//   dates     the searcher has time for `dates` first dates, given to the best-reading matches,
//   evaluate  after a first date the read improves to read2 (a2, c2); the searcher properly evaluates
//             the best n of the people dated.
// Success = at least one of those evaluated is serious and above `bar` on quality.
// Without `dates`, the n best-reading matches are evaluated directly (no first-date stage).
export function search(pool, { a, c, rhoQz, exposure = 0, likeRate, back, views, dates = null, read2 = null, n = 10, bar = 0.9 }) {
  const sd = readSd(a, c, rhoQz);
  const shown = normalize(pool.map((x) => ({ ...x, w: x.w * Math.exp(exposure * x.z) })));
  const mu = shown.map((x) => a * x.z + c * x.Q);
  let lo = -10, hi = 10;
  const likeShare = (t) => shown.reduce((acc, x, i) => acc + x.w * normSf((t - mu[i]) / sd), 0);
  for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (likeShare(m) > likeRate) lo = m; else hi = m; }
  const t0 = (lo + hi) / 2;
  const bk = shown.map((x) => back(x));
  const matchAt = (t) => shown.reduce((acc, x, i) => acc + x.w * normSf((t - mu[i]) / sd) * bk[i], 0);
  const matches = views * matchAt(t0);
  // Keeping the best K of the matches by the same read is the same as raising the like bar (one
  // impression, not two), so solve for the bar that leaves K.
  const K = dates ?? n;
  let t1 = t0;
  if (matches > K) {
    lo = t0; hi = 10;
    for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (views * matchAt(m) > K) lo = m; else hi = m; }
    t1 = (lo + hi) / 2;
  }
  const first = { cells: normalize(shown.map((x, i) => ({ ...x, w: x.w * normSf((t1 - mu[i]) / sd) * bk[i] }))), count: Math.min(matches, K) };
  // After a first date the read is a fresh, better one (read2); keeping the best n of those dated.
  const final = dates != null && read2 ? keepTop(first.cells, first.count, n, { ...read2, rhoQz }) : { cells: first.cells, count: Math.min(n, first.count) };
  const d = describe(final.cells, bar);
  return {
    matches, dated: dates != null ? first.count : null, evaluated: final.count, keepShare: first.count / Math.max(matches, 1e-12),
    ...d, datedPool: dates != null ? describe(first.cells, bar) : null, odds: 1 - Math.pow(1 - d.good, final.count), pool: describe(pool, bar),
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

// ---------- the app funnel: likes -> matches -> dates -> sex, both sides ----------
// One year on an app. Women decide who gets dates: a woman at looks y is shown viewsW men, likes her
// share likeW of them by her read (a z + c Q + noise), is liked back by each man at his own rate, and
// has time for datesW first dates, which go to the best-reading of her matches. Men only get dates
// women give them, up to their own capacity datesM. Everything a man receives is counted from the
// women's side: with `ratio` men per woman, a man at relative exposure s is shown to each woman
// s * viewsW / N_men times, so per man
//   likes   = (viewsW / ratio) s  E_y[ P(she likes him at her base bar) ]
//   matches = (viewsW / ratio) s  E_y[ P(she likes him) P(he likes her) ]
//   dates   = (viewsW / ratio) s  E_y[ P(he clears her date bar) P(he likes her) ]  (capped at datesM)
// Only a share activeW of women users actually go on dates in a year (the rest browse, swipe and
// match: luap's "here for entertainment"); they cut every man's dates by that share.
// A date turns into sex with chance pSex (a number, or a function of the man's cell: dates with
// more-desired men more often end in sex), so partners ~ Poisson(dates * pSex).
export function appFunnel({ men, women, a, c, rhoQz, rhoM, likeM, likeW, exposure = 0,
  viewsW = 15000, datesW = 13, datesM = 150, ratio = 2.7, pSex = 0.2, activeW = 1, ny = 15, groups = [0.5, 0.75, 0.9, 0.95, 0.99, 0.999] }) {
  const varS = a * a + c * c + 2 * a * c * rhoQz, sd = Math.sqrt(Math.max(1e-6, 1 - varS));
  const cells = men;
  const s = cells.map((x) => Math.exp(exposure * x.z));
  const sBar = cells.reduce((t, x, i) => t + x.w * s[i], 0);
  const shown = cells.map((x, i) => x.w * s[i] / sBar);
  const mu = cells.map((x) => a * x.z + c * x.Q);
  const sM = Math.sqrt(1 - rhoM * rhoM);
  const menBar = cells.map((x) => zTop(likeM(x.u)));
  // Women by looks: the single-women pool binned by looks percentile (it skews plain, since the most
  // attractive pair off first), each bin at its mean looks.
  const yq = [];
  for (let k = 0; k < ny; k++) {
    let w = 0, zy = 0, vv = 0;
    const members = women.filter((x) => x.u >= k / ny && x.u < (k + 1) / ny);
    for (const x of members) { w += x.w; zy += x.w * x.z; vv += x.w * x.u; }
    if (w > 0) yq.push({ v: vv / w, y: zy / w, w, cells: normalize(members) });
  }
  const dy = yq.map(() => new Float64Array(cells.length));   // dates each man gets from each looks bin
  const solve = (f, target) => { let lo = -10, hi = 10; for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (f(m) > target) lo = m; else hi = m; } return (lo + hi) / 2; };
  const perMan = { likes: new Float64Array(cells.length), matches: new Float64Array(cells.length), dates: new Float64Array(cells.length) };
  const womenOut = [];
  for (const [kq, { v, y, w: wy }] of yq.entries()) {
    const back = menBar.map((t) => normSf((t - rhoM * y) / sM));
    const like = (t) => shown.reduce((acc, p, i) => acc + p * normSf((t - mu[i]) / sd), 0);
    const match = (t) => shown.reduce((acc, p, i) => acc + p * normSf((t - mu[i]) / sd) * back[i], 0);
    const t0 = solve(like, likeW(v));
    const m0 = viewsW * match(t0);
    const t1 = m0 > datesW ? solve(match, datesW / viewsW) : t0;
    womenOut.push({ v, w: wy, likes: viewsW * likeW(v), matches: m0, dates: Math.min(datesW, m0) });
    const k = (viewsW / ratio) * wy;
    for (let i = 0; i < cells.length; i++) {
      const l0 = normSf((t0 - mu[i]) / sd), l1 = normSf((t1 - mu[i]) / sd);
      perMan.likes[i] += k * (s[i] / sBar) * l0;
      perMan.matches[i] += k * (s[i] / sBar) * l0 * back[i];
      perMan.dates[i] += activeW * k * (s[i] / sBar) * l1 * back[i];
      dy[kq][i] = activeW * k * (s[i] / sBar) * l1 * back[i];
    }
  }
  const pOf = typeof pSex === 'function' ? pSex : () => pSex;
  // His own capacity: a soft cap, so offers well past datesM are mostly turned down.
  const dates = Array.from(perMan.dates, (d) => datesM * (1 - Math.exp(-d / datesM)));
  // Summaries by looks percentile: everyone at or above each cut, and bands between cuts.
  const summarize = (sel) => {
    let W = 0, L = 0, Mt = 0, Dt = 0, zeroDate = 0, sex = 0, partners = 0;
    cells.forEach((x, i) => {
      if (!sel(x)) return;
      const p = pOf(x);
      W += x.w; L += x.w * perMan.likes[i]; Mt += x.w * perMan.matches[i]; Dt += x.w * dates[i];
      zeroDate += x.w * Math.exp(-dates[i]); sex += x.w * (1 - Math.exp(-dates[i] * p)); partners += x.w * dates[i] * p;
    });
    return { share: W, likes: L / W, matches: Mt / W, dates: Dt / W, noDate: zeroDate / W, anySex: sex / W, partners: partners / W,
      partnersIfAny: partners / Math.max(sex, 1e-12) };
  };
  const bands = [0, ...groups, 1];
  const byBand = bands.slice(0, -1).map((lo, k) => ({ lo, hi: bands[k + 1], ...summarize((x) => x.u >= lo && x.u < bands[k + 1]) }));
  // Concentration of dates among men.
  const order = cells.map((x, i) => i).sort((i, j) => dates[j] - dates[i]);
  const totD = cells.reduce((t, x, i) => t + x.w * dates[i], 0);
  const topShare = (p) => { let cw = 0, cd = 0; for (const i of order) { if (cw >= p) break; cw += cells[i].w; cd += cells[i].w * dates[i]; } return cd / totD; };
  const womenSexRate = cells.reduce((t, x, i) => t + x.w * dates[i] * pOf(x), 0) / Math.max(cells.reduce((t, x, i) => t + x.w * dates[i], 0), 1e-12);
  // The women a group of men dates: a mixture of the looks bins, weighted by the dates each gives.
  const datedWomen = (sel) => {
    const wk = yq.map((_, kq) => cells.reduce((t, x, i) => t + (sel(x) ? x.w * dy[kq][i] : 0), 0));
    const tot = wk.reduce((t, v) => t + v, 0);
    return normalize(yq.flatMap((b, kq) => b.cells.map((x) => ({ ...x, w: x.w * wk[kq] / tot }))));
  };
  return { all: summarize(() => true), byBand, womenSexRate, datedWomen, summarize, women: womenOut, topDates: { top5: topShare(0.05), top10: topShare(0.1), top20: topShare(0.2) }, perMan, dates };
}
