// Runs the chained dating model (src/dating/chain.js) with the calibrated parameters and sweeps
// the assumptions that matter. Writes docs/dating/results.md. Run after sensitivity.mjs (it reads
// src/data/dating/calibration.json): node scripts/dating/chain.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import * as D from '../../src/dating/model.js';
import * as C from '../../src/dating/chain.js';
import { normCdf } from '../../src/model.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = read('../../src/data/dating/digitized.json');
const pools = read('../../src/data/dating/pools.json');
const cal = read('../../src/data/dating/calibration.json');
const nsfg = read('../../src/data/dating/nsfg.json');

const pct = (v, d = 0) => (v * 100).toFixed(d) + '%';
const num = (v, d = 1) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(d));
const ord = (v) => { const n = Math.round(v * 100), s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'); return n + s; };
const band = (b) => `${ord(b.lo).replace(/(st|nd|rd|th)$/, '')}-${b.hi === 1 ? '100' : (b.hi * 100).toFixed(b.hi > 0.99 ? 1 : 0)}`;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const md = [];
const say = (...s) => md.push(...s, '');

// ---------- calibrated inputs ----------
const meanOf = (h) => D.histMean(D.histPoints(h));
const W = D.activityWeighted(D.histPoints(data.luap_like_rate_women), meanOf(data.luap_received_ratio_men)).pts;
const Mn = D.activityWeighted(D.histPoints(data.luap_like_rate_men), meanOf(data.luap_received_ratio_women)).pts;
const rhoW = cal.consensus.womenOnMen, rhoM = cal.consensus.menOnWomen;
const demandM = C.demandCurve(D.attentionMarket({ rho: rhoW, openness: W, M: 1000 }));
const demandW = C.demandCurve(D.attentionMarket({ rho: rhoM, openness: Mn, M: 1000 }));
const likeM = C.likeRateCurve(demandM, 0.33);    // men's like rate by looks (median 33%)
const likeW = C.likeRateCurve(demandW, 0.045);   // women's like rate by looks (median 4.5%)
const { b, kc, x50 } = cal.commitment;
const ok = data.okcupid_age;
const census = {};
let prev = 1;
for (const r of pools.by_age.filter((x) => x.sex === 'men')) { prev = Math.min(prev, r.never_married); census[r.age] = prev; }

// ---------- defaults, grounded where the literature allows (docs/dating/claims.md) ----------
const BASE = {
  rhoQz: 0.1,      // looks vs partner quality: Feingold (1992) r = .04 with IQ; small for adjustment
  lemon: 0.3,      // breakup odds x1.35 per SD of unseen quality: neuroticism OR 1.36 (Solomon & Jackson 2014)
  bar: 0.9,        // success = serious and top 10% on partner quality
  years: 5,        // length of the search
  evalPerYear: 2,  // people properly evaluated (months of dating) per year: n = 10 over five years
  datesW: 13,      // first dates per actively dating woman per year (NSFG: 2.8 app partners among those with any)
  activeW: 0.2,    // share of women users who actually date in a year (NSFG; luap d30 retention 15-25%)
  ratio: 1.5,      // men per woman among a year's users (Pew ever-used 58/42; NSFG totals)
  gammaSex: 1,     // dates with more-desired men more often end in sex (fits NSFG men: 3.4 partners)
  womenCasual: 0.15,
  read2: { a: 0.3, c: 0.25 },   // after a first date: strangers who have interacted, Connelly & Ones ~.2-.3
};
// Per year. a: weight of looks in the up-front read; c: weight of real quality (Connelly & Ones 2010,
// corrected self-other accuracy: strangers ~.17, coworkers ~.26, friends ~.47).
const CHANNELS = {
  app: { label: 'App', a: rhoW, c: 0.1, views: 15000 },
  friends: { label: 'Friends', a: 0.3, c: 0.45, views: 60, like: 0.2, dates: 6 },
  work: { label: 'Work', a: 0.25, c: 0.27, views: 25, like: 0.2, dates: 3 },
};

const menPop = (o = {}) => C.population({ rhoQz: o.rhoQz ?? BASE.rhoQz, casual: o.casual ?? b });
const menSingle = (o = {}) => C.singlePool(menPop(o), { demand: demandM, x50: o.x50 ?? x50, kc: o.kc ?? kc, lemon: o.lemon ?? BASE.lemon });
const womenSingle = (o = {}) => C.singlePool(C.population({ rhoQz: o.rhoQz ?? BASE.rhoQz, casual: BASE.womenCasual, nz: 61, ne: 41 }),
  { demand: demandW, x50, kc: 1, lemon: o.lemon ?? BASE.lemon });

// A woman (looks z-score y) searching men over `years`.
function womanSearch(pool, ch, o = {}) {
  const C0 = CHANNELS[ch], years = o.years ?? BASE.years, y = o.y ?? 0;
  const yEff = o.ageFactor != null && o.ageFactor < 1 ? C.shiftForFactor(pool, likeM, rhoM, y, o.ageFactor) : y;
  const dates = (ch === 'app' ? BASE.datesW : C0.dates) * years;
  return C.search(pool, {
    a: o.a ?? C0.a, c: o.c ?? C0.c, rhoQz: o.rhoQz ?? BASE.rhoQz,
    exposure: ch === 'app' ? cal.exposure.men : 0,
    likeRate: C0.like ?? likeW(normCdf(y)),
    back: C.backRule(likeM, rhoM, yEff),
    views: (o.views ?? C0.views) * years, dates, read2: o.read2 ?? BASE.read2,
    n: o.n ?? Math.round(BASE.evalPerYear * years), bar: o.bar ?? BASE.bar,
  });
}

// The two-sided app funnel for one year.
const funnelMen = menSingle();
const funnelWomen = womenSingle();
const pSex = (p0) => (x) => Math.min(0.95, p0 * Math.exp(BASE.gammaSex * x.z));
const runFunnel = (p0, o = {}) => C.appFunnel({ men: o.men ?? funnelMen.cells, women: funnelWomen.cells, a: rhoW, c: CHANNELS.app.c, rhoQz: BASE.rhoQz,
  rhoM, likeM, likeW, exposure: cal.exposure.men, datesW: BASE.datesW, activeW: o.activeW ?? BASE.activeW, ratio: o.ratio ?? BASE.ratio, pSex: pSex(p0),
  groups: [0.5, 0.75, 0.9, 0.95, 0.99] });
// p0 so the women's date-weighted sex rate gives NSFG's 2.8 partners among women with any app sex.
const targetX = (() => { let lo = 0.1, hi = 10; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (m / (1 - Math.exp(-m)) < nsfg['2022-2023_women']['18_35'].app_sex_mean_partners) lo = m; else hi = m; } return (lo + hi) / 2; })();
const p0 = (() => { let lo = 1e-4, hi = 1; for (let i = 0; i < 40; i++) { const m = Math.sqrt(lo * hi); if (runFunnel(m).womenSexRate * BASE.datesW < targetX) lo = m; else hi = m; } return Math.sqrt(lo * hi); })();
const F = runFunnel(p0);

