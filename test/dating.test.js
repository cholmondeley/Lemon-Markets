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
