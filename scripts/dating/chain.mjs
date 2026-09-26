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
const band = (b) => `${Math.round(b.lo * 100)}-${b.hi === 1 ? '100' : (b.hi * 100).toFixed(b.hi > 0.99 ? 1 : 0)}`;
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
const likeM = C.likeRateCurve(demandM, 0.33);    // men's like rate by appeal (median 33%)
const likeW = C.likeRateCurve(demandW, 0.045);   // women's like rate by appeal (median 4.5%)
const { b, kc, x50 } = cal.commitment;
const ok = data.okcupid_age;
const neverMarried = (sex) => { const out = {}; let p = 1; for (const r of pools.by_age.filter((x) => x.sex === sex)) { p = Math.min(p, r.never_married); out[r.age] = p; } return out; };
const censusM = neverMarried('men'), censusW = neverMarried('women');

// ---------- defaults, grounded where the literature allows (docs/dating/claims.md) ----------
const BASE = {
  rhoQz: 0.1,        // appeal vs partner quality: Feingold (1992) r = .04 with IQ
  lemon: 0.3,        // breakup odds x1.35 per SD of unseen quality (Solomon & Jackson 2014)
  commitMedian: 0.2, // a serious median man commits to a median woman he has dated for months; fitted to the census 25 -> 30
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
const ex = read('../../src/data/dating/exchange.json');
// Her appeal percentile after a WHR change, other traits at the median: z = bodyShare * z_WHR.
const appealFromWhr = (whrPct, share = BASE.bodyShare) => normCdf(share * D.zTop(1 - whrPct));
const glp = (drug, glute, start = 0.5, hipShare = 0.5) => ex.glp1.find((g) => g.drug === drug && g.glute_in === glute && Math.abs(g.start_pct - start) < 1e-6 && g.hip_share === hipShare);
const CHANNELS = {
  app: { label: 'App', a: rhoW, c: 0.1, views: 15000 },
  friends: { label: 'Friends', a: 0.3, c: 0.45, views: 60, like: 0.2, dates: 6 },
  work: { label: 'Work', a: 0.25, c: 0.27, views: 25, like: 0.2, dates: 3 },
};

const menPop = (o = {}) => C.population({ nz: 61, ne: 61, rhoQz: o.rhoQz ?? BASE.rhoQz, casual: o.casual ?? b });
const menSingle = (o = {}) => C.singlePool(menPop(o), { demand: demandM, x50, kc: o.kc ?? kc, lemon: o.lemon ?? BASE.lemon });
const womenPop = (o = {}) => C.population({ nz: 61, ne: 41, rhoQz: o.rhoQz ?? BASE.rhoQz, casual: BASE.womenCasual });
const womenSingle = (o = {}) => C.singlePool(womenPop(o), { demand: demandW, x50, kc: 1, lemon: o.lemon ?? BASE.lemon });
const hisCommit = (o = {}) => C.commitRule(demandM, { median: o.commitMedian ?? BASE.commitMedian, beta: rhoM, kc: o.kc ?? kc, options: o.options ?? 1 });
const herCommit = (o = {}) => C.commitRule(demandW, { median: o.commitMedian ?? BASE.commitMedian, beta: rhoW, kc, options: o.options ?? 1 });

// Never-married cohorts (frailty model fitted to the census at every age).
const cohortCache = new Map();
const cohortM = (o = {}) => {
  const key = JSON.stringify([o.rhoQz ?? BASE.rhoQz, o.kc ?? kc, o.theta ?? 0]);
  if (!cohortCache.has(key)) cohortCache.set(key, C.cohort(menPop(o), { demand: demandM, kc: o.kc ?? kc, theta: o.theta ?? 0, census: censusM }));
  return cohortCache.get(key);
};

// Single men at age M: never married (cohort) plus previously married and single again, in census
// proportions. Cached per assumption set.
const singleCache = new Map();
const menSingleC = (o = {}) => {
  const key = JSON.stringify([o.rhoQz ?? BASE.rhoQz, o.kc ?? kc, o.lemon ?? BASE.lemon]);
  if (!singleCache.has(key)) singleCache.set(key, menSingle(o));
  return singleCache.get(key);
};
const menAt = (sex, age) => pools.by_age.find((r) => r.sex === sex && r.age === Math.min(70, age));
const poolAt = (M, o = {}) => {
  const r = menAt('men', M);
  return C.singleAtAge(menPop(o), cohortM(o)[Math.min(60, M)], menSingleC(o), { neverShare: r.single_never, prevShare: r.single_prev });
};
// A man's options fall with his age: the share of women whose age range includes him (OkCupid men's
// curve), relative to a 29-year-old.
const menOptionsAt = (M) => D.curveAt(ok, 'men', Math.min(M, 48)) / D.curveAt(ok, 'men', 29);

// A woman at appeal percentile v searching for `years` from age `start`. Each year: her pool is
// never-married men two years older, men's interest in her is at that age's OkCupid level (a shift in
// her appeal, so the men with the most options drop away first), she likes and dates by her read,
// properly dates the best two by what a first date shows, and succeeds if one is above the quality
// bar and commits to her. Years are independent tries.
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
      // Both must commit: he to her (his bar, her appeal at this age) and she to him (her bar, set by her
      // options at this age, and his appeal).
      n: o.n ?? BASE.evalPerYear, bar, commit: commit ? (cell) => his(cell, y) * hers({ u: normCdf(y), serious: true }, cell.z) : null,
    });
    miss *= 1 - r.odds;
    rows.push({ age, ...r });
  }
  return { odds: 1 - miss, rows, first: rows[0], last: rows[rows.length - 1] };
}

