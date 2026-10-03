// Precomputes who keeps seeing whom after a first date on the apps. Both sides properly date only their
// best two first dates a year, so each keeps the people whose read clears a threshold set by their own
// search: hers by her age and appeal (t), his by his age and type (m). The two depend on each other (her
// dates are the men who'd keep seeing her, and his the women who'd keep seeing him), so they are solved in
// rounds until they stop moving. Depends on the funnel and the pools, not on the fitted tolerance or
// commitScale, so it runs before fit.mjs:
//   node scripts/dating/keep.mjs   -> src/data/dating/keep.json
import { readFileSync, writeFileSync } from 'node:fs';
import { createScenario } from '../../src/dating/scenario.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const inputs = { digitized: read('../../src/data/dating/digitized.json'), pools: read('../../src/data/dating/pools.json'),
  calibration: read('../../src/data/dating/calibration.json'), nsfg: read('../../src/data/dating/nsfg.json'), status: read('../../src/data/dating/status.json') };
const fitted = read('../../src/data/dating/fitted.json');
const t0 = Date.now(), log = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${m}`);
const fin = (x) => (Number.isFinite(x) ? Math.round(x * 1e3) / 1e3 : -99);   // -99: keeps everyone

// Her thresholds on the grid of women 18-48 (appeal for her age, 0.1-SD steps), given the men's table m
// (or, in round 0, each man's own bar).
const herTable = (m) => {
  const S = createScenario({ ...inputs, keep: m ? { m } : null }, { grid: 'coarse', fitted });
  const ys = [...new Set(S.womenSingle().cells.map((c) => c.z))], t = {};
  for (let age = 18; age <= 48; age++) for (const z of ys) {
    const ya = Math.round((z + S.womenShift(age)) * 10) / 10, key = `${age}_${ya.toFixed(1)}`;
    if (!(key in t)) t[key] = fin(S.keepAt(age, ya));
  }
  return t;
};
// His thresholds for men 22-55, every type on the men's grid, given her table t.
const hisTable = (t) => {
  const S = createScenario({ ...inputs, keep: { t } }, { grid: 'coarse', fitted });
  const cells = S.menPopCells(), m = {};
  // Only men whom more than two women a year want to keep seeing need a threshold. Below looks z 0.6
  // nobody qualifies at any age, even at the top of value (checked), and types beyond 3.4 SD of value
  // carry no weight: those keep everyone (-99).
  for (let M = 22; M <= 55; M++) {
    m[M] = cells.map((c) => (c.z < 0.6 || Math.abs(c.e) > 3.4 ? -99 : fin(S.hisKeepAt(M, c))));
    if (M % 5 === 0) log(`  his thresholds: age ${M}`);
  }
  return m;
};
const diff = (a, b) => { let d = 0, n = 0; for (const k of Object.keys(a)) if (a[k] > -90 && b[k] > -90) { d += Math.abs(a[k] - b[k]); n++; } return n ? d / n : 0; };

let t = herTable(null);
log(`round 0: her thresholds with men's own bars (${Object.keys(t).length})`);
let m = null;
for (let round = 1; round <= 3; round++) {
  m = hisTable(t);
  const kept = Object.values(m).flat(), everyone = kept.filter((x) => x <= -90).length;
  log(`round ${round}: his thresholds (${kept.length}; ${everyone} keep everyone they date)`);
  const t2 = herTable(m), d = diff(t, t2);
  log(`round ${round}: her thresholds moved ${d.toFixed(4)} on average`);
  t = t2;
  if (d < 0.005) break;
}
writeFileSync(new URL('../../src/data/dating/keep.json', import.meta.url), JSON.stringify({
  note: 'Keep-seeing thresholds after a first date on the apps. t: hers by "age_appeal"; m: his by age, then men\'s grid cell (menPop order); -99 = keeps everyone. keep.mjs.', t, m }));
log('wrote src/data/dating/keep.json');
