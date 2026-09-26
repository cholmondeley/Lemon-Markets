// Dating models: pure functions, no DOM. See docs/dating/methodology.md for the math and
// docs/dating/claims.md for where every calibration target comes from.
//
// Six pieces, one per section of the page:
//   1. attention market  - who gets liked on an app (consensus taste x like rate x exposure)
//   2. inbox load        - how the sex ratio turns into women's filters
//   3. commitment filter - who is still on the apps after the committed pair off
//   4. reservation value - why abundance makes the smallest flaw a dealbreaker (McCall search)
//   5. age curves        - attention by age, fecundity
//   6. search            - the rarity you can find vs the rarity you are (noisy reads, n evaluated)
import { normInv } from '../model.js';

// ---------- numerics ----------

// Upper normal tail P(Z > z) with small relative error in the far tail (Numerical Recipes erfcc,
// fractional error < 1.2e-7), which matters for 1-in-250k rarities.
export function normSf(z) {
  const x = z / Math.SQRT2, ax = Math.abs(x), t = 1 / (1 + 0.5 * ax);
  const erfc = t * Math.exp(-ax * ax - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return 0.5 * (x >= 0 ? erfc : 2 - erfc);
}
export const normPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
// Inverse of normSf for tiny p (normInv(1 - p) loses precision below ~1e-10; fine above).
export const zTop = (p) => -normInv(p);

// Composite Simpson's rule on [a, b] with n (even) intervals.
export function simpson(f, a, b, n = 400) {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
}

// A histogram of rates in [0, 1) with 1% bins (as digitized), as weights on bin midpoints.
export function histPoints(heights) {
  const tot = heights.reduce((s, v) => s + v, 0);
  const pts = [];
  heights.forEach((h, i) => { if (h > 0) pts.push({ x: (i + 0.5) / heights.length, w: h / tot }); });
  return pts;
}
export const histMean = (pts) => pts.reduce((s, p) => s + p.w * p.x, 0);
export function histQuantile(pts, q) {
  let c = 0;
  for (const p of pts) { c += p.w; if (c >= q) return p.x; }
  return pts[pts.length - 1].x;
}

// People who like more profiles also swipe more, so their likes are over-represented in what the
// other side receives: the mean received ratio (men 7.0%, women 39%) sits above the mean like rate
// per person (women 6.1%, men 33%). Re-weight like rates by x^a (a = how steeply activity rises
// with openness), with a chosen so the weighted mean hits the received mean.
export function activityWeighted(pts, targetMean) {
  const tilt = (a) => {
    const w = pts.map((p) => p.w * Math.pow(p.x, a)), t = w.reduce((s, v) => s + v, 0);
    return pts.map((p, i) => ({ x: p.x, w: w[i] / t }));
  };
  let lo = -3, hi = 3;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    if (histMean(tilt(mid)) < targetMean) lo = mid; else hi = mid;
  }
  const a = (lo + hi) / 2;
  return { a, pts: tilt(a) };
}

// ---------- 1. Attention market ----------
// Each person on one side has attractiveness z ~ N(0, 1). A viewer on the other side sees
// rho z + sqrt(1 - rho^2) e: rho is how much viewers agree (consensus), the rest is personal
// taste. Viewer i likes a fixed share l_i of what she is shown (the app founder's observation that a
// woman's like rate barely moves with what she sees), so she likes anyone above t_i = z_(1 - l_i).
// With equal exposure, the share of viewers who like a person with attractiveness z is
//   R(z) = sum_i w_i P(rho z + sqrt(1 - rho^2) e > t_i).
// Averaging R over z gives back the mean like rate exactly (a test checks this).
export function receivedRatio(z, rho, openness) {
  const s = Math.sqrt(1 - rho * rho);
  let r = 0;
  for (const { x, w } of openness) r += w * normSf((zTop(x) - rho * z) / s);
  return r;
}

