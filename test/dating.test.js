import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normSf, simpson, histPoints, histMean, receivedRatio, attentionMarket, observedHistogram, histDistance,
  casualShareOnApp, reservation, curveAt, fecundityUsed, bvnUpper, hitRate, findOdds, bestRarity, traitRarity,
} from '../src/dating/model.js';

const data = JSON.parse(readFileSync(new URL('../src/data/dating/digitized.json', import.meta.url)));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('normSf: known values, and relative accuracy in the far tail', () => {
  close(normSf(0), 0.5, 1e-7);
  close(normSf(1.959964), 0.025, 1e-7);
  close(normSf(-1.959964), 0.975, 1e-7);
  // P(Z > 4.753424) = 1e-6: relative error well under 1%.
  close(normSf(4.753424) / 1e-6, 1, 1e-3);
});

test('simpson integrates the normal density to 1', () => {
  close(simpson((z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI), -10, 10), 1, 1e-9);
});

test('digitized like-rate histograms reproduce the medians the app founder reports', () => {
  const med = (h) => { const t = h.reduce((s, v) => s + v, 0); let c = 0; for (let i = 0; i < h.length; i++) { c += h[i]; if (c >= t / 2) return (i + 0.5) / 100; } };
  close(med(data.luap_like_rate_women), 0.04, 0.01, 'women like');
  close(med(data.luap_like_rate_men), 0.26, 0.01, 'men like');
  close(med(data.luap_received_ratio_men), 0.05, 0.01, 'men received');
  close(med(data.luap_received_ratio_women), 0.38, 0.01, 'women received');
});

test('received ratio averages back to the mean like rate (law of total probability)', () => {
  const open = histPoints(data.luap_like_rate_women);
  for (const rho of [0.2, 0.6, 0.9]) {
    const m = attentionMarket({ rho, openness: open, M: 4000 });
    close(m.meanRatio, histMean(open), 2e-3, `rho ${rho}`);
  }
});

test('no consensus and equal exposure: everyone is liked at the same rate', () => {
  const open = histPoints(data.luap_like_rate_women);
  const m = attentionMarket({ rho: 0, openness: open, M: 500 });
  close(m.gini, 0, 1e-6);
  close(m.top10, 0.10, 1e-6);
  close(receivedRatio(2, 0, open), receivedRatio(-2, 0, open), 1e-12);
});

test('observed histogram is a probability distribution; distance to itself is 0', () => {
  const h = observedHistogram(new Float64Array([0.05, 0.1, 0.3]), 80);
  close(h.reduce((s, v) => s + v, 0), 1, 1e-9);
  assert.equal(histDistance(h, h), 0);
});

test('commitment filter: no pairing-off leaves the population mix; more pairing-off raises the casual share', () => {
  close(casualShareOnApp(0, 0.23, 0.1), 0.23, 1e-12);
  assert.ok(casualShareOnApp(4, 0.23, 0.1) > casualShareOnApp(1, 0.23, 0.1));
  close(casualShareOnApp(5, 0.3, 1), 0.3, 1e-12);   // casual men who pair off just as fast: no filter
});

test('reservation value: more prospects, higher bar', () => {
  const a = reservation(0.5).accept, b = reservation(5).accept, c = reservation(50).accept;
  assert.ok(a > b && b > c);
  // Fixed point holds.
  const { w } = reservation(5);
  close(w, 5 * (Math.exp(-w * w / 2) / Math.sqrt(2 * Math.PI) - w * normSf(w)), 1e-9);
});

test('age curves: interpolation and fecundity bookkeeping', () => {
  close(curveAt(data.okcupid_age, 'women', 22, false), data.okcupid_age.women[4], 1e-12);
  close(curveAt(data.okcupid_age, 'women', 22.5, false), (data.okcupid_age.women[4] + data.okcupid_age.women[5]) / 2, 1e-12);
  close(fecundityUsed(data.geruso, 20, 20), 0, 1e-12);
  close(fecundityUsed(data.geruso, 50, 20), 1, 1e-12);
});

