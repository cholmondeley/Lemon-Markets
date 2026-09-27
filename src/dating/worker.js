// Runs the reader's own scenarios off the main thread: the calibrated model on the coarse grid (the
// same grid the page's precomputed tables use), with the fitted constants.
import digitized from '../data/dating/digitized.json';
import pools from '../data/dating/pools.json';
import calibration from '../data/dating/calibration.json';
import nsfg from '../data/dating/nsfg.json';
import status from '../data/dating/status.json';
import fitted from '../data/dating/fitted.json';
import { createScenario } from './scenario.js';

let S = null;
const scenario = () => (S ??= createScenario({ digitized, pools, calibration, nsfg, status }, { grid: 'coarse', fitted }));

// { type: 'her', params } -> her odds (any, as rare or better, top 10 / 5 / 1% of men) over the years.
// { type: 'his', params } -> his odds (any, a woman at the 50 / 75 / 90 / 95th percentile for her age,
//   as rare as him or better), his mate-value percentile and first dates a year.
self.onmessage = ({ data: { id, type, params } }) => {
  const s = scenario();
  if (type === 'her') {
    const r = s.herYears(params);
    self.postMessage({ id, result: { ...r.odds, matches: r.first.matches } });
  } else if (type === 'his') {
    const r = s.hisYears(params);
    self.postMessage({ id, result: { ...r.odds, mvPct: r.mvPct, dates: r.first.dates } });
  }
};
self.postMessage({ ready: true });