// Steady state of one side of an app, on a quantile grid of attractiveness.
//   kappa: exposure tilt. Views of a person scale with exp(kappa z) (normalized to mean 1): feeds and
//          searches show popular profiles more. 0 = equal exposure (the like-ratio histograms);
//          Hinge's counts of likes include exposure.
//   views: profile views behind each observed ratio (binomial noise in the histogram comparison).
export function attentionMarket({ rho, openness, kappa = 0, views = 100, M = 2000 } = {}) {
  const u = new Float64Array(M), R = new Float64Array(M), likes = new Float64Array(M);
  const norm = Math.exp(kappa * kappa / 2);
  let tot = 0;
  for (let i = 0; i < M; i++) {
    u[i] = (i + 0.5) / M;
    const z = normInv(u[i]);
    R[i] = receivedRatio(z, rho, openness);
    likes[i] = R[i] * Math.exp(kappa * z) / norm;
    tot += likes[i];
  }
  // Share of all likes held by the top p of people (u runs low to high).
  const cum = new Float64Array(M + 1);
  for (let i = M - 1; i >= 0; i--) cum[M - i] = cum[M - i - 1] + likes[i] / tot;
  const topShare = (p) => cum[Math.round(p * M)];
  let gini = 0;
  for (let k = 1; k <= M; k++) gini += (cum[k] + cum[k - 1]) / M;   // area under top-down Lorenz
  gini = gini - 1;
  const at = (q) => R[Math.min(M - 1, Math.floor(q * M))];
  return {
    u, R, likes,
    meanRatio: R.reduce((s, v) => s + v, 0) / M,
    ratioP10: at(0.1), ratioP50: at(0.5), ratioP90: at(0.9), ratioP99: at(0.99),
    top1: topShare(0.01), top5: topShare(0.05), top10: topShare(0.10), top20: topShare(0.20),
    bottom50: 1 - topShare(0.5), gini,
    // Likes received by the median, 90th and 10th percentile person, relative to the mean person.
    rel: { p10: likes[Math.floor(0.1 * M)] * M / tot, p50: likes[Math.floor(0.5 * M)] * M / tot, p90: likes[Math.floor(0.9 * M)] * M / tot },
    histogram: observedHistogram(R, views),
  };
}

// The observed like-ratio histogram (1% bins) implied by true ratios R when each person has been
// seen `views` times: binomial noise, which is what a real app's histogram shows.
export function observedHistogram(R, views = 100, bins = 100) {
  const h = new Float64Array(bins);
  const M = R.length;
  for (let i = 0; i < M; i++) {
    const p = Math.min(Math.max(R[i], 1e-12), 1 - 1e-12);
    // Binomial pmf by recurrence from k = 0.
    let pk = Math.pow(1 - p, views);
    for (let k = 0; k <= views; k++) {
      h[Math.min(bins - 1, Math.floor((k / views) * bins))] += pk / M;
      pk *= ((views - k) / (k + 1)) * (p / (1 - p));
    }
  }
  return Array.from(h);
}

// Distance between two histograms on the same bins: the largest gap between their CDFs (KS).
export function histDistance(a, b) {
  const sa = a.reduce((s, v) => s + v, 0), sb = b.reduce((s, v) => s + v, 0);
  let ca = 0, cb = 0, d = 0;
  for (let i = 0; i < a.length; i++) { ca += a[i] / sa; cb += b[i] / sb; d = Math.max(d, Math.abs(ca - cb)); }
  return d;
}

// Consensus rho that best reproduces an observed received-ratio histogram, given the other side's
// like rates. Grid search then a local refinement.
export function fitConsensus(target, openness, { views = 100, M = 600 } = {}) {
  let best = { rho: 0, d: Infinity };
  const tryRho = (rho) => {
    const d = histDistance(attentionMarket({ rho, openness, views, M }).histogram, target);
    if (d < best.d) best = { rho, d };
  };
  for (let rho = 0.05; rho < 0.96; rho += 0.05) tryRho(rho);
  const c = best.rho;
  for (let rho = Math.max(0.01, c - 0.05); rho <= Math.min(0.99, c + 0.05); rho += 0.01) tryRho(rho);
  return best;
}