say('# Dating model: chained results', '',
  'Generated by `node scripts/dating/chain.mjs` from `src/data/dating/calibration.json`, `nsfg.json` and `pools.json`.',
  'One grid of people (looks z, partner quality Q, serious or casual) runs through demand → who is single → likes →',
  'matches → first dates → proper evaluation → outcomes. Everyone\'s bar rises with their options (men\'s median like rate',
  '33%, women\'s 4.5%). Defaults are grounded in the literature where possible (see the list at the end); each is swept.');

// ---------- A. The men's funnel ----------
const fnRows = F.byBand.map((x) => [band(x), pct(x.share, 1), num(x.likes, 0), num(x.matches, 0), num(x.dates, 1), pct(x.noDate), pct(x.anySex), num(x.partnersIfAny, 1)]);
fnRows.push(['All single men on apps', '100%', num(F.all.likes, 0), num(F.all.matches, 0), num(F.all.dates, 1), pct(F.all.noDate), pct(F.all.anySex), num(F.all.partnersIfAny, 1)]);
const ns = nsfg['2022-2023_men']['18_35'];
say('## A. A year on the apps, for men', '',
  `Women decide who gets dates: each actively dating woman (${pct(BASE.activeW)} of women users) has ${BASE.datesW} first dates a year and gives them to`,
  `the best-looking of her matches. ${BASE.ratio} men per woman over a year. A date ends in sex with a chance that rises with his looks, fitted so`,
  `women with any app sex have ${nsfg['2022-2023_women']['18_35'].app_sex_mean_partners.toFixed(1)} partners (NSFG 2022-23). Bands are looks percentiles among all men; single men skew plain because`,
  'attractive men pair off.');