// Commitment strength: the median-to-median chance that fits the census share of never-married women
// who marry between 25 and 30, for a woman on an app choosing like the app-wide consensus.
{
  const target = 1 - censusW[30] / censusW[25];
  let lo = 0.05, hi = 0.95;
  for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (herYears({ bar: 0, commitMedian: m }).odds < target) lo = m; else hi = m; }
  BASE.commitMedian = +((lo + hi) / 2).toFixed(3);
}

// ---------- the app funnel (one year, both sides) ----------
const fMen = menSingle(), fWomen = womenSingle();
const pSex = (p0) => (x) => Math.min(0.95, p0 * Math.exp(BASE.gammaSex * x.z));
const runFunnel = (p0) => C.appFunnel({ men: fMen.cells, women: fWomen.cells, a: rhoW, c: CHANNELS.app.c, rhoQz: BASE.rhoQz, rhoM, likeM, likeW,
  exposure: cal.exposure.men, datesW: BASE.datesW, activeW: BASE.activeW, ratio: BASE.ratio, pSex: pSex(p0), groups: [0.5, 0.75, 0.9, 0.95, 0.99] });
const targetX = (() => { let lo = 0.1, hi = 10; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (m / (1 - Math.exp(-m)) < nsfg['2022-2023_women']['18_35'].app_sex_mean_partners) lo = m; else hi = m; } return (lo + hi) / 2; })();
const p0 = (() => { let lo = 1e-4, hi = 1; for (let i = 0; i < 40; i++) { const m = Math.sqrt(lo * hi); if (runFunnel(m).womenSexRate * BASE.datesW < targetX) lo = m; else hi = m; } return Math.sqrt(lo * hi); })();
const F = runFunnel(p0);
const his = hisCommit(), hers = herCommit();

say('# Dating model: chained results', '',
  'Generated by `node scripts/dating/chain.mjs` from `src/data/dating/calibration.json`, `nsfg.json` and `pools.json`.',
  'One grid of people (appeal z: what a swipe measures, looks plus height, job and photos; partner quality Q; serious or',
  'casual) runs through demand → who is single → likes → matches → first dates → months of dating → commitment. Both sides',
  'have bars that rise with their options: for liking a profile (men\'s median 33%, women\'s 4.5%) and for committing.',
  'Defaults are grounded where possible (list at the end); each is swept.');

// ---------- A. Men's year on the apps ----------
const fnRows = F.byBand.map((x) => [band(x), pct(x.share, 1), num(x.likes, 0), num(x.matches, 0), num(x.dates, 1), pct(x.noDate), pct(x.anySex), num(x.partnersIfAny, 1)]);
fnRows.push(['All single men on apps', '100%', num(F.all.likes, 0), num(F.all.matches, 0), num(F.all.dates, 1), pct(F.all.noDate), pct(F.all.anySex), num(F.all.partnersIfAny, 1)]);
const ns = nsfg['2022-2023_men']['18_35'];
say('## A. A year on the apps, for men', '',
  `Each actively dating woman (${pct(BASE.activeW)} of women users) has ${BASE.datesW} first dates a year and gives them to the best-reading of her matches;`,
  `${BASE.ratio} men per woman over a year. Date-to-sex rises with his appeal, fitted to NSFG 2022-23. Bands are appeal percentiles among all men.`);