test('bivariate tail: independence and perfect correlation limits', () => {
  close(bvnUpper(1, 2, 0), normSf(1) * normSf(2), 1e-12);
  close(bvnUpper(1, 2, 0.999999), normSf(2), 2e-4);
  close(bvnUpper(0, 0, 0.5), 1 / 3, 1e-6);   // orthant probability 1/4 + asin(r) / (2 pi)
});

test("perfect reads reproduce the author's odds table (top-1% pool, 20 evaluated)", () => {
  const odds = (N) => findOdds({ n: 20, p: 0.01, N, r: 1 });
  close(odds(1e3), 1 - 0.9 ** 20, 1e-9);
  close(odds(1e4), 1 - 0.99 ** 20, 1e-9);
  close(odds(1e5), 1 - 0.999 ** 20, 1e-9);
  close(odds(2.5e5), 1 - 0.9996 ** 20, 1e-9);
});

test('noisy reads make the pool worse, and bestRarity inverts findOdds', () => {
  assert.ok(hitRate(1000, 0.01, 0.4) < hitRate(1000, 0.01, 0.8));
  const N = bestRarity({ n: 20, p: 0.01, r: 0.5, luck: 0.5 });
  close(findOdds({ n: 20, p: 0.01, N, r: 0.5 }), 0.5, 2e-3);
});

test('trait rarity: independent traits multiply, identical traits do not', () => {
  close(traitRarity({ k: 3, q: 0.1, rho: 0 }), 1e-3, 1e-15);
  close(traitRarity({ k: 3, q: 0.1, rho: 1 }), 0.1, 1e-15);
  const mid = traitRarity({ k: 3, q: 0.1, rho: 0.3 });
  assert.ok(mid > 1e-3 && mid < 0.1);
  close(traitRarity({ k: 3, q: 0.1, rho: 1e-9 }), 1e-3, 1e-5);
});

// ---------- chained model ----------
import { population, singlePool, describe, search, cohort, backRule, likeRateCurve, normalize } from '../src/dating/chain.js';

test('chain grid: weights sum to 1, casual share and quality marginal are as specified', () => {
  const pop = population({ rhoQz: 0.3, casual: 0.2 });
  const sum = pop.cells.reduce((s, c) => s + c.w, 0);
  close(sum, 1, 1e-9);
  close(describe(pop.cells).serious, 0.8, 1e-9);
  const mQ = pop.cells.reduce((s, c) => s + c.w * c.Q, 0), vQ = pop.cells.reduce((s, c) => s + c.w * c.Q * c.Q, 0);
  close(mQ, 0, 1e-9);
  close(vQ, 1, 2e-3);
  close(describe(pop.cells, 0.9).good, 0.8 * 0.1, 2e-3);
});

test('single pool: no pairing off leaves the population unchanged', () => {
  const pop = population({ casual: 0.2 });
  const s = singlePool(pop, { demand: () => 1, x50: 0, kc: 0.1, lemon: 0 });
  close(s.singleShare, 1, 1e-12);
  close(describe(s.cells).serious, 0.8, 1e-9);
});

test('search: a blind read with everyone liking back evaluates the pool as it is', () => {
  const pop = population({ casual: 0.3 });
  const r = search(pop.cells, { a: 0, c: 0, rhoQz: 0.2, likeRate: 0.1, back: () => 1, views: 1e6, n: 10 });
  close(r.serious, 0.7, 1e-6);
  close(r.qPct, 0.5, 1e-3);
  assert.equal(r.evaluated, 10);
});

test('search: fewer matches than capacity means everyone matched is evaluated', () => {
  const pop = population();
  const r = search(pop.cells, { a: 0.5, c: 0.1, rhoQz: 0.2, likeRate: 0.05, back: () => 0.2, views: 100, n: 10 });
  close(r.matches, 100 * 0.05 * 0.2, 1e-3);
  close(r.evaluated, r.matches, 1e-12);
});

test('cohort reproduces the census never-married curve it is fitted to', () => {
  const pop = population({ nz: 41, ne: 41 });
  const census = { 20: 0.95, 25: 0.8, 30: 0.55, 35: 0.4 };
  for (let a = 20; a <= 35; a++) if (census[a] == null) { const lo = Math.floor(a / 5) * 5; census[a] = census[lo] + (census[lo + 5] - census[lo]) * (a - lo) / 5; }
  const c = cohort(pop, { demand: (u) => 0.5 + u, kc: 0.1, census, start: 20, end: 35 });
  for (const a of [25, 30, 35]) close(c[a].never, census[a], 1e-6, `age ${a}`);
  // Casual men are over-represented among those left.
  assert.ok(describe(c[35].cells).serious < describe(c[20].cells).serious);
});