// Exposure tilt kappa that makes the top-5% share of likes hit a target (Hinge: 41% for men).
export function fitExposure(rho, openness, top5Target, M = 1500) {
  let lo = 0, hi = 3;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (attentionMarket({ rho, openness, kappa: mid, M }).top5 < top5Target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- 2. Inbox load ----------
// Likes (or opening messages) arriving to the average woman per day, and how selective she must be
// to answer only as many as she has time for. menPerWoman comes from the app's sex ratio (Pew 2022:
// 73 / 27 among 18-29 current users is 2.7), swipes and like rate from the men's side of the app.
export function inboxLoad({ menPerWoman = 2.7, swipesPerMan = 100, menLikeRate = 0.33, capacity = 5 } = {}) {
  const incoming = menPerWoman * swipesPerMan * menLikeRate;
  const answerShare = Math.min(1, capacity / incoming);
  return { incoming, answerShare, threshold: 1 - answerShare };
}

// ---------- 3. Commitment filter ----------
// Each man is either serious (pairs off at rate lambda when he meets someone he wants) or casual
// (pairs off at kc * lambda, kc < 1). Relationships end at rate delta and put him back on the app.
// Stationary chance he is on the app: delta / (delta + k lambda). With x = lambda / delta for a
// serious man, the casual share among men still on the app is
//   b / (1 + kc x)  /  [ b / (1 + kc x) + (1 - b) / (1 + x) ],
// where b is the casual share of all men. x scales with how many matches a man gets, so the filter
// is strongest on exactly the men women are swiping on. Nobody has to change his mind for this.
export function casualShareOnApp(x, b, kc) {
  const c = b / (1 + kc * x), s = (1 - b) / (1 + x);
  return c / (c + s);
}
export const onAppShare = (x, b, kc) => b / (1 + kc * x) + (1 - b) / (1 + x);

// Casual share on the app by attractiveness percentile, when a man's exit intensity is proportional
// to the likes he gets: x(u) = x50 * likes(u) / likes(median).
export function commitmentByPercentile(market, { x50, b, kc, groups = 10 } = {}) {
  const { likes, u } = market, M = likes.length, med = likes[Math.floor(M / 2)];
  const out = [];
  for (let g = 0; g < groups; g++) {
    let cas = 0, on = 0, n = 0, xs = 0;
    for (let i = Math.floor(g * M / groups); i < Math.floor((g + 1) * M / groups); i++) {
      const x = x50 * likes[i] / med;
      cas += b / (1 + kc * x); on += onAppShare(x, b, kc); xs += x; n++;
    }
    out.push({ group: g + 1, uMid: u[Math.floor((g + 0.5) * M / groups)], x: xs / n, casualOnApp: cas / on, onApp: on / n });
  }
  return out;
}

// x50 that makes the top group's casual share on the app hit a target (the app founder's chart: the
// most attractive men were ~52% casual vs ~23% for the least attractive).
export function fitCommitment(market, { b, kc, topTarget, groups = 10 }) {
  let lo = 0, hi = 50;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    const top = commitmentByPercentile(market, { x50: mid, b, kc, groups }).at(-1).casualOnApp;
    if (top < topTarget) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- 4. Reservation value (McCall search) ----------
// Prospects arrive at rate L (per unit of discounting / patience) with quality q ~ N(0, 1). Staying
// single is worth v0. The best policy accepts anyone above w, where
//   w = v0 + L * E[(q - w)+] = v0 + L * (phi(w) - w * S(w)).
// More arrivals raise the bar: the acceptance share S(w) falls as L grows.
export function reservation(L, v0 = 0) {
  let lo = -10, hi = 10;
  for (let it = 0; it < 100; it++) {
    const w = (lo + hi) / 2;
    const rhs = v0 + L * (normPdf(w) - w * normSf(w));
    if (w < rhs) lo = w; else hi = w;
  }
  const w = (lo + hi) / 2;
  return { w, accept: normSf(w), percentile: 1 - normSf(w) };
}

// ---------- 5. Age ----------
// Linear interpolation in a digitized curve {age: [...], key: [...]}, relative to its own peak.
export function curveAt(curve, key, age, relative = true) {
  const a = curve.age, v = curve[key];
  let y;
  if (age <= a[0]) y = v[0];
  else if (age >= a[a.length - 1]) y = v[v.length - 1];
  else {
    const i = a.findIndex((x) => x > age) - 1;
    y = v[i] + (v[i + 1] - v[i]) * (age - a[i]) / (a[i + 1] - a[i]);
  }
  return relative ? y / Math.max(...v) : y;
}

// Share of lifetime fecundity (sum of monthly birth probabilities from `from`) used by `age`.
export function fecundityUsed(geruso, age, from = 20) {
  let used = 0, tot = 0;
  geruso.age.forEach((a, i) => {
    if (a < from) return;
    tot += geruso.monthly[i];
    if (a < age) used += geruso.monthly[i];
  });
  return used / tot;
}

// ---------- 6. Search: the rarity you can find ----------
// True partner quality Q ~ N(0, 1) (a composite of what you care about). What you can read before
// investing real time (photos, texts, a first date) is S = r Q + sqrt(1 - r^2) e. You only go deep
// with people whose S is in your top p, and you can evaluate n of them properly.

// P(Q > a, S > b) for correlation r, by integrating over Q.
export function bvnUpper(a, b, r) {
  if (r >= 1) return normSf(Math.max(a, b));
  if (r <= 0) return normSf(a) * normSf(b);
  const s = Math.sqrt(1 - r * r);
  return simpson((q) => normPdf(q) * normSf((b - r * q) / s), a, a + 12, 600);
}

// Chance a candidate from your pre-filtered pool is at least 1-in-N on true quality.
export function hitRate(N, p, r) {
  if (p >= 1) return 1 / N;   // no pre-filter: everyone you meet gets evaluated
  if (r >= 1) return Math.min(1, (1 / N) / p);
  return bvnUpper(zTop(1 / N), zTop(p), r) / p;
}

// Chance at least one of n evaluated candidates is 1-in-N or better.
export const findOdds = ({ n, p, N, r }) => 1 - Math.pow(1 - hitRate(N, p, r), n);

// The best candidate among n: rarity ("1 in N") at the given quantile of luck (0.5 = median luck,
// 0.9 = better than 9 searches in 10). Solves (1 - h(a))^n = 1 - luck for the Q threshold a.
export function bestRarity({ n, p, r, luck = 0.5 }) {
  const target = 1 - Math.pow(1 - luck, 1 / n);   // per-candidate hit rate needed
  let lo = 1, hi = 1e12;
  for (let it = 0; it < 200; it++) {
    const mid = Math.sqrt(lo * hi);
    if (hitRate(mid, p, r) > target) lo = mid; else hi = mid;
    if (hi / lo < 1.001) break;
  }
  return Math.sqrt(lo * hi);
}

// How rare "top q on each of k traits" is when traits share pairwise correlation rho:
//   P(all > z) = integral phi(v) S((z - sqrt(rho) v) / sqrt(1 - rho))^k dv.
export function traitRarity({ k, q, rho = 0 }) {
  const z = zTop(q);
  if (rho <= 0) return Math.pow(q, k);
  if (rho >= 1) return q;
  const a = Math.sqrt(rho), s = Math.sqrt(1 - rho);
  return simpson((v) => normPdf(v) * Math.pow(normSf((z - a * v) / s), k), -9, 9, 800);
}

// ---------- 7. Channels ----------
// Where you meet people, as (people you can meet per year, how well you can read them before
// investing, how many you can evaluate properly). You go deep with the n who read best, so the
// pre-filter is p = n / met. Numbers are illustrative assumptions (see methodology), exposed as
// sliders on the page. met2017: share of 2017 couples who met this way (Rosenfeld et al. 2019).
export const DATING_CHANNELS = [
  { key: 'apps', label: 'Apps', met: 2000, r: 0.35, met2017: 0.39 },
  { key: 'bars', label: 'Bars and restaurants', met: 150, r: 0.35, met2017: 0.27 },
  { key: 'friends', label: 'Through friends', met: 25, r: 0.55, met2017: 0.20 },
  { key: 'work', label: 'Work', met: 15, r: 0.7, met2017: 0.11 },
  { key: 'school', label: 'School / college', met: 30, r: 0.7, met2017: 0.09 },
];

export function channelOdds(ch, { n = 10, N = 1000, years = 1 } = {}) {
  const met = ch.met * years, p = Math.min(1, n / met);
  return { p, odds: findOdds({ n, p, N, r: ch.r }), median: bestRarity({ n, p, r: ch.r }) };
}