say(table(['His appeal', 'Share of single men', 'Likes received', 'Matches', 'First dates', 'No date all year', 'Any sex from apps', 'Partners if any'], fnRows));
const nyc = F.byBand.find((x) => x.lo === 0.75);
say(`The top 10% of men get ${pct(F.topDates.top10)} of first dates, the top 20% ${pct(F.topDates.top20)}. NSFG 2022-23 (straight single men 18-35): ${pct(ns.single_partners_share['0'])} had no partner`,
  `last year; those with app sex had ${ns.app_sex_mean_partners.toFixed(1)} partners (model ${num(F.all.partnersIfAny, 1)}); the top 10% hold ${pct(ns.single_top10_share_of_partners)} of partners.`,
  `Lana Li's Hinge data (a 35-year-old NYC founder, three years): ~680 likes, ~115 matches and ~19 meetup attempts a year. The model's 75th-90th band:`,
  `${num(nyc.likes, 0)} likes, ${num(nyc.matches, 0)} matches, ${num(nyc.dates, 1)} first dates; among matches with women dating that year it converts ${pct(nyc.dates / (nyc.matches * BASE.activeW))}`,
  '(his 17%). The model under-counts meetups for a man like him; a denser, more active city would raise activeW.');

// ---------- B. Will he commit? ----------
const commitRows = [0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map((u) => {
  const cell = { u, serious: true }, casual = { u, serious: false };
  const bandX = F.byBand.find((x) => u >= x.lo && u < x.hi) ?? F.byBand[F.byBand.length - 1];
  const seriousShare = C.describe(C.normalize(fMen.cells.filter((x) => x.u >= bandX.lo && x.u < bandX.hi))).serious;
  const blend = (y) => seriousShare * his(cell, y) + (1 - seriousShare) * his(casual, y);
  return [ord(u), pct(seriousShare), pct(blend(D.zTop(0.9))), pct(blend(0)), pct(blend(D.zTop(0.1))), pct(blend(D.zTop(0.01)))];
});
say('## B. Will he commit to her?', '',
  'Chance a single man on the apps commits to a woman after months of dating her, by his appeal and hers. "Says serious" is his stated',
  `intent on the app (the commitment filter, calibrated to luap); commitment also needs her to clear his bar, which rises with his options.`,
  `A serious median man commits to a median woman ${pct(BASE.commitMedian)} of the time (and she to him), fitted so a median woman on an app has the`,
  `census chance of marrying between 25 and 30 (${pct(1 - censusW[30] / censusW[25])}) when both must commit.`);
say(table(['His appeal', 'Says serious', 'Commits: her 10th', 'Her 50th', 'Her 90th', 'Her 99th'], commitRows));

// Still single after N first dates (the author's screenshot, with modeled rates).
const perDate = F.byBand.map((x) => {
  const sel = (c) => c.u >= x.lo && c.u < x.hi;
  const men = fMen.cells.filter(sel), dated = F.datedWomen(sel);
  const W0 = men.reduce((t, c) => t + c.w, 0);
  // His commitment to the women who date him, and theirs to him, averaged over both.
  let hc = 0;
  for (const m of men) for (const w of dated) hc += (m.w / W0) * w.w * his(m, w.z) * hers(w, m.z);
  const evalShare = Math.min(1, BASE.evalPerYear / Math.max(x.dates, 1e-9));
  return { x, p: evalShare * hc };
});
const Ns = [1, 2, 4, 6, 8, 10, 15, 20, 30, 50];
const sRows = Ns.map((N) => [N, pct(Math.pow(0.6, N)), pct(Math.pow(0.5, N)), ...perDate.map(({ p }) => pct(Math.pow(1 - p, N)))]);
say('Chance a man is still single after N first dates. The first two columns are the author\'s check (40% and 50% per woman);',
  'the rest use the model: a first date becomes months of dating only if it is among his best two a year, then both must commit.');
say(table(['First dates', 'At 40%', 'At 50%', ...perDate.map(({ x, p }) => `${band(x)} (${pct(p, 1)} per date)`)], sRows));

// ---------- C. Her search, by her appeal ----------
const vs = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99];
const herRows = vs.map((v) => {
  const any = herYears({ v, bar: 0 }), good = herYears({ v }), t5 = herYears({ v, bar: 0.95 }), t1 = herYears({ v, bar: 0.99 });
  const equal = herYears({ v, bar: Math.max(v, 0.5) }), noC = herYears({ v, commit: false });
  return [ord(v), num(good.first.matches, 0), ord(good.first.zPct), pct(good.first.commits), pct(any.odds), pct(good.odds), pct(t5.odds, 1), pct(t1.odds, 1), pct(equal.odds), pct(noC.odds)];
});
say('## C. Her search, by her appeal', '',
  'Five years from 25, on an app, two men properly dated a year. Success = a serious man who commits to her; "top 10%" adds a quality',
  'bar; "her equal" asks for a man at least as rare on quality as she is on appeal. The last column drops the commitment step (the',
  'previous version of this model): without it, a 10th-percentile woman looked as well off as a 99th.');
