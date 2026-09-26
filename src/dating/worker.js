// Runs the reader's own scenarios off the main thread: the calibrated model on the coarse grid
// (results within ~0.1 point of the fine grid), reusing the fitted constants from the report.
import digitized from '../data/dating/digitized.json';
import pools from '../data/dating/pools.json';
import calibration from '../data/dating/calibration.json';
import nsfg from '../data/dating/nsfg.json';
import exchange from '../data/dating/exchange.json';
import fitted from '../data/dating/fitted.json';
import { createScenario } from './scenario.js';

let S = null;
const scenario = () => (S ??= createScenario({ digitized, pools, calibration, nsfg, exchange }, { grid: 'coarse', fitted }));

// { type: 'her', params } -> odds of any committed man and of a committed top-10 / 5 / 1% man.
self.onmessage = ({ data: { id, type, params } }) => {
  const s = scenario();
  if (type === 'her') {
    const p = { ...params };
    if (p.whr != null) { p.v = s.appealFromWhr(p.whr); delete p.whr; }
    const run = (bar) => s.herYears({ ...p, bar });
    const any = run(0), t10 = run(0.9), t5 = run(0.95), t1 = run(0.99);
    self.postMessage({ id, result: {
      any: any.odds, top10: t10.odds, top5: t5.odds, top1: t1.odds, v: p.v ?? 0.5,
      matches: t10.first.matches, datesAppeal: t10.first.zPct, commits: t10.first.commits,
    } });
  }
};
self.postMessage({ ready: true });
