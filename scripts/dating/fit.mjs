// Fits the mate-value model's free parameters to data (coarse grid), and writes them into
// src/data/dating/fitted.json for everything downstream:
//   theta        how much faster higher-value men marry: ACS ever-married share at 40-49 by earnings
//                quintile (59% bottom -> 91% top), with earnings correlating earnStatus with status;
//   tolerance    how far below their own level people commit: couples' mate values correlate 0.76
//                (latent status, PSID; scripts/dating/assort.py);
//   commitScale  the chance a relationship works out when both would commit: never-married women 25
//                who marry by 30 (census), averaged over women's appeal.
// Run: node scripts/dating/fit.mjs   (after the data scripts; takes a few minutes)
import { readFileSync, writeFileSync } from 'node:fs';
import * as D from '../../src/dating/model.js';
import { normCdf } from '../../src/model.js';
import { createScenario, POWER } from '../../src/dating/scenario.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const inputs = {
  digitized: read('../../src/data/dating/digitized.json'), pools: read('../../src/data/dating/pools.json'),
  calibration: read('../../src/data/dating/calibration.json'), nsfg: read('../../src/data/dating/nsfg.json'),
  status: read('../../src/data/dating/status.json'),
};
const assort = read('../../src/data/dating/assort.json');
const prev = (() => { try { return read('../../src/data/dating/fitted.json'); } catch { return {}; } })();
const t0 = Date.now();
const log = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${m}`);

// p0 (date-to-sex) is fitted inside createScenario when absent; reuse it if present.
let S = createScenario(inputs, { grid: 'coarse', fitted: prev.p0 ? { p0: prev.p0 } : null });
const p0 = S.p0;
log(`p0 ${p0.toFixed(5)}`);

// ---------- theta: marriage by earnings quintile ----------
const acs = inputs.pools.marriage_by_earnings.men_40_49.quintiles.map((q) => q.ever_married);
const W_OTHER = Math.hypot(POWER.status, POWER.social, POWER.height), NORM = Math.hypot(POWER.looks, W_OTHER);
const rEarn = S.BASE.earnStatus * (POWER.status / W_OTHER) * (W_OTHER / NORM);
const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => -D.zTop(p));
const byQuintile = (theta) => {
  const pop = S.menPop(), coh = S.cohortM({ theta })[45];
  // Never-married share of each type at 45 relative to its population weight.
  const pNever = pop.cells.map((c, i) => Math.min(1, coh.cells[i].w * coh.never / c.w));
  const s = Math.sqrt(1 - rEarn * rEarn);
  return [0, 1, 2, 3, 4].map((q) => {
    let num = 0, den = 0;
    pop.cells.forEach((c, i) => {
      const lo = q === 0 ? -Infinity : cuts[q - 1], hi = q === 4 ? Infinity : cuts[q];
      const pq = normCdf((hi - rEarn * c.Q) / s) - normCdf((lo - rEarn * c.Q) / s);
      num += c.w * pq * (1 - pNever[i]); den += c.w * pq;
    });
    return num / den;
  });
};
let theta = 0, best = Infinity;
for (let th = 0; th <= 2.0001; th += 0.05) {
  const m = byQuintile(th), sse = m.reduce((s, x, i) => s + (x - acs[i]) ** 2, 0);
  if (sse < best) { best = sse; theta = +th.toFixed(2); }
}
const quint = byQuintile(theta);
log(`theta ${theta}: model ${quint.map((x) => (x * 100).toFixed(0)).join(' ')} vs ACS ${acs.map((x) => (x * 100).toFixed(0)).join(' ')}`);

// ---------- tolerance and commitScale ----------
S = createScenario(inputs, { grid: 'coarse', fitted: { p0, theta } });
const target = 1 - S.censusW[30] / S.censusW[25];
const vs = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];   // equal-weight quantiles of her appeal
const run = (o) => vs.map((v) => S.herYears({ start: 25, years: 5, v, gap: 2, ...o }));
const avgAny = (rs) => rs.reduce((s, r) => s + r.odds.any, 0) / rs.length;
const corr = (rs) => {
  let W = 0, my = 0, mx = 0, yy = 0, xx = 0, xy = 0;
  rs.forEach((r, i) => {
    const y = D.zTop(1 - vs[i]), w = r.odds.any, { mean, sq } = r.partner;
    W += w; my += w * y; mx += w * mean; yy += w * y * y; xx += w * sq; xy += w * y * mean;
  });
  my /= W; mx /= W;
  return (xy / W - my * mx) / Math.sqrt((yy / W - my * my) * (xx / W - mx * mx));
};
const fitScale = (tolerance) => {
  let lo = 0.02, hi = 1;
  for (let it = 0; it < 10; it++) { const m = (lo + hi) / 2; if (avgAny(run({ tolerance, commitScale: m })) < target) lo = m; else hi = m; }
  return (lo + hi) / 2;
};
const rhoTarget = assort.cfa.rho;
let dLo = 0.02, dHi = 1.5, fit = null;
for (let it = 0; it < 10; it++) {
  const d = (dLo + dHi) / 2, m = fitScale(d), rs = run({ tolerance: d, commitScale: m }), rho = corr(rs);
  log(`tolerance ${d.toFixed(3)} commitScale ${m.toFixed(3)}: couples correlate ${rho.toFixed(3)} (target ${rhoTarget.toFixed(2)}), 25->30 ${(avgAny(rs) * 100).toFixed(1)}% (target ${(target * 100).toFixed(1)}%)`);
  fit = { tolerance: +d.toFixed(3), commitScale: +m.toFixed(3), rho };
  if (rho > rhoTarget) dLo = d; else dHi = d;
}
const out = { ...prev, p0, theta, tolerance: fit.tolerance, commitScale: fit.commitScale,
  checks: { marriageByEarnings: { model: quint, acs }, couplesCorrelation: { model: fit.rho, target: rhoTarget }, census25to30: target } };
delete out.commitMedian;
writeFileSync(new URL('../../src/data/dating/fitted.json', import.meta.url), JSON.stringify(out, null, 1));
log(`wrote fitted.json ${JSON.stringify({ theta, tolerance: fit.tolerance, commitScale: fit.commitScale })}`);