say(table(['Her appeal', 'Matches (yr 1)', 'Appeal of men she dates', 'Both commit (per man dated for months)', 'Any committed man', 'Committed top-10% man', 'Top 5%', 'Top 1%', 'Committed man her equal (at least median)', 'No commitment step'], herRows));
say('More appeal helps her get commitment, but far less than it helps her get attention: a 99th-percentile woman is 1 in 100 and',
  'still finds a man of her rarity who commits in a minority of five-year searches.');

// ---------- D. Strategy: how much she swipes on looks ----------
const aRows = [rhoW, 0.3, 0.15, 0].map((a) => {
  const x25 = herYears({ a, bar: 0 }), x30 = herYears({ a, bar: 0, start: 30 }), g = herYears({ a });
  return [a.toFixed(2), ord(x25.first.zPct), pct(x25.first.commits), pct(x25.odds), pct(x30.odds), pct(g.odds)];
});
say('## D. Swiping on looks costs her commitment', '',
  'Median woman. a = how much appeal drives who she likes and dates (0.48 is the app-wide consensus). The best-looking men have the most',
  `options and commit least. Census check: of never-married women, ${pct(1 - censusW[30] / censusW[25])} marry between 25 and 30 and ${pct(1 - censusW[35] / censusW[30])} between 30 and 35.`);
say(table(['a', 'Appeal of men she dates', 'They commit', 'Any committed man 25-30', 'Any committed man 30-35', 'Committed top-10% man 25-30'], aRows));
say('At the app-wide weight the model matches 25-30 (by construction) and falls short at 30-35; the census rate for 30-35 needs a much',
  'lower weight on looks. Read the other way: the women who marry in their thirties are the ones choosing on something other than looks.',
  'The model also leaves out what else changes in the thirties: divorced and older men in the pool, offline channels, and lower bars.');

// ---------- E. Her age ----------
const ageRows = [22, 25, 28, 30, 33, 35, 38].map((start) => {
  const any = herYears({ start, bar: 0 }), good = herYears({ start }), adapt = herYears({ start, bar: 0, a: 0.15 });
  const cen = censusW[start + 5] != null ? 1 - censusW[start + 5] / censusW[start] : null;
  return [start, pct(D.curveAt(ok, 'women', start)), pct(any.first.pool.serious), pct(any.odds), pct(adapt.odds), cen != null ? pct(cen) : '', pct(good.odds), pct(D.fecundityUsed(data.geruso, start + 5, 20))];
});
say('## E. Her age', '',
  'Median woman, five-year search starting at each age; each year her pull declines (OkCupid) and her pool is the single men two',
  'years older (never married plus divorced, in census proportions), who are more often casual as they age (section H). Census = share of never-married women that age who marry in the',
  'next five years (cross-section).');
say(table(['Start age', 'Interest vs peak', 'Pool says serious', 'Any committed man', 'Same, choosing less on looks (a = 0.15)', 'Census', 'Committed top-10% man', 'Fecundity used by end'], ageRows));

// ---------- F. His search ----------
const wS = womenSingle();
const manRows = F.byBand.map((x) => {
  const sel = (c) => c.u >= x.lo && c.u < x.hi;
  const dated = F.datedWomen(sel), count = x.dates * BASE.years, n = BASE.evalPerYear * BASE.years;
  const men = fMen.cells.filter(sel), Wm = men.reduce((t, c) => t + c.w, 0);
  const yHim = men.reduce((t, c) => t + c.w * c.z, 0) / Wm;
  const kept = C.keepTop(dated, count, n, { ...BASE.read2, rhoQz: BASE.rhoQz });
  const uHim = men.reduce((t, c) => t + c.w * c.u, 0) / Wm;
  const commitHer = (c) => hers(c, yHim) * his({ u: uHim, serious: true }, c.z);   // both must commit (he is searching, so serious)
  const d10 = C.describe(kept.cells, 0.9, commitHer), d0 = C.describe(kept.cells, 0, commitHer);
  const d5 = C.describe(kept.cells, 0.95, commitHer), d1 = C.describe(kept.cells, 0.99, commitHer);
  const uMid = (x.lo + Math.min(x.hi, 0.999)) / 2;
  const dEq = C.describe(kept.cells, Math.max(0.5, uMid), commitHer);
  const odds = (d) => 1 - Math.pow(1 - d.good, kept.count);
  return [band(x), num(count, 1), ord(C.describe(dated).zPct), pct(d0.commits), pct(odds(d0)), pct(odds(d10)), pct(odds(d5), 1), pct(odds(d1), 1), pct(odds(dEq))];
});
say('## F. His search, by his appeal', '',
  'Five years, the first dates the funnel gives him, the best 10 of them properly dated, success if both commit (her bar rises with her',
  'options, his with his). "His equal" asks for a woman at least as rare on quality as he is on appeal (at least median).');
