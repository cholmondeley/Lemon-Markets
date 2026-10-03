// Precomputes, for women on the apps, the read a man must clear after a first date for her to keep
// seeing him (she properly dates only the best two of her ~13 first dates a year), by her age and her
// appeal for her age (0.1-SD grid). Depends on the fitted tolerance, so run after fit.mjs:
//   node scripts/dating/keep.mjs   -> src/data/dating/keep.json
import { readFileSync, writeFileSync } from 'node:fs';
import { createScenario } from '../../src/dating/scenario.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const S = createScenario({ digitized: read('../../src/data/dating/digitized.json'), pools: read('../../src/data/dating/pools.json'),
  calibration: read('../../src/data/dating/calibration.json'), nsfg: read('../../src/data/dating/nsfg.json'), status: read('../../src/data/dating/status.json') },
  { grid: 'coarse', fitted: read('../../src/data/dating/fitted.json') });
// Women 18-48 (the ages men search); appeal for her age from the women's grid, shifted by age.
const ys = [...new Set(S.womenSingle().cells.map((c) => c.z))];
const t = {};
for (let age = 18; age <= 48; age++) {
  for (const z of ys) {
    const ya = Math.round((z + S.womenShift(age)) * 10) / 10, key = `${age}_${ya.toFixed(1)}`;
    if (!(key in t)) { const x = S.keepAt(age, ya); t[key] = Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : -99; }   // -99: she keeps everyone
  }
  console.log(`age ${age}: ${Object.keys(t).length} thresholds`);
}
writeFileSync(new URL('../../src/data/dating/keep.json', import.meta.url), JSON.stringify({ note: 'herKeepBar thresholds by "age_appeal"; see keep.mjs', t }));
console.log('wrote src/data/dating/keep.json');
