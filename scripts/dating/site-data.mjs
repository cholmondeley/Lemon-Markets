// Precomputes the dating page's default tables from the calibrated model (fine grid) and the data
// aggregates, into src/data/dating/site.json. The page draws these directly and runs only the
// reader's own scenarios live. Run after sensitivity.mjs and chain.mjs (it reads fitted.json):
//   node scripts/dating/site-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import * as D from '../../src/dating/model.js';
import * as C from '../../src/dating/chain.js';
import { createScenario } from '../../src/dating/scenario.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const inputs = {
  digitized: read('../../src/data/dating/digitized.json'), pools: read('../../src/data/dating/pools.json'),
  calibration: read('../../src/data/dating/calibration.json'), nsfg: read('../../src/data/dating/nsfg.json'),
  exchange: read('../../src/data/dating/exchange.json'),
};
const gss = read('../../src/data/dating/gss.json'), ag = read('../../src/data/dating/agegap.json'), tails = read('../../src/data/dating/tails.json');
const fitted = read('../../src/data/dating/fitted.json');
const S = createScenario(inputs, { grid: 'fine', fitted });
const { BASE, herYears, glp, appealFromWhr } = S;
const r3 = (x) => Math.round(x * 1000) / 1000, r4 = (x) => Math.round(x * 1e4) / 1e4;
const t0 = Date.now();
const log = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${m}`);
const out = { fitted, base: { ...BASE } };

// ---------- Prologue: marriage by cohort (read from the cohort chart at ages 25 and 30) ----------
out.cohorts = {
  source: 'Women in the U.S. by decade of birth, percent married (1950 manual, 1960-2000 real data); read from the chart at ages 25 and 30.',
  rows: [
    { cohort: 1940, by25: 0.82, by30: 0.89 }, { cohort: 1950, by25: 0.74, by30: 0.84 }, { cohort: 1960, by25: 0.59, by30: 0.78 },
    { cohort: 1970, by25: 0.50, by30: 0.70 }, { cohort: 1980, by25: 0.37, by30: 0.58 }, { cohort: 1990, by25: 0.27, by30: 0.52 },
    { cohort: 2000, by25: 0.17, by30: null },
  ],
};

// ---------- Act I: how couples met (Rosenfeld, Thomas & Hausen 2019; read from the published chart) ----------
out.channels = {
  source: 'Rosenfeld, Thomas & Hausen (2019), PNAS, HCMST 2009 and 2017; values read from the published chart.',
  years: [1940, 1950, 1960, 1970, 1980, 1990, 1995, 2000, 2005, 2010, 2013, 2017],
  series: {
    Online: [0, 0, 0, 0, 0, 0.005, 0.02, 0.09, 0.18, 0.21, 0.27, 0.39],
    'Through friends': [0.28, 0.31, 0.33, 0.34, 0.34, 0.34, 0.33, 0.32, 0.30, 0.27, 0.24, 0.20],
    'Bar or restaurant': [0.11, 0.14, 0.16, 0.18, 0.19, 0.19, 0.19, 0.18, 0.19, 0.21, 0.24, 0.27],
    Coworkers: [0.06, 0.09, 0.12, 0.16, 0.19, 0.20, 0.20, 0.18, 0.16, 0.14, 0.12, 0.11],
    Family: [0.29, 0.27, 0.25, 0.22, 0.19, 0.16, 0.15, 0.13, 0.11, 0.10, 0.09, 0.07],
    School: [0.27, 0.24, 0.21, 0.17, 0.14, 0.12, 0.10, 0.10, 0.09, 0.08, 0.07, 0.05],
  },
};
const nat = inputs.pools.metros[0];
out.bench = { singleWomen2029PerThousand: nat.single_women_20_29 / nat.adults * 1000, singleMen2535PerThousand: nat.single_men_25_35 / nat.adults * 1000,
  metros: inputs.pools.metros.slice(1, 11).map((m) => ({ name: m.name, women: m.single_women_20_29 / m.adults * 1000 })) };
out.calcExamples = [
  { who: 'A 25-year-old woman in New York', steps: [['6ft+, $100k+, BA, ages 25-40', 32000], ['… within 2 years of her age', 8100], ['… and a millionaire', 330], ['… and a healthy weight', 158]] },
  { who: 'A 30-year-old man in San Francisco', steps: [['Women 22-27, BA, not overweight', 42000], ['… WHR ≤ 0.74, waist ≤ 27 in', 1500], ['… earns $100k+', 311], ['… doesn\'t drink', 19]] },
];

// ---------- Act II: the attention market ----------
const dg = inputs.digitized;
out.hist = { menReceived: dg.luap_received_ratio_men, womenReceived: dg.luap_received_ratio_women, menLike: dg.luap_like_rate_men, womenLike: dg.luap_like_rate_women };
out.hinge = { men: { top1: 0.16, top5: 0.41, top10: 0.58, bottom50: 0.04 }, women: { top1: 0.11, top5: 0.31, top10: 0.46, bottom50: 0.08 } };
out.gssConcentration = { men: gss.men.partner_concentration_25_45, women: gss.women.partner_concentration_25_45 };

// ---------- Act III: the funnel ----------
log('funnel');
const F = S.funnel();
const band = (b) => ({ lo: b.lo, hi: b.hi, share: r4(b.share), likes: r3(b.likes), matches: r3(b.matches), dates: r3(b.dates), noDate: r4(b.noDate), anySex: r4(b.anySex), partnersIfAny: r3(b.partnersIfAny) });
out.funnel = { bands: F.byBand.map(band), all: band({ lo: 0, hi: 1, ...F.all }), top: F.topDates };
// Per appeal percentile (1..99), for the reader's "your year on the apps".
{
  const cells = S.fMen.cells, pOf = (x) => Math.min(0.95, S.p0 * Math.exp(BASE.gammaSex * x.z));
  const byU = new Map();
  cells.forEach((x, i) => {
    const k = x.u; if (!byU.has(k)) byU.set(k, { w: 0, likes: 0, matches: 0, dates: 0, noDate: 0, anySex: 0 });
    const g = byU.get(k), d = F.dates[i];
    g.w += x.w; g.likes += x.w * F.perMan.likes[i]; g.matches += x.w * F.perMan.matches[i]; g.dates += x.w * d;
    g.noDate += x.w * Math.exp(-d); g.anySex += x.w * (1 - Math.exp(-d * pOf(x)));
  });
  const us = [...byU.keys()].sort((a, b) => a - b);
  const at = (u, key) => {
    let j = us.findIndex((x) => x >= u); if (j <= 0) j = 1;
    const a = byU.get(us[j - 1]), b = byU.get(us[j]), t = (u - us[j - 1]) / (us[j] - us[j - 1]);
    return (1 - t) * a[key] / a.w + t * b[key] / b.w;
  };
  out.funnelByU = [];
  for (let p = 1; p <= 99; p++) {
    const u = p / 100;
    out.funnelByU.push({ p, likes: r3(at(u, 'likes')), matches: r3(at(u, 'matches')), dates: r3(at(u, 'dates')), noDate: r4(at(u, 'noDate')), anySex: r4(at(u, 'anySex')) });
  }
  out.womenByU = F.women.map((w) => ({ v: r3(w.v), likes: r3(w.likes), matches: r3(w.matches), dates: r3(Math.min(BASE.datesW, w.matches)) }));
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
const ys = [0.1, 0.5, 0.9, 0.99].map((v) => D.zTop(1 - v));
out.commitGrid = [0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map((u) => {
  const bandX = F.byBand.find((x) => u >= x.lo && u < x.hi) ?? F.byBand.at(-1);
  const serious = C.describe(C.normalize(S.fMen.cells.filter((x) => x.u >= bandX.lo && x.u < bandX.hi))).serious;
  const blend = (y) => serious * his({ u, serious: true }, y) + (1 - serious) * his({ u, serious: false }, y);
  return { u, serious: r4(serious), commits: ys.map((y) => r4(blend(y))) };
});
out.perDate = F.byBand.map((x) => {
  const sel = (c) => c.u >= x.lo && c.u < x.hi;
  const men = S.fMen.cells.filter(sel), dated = F.datedWomen(sel);
  const W0 = men.reduce((t, c) => t + c.w, 0);
  let hc = 0;
  for (const m of men) for (const w of dated) hc += (m.w / W0) * w.w * his(m, w.z) * hers(w, m.z);
  return { lo: x.lo, hi: x.hi, p: r4(Math.min(1, BASE.evalPerYear / Math.max(x.dates, 1e-9)) * hc) };
});
out.cheating = { quintiles: gss.men.by_partner_quintile.map((q) => ({ q: q.quintile, median: q.median_partners, cheated: r4(q.cheated), n: q.n })), tiers: gss.men.notebook_tiers };

// ---------- Act V: the clock ----------
log('age');
out.age = {
  okcupid: dg.okcupid_age, geruso: dg.geruso,
  whr: inputs.pools.by_age.filter((r) => r.sex === 'women' && r.age >= 18 && r.age <= 50).map((r) => ({ age: r.age, le074: r4(r.whr_le_074), ge085: r4(r.whr_ge_085), p50: r3(r.whr_p50) })),
  censusW: S.censusW, censusM: S.censusM,
  cohortMen: [25, 30, 35, 40, 45, 50].map((age) => { const d = C.describe(S.cohortM()[age].cells); return { age, casual: r4(1 - d.serious), appeal: r4(d.zPct), quality: r4(d.qPct) }; }),
  neverMarried4049: inputs.pools.never_married_40_49,
};
out.herByAge = [22, 24, 26, 28, 30, 32, 34, 36, 38].map((start) => {
  const any = herYears({ start, bar: 0 }), good = herYears({ start }), adapt = herYears({ start, bar: 0, a: 0.15 });
  const cen = S.censusW[start + 5] != null ? 1 - S.censusW[start + 5] / S.censusW[start] : null;
  return { start, any: r4(any.odds), top10: r4(good.odds), adapt: r4(adapt.odds), census: cen == null ? null : r4(cen), interest: r4(D.curveAt(S.ok, 'women', start)) };
});

// ---------- Act VI: search ----------
log('search');
out.searchOdds = [1, 0.7, 0.5, 0.35].map((r) => ({ r, odds: [1e3, 1e4, 1e5, 2.5e5].map((N) => r4(D.findOdds({ n: 20, p: 0.01, N, r }))), median: Math.round(D.bestRarity({ n: 20, p: 0.01, r })) }));
out.tails = { traits: tails.traits, corr: tails.corr, n: tails.n };
out.herByAppeal = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99].map((v) => {
  const row = { v, any: herYears({ v, bar: 0 }).odds, top10: herYears({ v }).odds, top5: herYears({ v, bar: 0.95 }).odds, top1: herYears({ v, bar: 0.99 }).odds,
    equal: herYears({ v, bar: Math.max(v, 0.5) }).odds, noCommit: herYears({ v, commit: false }).odds };
  const f = herYears({ v });
  row.matches = f.first.matches; row.datesAppeal = f.first.zPct; row.commits = f.first.commits;
  return Object.fromEntries(Object.entries(row).map(([k, x]) => [k, typeof x === 'number' ? r4(x) : x]));
});
out.hisByAppeal = F.byBand.map((x) => {
  const sel = (c) => c.u >= x.lo && c.u < x.hi;
  const dated = F.datedWomen(sel), count = x.dates * BASE.years, n = BASE.evalPerYear * BASE.years;
  const men = S.fMen.cells.filter(sel), Wm = men.reduce((t, c) => t + c.w, 0);
  const yHim = men.reduce((t, c) => t + c.w * c.z, 0) / Wm, uHim = men.reduce((t, c) => t + c.w * c.u, 0) / Wm;
  const kept = C.keepTop(dated, count, n, { ...BASE.read2, rhoQz: BASE.rhoQz });
  const commit = (c) => hers(c, yHim) * his({ u: uHim, serious: true }, c.z);
  const odds = (bar) => { const d = C.describe(kept.cells, bar, commit); return r4(1 - Math.pow(1 - d.good, kept.count)); };
  const uMid = (x.lo + Math.min(x.hi, 0.999)) / 2;
  return { lo: x.lo, hi: x.hi, dates5y: r3(count), datesAppeal: r4(C.describe(dated).zPct), any: odds(0), top10: odds(0.9), top5: odds(0.95), top1: odds(0.99), equal: odds(Math.max(0.5, uMid)) };
});

// ---------- Act VII: playbook ----------
log('levers');
const lever = (label, o) => ({ label, any: r4(herYears({ ...o, bar: 0 }).odds), top10: r4(herYears({ ...o, bar: 0.9 }).odds), top5: r4(herYears({ ...o, bar: 0.95 }).odds), top1: r4(herYears({ ...o, bar: 0.99 }).odds) });
const tirz = appealFromWhr(glp('tirzepatide', 1).new_pct), sema = appealFromWhr(glp('semaglutide', 0).new_pct);
out.levers = [
  lever('Baseline: on the apps from 27, choosing like everyone else', { start: 27 }),
  lever('Start at 23 instead', { start: 23 }),
  lever('Open to men 10 years older', { start: 27, gap: 10 }),
  lever('Open to men 15 years older', { start: 27, gap: 15 }),
  lever('Weigh looks less', { start: 27, a: 0.15 }),
  lever('Friends\' introductions instead of the apps', { start: 27, ch: 'friends' }),
  lever('Give three men a year months of dating', { start: 27, n: 3 }),
  lever('GLP-1 (semaglutide-sized waist loss)', { start: 27, v: sema }),
  lever('GLP-1 (tirzepatide-sized) plus glute training', { start: 27, v: tirz }),
  lever('App levers combined, from 27', { start: 27, gap: 15, a: 0.15, n: 3 }),
  lever('App levers combined, from 23', { start: 23, gap: 15, a: 0.15, n: 3 }),
  lever('All of it from 23, plus tirzepatide and glutes', { start: 23, gap: 15, a: 0.15, n: 3, v: tirz }),
];
out.glp = [0.25, 0.5, 0.75].flatMap((start) => [['semaglutide', 0], ['tirzepatide', 0], ['tirzepatide', 1]].map(([drug, glute]) => {
  const g = glp(drug, glute, start), v0 = appealFromWhr(start), v1 = appealFromWhr(g.new_pct);
  return { start, drug, glute, whr: r3(g.whr), newWhr: r3(g.new_whr), newPct: r4(g.new_pct), appeal0: r4(v0), appeal1: r4(v1),
    any0: r4(herYears({ v: v0, bar: 0 }).odds), any1: r4(herYears({ v: v1, bar: 0 }).odds), top10_0: r4(herYears({ v: v0 }).odds), top10_1: r4(herYears({ v: v1 }).odds) };
}));
out.exchange = { tiers: inputs.exchange.tiers, absWorth: inputs.exchange.abs_worth, metros: inputs.exchange.metros, women: inputs.exchange.women, men: inputs.exchange.men };
out.reach = ag.reach_recent_5y;
out.gapByIncome = { recent: ag.recent_5y.bands, recent3045: ag.recent_5y_husband_30_45.bands, all: ag.all.bands };
log('options');
out.options = [0.25, 0.5, 1, 2].map((options) => ({ options, any: r4(herYears({ bar: 0, options }).odds), top10: r4(herYears({ options }).odds),
  commit90: r4(C.commitRule(S.demandM, { median: BASE.commitMedian, beta: S.rhoM, kc: S.kc, options })({ u: 0.9, serious: true }, 0)) }));
out.gapModel = [23, 27, 31].map((start) => ({ start, rows: [2, 5, 10, 15].map((gap) => ({ gap, any: r4(herYears({ start, gap, bar: 0 }).odds), top10: r4(herYears({ start, gap }).odds) })) }));

writeFileSync(new URL('../../src/data/dating/site.json', import.meta.url), JSON.stringify(out));
log(`wrote src/data/dating/site.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