say(table(['His looks', 'Share of single men', 'Likes received', 'Matches', 'First dates', 'No date all year', 'Any sex from apps', 'Partners if any'], fnRows));
say(`The top 10% of men get ${pct(F.topDates.top10)} of all first dates and the top 20% get ${pct(F.topDates.top20)}.`,
  `Checks against data: NSFG 2022-23, straight single men 18-35: ${pct(ns.single_partners_share['0'])} had no partner at all last year, ${pct(ns.app_sex_single, 1)} had sex with`,
  `someone met online, and those who did had ${ns.app_sex_mean_partners.toFixed(1)} partners (model: ${num(F.all.partnersIfAny, 1)}). The model's ${pct(F.all.anySex)} of male app users implies about`,
  `${pct(ns.app_sex_single / F.all.anySex)} of single men 18-35 used apps in the year. Top 10% of single men hold ${pct(ns.single_top10_share_of_partners)} of all their partners (NSFG).`);
const nyc = F.byBand.find((x) => x.lo === 0.95);
say(`The NYC Hinge funnel (a man receiving 2,031 likes): 345 matches → 57 meetup attempts (17% of matches). The model's`,
  `95th-99th band receives ${num(nyc.likes, 0)} likes, ${num(nyc.matches, 0)} matches and ${num(nyc.dates, 1)} first dates a year (${pct(nyc.dates / nyc.matches, 1)} of matches). Among matches with`,
  `women who are actually dating that year it converts ${pct(nyc.dates / (nyc.matches * BASE.activeW))}, close to the funnel's 17%; the rest of his matches are women who browse,`,
  'swipe and chat but do not date. The top 1% band is a model tail (his date-to-sex rate is near its cap); treat it as illustrative.');
const wfRows = F.women.filter((_, i) => [1, 4, 7, 10, 13].includes(i)).map((w) => [ord(w.v), num(w.likes, 0), num(w.matches, 0), num(Math.min(BASE.datesW, w.matches), 0)]);
say('Women (actively dating), for contrast:');
say(table(['Her looks', 'Likes she sends', 'Matches', 'First dates (capacity 13)'], wfRows));

// ---------- B. Looks don't help ----------
const n5 = Math.round(BASE.evalPerYear * BASE.years);
const wRows = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99].map((v) => {
  const x = womanSearch(menSingle().cells, 'app', { y: D.zTop(1 - v) });
  return [ord(v), num(x.matches, 0), pct(x.keepShare, 1), ord(x.datedPool.zPct), pct(x.datedPool.serious), pct(x.serious), ord(x.qPct), pct(x.odds)];
});
say('## B. Looks do not help you find a good partner', '',
  `Five years of searching, ${BASE.datesW * BASE.years} first dates, ${n5} people properly evaluated (the best ${n5} by what a first date shows).`,
  'Women: more looks means more matches, a harsher filter on his looks, and men who are less often serious. The odds',
  'of ending up with a serious top-10% man barely move.');
say(table(['Her looks', 'Matches', 'Share she dates', 'Looks of men she dates', 'Serious (dated)', 'Serious (evaluated)', 'Quality (evaluated)', 'Odds'], wRows));
const mRows = F.byBand.map((x) => {
  const sel = (c) => c.u >= x.lo && c.u < x.hi;
  const dated = F.datedWomen(sel);
  const years = BASE.years, count = x.dates * years;
  const kept = C.keepTop(dated, count, n5, { ...BASE.read2, rhoQz: BASE.rhoQz });
  const d = C.describe(kept.cells, BASE.bar);
  const odds = 1 - Math.pow(1 - d.good, kept.count);
  return [band(x), num(count, 1), ord(C.describe(dated).zPct), ord(d.qPct), pct(odds)];
});
say('Men: looks buy dates, and dates buy odds, but only up to the point where he has more dates than he can evaluate.',
  'Past that, more looks means more choice on her looks, not on what matters.');
say(table(['His looks', 'First dates in 5 years', 'Looks of women who date him', 'Quality (evaluated)', 'Odds of a serious top-10% woman'], mRows));

// ---------- C. Who is left and who she dates ----------
const single = menSingle();
const res = { app: womanSearch(single.cells, 'app'), friends: womanSearch(single.cells, 'friends'), work: womanSearch(single.cells, 'work') };
const rowsC = [];
const addC = (label, d) => rowsC.push([label, pct(d.serious), ord(d.zPct), ord(d.qPct), pct(d.good, 1)]);
addC('All men', C.describe(menPop().cells));
addC(`Single men (${pct(single.singleShare)} of men)`, C.describe(single.cells));
addC('Single men, no lemon effect', C.describe(menSingle({ lemon: 0 }).cells));
addC('Men she first-dates (app)', res.app.datedPool);
addC('Men she evaluates (app)', res.app);
addC('Men she evaluates (friends)', res.friends);
addC('Men she evaluates (work)', res.work);
say('## C. Who is left, and who she ends up with', '', 'Median woman, five years. Looks and quality percentiles are against all men.');
say(table(['Group', 'Serious', 'Looks', 'Quality', 'Serious and top-10% quality'], rowsC));

