import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genAgents, step, poolStats, theory, spreadWidth, DT } from '../src/model.js';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('spreadWidth: r=0 is the essay (w=1); larger r narrows', () => {
  assert.equal(spreadWidth(0), 1);
  assert.ok(Math.abs(spreadWidth(0.31) - 0.9507) < 1e-3);
  assert.ok(Math.abs(spreadWidth(0.9) - 0.4359) < 1e-3);
});

test('theory at w=1 matches the essay closed forms', () => {
  for (const g of [0.04, 0.33, 1]) {
    const L = Math.log((g + 2) / g);
    const t = theory(g, 1);
    assert.ok(Math.abs(t.PA - (g / 2) * L) < 1e-12);
    assert.ok(Math.abs(t.PXlt1_A - Math.log((g + 1) / g) / L) < 1e-12);
    assert.ok(Math.abs(t.EXA - (2 / L - g)) < 1e-12);
    assert.ok(Math.abs(t.EXU - (1 - g + (g * g / 2) * L) / (1 - (g / 2) * L)) < 1e-12);
  }
});

test('theory: population mean is 1, so P(A)*E[X|A] + P(U)*E[X|U] = 1', () => {
  for (const w of [1, 0.95, 0.6]) {
    const t = theory(0.33, w);
    assert.ok(Math.abs(t.PA * t.EXA + (1 - t.PA) * t.EXU - 1) < 1e-12);
  }
});

test('simulation converges to theory (gamma=0.33, r=0.31)', () => {
  const rng = mulberry32(12345);
  const gamma = 0.33, r = 0.31;
  const agents = genAgents(20000, r, rng);
  const steps = Math.round(150 / DT);
  for (let k = 0; k < steps; k++) step(agents, gamma, DT, k, rng);

  const avail = agents.filter((a) => a.s === 'A');
  const taken = agents.filter((a) => a.s === 'U');
  const sa = poolStats(avail), su = poolStats(taken);
  const th = theory(gamma, spreadWidth(r));

  assert.ok(Math.abs(avail.length / agents.length - th.PA) < 0.015, 'P(A)');
  assert.ok(Math.abs(sa.avgX - th.EXA) < 0.02, 'E[X|A]');
  assert.ok(Math.abs(sa.fracLiars - th.PXlt1_A) < 0.02, 'P(X<1|A)');
  assert.ok(Math.abs(su.avgX - th.EXU) < 0.02, 'E[X|U]');
});
