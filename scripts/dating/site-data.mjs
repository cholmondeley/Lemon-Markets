// Precomputes the dating page's default tables from the calibrated model and the data aggregates,
// into src/data/dating/site.json. The page draws these directly and runs only the reader's own
// scenarios live. Run after the data scripts and fit.mjs (it reads fitted.json):
//   node scripts/dating/site-data.mjs
// The attention layer (funnel) runs on the fine grid; the mate-value searches on the coarse grid the
// page's worker uses, so the page's tables and its playgrounds agree exactly.
import { readFileSync, writeFileSync } from 'node:fs';
import * as D from '../../src/dating/model.js';
import * as C from '../../src/dating/chain.js';
import { normCdf } from '../../src/model.js';
import { createScenario, RHO_LOOKS_VALUE } from '../../src/dating/scenario.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const inputs = {
  digitized: read('../../src/data/dating/digitized.json'), pools: read('../../src/data/dating/pools.json'),
  calibration: read('../../src/data/dating/calibration.json'), nsfg: read('../../src/data/dating/nsfg.json'),
  status: read('../../src/data/dating/status.json'),
};
const gss = read('../../src/data/dating/gss.json'), ag = read('../../src/data/dating/agegap.json'), tails = read('../../src/data/dating/tails.json');
const exchange = read('../../src/data/dating/exchange.json'), glp1 = read('../../src/data/dating/glp1.json'), hcmst = read('../../src/data/dating/hcmst.json');
const assort = read('../../src/data/dating/assort.json');
const fitted = read('../../src/data/dating/fitted.json');
const SF = createScenario(inputs, { grid: 'fine', fitted });     // attention layer
const S = createScenario(inputs, { grid: 'coarse', fitted });    // mate-value searches
const { BASE, herYears, hisYears, appealFromWhr } = S;
const r3 = (x) => Math.round(x * 1000) / 1000, r4 = (x) => Math.round(x * 1e4) / 1e4;
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, typeof x === 'number' ? r4(x) : x]));
const t0 = Date.now();
const log = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${m}`);
const out = { fitted, base: { ...BASE } };

// ---------- Prologue: marriage by age, one line per decade of birth (the author's chart, digitized) ----------
out.cohorts = inputs.digitized.cohorts;

// ---------- Act I: how couples met ----------
out.channels = {
  source: 'Rosenfeld, Thomas & Hausen (2019), PNAS, HCMST 2009 and 2017; values read from the published chart.',
  years: [1940, 1950, 1960, 1970, 1980, 1990, 1995, 2000, 2005, 2010, 2013, 2017],
  series: {
    Online: [0, 0, 0, 0, 0, 0, 0.02, 0.09, 0.18, 0.21, 0.27, 0.39],
    'Through friends': [0.28, 0.31, 0.33, 0.34, 0.34, 0.34, 0.33, 0.32, 0.30, 0.27, 0.24, 0.20],
    'Bar or restaurant': [0.11, 0.14, 0.16, 0.18, 0.19, 0.19, 0.19, 0.18, 0.19, 0.21, 0.24, 0.27],
    Coworkers: [0.06, 0.09, 0.12, 0.16, 0.19, 0.20, 0.20, 0.18, 0.16, 0.14, 0.12, 0.11],
    Family: [0.29, 0.27, 0.25, 0.22, 0.19, 0.16, 0.15, 0.13, 0.11, 0.10, 0.09, 0.07],
    School: [0.27, 0.24, 0.21, 0.17, 0.14, 0.12, 0.10, 0.10, 0.09, 0.08, 0.07, 0.05],
  },
};
out.hcmst = hcmst.periods.map((p) => round({ from: p.from, to: p.to, n: p.n, online: p.Online, se: p.online_se, ci: 1.96 * p.online_se, friends: p["Through friends"] }));
const singleUS = (sex, lo, hi) => inputs.pools.by_age.filter((r) => r.sex === sex && r.age >= lo && r.age <= hi).reduce((s, r) => s + r.pop * r.single, 0);
// The Dating Calculator's counts (the author's screenshots), with the whole-country and metro steps
// from the parquet: single men 25-40 with no kids 14.6M nationally, 1.02M in the New York metro (CBSA
// 35620); single women 22-27 8.0M nationally, 119k in the San Francisco metro (CBSA 41860), 42k of them
// with a BA and not overweight.
out.calcExamples = [
  { who: 'A 25-year-old woman in New York', unit: 'single men', steps: [['Single men 25-40, no kids, whole US', 14.6e6], ['… in the New York metro', 1.02e6], ['… aged 25-27', 288000],
    ['… earning $100k+', 39000], ['… with a graduate degree', 6200], ['… 6\'0" or taller', 1600], ['… a healthy weight, fit', 504], ['… doesn\'t drink or smoke', 19]] },
  { who: 'A 30-year-old man in San Francisco', unit: 'single women', steps: [['Single women 22-27, whole US', Math.round(singleUS('women', 22, 27) / 1e5) * 1e5],
    ['… in the San Francisco metro', 119000], ['… with a BA, not overweight', 42000], ['… WHR ≤ 0.74, waist ≤ 27 in', 1500], ['… earns $100k+', 311], ['… doesn\'t drink', 19]] },
];

// ---------- Act II: the attention market ----------
const dg = inputs.digitized, cal = inputs.calibration;
out.hist = { menReceived: dg.luap_received_ratio_men, womenReceived: dg.luap_received_ratio_women, menLike: dg.luap_like_rate_men, womenLike: dg.luap_like_rate_women };
out.hinge = { men: { top1: 0.16, top5: 0.41, top10: 0.58, bottom50: 0.04 }, women: { top1: 0.11, top5: 0.31, top10: 0.46, bottom50: 0.08 } };
out.gssConcentration = { men: gss.men.partner_concentration_25_45, women: gss.women.partner_concentration_25_45 };
{
  const meanOf = (h) => D.histMean(D.histPoints(h));
  const W = D.activityWeighted(D.histPoints(dg.luap_like_rate_women), meanOf(dg.luap_received_ratio_men)).pts;
  const scaled = (pts, f) => pts.map((p) => ({ x: Math.min(0.99, p.x * f), w: p.w }));
  const top5 = (f, rho) => r4(D.attentionMarket({ rho, openness: scaled(W, f), kappa: cal.exposure.men, M: 1000 }).top5);
  // The top 5%'s share of likes: men today (Hinge's women), women today, and two changes. A 50/50 app:
  // with 1 man per woman instead of 2.7, a woman with time for the same number of conversations can
  // like 2.7 times as many profiles (Act II's inbox arithmetic).
  const r0 = cal.consensus.womenOnMen;
  out.attention = { men: 0.31, women: top5(1, r0), agreeLess: top5(1, 0.2), even: top5(2.7, r0), both: top5(2.7, 0.2) };
}

// ---------- Act III: the funnel ----------
log('funnel');
const F = SF.funnel();
const band = (b) => ({ lo: b.lo, hi: b.hi, share: r4(b.share), likes: r3(b.likes), matches: r3(b.matches), dates: r3(b.dates), noDate: r4(b.noDate), anySex: r4(b.anySex), partnersIfAny: r3(b.partnersIfAny) });
out.funnel = { bands: F.byBand.map(band), all: band({ lo: 0, hi: 1, ...F.all }), top: F.topDates };
{
  // Per man, by his looks percentile (1..99): a year's likes, matches and first dates, and each split
  // by the looks percentile of the women (15 bins), for "your year on the apps".
  const cells = SF.fMen.cells, pOf = (x) => Math.min(0.95, SF.p0 * Math.exp(BASE.gammaSex * x.z));
  const nb = F.bins.v.length, byU = new Map();
  cells.forEach((x, i) => {
    if (!byU.has(x.u)) byU.set(x.u, { w: 0, likes: 0, matches: 0, dates: 0, noDate: 0, anySex: 0, L: new Float64Array(nb), M: new Float64Array(nb), Dd: new Float64Array(nb) });
    const g = byU.get(x.u), d = F.dates[i];
    g.w += x.w; g.likes += x.w * F.perMan.likes[i]; g.matches += x.w * F.perMan.matches[i]; g.dates += x.w * d;
    g.noDate += x.w * Math.exp(-d); g.anySex += x.w * (1 - Math.exp(-d * pOf(x)));
    for (let k = 0; k < nb; k++) { g.L[k] += x.w * F.bins.likes[k][i]; g.M[k] += x.w * F.bins.matches[k][i]; g.Dd[k] += x.w * F.bins.dates[k][i] * (d / Math.max(F.perMan.dates[i], 1e-12)); }
  });
  const us = [...byU.keys()].sort((a, b) => a - b);
  const at = (u, f) => {
    let j = us.findIndex((x) => x >= u); if (j <= 0) j = 1;
    const a = byU.get(us[j - 1]), b = byU.get(us[j]), t = (u - us[j - 1]) / (us[j] - us[j - 1]);
    return (1 - t) * f(a) / a.w + t * f(b) / b.w;
  };
  out.funnelBins = F.bins.v.map(r4);
  out.funnelByU = [];
  for (let p = 1; p <= 99; p++) {
    const u = p / 100;
    out.funnelByU.push({ p, likes: r3(at(u, (g) => g.likes)), matches: r3(at(u, (g) => g.matches)), dates: r3(at(u, (g) => g.dates)), noDate: r4(at(u, (g) => g.noDate)), anySex: r4(at(u, (g) => g.anySex)),
      L: Array.from({ length: nb }, (_, k) => r3(at(u, (g) => g.L[k]))), M: Array.from({ length: nb }, (_, k) => r3(at(u, (g) => g.M[k]))), D: Array.from({ length: nb }, (_, k) => r4(at(u, (g) => g.Dd[k]))) });
  }
  // Per woman, by her looks bin: likes a day from men (Act II's inbox: 2.7 men per woman on at once,
  // 100 swipes a day each), and how those likes, her matches and her first dates split by the men's
  // looks percentile (20 bands of 5 points).
  const menW = cells.map((x) => x.w), NB = 20;
  const bandOf = (u) => Math.min(NB - 1, Math.floor(u * NB));
  out.womenByU = F.women.map((wo, k) => {
    const L = new Float64Array(NB), Mm = new Float64Array(NB), Dd = new Float64Array(NB);
    let seen = 0;
    cells.forEach((x, i) => {
      const b = bandOf(x.u), back = F.bins.back[k][i], like = F.bins.like[k][i];
      seen += menW[i];
      L[b] += menW[i] * back; Mm[b] += menW[i] * back * like; Dd[b] += menW[i] * F.bins.dates[k][i];
    });
    const perDay = 2.7 * 100;
    const dTot = Dd.reduce((s, v) => s + v, 0);
    return { v: r3(wo.v), likesSent: r3(wo.likes), matches: r3(wo.matches), dates: r3(Math.min(BASE.datesW, wo.matches)),
      likesPerDay: r3(perDay * L.reduce((s, v) => s + v, 0) / seen), L: Array.from(L, (v) => r3(perDay * v / seen)), M: Array.from(Mm, (v) => r4(perDay * v / seen)),
      D: Array.from(Dd, (v) => r4(v / Math.max(dTot, 1e-12))) };
  });
}
const ns = inputs.nsfg;
out.nsfg = ['2017-2019', '2022-2023'].map((wave) => ({ wave, men: ns[`${wave}_men`]['18_35'], women: ns[`${wave}_women`]['18_35'] }));
out.lanaLi = { years: 3, likesReceived: 2031, likesSent: 1013, matches: 345, convos: 240, meetups: 57, who: '35-year-old 5\'10" NYC founder, three years of Hinge' };

// ---------- Act IV: who is left ----------
log('commitment');
const his = S.hisCommit(), hers = S.herCommit();
const menEq = D.attentionMarket({ rho: S.rhoW, openness: D.activityWeighted(D.histPoints(dg.luap_like_rate_women), D.histMean(D.histPoints(dg.luap_received_ratio_men))).pts, M: 1000 });
out.intent = {
  luap: [23, 22, 30, 33, 35, 41, 46, 52],
  model: D.commitmentByPercentile(menEq, { x50: S.x50, b: S.b, kc: S.kc, groups: 8 }).map((g) => r4(g.casualOnApp)),
};
// A serious man, 30, who has dated a woman of 28 for months: would he commit to her? His decision
// alone, by his mate value (whether the relationship then works out is commitScale, shown separately).
const manAt = (p, M = 30) => { const x = D.zTop(1 - p); return { Q: x, u: normCdf(RHO_LOOKS_VALUE * x), serious: true, M }; };
const decide = (p, v) => his(manAt(p), D.zTop(1 - v) + S.womenShift(28)) / BASE.commitScale;
out.commitBars = [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map((p) => ({ p, median: r4(decide(p, 0.5)), top10: r4(decide(p, 0.9)), bottom: r4(decide(p, 0.25)) }));
// Per first date, by his looks band: the chance it becomes a relationship both commit to. His mate
// value given his looks: x = rho z + sqrt(1 - rho^2) e, averaged over e.
out.perDate = F.byBand.map((x) => {
  const sel = (c) => c.u >= x.lo && c.u < x.hi;
  const men = SF.fMen.cells.filter(sel), dated = F.datedWomen(sel);
  const W0 = men.reduce((t, c) => t + c.w, 0);
  const es = [-2, -1, 0, 1, 2].map((e) => ({ e, w: Math.exp(-e * e / 2) })), We = es.reduce((s, q) => s + q.w, 0);
  let hc = 0;
  for (const m of men) for (const { e, w: we } of es) {
    const xm = RHO_LOOKS_VALUE * m.z + Math.sqrt(1 - RHO_LOOKS_VALUE ** 2) * e;
    for (const w of dated) { const y = w.z + S.womenShift(28); hc += (m.w / W0) * (we / We) * w.w * his({ Q: xm, u: m.u, serious: m.serious, M: 30 }, y) * hers(xm, y, normCdf(y)) * (w.serious ? 1 : S.kc); }
  }
  return { lo: x.lo, hi: x.hi, dates: r3(x.dates), p: r4(Math.min(1, BASE.evalPerYear / Math.max(x.dates, 1e-9)) * hc) };
});
{
  // Who is single: the casual share among all men, men on the apps, single men 25-35, never-married men at 40.
  const cas = (cells) => { const W = cells.reduce((s, c) => s + c.w, 0); return cells.reduce((s, c) => s + (c.serious ? 0 : c.w), 0) / W; };
  const single2535 = [];
  for (let M = 25; M <= 35; M++) single2535.push(...S.poolCells(M));
  out.poolMix = { all: S.b, onApps: r4(cas(SF.fMen.cells)), single2535: r4(cas(single2535)), never40: r4(cas(S.cohortM()[40].cells)) };
}

// ---------- Act V: the clock ----------
log('age');
out.age = {
  okcupid: dg.okcupid_age, geruso: dg.geruso,
  whr: inputs.pools.by_age.filter((r) => r.sex === 'women' && r.age >= 18 && r.age <= 50).map((r) => ({ age: r.age, le074: r4(r.whr_le_074), ge085: r4(r.whr_ge_085), p50: r3(r.whr_p50) })),
  cohortMen: [25, 30, 35, 40, 45, 50].map((age) => { const d = C.describe(S.cohortM()[age].cells); return { age, casual: r4(1 - d.serious), value: r4(d.qPct) }; }),
  neverMarried4049: inputs.pools.never_married_40_49,
};
out.herByAge = [22, 24, 26, 28, 30, 32, 34, 36, 38].map((start) => { const r = herYears({ start }); return { start, any: r4(r.odds.any), rare: r4(r.odds.rare), top10: r4(r.odds.top10) }; });

// ---------- Act VI: search ----------
log('search');
out.searchOdds = [1, 0.7, 0.5, 0.35].map((r) => ({ r, odds: [1e3, 1e4, 1e5, 2.5e5].map((N) => r4(D.findOdds({ n: 20, p: 0.01, N, r }))), median: Math.round(D.bestRarity({ n: 20, p: 0.01, r })) }));
out.searchText = { perfect1e4: r4(D.findOdds({ n: 20, p: 0.01, N: 1e4, r: 1 })), half1e4: r4(D.findOdds({ n: 20, p: 0.01, N: 1e4, r: 0.5 })),
  halfTop1Share: r4(D.bvnUpper(D.zTop(0.01), D.zTop(0.01), 0.5) / 0.01) };
out.tails = { traits: tails.traits, corr: tails.corr, n: tails.n };
out.herByAppeal = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99].map((v) => { const r = herYears({ v }); return round({ v, ...r.odds, matches: r.first.matches }); });
out.hisByAppeal = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99].map((mv) => { const r = hisYears({ age: 30, mv, lo: 22, hi: 30 }); return round({ mv, ...r.odds, dates: r.first.dates, uLooks: r.uLooks }); });

// ---------- Act VII: playbook ----------
log('levers');
const lever = (label, o) => { const r = herYears(o); return { label, ...round(r.odds) }; };
// GLP-1s for a median-WHR woman: her appeal from the average new WHR percentile of the 25-50% and
// 50-75% starting bands (she sits between them).
const gb = (lo) => glp1.bands.find((b) => Math.abs(b.band[0] - lo) < 1e-6);
const medWhr = (k) => (gb(0.25)[k] + gb(0.5)[k]) / 2;
const vGlp = appealFromWhr(medWhr('pct_glp1')), vGlpG = appealFromWhr(medWhr('pct_glp1_glutes'));
const baseW = { start: 27, v: 0.5, gap: 2 };
// A woman's WHR percentile from her appeal (appeal = 0.6 x the WHR z-score, other traits median), and
// where GLP-1s plus a year of glute work take it (interpolating the NHANES bands by where she starts).
const whrFromAppeal = (v) => normCdf(D.zTop(1 - v) / 0.6);
const bandsBy = glp1.bands.map((b) => ({ p: 1 - (b.band[0] + b.band[1]) / 2, g: b.pct_glp1, gg: b.pct_glp1_glutes })).sort((a, b) => a.p - b.p);
const afterGlp = (p, k) => { if (p <= bandsBy[0].p) return bandsBy[0][k] - (bandsBy[0].p - p); if (p >= bandsBy.at(-1).p) return Math.min(0.999, bandsBy.at(-1)[k]); const j = bandsBy.findIndex((b) => b.p >= p); const a = bandsBy[j - 1], b = bandsBy[j], t = (p - a.p) / (b.p - a.p); return a[k] + (b[k] - a[k]) * t; };
const glpAppeal = (v) => appealFromWhr(afterGlp(whrFromAppeal(v), 'gg'));
out.leversBy = {};
for (const v of [0.5, 0.7, 0.9]) {
  const b = { ...baseW, v, rareV: v };   // "as good as her" stays measured against where she started
  out.leversBy[`p${Math.round(v * 100)}`] = [
    lever("Don't start looking till 27", b),
    lever('Start at 23 instead', { ...b, start: 23 }),
    lever('Open to men 10 years older', { ...b, gap: 10 }),
    lever('Open to men 15 years older', { ...b, gap: 15 }),
    lever('GLP-1 plus a year of glute work', { ...b, v: glpAppeal(v) }),
    lever('Dating 2 → 3 men a year', { ...b, n: 3 }),
  ];
}
out.levers = out.leversBy.p50;
// Age gaps for a top-20% woman of 23: where the top-tier men are.
out.gapYoung = { narrow: round(herYears({ start: 23, v: 0.8, gap: 2 }).odds), wide: round(herYears({ start: 23, v: 0.8, gap: 15 }).odds) };
out.leverAppeal = { glp: r4(vGlp), glpGlutes: r4(vGlpG) };
{
  // GLP-1s for a woman already in the top 20% on WHR (80th percentile), from 27.
  const p0 = 0.8, v0 = appealFromWhr(p0), v1 = appealFromWhr(afterGlp(p0, 'gg'));
  const o0 = herYears({ ...baseW, v: v0 }).odds, o1 = herYears({ ...baseW, v: v1, rareV: v0 }).odds;
  out.glpTop20 = round({ v0, v1, pAfter: afterGlp(p0, 'gg'), any0: o0.any, any1: o1.any, top10_0: o0.top10, top10_1: o1.top10, rare0: o0.rare, rare1: o1.rare });
}
{
  // Everything together from 23 for a top-20% woman going for a top-10% man, one step at a time.
  const v = 0.8, b = { ...baseW, v, rareV: v };
  const steps = [["Don't start looking till 27", {}], ['Start at 23', { start: 23 }], ['Open to men 15 years older', { gap: 15 }], ['GLP-1 plus glute work', { v: glpAppeal(v) }], ['Dating 2 → 3 men a year', { n: 3 }]];
  let o = {};
  out.waterfall = steps.map(([label, d]) => { o = { ...o, ...d }; const r = herYears({ ...b, ...o }); return { label, ...round(r.odds) }; });
}
out.glp = [0, 0.05, 0.1, 0.25, 0.5].map((lo) => {
  const b = gb(lo), p0 = 1 - (b.band[0] + b.band[1]) / 2, v0 = appealFromWhr(p0), v1 = appealFromWhr(b.pct_glp1), v2 = appealFromWhr(b.pct_glp1_glutes);
  // Five years from 25: a millionaire husband, before and after, and the same open to men 15 years older.
  const at = (v, gap = 2) => herYears({ start: 25, v, gap }).odds;
  const o0 = at(v0), o2 = at(v2), g0 = at(v0, 15), g2 = at(v2, 15);
  return round({ lo: b.band[0], hi: b.band[1], whr: b.whr_median, q0: b.qualify_now, q1: b.qualify_glp1, q2: b.qualify_glp1_glutes, pct0: p0, pct1: b.pct_glp1, pct2: b.pct_glp1_glutes,
    v0, v1, v2, mil0: o0.mil, mil2: o2.mil, milGap0: g0.mil, milGap2: g2.mil, top10_0: o0.top10, top10_2: o2.top10 });
});
out.glpAll = r4(glp1.qualify_all);
out.exchange = { tiers: exchange.tiers, metros: exchange.metros };
out.reach = ag.reach_recent_5y;
out.gapByIncome = { recent: ag.recent_5y.bands, recent3045: ag.recent_5y_husband_30_45.bands, all: ag.all.bands };
out.gapModel = [23, 27, 31].map((start) => ({ start, rows: [2, 5, 10, 15].map((gap) => ({ gap, ...round(herYears({ start, gap }).odds) })) }));
// The same for a 90th-percentile woman: where the gap buys top-tier men.
out.gapTop = [23, 27, 31].map((start) => ({ start, rows: [2, 10, 15].map((gap) => ({ gap, ...round(herYears({ start, gap, v: 0.9 }).odds) })) }));
// Men: a 30-year-old at the median on everything, looking at women 22-30; move one thing at a time.
log('men');
const baseM = { age: 30, lo: 22, hi: 30, uLooks: 0.5, status: 0.5, social: 0.5, height: 0.5 };
// Each lever on the apps and off them (in person: two approaches a month).
const mlever = (label, o) => {
  const a = hisYears({ ...baseM, ...o }), p = hisYears({ ...baseM, ...o, ch: 'inperson' });
  return { label, mvPct: r4(a.mvPct), dates: r3(a.first.dates), datesIP: r3(p.first.dates), ...round(a.odds), ip: round(p.odds) };
};
// Body is half of a man's looks (assumption), face at the median. The rungs are the Dating
// Calculator's flags among single men 25-35 (parquet): not overweight or obese 40% (body at the 60th
// percentile), fit 5.3% (body fat up to 20%: the 94.7th), strict abs 2.2% (up to 17%: the 97.8th).
const looksWithBody = (pBody) => normCdf(D.zTop(1 - pBody) / Math.SQRT2);
out.menLevers = [
  mlever('Baseline: a median man of 30', {}),
  mlever('Lose the weight (out of overweight: top 40%)', { uLooks: looksWithBody(0.6) }),
  mlever('Get fit (top 5% of bodies)', { uLooks: looksWithBody(0.947) }),
  mlever('Get strict abs (top 2%)', { uLooks: looksWithBody(0.978) }),
  mlever('Status to the 75th percentile (income, career)', { status: 0.75 }),
  mlever('Status to the 90th percentile', { status: 0.9 }),
  mlever('Social skills to the 75th percentile', { social: 0.75 }),
  mlever('All of it: fit, status and social skills at the 75th', { uLooks: looksWithBody(0.947), status: 0.75, social: 0.75 }),
];
out.assort = { rho: assort.cfa.rho, composite: assort.rho_composite, cascade: assort.observed.cascade, matched: assort.observed.matched, independent: assort.fits[0].matched, n: assort.observed.n };

writeFileSync(new URL('../../src/data/dating/site.json', import.meta.url), JSON.stringify(out));
log(`wrote src/data/dating/site.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
