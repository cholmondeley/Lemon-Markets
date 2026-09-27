// The calibrated dating model, assembled from its data: shared by the report script
// (scripts/dating/chain.mjs), the calibration (scripts/dating/fit.mjs), the page's precomputed tables
// (scripts/dating/site-data.mjs) and the page's worker (src/dating/worker.js). Pure: takes the parsed
// JSON inputs, no I/O.
//
//   const S = createScenario({ digitized, pools, calibration, nsfg, exchange, status }, { grid: 'fine', fitted });
//   S.herYears({ start: 27, v: 0.5, gap: 10 }).odds.top10
//
// Two layers.
//   Attention (the apps): who gets likes, matches and dates is driven by looks z, from the calibrated
//     attention market (Acts II-III, unchanged).
//   Mate value (who commits to whom): after months of dating, each side knows the other's mate value
//     and commits only to someone near or above their own level, with a bar that rises with their
//     options. A man's mate value is the author's "dating power" mix: status 0.5, social skills 0.2,
//     looks 0.2, height 0.1 (looks are what the profile shows, so looks and mate value correlate 0.34).
//     His value is his potential (the same at 25 and 40); fewer women consider him as he ages
//     (OkCupid), which lowers his bar. A woman's mate value is her
//     appeal for her age, shifted by age (OkCupid: men's interest by her age).
// Grids: 'fine' (61 x 61, the report) or 'coarse' (31 x 31, live on the page).
import * as D from './model.js';
import * as C from './chain.js';
import { normCdf } from '../model.js';

export const DEFAULTS = {
  lemon: 0.3,        // breakup odds x1.35 per SD of unseen quality (Solomon & Jackson 2014)
  years: 5,
  evalPerYear: 2,    // people properly dated (months) per year
  datesW: 13,        // first dates per actively dating woman per year (NSFG)
  activeW: 0.2,      // share of women users who date in a year (NSFG; luap retention)
  ratio: 1.5,        // men per woman among a year's users (Pew ever-used 58/42; NSFG totals)
  gammaSex: 1,       // dates with more-desired men more often end in sex (fits NSFG: 3.4 partners)
  womenCasual: 0.15,
  rhoQz: 0.1,        // looks vs hidden quality (the attention layer's lemon effect; Feingold 1992)
  // Mate value.
  sigma: 0.5,        // how noisy a committed judgment of mate value is, after months (SD, in mate-value SDs)
  kappa: 0.25,       // how much a person's options raise their commitment bar (x McCall reservation shift)
  tolerance: 0.35,   // how far below their own level people will commit (fitted: couples correlate 0.76)
  commitScale: 0.5,  // chance the relationship itself works out when both would commit (fitted: census 25->30)
  theta: 0.5,        // how much faster higher-value men marry (fitted: ACS ever-married by earnings quintile)
  earnStatus: 0.8,   // correlation of a man's earnings with his status (assumption)
  read: { a: 0.48, c: 0.2 },    // a profile: looks at the app-wide consensus, a little status (job, school)
  read2: { a: 0.3, c: 0.5 },    // after a first date: status and character show much more
  intentShown: 0.5,
  ageWeight: 0.5,    // how much of women's age preference (OkCupid) lowers an older man's bar
  sigmaFirst: 1,     // after one date, the read on whether to keep seeing someone is twice as noisy
  casualPursue: 0.8, // casual men keep seeing a woman who likes them (it's what they're there for)  // share of casual men she can spot and skip up front (stated intent on the profile, never married at 42)
};

// The author's dating power equation: .1 height + .5 status + .2 social skills + .2 attractiveness.
export const POWER = { height: 0.1, status: 0.5, social: 0.2, looks: 0.2 };
const W_OTHER = Math.hypot(POWER.status, POWER.social, POWER.height);   // everything but looks
const NORM = Math.hypot(POWER.looks, W_OTHER);
export const RHO_LOOKS_VALUE = POWER.looks / NORM;                      // 0.34

const GRIDS = { fine: { men: [61, 61], women: [61, 41] }, coarse: { men: [31, 31], women: [31, 21] } };