// ---------- D. Channels ----------
const chRows = [];
for (const rhoQz of [0, 0.1, 0.2]) for (const lemon of [0, 0.3]) for (const years of [1, 5]) {
  const pool = menSingle({ rhoQz, lemon }).cells;
  const r = ['app', 'friends', 'work'].map((ch) => womanSearch(pool, ch, { rhoQz, years }));
  chRows.push([rhoQz, lemon, years, ...r.map((x) => `${pct(x.odds)} (${x.evaluated.toFixed(1)} × ${pct(x.good, 1)})`)]);
}
say('## D. Channels', '',
  'Odds of properly evaluating a serious, top-10% man (people evaluated × hit rate). Reads from Connelly & Ones: a friend',
  'who knows him (.45) beats a coworker (.27) beats a profile (.10). Friends supply ~6 first dates a year, work ~3.');
say(table(['Looks-quality ρ', 'Lemon', 'Years', 'App', 'Friends', 'Work'], chRows));
const readRows = [0.05, 0.1, 0.2, 0.3].map((c) => { const x = womanSearch(single.cells, 'app', { c }); return [c, pct(x.serious), ord(x.qPct), pct(x.odds)]; });
say('How much real quality an app profile shows (c):');
say(table(['c', 'Serious', 'Quality', 'Odds'], readRows));
const r2Rows = [0.15, 0.25, 0.4].map((c2) => { const x = womanSearch(single.cells, 'app', { read2: { a: 0.3, c: c2 } }); return [c2, pct(x.serious), ord(x.qPct), pct(x.odds)]; });
say('How much a first date shows (c after the date):');
say(table(['c after date', 'Serious', 'Quality', 'Odds'], r2Rows));

// ---------- E. Her age ----------
const coh = (theta) => C.cohort(menPop(), { demand: demandM, kc, theta, census });
const cohorts = { 0: coh(0), 0.3: coh(0.3) };
const ageRows = [22, 25, 28, 30, 33, 35, 38, 40].map((age) => {
  const af = D.curveAt(ok, 'women', age);
  const pool = cohorts[0][Math.min(60, age + 2)].cells;
  const o = { ageFactor: af, years: 2 };
  const x = womanSearch(pool, 'app', o), xq = womanSearch(cohorts[0.3][Math.min(60, age + 2)].cells, 'app', o), hot = womanSearch(pool, 'app', { ...o, y: 1 });
  return [age, pct(af), num(x.matches, 0), pct(x.pool.serious), pct(x.serious), pct(x.odds), pct(hot.odds), pct(xq.odds), pct(D.fecundityUsed(data.geruso, age, 20))];
});
say('## E. Her age', '',
  'A two-year search starting at each age. Her pool is never-married men two years older (section G). Interest in her falls',
  'with age (OkCupid), applied as a shift in her looks so the men with the most options drop away first.');
say(table(['Her age', 'Interest vs peak', 'Matches', 'Pool serious', 'Serious (evaluated)', 'Odds (median)', 'Odds (top 16%)', 'Odds (θ = 0.3)', 'Fecundity used'], ageRows));

// ---------- F. The top man ----------
const wS = womenSingle();
const topMan = (c, bar) => C.search(wS.cells, { a: Math.min(rhoM, Math.sqrt(1 - c * c) * 0.9), c, rhoQz: BASE.rhoQz, exposure: cal.exposure.women,
  likeRate: likeM(0.999), back: C.backRule(likeW, rhoW, D.zTop(0.001)), views: 15000 * 5, dates: 150 * 5, read2: BASE.read2, n: 20, bar });
const cRows = [0.1, 0.3, 0.5, 0.7].map((c) => [c, pct(topMan(c, 0.999).odds, 1), pct(topMan(c, 0.9999).odds, 1), pct(topMan(c, 0.999996).odds, 2)]);
say('## F. The top man', '',
  'The 99.9th-percentile man, five years, three first dates a week, 20 women properly evaluated, by how much real quality',
  'his up-front read picks up (c). The author\'s table assumes a perfect read of a top-1% pool: 88% / 18% / 0.8%.');
say(table(['Up-front c', '1 in 1k', '1 in 10k', '1 in 250k'], cRows));