say(table(['His appeal', 'First dates in 5 years', 'Appeal of women who date him', 'Both commit (per woman dated for months)', 'Any committed woman', 'Committed top-10% woman', 'Top 5%', 'Top 1%', 'Committed woman his equal'], manRows));

// ---------- G. Channels ----------
const chRows = [];
for (const rhoQz of [0, 0.1, 0.2]) for (const lemon of [0, 0.3]) {
  const pool = menSingle({ rhoQz, lemon }).cells;
  const r = ['app', 'friends', 'work'].map((ch) => herYears({ ch, rhoQz, pool }));
  chRows.push([rhoQz, lemon, ...r.map((x) => `${pct(x.odds)} (${pct(x.first.commits)} commit)`)]);
}
say('## G. Channels', '',
  'Median woman, five years from 25, committed top-10% man. Pools here are the stationary single pool. Reads from Connelly & Ones:',
  'a friend who knows him (.45), a coworker (.27), a profile (.10); friends supply ~6 first dates a year, work ~3.');
say(table(['Appeal-quality ρ', 'Lemon', 'App', 'Friends', 'Work'], chRows));

// ---------- H. Never-married men ----------
const cohRows = [];
for (const theta of [0, 0.3]) for (const age of [25, 30, 35, 40, 45]) {
  const d = C.describe(cohortM({ theta })[age].cells);
  cohRows.push([theta, age, pct(censusM[age]), pct(1 - d.serious), ord(d.zPct), ord(d.qPct)]);
}
say('## H. Never-married men by age', '', 'Frailty model fitted to the census never-married curve at every age; the output is who is left.');
say(table(['θ (quality helps marriage)', 'Age', 'Never married (census)', 'Casual', 'Appeal', 'Quality'], cohRows));

// ---------- I. More options, less commitment ----------
const optRows = [0.25, 0.5, 1, 2].map((options) => {
  const x = herYears({ bar: 0, options }), g = herYears({ options });
  const c50 = C.commitRule(demandM, { median: BASE.commitMedian, beta: rhoM, kc, options })({ u: 0.9, serious: true }, 0);
  return [`× ${options}`, pct(c50), pct(x.odds), pct(g.odds)];
});
say('## I. Options and commitment', '',
  'Everyone\'s options scaled at once (apps multiplied them). Bars rise with options, so commitment falls even though nobody changed.',
  'Women born in the 1940s were 89% married by 30; the 1980s cohort 58%, the 1990s ~52% (cohort chart).');
say(table(['Options vs today', 'A 90th-percentile serious man commits to a median woman', 'Median woman: any committed man in 5 years', 'Committed top-10% man'], optRows));

// ---------- K. Age gaps ----------
const gapRows = [];
for (const start of [23, 25, 27, 29, 31, 35]) for (const gap of [2, 5, 10, 15]) {
  const any = herYears({ start, gap, bar: 0 }), good = herYears({ start, gap }), t5 = herYears({ start, gap, bar: 0.95 }), t1 = herYears({ start, gap, bar: 0.99 });
  gapRows.push([start, `+${gap}`, pct(menOptionsAt(start + gap)), pct(any.first.pool.serious), pct(any.first.commits), pct(any.odds), pct(good.odds), pct(t5.odds, 1), pct(t1.odds, 1)]);
}
const ag = read('../../src/data/dating/agegap.json');
say('## K. Age gaps', '',
  'Median woman, five years, searching single men `gap` years older (never married plus divorced, in census proportions). Men\'s options',
  'fall with age (OkCupid: the share of women whose age range includes them), so older men\'s bars are lower; men of every age find',
  'women in their early twenties most attractive (Rudder), so her appeal to them does not fall with the gap.');