test('back rule: with no consensus, a candidate likes the searcher at his own like rate', () => {
  const rate = likeRateCurve((u) => 1 + u, 0.3);
  close(rate(0.5), 0.3, 1e-6);
  const back = backRule(rate, 0, 2);
  close(back({ u: 0.9 }), rate(0.9), 1e-6);
  assert.ok(rate(0.9) < rate(0.5));
});

import { appFunnel } from '../src/dating/chain.js';

test('app funnel: dates men receive add up to dates active women give (when men have room)', () => {
  const men = population({ nz: 31, ne: 11 }).cells, women = population({ nz: 31, ne: 3 }).cells;
  const opts = { men, women, a: 0.48, c: 0.1, rhoQz: 0.1, rhoM: 0.56, likeM: () => 0.3, likeW: () => 0.05, viewsW: 3000, datesW: 10, datesM: 1e9, ratio: 2, activeW: 0.25, ny: 5 };
  const f = appFunnel(opts);
  const menTotal = men.reduce((t, x, i) => t + x.w * f.perMan.dates[i], 0) * opts.ratio;
  const womenTotal = opts.activeW * f.women.reduce((t, w) => t + w.w * Math.min(opts.datesW, w.matches), 0);
  close(menTotal, womenTotal, 1e-6 * womenTotal);
  const none = appFunnel({ ...opts, activeW: 0 });
  close(none.all.dates, 0, 1e-12);
  assert.ok(f.topDates.top10 > 0.1);   // dates concentrate on the best-looking men
});

import { tSf, tTop, traitRarityT, hitRateT } from '../src/dating/model.js';

test('t-copula: t tails match known quantiles and fall back to the Gaussian', () => {
  close(tSf(2.015, 5), 0.05, 5e-4);          // t(5) 95th percentile is 2.015
  close(tTop(0.025, 10), 2.228, 5e-3);        // t(10) 97.5th percentile is 2.228
  close(traitRarityT({ k: 3, q: 0.1, rho: 0.2, nu: Infinity }), traitRarity({ k: 3, q: 0.1, rho: 0.2 }), 1e-12);
  // Heavier tails make joint extremes likelier at the same correlation.
  assert.ok(traitRarityT({ k: 3, q: 0.01, rho: 0.2, nu: 4 }) > traitRarity({ k: 3, q: 0.01, rho: 0.2 }));
  // Independent t marginals still share a scale, so even rho = 0 is not independence.
  assert.ok(traitRarityT({ k: 3, q: 0.01, rho: 0, nu: 4 }) > 1e-6);
  close(hitRateT(1000, 0.01, 0.5, Infinity), hitRate(1000, 0.01, 0.5), 1e-12);
});

// ---------- the mate-value layer (the calibrated scenario, coarse grid) ----------
import { evaluate } from '../src/dating/chain.js';
import { createScenario } from '../src/dating/scenario.js';

test('evaluate: everyone wanting to continue changes nothing; half wanting halves who continues', () => {
  const cells = normalize([{ Q: 0, u: 0.5, z: 0, serious: true, w: 1 }, { Q: 1, u: 0.8, z: 1, serious: true, w: 1 }]);
  const a = evaluate({ cells, count: 4 }, { n: 10, bar: 0 }), b = evaluate({ cells, count: 4 }, { n: 10, bar: 0, pursue: () => 1 });
  close(a.evaluated, b.evaluated, 1e-12); close(a.odds, b.odds, 1e-12);
  close(evaluate({ cells, count: 4 }, { n: 10, bar: 0, pursue: () => 0.5 }).continued, 2, 1e-12);
});

const readJ = (p) => JSON.parse(readFileSync(new URL(`../src/data/dating/${p}`, import.meta.url)));
const S = createScenario({ digitized: data, pools: readJ('pools.json'), calibration: readJ('calibration.json'), nsfg: readJ('nsfg.json'), status: readJ('status.json'), keep: readJ('keep.json') },
  { grid: 'coarse', fitted: readJ('fitted.json') });