// ---------- G. Never-married men ----------
const cohRows = [];
for (const theta of [0, 0.3]) for (const age of [25, 30, 35, 40, 45, 50]) {
  const d = C.describe(cohorts[theta][age].cells);
  cohRows.push([theta, age, pct(cohorts[theta][age].never), pct(1 - d.serious), ord(d.zPct), ord(d.qPct), pct(d.good, 1)]);
}
say('## G. Never-married men by age', '',
  'Frailty model fitted to the census never-married curve at every age; the output is who is left. Propensity = intent',
  '(casual men at k_c) × demand from looks × e^(θQ).');
say(table(['θ', 'Age', 'Never married (census)', 'Casual', 'Looks', 'Quality', 'Serious and top-10% quality'], cohRows));
const nm = pools.never_married_40_49;
say(`Census check (men 40-49, never vs ever married): median earnings $${Math.round(nm.men_never.median_earnings / 1000)}k vs $${Math.round(nm.men_ever.median_earnings / 1000)}k, BA+ ${pct(nm.men_never.ba_plus)} vs ${pct(nm.men_ever.ba_plus)}.`);

// ---------- H. What moves her odds ----------
const base = res.app.odds;
const at = (fn) => fn().odds;
const pickAge = (age) => parseFloat(ageRows.find((r) => r[0] === age)[5]) / 100;
const tornado = [
  ['Looks-quality ρ 0 → 0.2', at(() => womanSearch(menSingle({ rhoQz: 0 }).cells, 'app', { rhoQz: 0 })), at(() => womanSearch(menSingle({ rhoQz: 0.2 }).cells, 'app', { rhoQz: 0.2 }))],
  ['Lemon effect 0 → 0.46', at(() => womanSearch(menSingle({ lemon: 0 }).cells, 'app')), at(() => womanSearch(menSingle({ lemon: 0.46 }).cells, 'app'))],
  ['Casual pair-off rate k_c 0 → 0.2', at(() => womanSearch(menSingle({ kc: 0 }).cells, 'app')), at(() => womanSearch(menSingle({ kc: 0.2 }).cells, 'app'))],
  ['Quality shown in profile c 0.05 → 0.2', at(() => womanSearch(single.cells, 'app', { c: 0.05 })), at(() => womanSearch(single.cells, 'app', { c: 0.2 }))],
  ['Quality shown on a first date 0.15 → 0.4', at(() => womanSearch(single.cells, 'app', { read2: { a: 0.3, c: 0.15 } })), at(() => womanSearch(single.cells, 'app', { read2: { a: 0.3, c: 0.4 } }))],
  ['People evaluated n 4 → 20', at(() => womanSearch(single.cells, 'app', { n: 4 })), at(() => womanSearch(single.cells, 'app', { n: 20 }))],
  ['Her looks median → top 1%', base, at(() => womanSearch(single.cells, 'app', { y: D.zTop(0.01) }))],
  ['Her age 25 → 35 (two-year search)', pickAge(25), pickAge(35)],
].map(([k, lo, hi]) => [k, pct(lo), pct(hi), `${((hi - lo) * 100).toFixed(0)} pts`]);
say('## H. What moves her odds most', '', `Median woman, five years on an app, default odds ${pct(base)}. Each row moves one assumption.`);
say(table(['Assumption', 'Low', 'High', 'Swing'], tornado));

say('## Defaults and where they come from', '',
  '- Looks-quality correlation 0.1: Feingold (1992), attractiveness vs intelligence r = .04 in adults; Langlois et al. (2000), small positive links to adjustment and social skills.',
  '- Reads of real quality: Connelly & Ones (2010), corrected self-other accuracy averaged over the Big Five: strangers ~.17, coworkers ~.26, friends ~.47, cohabitants ~.48, family ~.57. Profile 0.1, after a first date 0.25, friend introduction 0.45, coworker 0.27.',
  '- Lemon effect 0.3 (breakup odds ×1.35 per SD of unseen quality): Solomon & Jackson (2014, HILDA), neuroticism OR 1.36, conscientiousness 0.88, agreeableness 0.91 per unit; Karney & Bradbury (1995), neuroticism the most consistent predictor.',
  `- Dating activity: NSFG 2022-23 (women with any app sex average ${nsfg['2022-2023_women']['18_35'].app_sex_mean_partners.toFixed(1)} app partners → ~2.6 per active dater; ~20% of women users date in a year), luap d30 retention 15-25%, Pew ever-used 58/42.`,
  '- Consensus, exposure, commitment filter: fitted in `docs/dating/sensitivity.md`.');

writeFileSync(new URL('../../docs/dating/results.md', import.meta.url), md.join('\n'));
console.log('wrote docs/dating/results.md');