say(table(['Her age', 'Gap', 'His options vs a 29-year-old', 'Pool says serious', 'Both commit (per man)', 'Any committed man', 'Committed top-10% man', 'Top 5%', 'Top 1%'], gapRows));
say('This is the model, which has no income that grows with a man\'s age; the empirical reach table below is the evidence on status.');
const reach = ag.reach_recent_5y;
const reachRows = [...new Set(reach.map((x) => x.wife_age))].map((wa) => {
  const row = (g) => reach.find((x) => x.wife_age === wa && x.gap === g);
  const a = row('under 2'), b = row('5-9'), c = row('10+');
  const f = (x) => `${pct(x.top10, 1)} / ${pct(x.top5, 1)} / ${pct(x.top1, 2)}`;
  return [wa, f(a), f(b), f(c), c.n, `${(c.top10 / a.top10).toFixed(1)}×`, `${(c.top1 / a.top1).toFixed(1)}×`];
});
say('Empirical reach (ACS 2024, marriages in the last five years): share of husbands in the top 10 / 5 / 1% of men 25-64 by income, by',
  'the wife\'s age at marriage and the gap. Husband income is measured now, so older husbands have had more time to earn (part of what a gap',
  'buys: an established man). Top-1% cells for young wives rest on a handful of couples; the top-10% column is the reliable one.');
say(table(['Wife\'s age at marriage', 'Gap under 2', 'Gap 5-9', 'Gap 10+', 'Couples with 10+ gap', 'Lift, top 10%', 'Lift, top 1%'], reachRows));
const rb = ag.recent_5y.bands, rc = ag.recent_5y_husband_30_45.bands;
say(`ACS 2024, marriages in the last five years, husband 10+ years older, by his income percentile (men 25-64): ${rb.map((x) => `${x.band} ${pct(x.gap10, 1)}`).join(', ')}.`,
  `Husbands in the top 1% who married recently are older (median ${rb[5].median_h_age}, vs ${rb[1].median_h_age} for the 50th-75th). Holding husbands to 30-45:`,
  `${rc.map((x) => `${x.band} ${pct(x.gap10, 1)}`).join(', ')}. Top earners marry later, and late-marrying men marry younger women; a woman in her`,
  `mid-twenties reaches them only with a gap. Wives in recent top-1% marriages: ${pct(rb[5].wife_ba_plus)} BA+ (${pct(rc[5].wife_ba_plus)} with husbands 30-45).`);

// ---------- L. Her levers, alone and together ----------
const lever = (label, o) => { const r = [0.9, 0.95, 0.99].map((bar) => herYears({ ...o, bar }).odds); return [label, pct(herYears({ ...o, bar: 0 }).odds), pct(r[0]), pct(r[1], 1), pct(r[2], 1)]; };
const leverRows = [
  lever('Baseline: app from 27, swipes like everyone', { start: 27 }),
  lever('Start at 23 instead', { start: 23 }),
  lever('Open to men 10 years older', { start: 27, gap: 10 }),
  lever('Open to men 15 years older', { start: 27, gap: 15 }),
  lever('Weights looks less (a = 0.15)', { start: 27, a: 0.15 }),
  lever('Friends\' introductions instead of the app', { start: 27, ch: 'friends' }),
  lever('Gives more men months of dating (3 a year)', { start: 27, n: 3 }),
  lever('GLP-1 (semaglutide-sized waist loss)', { start: 27, v: appealFromWhr(glp('semaglutide', 0).new_pct) }),
  lever('GLP-1 (tirzepatide-sized) plus glute training', { start: 27, v: appealFromWhr(glp('tirzepatide', 1).new_pct) }),
  lever('Combined on the app from 27: 15-year range, less on looks, 3 a year', { start: 27, gap: 15, a: 0.15, n: 3 }),
  lever('Same, from 23', { start: 23, gap: 15, a: 0.15, n: 3 }),
  lever('Same from 23, plus tirzepatide and glutes', { start: 23, gap: 15, a: 0.15, n: 3, v: appealFromWhr(glp('tirzepatide', 1).new_pct) }),
];
say('## L. Her levers, alone and together', '',
  'Median woman, five-year search. Each row changes one thing from the baseline; the last two combine the app levers (the model runs one',
  'channel per search, and friends supply only ~6 first dates a year, so mixing channels is left out).');
say(table(['Strategy', 'Any committed man', 'Committed top-10% man', 'Top 5%', 'Top 1%'], leverRows));