test('commitment follows rank: men commit up, rarely down', () => {
  const his = S.hisCommit(), m = S.BASE.commitScale, Z = { 0.25: -0.6745, 0.5: 0, 0.9: 1.2816 };
  const man = (p) => ({ Q: Z[p], u: 0.5, serious: true, M: 30 });
  const y = (p) => Z[p] + S.womenShift(28);
  assert.ok(his(man(0.25), y(0.9)) / m > 0.99, 'a 25th-percentile man commits to a 90th-percentile woman');
  assert.ok(his(man(0.9), y(0.5)) / m < 0.1, 'a 90th-percentile man rarely commits to a median woman');
  assert.ok(his(man(0.5), y(0.5)) / m > 0.6, 'a median man usually commits to a median woman');
});

test('her odds of a top-10% man: near zero at the median, rising steeply with her appeal', () => {
  const t = [0.5, 0.75, 0.9, 0.99].map((v) => S.herYears({ v }).odds.top10);
  assert.ok(t[0] < 0.01, `median woman ${t[0]}`);
  assert.ok(t[2] > 0.03 && t[3] > 0.1, `90th ${t[2]}, 99th ${t[3]}`);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
});

test('age gaps buy top-tier men (standing now), young women included', () => {
  for (const [start, v] of [[23, 0.8], [31, 0.9]]) {
    const narrow = S.herYears({ start, v, gap: 2 }).odds, wide = S.herYears({ start, v, gap: 15 }).odds;
    assert.ok(wide.top10 > 2 * narrow.top10, `${start}: ${narrow.top10} -> ${wide.top10}`);
    assert.ok(wide.top5 > 2 * narrow.top5, `${start}: ${narrow.top5} -> ${wide.top5}`);
  }
});

test('men: getting off the apps and getting fit both raise his odds', () => {
  const base = S.hisYears({ age: 30, lo: 22, hi: 30, uLooks: 0.5 }).odds.any;
  assert.ok(S.hisYears({ age: 30, lo: 22, hi: 30, uLooks: 0.5, ch: 'inperson' }).odds.any > 1.5 * base);
  assert.ok(S.hisYears({ age: 30, lo: 22, hi: 30, uLooks: 0.68 }).odds.any > 1.5 * base);
});

test('the fit: women searching from 25 find a committed man by 30 at the census rate, lagged, among those who expect to marry', () => {
  const vs = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
  const avg = vs.reduce((s, v) => s + S.herYears({ start: 25, v, gap: 2 }).odds.any, 0) / vs.length;
  const { lag, expect } = readJ('fitted.json').checks.level;
  close(avg, (1 - S.censusW[30 + lag] / S.censusW[25 + lag]) / expect, 0.01);
});

test('relaxing toward what you can get: only ever helps, and the top clears', () => {
  for (const v of [0.2, 0.5, 0.9, 0.99]) {
    const strict = S.herYears({ start: 25, v, relax: false }).odds.any, relaxed = S.herYears({ start: 25, v }).odds.any;
    assert.ok(relaxed >= strict - 1e-9, `${v}: ${strict} -> ${relaxed}`);
  }
  const life = [0.9, 0.95, 0.99].map((v) => S.herYears({ start: 22, years: 13, v }).odds.any);
  assert.ok(life.every((p) => p > 0.85), `top women committed by 35: ${life}`);
  assert.ok(life[2] > S.herYears({ start: 22, years: 13, v: 0.99, relax: false }).odds.any + 0.05, 'the 99th percentile gains most');
});

test('on the apps she keeps seeing a man only if he beats her other first dates', () => {
  const r = S.hisYears({ age: 30, lo: 22, hi: 30, uLooks: 0.5 }).rows[0];
  const kept = r.evaluated / r.dates;
  assert.ok(kept < 0.25, `a median man's first dates that become months of dating: ${kept}`);
  assert.ok(S.hisYears({ age: 30, lo: 22, hi: 30, uLooks: 0.5, ch: 'inperson' }).odds.any > 4 * S.hisYears({ age: 30, lo: 22, hi: 30, uLooks: 0.5 }).odds.any, 'in person far better for him');
});
