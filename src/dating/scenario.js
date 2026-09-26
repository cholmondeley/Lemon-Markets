// The calibrated dating model, assembled from its data: shared by the report script
// (scripts/dating/chain.mjs), the page's precomputed tables (scripts/dating/site-data.mjs) and the
// page's worker (src/dating/worker.js). Pure: takes the parsed JSON inputs, no I/O.
//
//   const S = createScenario({ digitized, pools, calibration, nsfg, exchange }, { grid: 'fine' });
//   S.herYears({ start: 27, gap: 15 }).odds
//
// Grids: 'fine' (61 x 61, the report) or 'coarse' (31 x 31, live on the page; within ~0.1 point).
import * as D from './model.js';
import * as C from './chain.js';
import { normCdf } from '../model.js';

export const DEFAULTS = {
  rhoQz: 0.1,        // appeal vs partner quality: Feingold (1992) r = .04 with IQ
  lemon: 0.3,        // breakup odds x1.35 per SD of unseen quality (Solomon & Jackson 2014)
  commitMedian: 0.3, // a serious median man commits to a median woman he has dated for months; fitted to the census 25 -> 30
  bar: 0.9,          // quality bar for "a good partner": top 10%
  years: 5,
  evalPerYear: 2,    // people properly dated (months) per year
  datesW: 13,        // first dates per actively dating woman per year (NSFG)
  activeW: 0.2,      // share of women users who date in a year (NSFG; luap retention)
  ratio: 1.5,        // men per woman among a year's users (Pew ever-used 58/42; NSFG totals)
  gammaSex: 1,       // dates with more-desired men more often end in sex (fits NSFG: 3.4 partners)
  womenCasual: 0.15,
  read2: { a: 0.3, c: 0.25 },   // what a first date shows (Connelly & Ones: strangers who interact)
  bodyShare: 0.6,    // how much of a woman's appeal is her body (WHR); assumption, swept 0.4-0.8
};

const GRIDS = { fine: { men: [61, 61], women: [61, 41] }, coarse: { men: [31, 31], women: [31, 21] } };