export function createScenario({ digitized, pools, calibration: cal, nsfg, status }, { grid = 'fine', fitted = null } = {}) {
  const G = GRIDS[grid];
  const BASE = { ...DEFAULTS };
  if (fitted) for (const k of ['tolerance', 'commitScale', 'theta', 'p0']) if (fitted[k] != null) BASE[k] = fitted[k];
  const meanOf = (h) => D.histMean(D.histPoints(h));
  const W = D.activityWeighted(D.histPoints(digitized.luap_like_rate_women), meanOf(digitized.luap_received_ratio_men)).pts;
  const Mn = D.activityWeighted(D.histPoints(digitized.luap_like_rate_men), meanOf(digitized.luap_received_ratio_women)).pts;
  const rhoW = cal.consensus.womenOnMen, rhoM = cal.consensus.menOnWomen;
  const demandM = C.demandCurve(D.attentionMarket({ rho: rhoW, openness: W, M: 1000 }));
  const demandW = C.demandCurve(D.attentionMarket({ rho: rhoM, openness: Mn, M: 1000 }));
  const likeM = C.likeRateCurve(demandM, 0.33);    // men's like rate by looks (median 33%)
  const likeW = C.likeRateCurve(demandW, 0.045);   // women's like rate by looks (median 4.5%)
  const { b, kc, x50 } = cal.commitment;
  const ok = digitized.okcupid_age;
  const neverMarried = (sex) => { const out = {}; let p = 1; for (const r of pools.by_age.filter((x) => x.sex === sex)) { p = Math.min(p, r.never_married); out[r.age] = p; } return out; };
  const censusM = neverMarried('men'), censusW = neverMarried('women');
  const byAge = (sex, age) => pools.by_age.find((r) => r.sex === sex && r.age === Math.max(18, Math.min(70, age)));

  // ---------- age ----------
  // Interest relative to the peak -> a shift in standing: half the interest = from the median to the 25th percentile.
  const shiftFor = (rel) => D.zTop(1 - 0.5 * Math.max(1e-4, rel));
  const womenShift = (a) => shiftFor(D.curveAt(ok, 'women', Math.min(a, 48)));
  const menLooksShift = (M) => shiftFor(D.curveAt(ok, 'men', Math.min(M, 48)));
  // A man's age does not change his mate value (his potential: a promising 25-year-old and the same
  // man at 40 rank alike), but it shrinks his market: the share of women whose age range includes him
  // falls fast after 30 (OkCupid). His bar is set by that market, so an older man commits to women he
  // could not hold at 28: ageWeight of the shift in standing (half the interest = -0.67 SD).
  const menAgeDiscount = (M) => (BASE.ageWeight ?? 0.5) * menLooksShift(M);
  // A man's options on the apps also fall with his age, relative to a 29-year-old.
  const menOptionsAt = (M) => D.curveAt(ok, 'men', Math.min(M, 48)) / D.curveAt(ok, 'men', 29);

  // ---------- people ----------
  const menPop = (o = {}) => {
    const p = C.population({ nz: G.men[0], ne: G.men[1], rhoQz: RHO_LOOKS_VALUE, casual: o.casual ?? b });
    p.cells.forEach((c) => { c.xt = c.Q; });   // Q starts as mate value for his age (type)
    return p;
  };
  const menSingle = (o = {}) => C.singlePool(menPop(o), { demand: demandM, x50, kc: o.kc ?? kc, lemon: o.lemon ?? BASE.lemon });
  const womenPop = () => C.population({ nz: G.women[0], ne: G.women[1], rhoQz: BASE.rhoQz, casual: BASE.womenCasual });
  const womenSingle = (o = {}) => C.singlePool(womenPop(o), { demand: demandW, x50, kc: 1, lemon: o.lemon ?? BASE.lemon });

  // What she ends up with is a man's standing now, not only his potential: "a top-10% man" ranks men
  // 22-55 on current mate value. His status (the part of e that is
  // status) sits at his age's median and spread (earnings rank climbs into the 40s and fans out, so
  // top earners are mostly over 35); looks and the rest as they are. Commitment still runs on
  // potential (a promising 25-year-old and the same man at 40 are judged alike).
  const SIO = POWER.status / W_OTHER;
  const tail = (M) => status.status_tail[Math.max(22, Math.min(55, M))];
  const xNow = (z, e, M) => { const { mu, sigma } = tail(M); return (POWER.looks * z + W_OTHER * (e + SIO * (mu + (sigma - 1) * SIO * e))) / NORM; };
  const menScale = (() => {
    const pts = [], pop = menPop();
    let tot = 0;
    for (let M = 22; M <= 55; M++) {
      const wm = byAge('men', M).pop;
      tot += wm;
      for (const c of pop.cells) pts.push([xNow(c.z, c.e, M), c.w * wm]);
    }
    pts.sort((p, q) => p[0] - q[0]);
    const xs = new Float64Array(pts.length), cs = new Float64Array(pts.length);
    let cw = 0;
    pts.forEach(([x, w], i) => { cw += w / tot; xs[i] = x; cs[i] = cw; });
    const quantile = (p) => { let lo = 0, hi = cs.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cs[m] < p) lo = m + 1; else hi = m; } return xs[lo]; };
    return { quantile };
  })();
  const menBar = (p) => ({ z: menScale.quantile(p), key: 'xn' });

  // ---------- who is single at each age ----------
  // Never-married men: frailty model fitted to the census at every age, with higher-value men marrying
  // faster (theta, fitted to the ACS marriage gradient by earnings); plus men single again after a
  // marriage, in census proportions.
  const cohortCache = new Map();
  const cohortM = (o = {}) => {
    const th = o.theta ?? BASE.theta, key = JSON.stringify([th, o.kc ?? kc]);
    if (!cohortCache.has(key)) cohortCache.set(key, C.cohort(menPop(o), { demand: () => 1, kc: o.kc ?? kc, theta: th, census: censusM }));
    return cohortCache.get(key);
  };
  let singleC = null;
  const poolAt = (M, o = {}) => {
    const r = byAge('men', M);
    singleC ??= menSingle();
    return C.singleAtAge(menPop(o), cohortM(o)[Math.min(60, M)], singleC, { neverShare: r.single_never, prevShare: r.single_prev });
  };
  // Single men M years old, each tagged with his mate value (Q = xt), his standing now (xn) and age.
  const poolCache = new Map();
  const poolCells = (M, o = {}) => {
    const key = JSON.stringify([M, o.theta ?? BASE.theta]);
    if (!poolCache.has(key)) poolCache.set(key, poolAt(M, o).map((c) => ({ ...c, xt: c.xt ?? c.Q, xn: xNow(c.z, c.e, M), M })));
    return poolCache.get(key);
  };
  // The single men a woman aged `age` would date: `below` years younger to `gap` years older, weighted
  // by how many single men there are at each age.
  const herPool = (age, gap, o = {}) => {
    const lo = Math.max(22, age - (o.below ?? 2)), hi = Math.min(55, age + gap);
    const ws = [];
    for (let M = lo; M <= hi; M++) { const r = byAge('men', M); ws.push([M, r.pop * r.single]); }
    const tot = ws.reduce((s, [, w]) => s + w, 0);
    return ws.flatMap(([M, w]) => poolCells(M, o).map((c) => ({ ...c, w: c.w * w / tot })));
  };
  const womenSingleCells = (() => { let cells = null; return () => (cells ??= womenSingle().cells.map((c) => ({ ...c, xt: c.z }))); })();
  const hisPool = (lo, hi) => {
    const ws = [];
    for (let a = lo; a <= hi; a++) { const r = byAge('women', a); ws.push([a, r.pop * r.single]); }
    const tot = ws.reduce((s, [, w]) => s + w, 0);
    return ws.flatMap(([a, w]) => womenSingleCells().map((c) => ({ ...c, Q: c.z + womenShift(a), a, w: c.w * w / tot })));
  };

  // ---------- commitment ----------
  // Options raise the bar (McCall): the reservation shift of someone with this many prospects over the
  // median person's, scaled by kappa. Prospects = the calibrated app demand for their looks.
  const L0 = (demand, median) => { let lo = 1e-3, hi = 1e4; for (let it = 0; it < 80; it++) { const m = Math.sqrt(lo * hi); if (D.reservation(m).accept > median) lo = m; else hi = m; } return Math.sqrt(lo * hi) / demand(0.5); };
  const L0m = L0(demandM, 0.33), L0w = L0(demandW, 0.045);
  const wMed = { m: D.reservation(L0m * demandM(0.5)).w, w: D.reservation(L0w * demandW(0.5)).w };
  const premCache = new Map();
  const premium = (side, u, opt) => {
    const key = `${side}${Math.round(u * 1e4)}_${Math.round(opt * 1e3)}`;
    let v = premCache.get(key);
    if (v === undefined) {
      v = side === 'm' ? D.reservation(L0m * demandM(u) * opt).w - wMed.m : D.reservation(L0w * demandW(u) * opt).w - wMed.w;
      premCache.set(key, v);
    }
    return v;
  };
  // He commits to a woman of mate value yEff (for her age) if she is near or above what his market
  // lets him hold: his own value, less the age discount, less `tolerance`, plus his options premium.
  // `commitScale` = the chance it works out at all. Casual men at kc of that.
  const hisCommit = (o = {}) => {
    const d = o.tolerance ?? BASE.tolerance, s = o.sigma ?? BASE.sigma, k = o.kappa ?? BASE.kappa, m = o.commitScale ?? BASE.commitScale, opt = o.options ?? 1;
    return (cell, yEff) => (cell.serious ? 1 : kc) * m * D.normSf((cell.Q + menAgeDiscount(cell.M ?? 29) - d + k * premium('m', cell.u, opt) - yEff) / s);
  };
  // She commits to a man of mate value xEff if he is near or above her level, less her options premium.
  const herCommit = (o = {}) => {
    const d = o.tolerance ?? BASE.tolerance, s = o.sigma ?? BASE.sigma, k = o.kappa ?? BASE.kappa, opt = o.options ?? 1;
    return (xEff, yEff, uHer) => D.normSf((yEff - d + k * premium('w', uHer, opt) - xEff) / s);
  };

  // After a first date: does he want to keep seeing her (months of dating take two)? The same bar as
  // committing, read more noisily. Casual men mostly do, which is how they cost women years.
  const hisInterest = (o = {}) => {
    const d = o.tolerance ?? BASE.tolerance, k = o.kappa ?? BASE.kappa, opt = o.options ?? 1;
    return (cell, yEff) => (cell.serious ? D.normSf((cell.Q + menAgeDiscount(cell.M ?? 29) - d + k * premium('m', cell.u, opt) - yEff) / BASE.sigmaFirst) : BASE.casualPursue);
  };
  const herInterest = (o = {}) => {
    const d = o.tolerance ?? BASE.tolerance, k = o.kappa ?? BASE.kappa, opt = o.options ?? 1;
    return (xEff, yEff, uHer) => D.normSf((yEff - d + k * premium('w', uHer, opt) - xEff) / BASE.sigmaFirst);
  };

  // ---------- her search ----------
  const CHANNELS = {
    app: { label: 'Apps', a: BASE.read.a, c: BASE.read.c, views: 15000 },
    friends: { label: 'Friends', a: 0.3, c: 0.45, views: 60, like: 0.2, dates: 6 },
    work: { label: 'Work', a: 0.25, c: 0.4, views: 25, like: 0.2, dates: 3 },
    // Men only: approaching women he likes, in person. Two a month puts a man well inside the top
    // quarter of single men (the author's post). In person she reads more of him than a profile shows,
    // and she isn't flooded: her yes rate is her app like rate x 2.7, the app's men-per-woman ratio.
    inperson: { label: 'In person', a: 0.3, c: 0.45, approaches: 24 },
  };
  // A woman at appeal percentile v for her age, searching for `years` from age `start`, open to men
  // `gap` years older. Each year: men's interest in her is at her age's level; she likes and dates by
  // what the profile shows; she properly dates the best evalPerYear by what a first date shows; it
  // succeeds if both commit. Odds of at least one success, overall and with a man above each bar:
  // top 10 / 5 / 1% of men 22-55 by standing now, and "as good as her or better" (his rank on
  // potential at least her rank among women her age).
  function herYears({ start = 25, years = BASE.years, v = 0.5, ch = 'app', gap = 2, ...o } = {}) {
    const C0 = CHANNELS[ch], his = hisCommit(o), hers = herCommit(o), hisWant = hisInterest(o), y0 = D.zTop(1 - v);
    // "As good as her or better" is rank for rank on potential (his for his age, hers for her age);
    // the top-10/5/1% bars are on standing now.
    const bars = { any: 0, top10: menBar(0.9), top5: menBar(0.95), top1: menBar(0.99), rare: { z: D.zTop(1 - Math.min(0.999, Math.max(v, 0.001))), key: 'xt' } };
    const miss = Object.fromEntries(Object.keys(bars).map((k) => [k, 1]));
    const rows = [];
    let reach = 1, xm = 0, xs = 0, got = 0;
    for (let t = 0; t < years; t++) {
      const age = start + t, yEff = y0 + womenShift(age), uApp = normCdf(yEff);
      const skip = o.intentShown ?? BASE.intentShown;
      const pool = (o.pool ?? herPool(age, gap, o)).map((c) => (c.serious ? c : { ...c, w: c.w * (1 - skip) }));
      const r = C.search(pool, {
        a: o.a ?? C0.a, c: o.c ?? C0.c, rhoQz: RHO_LOOKS_VALUE, exposure: ch === 'app' ? cal.exposure.men : 0,
        likeRate: C0.like ?? likeW(uApp), back: C.backRule(likeM, rhoM, yEff),
        views: o.views ?? C0.views, dates: ch === 'app' ? (o.datesW ?? BASE.datesW) : C0.dates, read2: o.read2 ?? BASE.read2,
        n: o.n ?? BASE.evalPerYear, bar: 0, bars, commit: (cell) => his(cell, yEff) * hers(cell.Q, yEff, uApp),
        pursue: (cell) => hisWant(cell, yEff),
      });
      for (const k of Object.keys(bars)) miss[k] *= 1 - r.multi[k];
      // Who she ends up with (type), weighted by the chance her first success comes this year.
      const pYear = reach * r.multi.any;
      xm += pYear * r.xMean; xs += pYear * r.xSq; got += pYear; reach *= 1 - r.multi.any;
      rows.push({ age, yEff, matches: r.matches, dated: r.dated, evaluated: r.evaluated, odds: r.multi, zPct: r.zPct, commits: r.commits });
    }
    const odds = Object.fromEntries(Object.entries(miss).map(([k, v2]) => [k, 1 - v2]));
    return { odds, rows, first: rows[0], last: rows[rows.length - 1], partner: { mean: got > 0 ? xm / got : 0, sq: got > 0 ? xs / got : 0 } };
  }

  // ---------- the app funnel (attention layer): one year, both sides ----------
  const fMen = menSingle(), fWomen = womenSingle();
  const pSex = (p0) => (x) => Math.min(0.95, p0 * Math.exp(BASE.gammaSex * x.z));
  const runFunnel = (p0, o = {}) => C.appFunnel({ men: fMen.cells, women: fWomen.cells, a: rhoW, c: 0.1, rhoQz: BASE.rhoQz, rhoM, likeM, likeW,
    exposure: cal.exposure.men, datesW: o.datesW ?? BASE.datesW, activeW: o.activeW ?? BASE.activeW, ratio: o.ratio ?? BASE.ratio, pSex: pSex(p0),
    groups: o.groups ?? [0.5, 0.75, 0.9, 0.95, 0.99] });
  let p0 = BASE.p0;
  if (!p0) {
    const target = nsfg['2022-2023_women']['18_35'].app_sex_mean_partners;
    let lo = 0.1, hi = 10;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (m / (1 - Math.exp(-m)) < target) lo = m; else hi = m; }
    const targetX = (lo + hi) / 2;
    lo = 1e-4; hi = 1;
    for (let i = 0; i < 40; i++) { const m = Math.sqrt(lo * hi); if (runFunnel(m).womenSexRate * BASE.datesW < targetX) lo = m; else hi = m; }
    p0 = Math.sqrt(lo * hi);
  }
  const funnel = (o = {}) => runFunnel(p0, o);
  // First dates a man gets in a year by his looks percentile (from the funnel, cached).
  let datesByU = null;
  const datesAt = (u) => {
    if (!datesByU) {
      const F = funnel(), acc = new Map();
      fMen.cells.forEach((x, i) => { const g = acc.get(x.u) ?? [0, 0]; g[0] += x.w; g[1] += x.w * F.dates[i]; acc.set(x.u, g); });
      datesByU = [...acc.entries()].sort((p, q) => p[0] - q[0]).map(([uu, [w, d]]) => [uu, d / w]);
    }
    let j = datesByU.findIndex(([uu]) => uu >= u);
    if (j <= 0) return datesByU[Math.max(0, j)][1];
    const [u0, d0] = datesByU[j - 1], [u1, d1] = datesByU[j];
    return d0 + (d1 - d0) * (u - u0) / (u1 - u0);
  };

  // ---------- his search ----------
  // A man `age` years old: looks percentile uLooks (what his likes say), status / height / social
  // percentiles for his age (or his overall percentile `mv`). Women decide who gets first dates, so his
  // first dates are the ones the funnel gives a man with his looks (fewer as he ages), with the women
  // who chose him, aged lo-hi. Months of dating take two (does she want to keep seeing him?); he
  // properly dates the best evalPerYear; success if both commit. Bars are on her appeal for her age
  // (50 / 75 / 90 / 95th) and "as rare as him or better".
  const datedCache = new Map();
  const datedFor = (u) => {
    const F = funnel(), us = [...new Set(fMen.cells.map((c) => c.u))];
    const uu = us.reduce((b, x) => (Math.abs(x - u) < Math.abs(b - u) ? x : b), us[0]);
    if (!datedCache.has(uu)) datedCache.set(uu, F.datedWomen((c) => c.u === uu));
    return datedCache.get(uu);
  };
  function hisYears({ age = 30, years = BASE.years, uLooks = null, status: us = 0.5, height = 0.5, social = 0.5, mv = null, lo = age - 8, hi = age, ch = 'app', ...o } = {}) {
    const his = hisCommit(o), hers = herCommit(o), herWant = herInterest(o);
    let z, e;
    if (mv != null) {
      const x = D.zTop(1 - mv);
      z = uLooks != null ? D.zTop(1 - uLooks) : RHO_LOOKS_VALUE * x;
      e = (NORM * x - POWER.looks * z) / W_OTHER;
    } else {
      z = D.zTop(1 - (uLooks ?? 0.5));
      e = (POWER.status * D.zTop(1 - us) + POWER.height * D.zTop(1 - height) + POWER.social * D.zTop(1 - social)) / W_OTHER;
    }
    uLooks = normCdf(z);
    const xType = (POWER.looks * z + W_OTHER * e) / NORM;
    const bars = { any: 0, p50: { z: 0, key: 'xt' }, p75: { z: D.zTop(0.25), key: 'xt' }, p90: { z: D.zTop(0.1), key: 'xt' }, p95: { z: D.zTop(0.05), key: 'xt' },
      rare: { z: Math.min(3.5, xType), key: 'xt' } };
    const miss = Object.fromEntries(Object.keys(bars).map((k) => [k, 1]));
    const ages = [];
    for (let a = Math.max(18, lo); a <= Math.min(48, hi); a++) { const r = byAge('women', a); ages.push([a, r.pop * r.single]); }
    const aTot = ages.reduce((t, [, w]) => t + w, 0);
    const rows = [];
    for (let t = 0; t < years; t++) {
      const M = age + t, zApp = z + menLooksShift(M) - menLooksShift(29);
      const me = { Q: xType, u: uLooks, serious: true, M };
      // Who he dates: the single women of those ages who would pick him (her read of him: looks and a
      // little status, against her own like rate, pickier the more appealing she is) and whom he likes
      // back. How many: the funnel's first dates for a man with his looks. Through friends: the single
      // women his friends know, with no swipe stage.
      const sRead = BASE.read.a * zApp + BASE.read.c * xType, sdRead = Math.sqrt(Math.max(1e-6, 1 - (BASE.read.a ** 2 + BASE.read.c ** 2 + 2 * BASE.read.a * BASE.read.c * RHO_LOOKS_VALUE)));
      const tM = D.zTop(likeM(uLooks)), sM = Math.sqrt(1 - rhoM * rhoM);
      const ip = CHANNELS.inperson, sIP = ip.a * zApp + ip.c * xType, sdIP = Math.sqrt(Math.max(1e-6, 1 - (ip.a ** 2 + ip.c ** 2 + 2 * ip.a * ip.c * RHO_LOOKS_VALUE)));
      let liked = 0, yes = 0;
      const cells = ages.flatMap(([a, w]) => womenSingleCells().map((c) => {
        const Q = c.z + womenShift(a), wt = c.w * w / aTot, back = D.normSf((tM - rhoM * Q) / sM);
        let pick = 1;
        if (ch === 'app') pick = D.normSf((D.zTop(likeW(normCdf(Q))) - sRead) / sdRead) * back;
        else if (ch === 'inperson') {
          const y = D.normSf((D.zTop(Math.min(0.9, 2.7 * likeW(normCdf(Q)))) - sIP) / sdIP);
          liked += wt * back; yes += wt * back * y; pick = back * y;
        }
        return { ...c, xt: c.z, Q, a, w: wt * pick };
      }));
      const dates = ch === 'app' ? Math.max(0.05, datesAt(normCdf(zApp))) : ch === 'inperson' ? ip.approaches * yes / Math.max(liked, 1e-12) : CHANNELS[ch].dates;
      const r = C.evaluate({ cells: C.normalize(cells), count: dates }, {
        n: o.n ?? BASE.evalPerYear, read2: { a: 0, c: 0.7 }, rhoQz: 1, bar: 0, bars,
        pursue: (c) => herWant(xType, c.Q, normCdf(c.Q)),
        commit: (c) => (c.serious ? 1 : kc) * his(me, c.Q) * hers(xType, c.Q, normCdf(c.Q)),
      });
      for (const k of Object.keys(bars)) miss[k] *= 1 - r.multi[k];
      rows.push({ age: M, dates, evaluated: r.evaluated, odds: r.multi });
    }
    return { odds: Object.fromEntries(Object.entries(miss).map(([k, v2]) => [k, 1 - v2])), rows, first: rows[0], mvPct: normCdf(xType), uLooks };
  }

  // Her appeal percentile after a WHR change, other traits at the median: z = bodyShare * z_WHR.
  const appealFromWhr = (whrPct, share = 0.6) => normCdf(share * D.zTop(1 - whrPct));

  return {
    BASE, CHANNELS, rhoW, rhoM, demandM, demandW, likeM, likeW, b, kc, x50, ok, censusM, censusW, cal,
    menPop, menSingle, womenPop, womenSingle, hisCommit, herCommit, cohortM, poolAt, poolCells, herPool, hisPool, menOptionsAt,
    womenShift, menLooksShift, menAgeDiscount, menBar, datesAt, POWER_NORM: { W_OTHER, NORM }, menScale, xNow,
    herYears, hisYears, funnel, fMen, fWomen, p0, appealFromWhr,
    fitted: { tolerance: BASE.tolerance, commitScale: BASE.commitScale, theta: BASE.theta, p0 },
  };
}