// ---------- M. Reaching up: the millionaire husband and the top-5% wife ----------
const k = (x) => `$${Math.round(x / 1000)}k`, mm = (x) => (x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : k(x));
say('## M. Reaching up', '',
  `Exchange rates (the author's "There's no such thing as rich enough"): single women 22-29 (${(ex.women / 1e6).toFixed(1)}M) against single men 28-42`,
  `(${(ex.men / 1e6).toFixed(1)}M). For each WHR tier, the income or net worth that as many men clear as women clear the tier. Under assortative`,
  'matching on market value, those are the men a woman at that tier can reach, and the women a man at that bar can reach.');
say(table(['Her WHR', 'Share of single women 22-29', 'Men earning', 'or worth', 'Fit men earning'], ex.tiers.map((t) => [`≤ ${t.whr}`, pct(t.share, 2), `${k(t.income)}+`, `${mm(t.net_worth)}+`, t.income_if_fit > 0 ? `${k(t.income_if_fit)}+` : 'any'])));
say('Abs (fit, per the parquet) are worth about 4x income: ' + ex.abs_worth.map((a) => `a fit man earning ${k(a.income)} is as rare as any man earning ${k(a.equivalent_income)}`).join('; ') + '.');
const mt = ex.metros;
say(`Where each side has leverage (women at WHR ≤ 0.74 per single man worth $1M+, largest metros): fewest in ${mt.slice(0, 5).map((m) => `${m.name.split('-')[0].split(',')[0]} ${m.women_per_millionaire.toFixed(1)}`).join(', ')};`,
  `most in ${mt.slice(-5).reverse().map((m) => `${m.name.split('-')[0].split(',')[0]} ${m.women_per_millionaire.toFixed(1)}`).join(', ')}. Below 1, millionaires outnumber qualifying women.`);

const glpRows = [];
for (const start of [0.25, 0.5, 0.75]) for (const [drug, glute, label] of [['semaglutide', 0, 'Semaglutide-sized'], ['tirzepatide', 0, 'Tirzepatide-sized'], ['tirzepatide', 1, 'Tirzepatide + 1 in glutes']]) {
  const g = glp(drug, glute, start), v0 = appealFromWhr(start), v1 = appealFromWhr(g.new_pct);
  const tier = ex.tiers.filter((t) => g.new_whr <= t.whr).at(-1);
  const r = [0, 0.9, 0.99].map((bar) => herYears({ v: v1, bar }).odds), r0 = [0, 0.9, 0.99].map((bar) => herYears({ v: v0, bar }).odds);
  glpRows.push([ord(start), g.whr.toFixed(3), label, g.new_whr.toFixed(3), ord(g.new_pct), `${ord(v0)} → ${ord(v1)}`, tier ? `${k(tier.income)}+ / ${mm(tier.net_worth)}+` : 'below the tiers',
    `${pct(r0[0])} → ${pct(r[0])}`, `${pct(r0[1])} → ${pct(r[1])}`, `${pct(r0[2], 1)} → ${pct(r[2], 1)}`]);
}
say('### For women: GLP-1s and the gym', '',
  'One woman changes; her peers do not. Waist falls by a share of baseline (semaglutide 2.4 mg ~12%, STEP 1; tirzepatide 15 mg ~17%,',
  'SURMOUNT-1: -19.9 cm); hips fall by half the waist loss in cm (assumed); glute training adds an inch of hip (assumed). Her appeal moves by',
  `${BASE.bodyShare} x her WHR z-score (other traits at the median). Odds: five years from 25, any committed man / top 10% / top 1%.`);
say(table(['Her WHR percentile', 'WHR', 'Intervention', 'New WHR', 'New WHR percentile', 'Appeal', 'Men she can reach', 'Any committed man', 'Top 10%', 'Top 1%'], glpRows));
const shareRows = [0.4, 0.6, 0.8].map((sh) => { const v1 = appealFromWhr(glp('tirzepatide', 1).new_pct, sh); return [sh, ord(v1), pct(herYears({ v: v1, bar: 0 }).odds), pct(herYears({ v: v1 }).odds)]; });
say('How much of her appeal is her body (median woman, tirzepatide plus glutes):');
say(table(['Body share of appeal', 'Appeal', 'Any committed man', 'Top 10%'], shareRows));
const hipRows = [0.3, 0.5, 0.7].map((h) => { const g = glp('tirzepatide', 0, 0.5, h); return [h, g.new_whr.toFixed(3), ord(g.new_pct)]; });
say('If hips hold up better or worse (median woman, tirzepatide, no glute work; hip loss as a share of waist loss in cm):');
say(table(['Hip share', 'New WHR', 'New WHR percentile'], hipRows));
say('The millionaire-husband recipe, in the model\'s terms: get to WHR ≤ 0.74 (the $1M tier), start early, widen the age range upward (the',
  'empirical reach table in K: a 10+ year gap multiplies the chance of a top-10% husband 4.4x for brides 18-22 and 1.7x for 23-26), finish a',
  'degree (wives in recent top-1% marriages are 82-90% BA+), and look where millionaires outnumber qualifying women (SF, Seattle, Denver).');