export function createScenario({ digitized, pools, calibration: cal, nsfg, exchange }, { grid = 'fine', fitted = null } = {}) {
  const G = GRIDS[grid];
  const BASE = { ...DEFAULTS };
  const meanOf = (h) => D.histMean(D.histPoints(h));
  const W = D.activityWeighted(D.histPoints(digitized.luap_like_rate_women), meanOf(digitized.luap_received_ratio_men)).pts;
  const Mn = D.activityWeighted(D.histPoints(digitized.luap_like_rate_men), meanOf(digitized.luap_received_ratio_women)).pts;
  const rhoW = cal.consensus.womenOnMen, rhoM = cal.consensus.menOnWomen;
  const demandM = C.demandCurve(D.attentionMarket({ rho: rhoW, openness: W, M: 1000 }));
  const demandW = C.demandCurve(D.attentionMarket({ rho: rhoM, openness: Mn, M: 1000 }));
  const likeM = C.likeRateCurve(demandM, 0.33);    // men's like rate by appeal (median 33%)
  const likeW = C.likeRateCurve(demandW, 0.045);   // women's like rate by appeal (median 4.5%)
  const { b, kc, x50 } = cal.commitment;
  const ok = digitized.okcupid_age;
  const neverMarried = (sex) => { const out = {}; let p = 1; for (const r of pools.by_age.filter((x) => x.sex === sex)) { p = Math.min(p, r.never_married); out[r.age] = p; } return out; };
  const censusM = neverMarried('men'), censusW = neverMarried('women');

  // Her appeal percentile after a WHR change, other traits at the median: z = bodyShare * z_WHR.
  const appealFromWhr = (whrPct, share = BASE.bodyShare) => normCdf(share * D.zTop(1 - whrPct));
  const glp = (drug, glute, start = 0.5, hipShare = 0.5) => exchange.glp1.find((g) => g.drug === drug && g.glute_in === glute && Math.abs(g.start_pct - start) < 1e-6 && g.hip_share === hipShare);
  const CHANNELS = {
    app: { label: 'App', a: rhoW, c: 0.1, views: 15000 },
    friends: { label: 'Friends', a: 0.3, c: 0.45, views: 60, like: 0.2, dates: 6 },
    work: { label: 'Work', a: 0.25, c: 0.27, views: 25, like: 0.2, dates: 3 },
  };

  const menPop = (o = {}) => C.population({ nz: G.men[0], ne: G.men[1], rhoQz: o.rhoQz ?? BASE.rhoQz, casual: o.casual ?? b });
  const menSingle = (o = {}) => C.singlePool(menPop(o), { demand: demandM, x50, kc: o.kc ?? kc, lemon: o.lemon ?? BASE.lemon });
  const womenPop = (o = {}) => C.population({ nz: G.women[0], ne: G.women[1], rhoQz: o.rhoQz ?? BASE.rhoQz, casual: BASE.womenCasual });
  const womenSingle = (o = {}) => C.singlePool(womenPop(o), { demand: demandW, x50, kc: 1, lemon: o.lemon ?? BASE.lemon });
  const hisCommit = (o = {}) => C.commitRule(demandM, { median: o.commitMedian ?? BASE.commitMedian, beta: rhoM, kc: o.kc ?? kc, options: o.options ?? 1 });
  const herCommit = (o = {}) => C.commitRule(demandW, { median: o.commitMedian ?? BASE.commitMedian, beta: rhoW, kc, options: o.options ?? 1 });

  // Never-married cohorts (frailty model fitted to the census at every age), cached per assumption set.
  const cohortCache = new Map();
  const cohortM = (o = {}) => {
    const key = JSON.stringify([o.rhoQz ?? BASE.rhoQz, o.kc ?? kc, o.theta ?? 0]);
    if (!cohortCache.has(key)) cohortCache.set(key, C.cohort(menPop(o), { demand: demandM, kc: o.kc ?? kc, theta: o.theta ?? 0, census: censusM }));
    return cohortCache.get(key);
  };
  const singleCache = new Map();
  const menSingleC = (o = {}) => {
    const key = JSON.stringify([o.rhoQz ?? BASE.rhoQz, o.kc ?? kc, o.lemon ?? BASE.lemon]);
    if (!singleCache.has(key)) singleCache.set(key, menSingle(o));
    return singleCache.get(key);
  };
  const byAge = (sex, age) => pools.by_age.find((r) => r.sex === sex && r.age === Math.min(70, age));
  // Single men at age M: never married (cohort) plus previously married and single again, in census proportions.
  const poolAt = (M, o = {}) => {
    const r = byAge('men', M);
    return C.singleAtAge(menPop(o), cohortM(o)[Math.min(60, M)], menSingleC(o), { neverShare: r.single_never, prevShare: r.single_prev });
  };
  // A man's options fall with his age: the share of women whose age range includes him (OkCupid men's
  // curve), relative to a 29-year-old.
  const menOptionsAt = (M) => D.curveAt(ok, 'men', Math.min(M, 48)) / D.curveAt(ok, 'men', 29);

  // A woman at appeal percentile v searching for `years` from age `start`. Each year: her pool is the
  // single men `gap` years older, men's interest in her is at that age's OkCupid level (a shift in her
  // appeal, so the men with the most options drop away first), she likes and dates by her read,
  // properly dates the best evalPerYear by what a first date shows, and succeeds if one is above the
  // quality bar and both commit. Years are independent tries.
  function herYears({ start = 25, years = BASE.years, v = 0.5, ch = 'app', bar = BASE.bar, commit = true, ...o } = {}) {
    const C0 = CHANNELS[ch], hers = herCommit(o), gap = o.gap ?? 2;
    let miss = 1;
    const rows = [];
    for (let t = 0; t < years; t++) {
      const age = start + t, af = D.curveAt(ok, 'women', age), M = age + gap;
      const pool = o.pool ?? poolAt(M, o);
      const his = hisCommit({ ...o, options: (o.options ?? 1) * menOptionsAt(M) });
      const y0 = D.zTop(1 - v);
      const y = af < 0.999 ? C.shiftForFactor(pool, likeM, rhoM, y0, af) : y0;
      const r = C.search(pool, {
        a: o.a ?? C0.a, c: o.c ?? C0.c, rhoQz: o.rhoQz ?? BASE.rhoQz, exposure: ch === 'app' ? cal.exposure.men : 0,
        likeRate: C0.like ?? likeW(normCdf(y)), back: C.backRule(likeM, rhoM, y),
        views: o.views ?? C0.views, dates: ch === 'app' ? BASE.datesW : C0.dates, read2: o.read2 ?? BASE.read2,
        // Both must commit: he to her (his bar, her appeal at this age) and she to him (her bar, set by
        // her options at this age, and his appeal).
        n: o.n ?? BASE.evalPerYear, bar, commit: commit ? (cell) => his(cell, y) * hers({ u: normCdf(y), serious: true }, cell.z) : null,
      });
      miss *= 1 - r.odds;
      rows.push({ age, ...r });
    }
    return { odds: 1 - miss, rows, first: rows[0], last: rows[rows.length - 1] };
  }

  // Commitment strength: the median-to-median chance that fits the census share of never-married women
  // who marry between 25 and 30, for a woman on an app choosing like the app-wide consensus.
  if (fitted?.commitMedian) BASE.commitMedian = fitted.commitMedian;
  else {
    const target = 1 - censusW[30] / censusW[25];
    let lo = 0.05, hi = 0.95;
    for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (herYears({ bar: 0, commitMedian: m }).odds < target) lo = m; else hi = m; }
    BASE.commitMedian = +((lo + hi) / 2).toFixed(3);
  }

  // The app funnel (one year, both sides), with the date-to-sex rate fitted to NSFG women.
  const fMen = menSingle(), fWomen = womenSingle();
  const pSex = (p0) => (x) => Math.min(0.95, p0 * Math.exp(BASE.gammaSex * x.z));
  const runFunnel = (p0, o = {}) => C.appFunnel({ men: fMen.cells, women: fWomen.cells, a: rhoW, c: CHANNELS.app.c, rhoQz: BASE.rhoQz, rhoM, likeM, likeW,
    exposure: cal.exposure.men, datesW: o.datesW ?? BASE.datesW, activeW: o.activeW ?? BASE.activeW, ratio: o.ratio ?? BASE.ratio, pSex: pSex(p0),
    groups: o.groups ?? [0.5, 0.75, 0.9, 0.95, 0.99] });
  let p0 = fitted?.p0;
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

  return {
    BASE, CHANNELS, rhoW, rhoM, demandM, demandW, likeM, likeW, b, kc, x50, ok, censusM, censusW, cal,
    menPop, menSingle, womenPop, womenSingle, hisCommit, herCommit, cohortM, menSingleC, poolAt, menOptionsAt,
    herYears, funnel, fMen, fWomen, p0, appealFromWhr, glp, fitted: { commitMedian: BASE.commitMedian, p0 },
  };
}
