// Precomputes Act V's stopping-rule results for every job type, candidate count,
// interview quality and recall setting, across a grid of evaluation fractions.
// Usage: node scripts/stopping-data.mjs   (writes src/data/stopping.json)
import { writeFileSync } from 'node:fs';
import { JOB_TYPES, PRESET_HIRING, stoppingRun } from '../src/model.js';

export const FRACTIONS = [0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.37, 0.45, 0.5, 0.6];
const NS = [5, 10, 20, 50, 100], RS = [1, 0.44, 0.18];
const out = { fractions: FRACTIONS, ns: NS, rs: RS, D: 1, results: {} };
let seed = 100;
const t0 = Date.now();
for (const job of Object.keys(JOB_TYPES)) {
  for (const n of NS) for (const r of RS) for (const recall of [false, true]) {
    const key = [job, n, r, recall ? 1 : 0].join('|');
    out.results[key] = FRACTIONS.map((f) => {
      const res = stoppingRun(JOB_TYPES[job].dist, PRESET_HIRING, { n, f, r, recall, T: 6000, seed: seed++ });
      return Object.fromEntries(Object.entries(res).map(([k, v]) => [k, +v.toFixed(4)]));
    });
  }
}
writeFileSync(new URL('../src/data/stopping.json', import.meta.url), JSON.stringify(out));
console.log('wrote src/data/stopping.json in', ((Date.now() - t0) / 1000).toFixed(1), 's');