say('### For men: the top-5% wife', '',
  `A WHR ≤ 0.74 woman is about 1 in 25 single women 22-29. The same count of single men 28-42 earn ${k(ex.tiers[2].income)}+ or are worth ${mm(ex.tiers[2].net_worth)}+;`,
  `fit men need only ${k(ex.tiers[2].income_if_fit)}+ (${ex.men_counts.fit >= ex.tiers[2].women ? 'fit men alone outnumber her tier' : ''}). Abs are the cheapest lever (worth ~4x income),`,
  `then income, then geography (St. Louis, Atlanta, Philadelphia, Detroit have the most qualifying women per millionaire). Section F shows`,
  'what appeal buys him on the apps: dates and commitment rise with it, but his odds of a partner as rare as he is stay low.');

// ---------- J. What moves her odds ----------
const base = herYears();
const tornado = [
  [`Commitment strength ${(BASE.commitMedian * 0.67).toFixed(2)} → ${(BASE.commitMedian * 1.33).toFixed(2)}`, herYears({ commitMedian: BASE.commitMedian * 0.67 }), herYears({ commitMedian: BASE.commitMedian * 1.33 })],
  ['Her weight on looks 0.48 → 0.15', base, herYears({ a: 0.15 })],
  ['Her appeal median → 90th', base, herYears({ v: 0.9 })],
  ['GLP-1 + glutes (median WHR → 97th)', base, herYears({ v: appealFromWhr(glp('tirzepatide', 1).new_pct) })],
  ['Start age 25 → 32', base, herYears({ start: 32 })],
  ['Proper dates per year 1 → 4', herYears({ n: 1 }), herYears({ n: 4 })],
  ['Quality shown on a first date 0.15 → 0.4', herYears({ read2: { a: 0.3, c: 0.15 } }), herYears({ read2: { a: 0.3, c: 0.4 } })],
  ['Appeal-quality ρ 0 → 0.2', herYears({ rhoQz: 0 }), herYears({ rhoQz: 0.2 })],
  ['Casual pair-off rate k_c 0 → 0.2', herYears({ kc: 0 }), herYears({ kc: 0.2 })],
  ['Age gap +2 → +15 (starting at 27)', herYears({ start: 27 }), herYears({ start: 27, gap: 15 })],
].map(([k, lo, hi]) => [k, pct(lo.odds), pct(hi.odds), `${((hi.odds - lo.odds) * 100).toFixed(0)} pts`]);
say('## J. What moves her odds most', '', `Median woman, five years from 25, committed top-10% man: default ${pct(base.odds)}.`);
say(table(['Assumption', 'Low', 'High', 'Swing'], tornado));

say('## Defaults and where they come from', '',
  '- Appeal-quality correlation 0.1: Feingold (1992), attractiveness vs intelligence r = .04; Langlois et al. (2000), small links to adjustment.',
  '- Reads of real quality: Connelly & Ones (2010), corrected accuracy averaged over the Big Five: strangers ~.17, coworkers ~.26, friends ~.47, cohabitants ~.48, family ~.57.',
  '- Lemon effect 0.3: Solomon & Jackson (2014), breakup odds per unit neuroticism 1.36, conscientiousness 0.88, agreeableness 0.91.',
  `- Commitment strength ${BASE.commitMedian}: set so a median woman on an app who chooses like the app-wide consensus has the census chance of marrying between 25 and 30 (${pct(1 - censusW[30] / censusW[25])}), with both sides needing to commit.`,
  '- Dating activity: NSFG 2022-23, luap retention, Pew ever-used 58/42. Consensus, exposure and the commitment filter: `docs/dating/sensitivity.md`.');

writeFileSync(new URL('../../docs/dating/results.md', import.meta.url), md.join('\n'));
console.log('wrote docs/dating/results.md');
