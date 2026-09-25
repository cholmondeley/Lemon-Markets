import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genAgents, step, poolStats, theory, steadyState, spreadWidth, mulberry32, JOB_TYPES, DT, bestOfK, narrowing, exactNarrowing, poolDensity, ladder, normCdf, counterOffers, sourceChannel, CHANNELS } from '../src/model.js';

test('spreadWidth: r=0 is 1; larger r narrows', () => {
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

test('numeric steady state matches the closed form for Uniform(0, 2]', () => {
  for (const g of [0.04, 0.33]) {
    const n = steadyState(JOB_TYPES.uniform.dist, g), c = theory(g);
    for (const k of ['PA', 'EXA', 'EXU', 'PXlt1_A', 'PQ1_A']) assert.ok(Math.abs(n[k] - c[k]) < 1e-4, k);
  }
});

test('every job type has mean truth ratio 1', () => {
  for (const { dist } of Object.values(JOB_TYPES)) {
    const t = steadyState(dist, 0.04);
    assert.ok(Math.abs(t.PA * t.EXA + (1 - t.PA) * t.EXU - 1) < 2e-3);
  }
});

test('Act I headline numbers at gamma = 0.04', () => {
  const pro = steadyState(JOB_TYPES.professional.dist, 0.04);
  assert.equal(Math.round(pro.PXlt1_A * 100), 75);
  assert.equal(pro.EXA.toFixed(2), '0.82');
  assert.equal(Math.round(pro.PQ1_A * 100), 34);
  assert.equal((pro.PA * 100).toFixed(1), '4.6');
  const uni = theory(0.04);   // the handoff's original targets, now the worst case
  assert.equal(Math.round(uni.PXlt1_A * 100), 83);
  assert.equal(uni.EXA.toFixed(2), '0.47');
  assert.equal(Math.round(uni.PQ1_A * 100), 61);
});

test('uniform truth ratios lie in (0, 2] with no floor', () => {
  const agents = genAgents(50000, JOB_TYPES.uniform.dist, mulberry32(7));
  const xs = agents.map((a) => a.x);
  assert.ok(Math.min(...xs) > 0 && Math.max(...xs) <= 2);
  assert.ok(xs.filter((x) => x < 0.02).length > 300, 'mass below 0.02 is kept');
});

for (const job of Object.keys(JOB_TYPES)) {
  test(`simulation converges to theory (${job}, gamma=0.04)`, () => {
    const rng = mulberry32(12345);
    const { dist } = JOB_TYPES[job];
    const agents = genAgents(40000, dist, rng);
    const steps = Math.round(60 / DT);
    for (let k = 0; k < steps; k++) step(agents, 0.04, DT, k, rng);

    const avail = agents.filter((a) => a.s === 'A');
    const taken = agents.filter((a) => a.s === 'U');
    const sa = poolStats(avail), su = poolStats(taken);
    const th = steadyState(dist, 0.04);

    assert.ok(Math.abs(avail.length / agents.length - th.PA) < 0.01, 'P(A)');
    assert.ok(Math.abs(sa.avgX - th.EXA) < 0.03, 'E[X|A]');
    assert.ok(Math.abs(sa.fracLiars - th.PXlt1_A) < 0.03, 'P(X<1|A)');
    assert.ok(Math.abs(su.avgX - th.EXU) < 0.02, 'E[X|U]');
  });
}

test('Act II: narrowing matches the handoff (1.6%, 4.9%, 10.2%)', () => {
  assert.equal((narrowing(0.18) * 100).toFixed(1), '1.6');
  assert.equal((narrowing(0.31) * 100).toFixed(1), '4.9');
  assert.equal((narrowing(0.44) * 100).toFixed(1), '10.2');
});

test('best of 5 from the available pool matches the handoff section 5 targets (uniform)', () => {
  const d = JOB_TYPES.uniform.dist;
  assert.ok(Math.abs(bestOfK(d, 0.04, 0, 5) - 0.469) < 0.01);
  assert.ok(Math.abs(bestOfK(d, 0.04, 0.18, 5) - 0.572) < 0.01);
  assert.ok(Math.abs(bestOfK(d, 0.04, 0.44, 5) - 0.751) < 0.01);
});

test('best of 5, professional, matches docs/test-targets-lognormal.md', () => {
  const d = JOB_TYPES.professional.dist;
  assert.ok(Math.abs(bestOfK(d, 0.04, 0, 5) - 0.821) < 0.01);
  assert.ok(Math.abs(bestOfK(d, 0.04, 0.18, 5) - 0.894) < 0.01);
  assert.ok(Math.abs(bestOfK(d, 0.04, 0.44, 5) - 1.014) < 0.01);
});

test('pool density integrates to the steady-state mean', () => {
  const d = JOB_TYPES.professional.dist, xs = [];
  for (let i = 1; i <= 3000; i++) xs.push(i * 6 / 3000);
  const f = poolDensity(d, 0.04, xs);
  let m = 0; for (let i = 1; i < xs.length; i++) m += (xs[i] - xs[i - 1]) * (xs[i] * f[i] + xs[i - 1] * f[i - 1]) / 2;
  assert.ok(Math.abs(m - steadyState(d, 0.04).EXA) < 0.005);
});

test('exact narrowing in the skewed pool is a bit below the textbook figure', () => {
  const pro = JOB_TYPES.professional.dist, uni = JOB_TYPES.uniform.dist;
  const near = (a, b) => Math.abs(a * 100 - b) < 0.3;
  assert.ok(near(exactNarrowing(pro, 0.04, 0.18), 1.1));
  assert.ok(near(exactNarrowing(pro, 0.04, 0.44), 8.2));
  assert.ok(near(exactNarrowing(pro, 0.04, 0.9), 52.0));
  assert.ok(near(exactNarrowing(uni, 0.04, 0.44), 9.3));
});

test('normCdf is accurate', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.2816) - 0.9) < 1e-4);
  assert.ok(Math.abs(normCdf(-1.96) - 0.025) < 1e-4);
});

test('sourcing ladder matches the handoff section 3 targets (uniform)', () => {
  const L = ladder(JOB_TYPES.uniform.dist, 0.04);
  const want = { charm: 23.4, unstructured: 28.7, structured: 37.6, poach: 52.2, poachS: 66.1, friend: 39.6, excol: 67.8, ap3: 75.5, ap5: 79.6 };
  for (const [id, m] of Object.entries(want)) assert.ok(Math.abs(L[id].mean * 100 - m) < 0.8, id + ' ' + (L[id].mean * 100).toFixed(1));
  assert.ok(Math.abs(L.charm.q[0] * 100 - 61.1) < 1.2, 'charm Q1');
});

test('sourcing ladder matches docs/test-targets-lognormal.md (professional)', () => {
  const L = ladder(JOB_TYPES.professional.dist, 0.04);
  const want = { charm: 38.0, unstructured: 42.7, structured: 50.4, poach: 50.6, poachS: 65.1, friend: 52.1, excol: 66.8, ap3: 76.9, ap5: 82.1 };
  for (const [id, m] of Object.entries(want)) assert.ok(Math.abs(L[id].mean * 100 - m) < 0.8, id + ' ' + (L[id].mean * 100).toFixed(1));
});

test('counter-offer calculator matches the handoff section 4 targets (uniform)', () => {
  const d = JOB_TYPES.uniform.dist;
  const want = [[0.12, 0.5, 1.482, 0.986, 1.424], [0.12, 0.7, 1.637, 0.964, 1.581], [0.25, 0.5, 1.395, 0.927, 1.313], [0.25, 0.7, 1.542, 0.879, 1.452]];
  for (const [c, rE, cc, nc, won] of want) {
    const r = counterOffers(d, 0.04, c, rE, 0.5);
    assert.ok(Math.abs(r.countered.EX - cc) < 0.006 && Math.abs(r.not.EX - nc) < 0.006 && Math.abs(r.won.EX - won) < 0.006, `${c} ${rE}`);
    const all = counterOffers(d, 0.04, c, rE, 1);
    assert.ok(Math.abs(all.won.EX - all.countered.EX) < 1e-9, 'q = 1 wins every countered candidate');
  }
});

test('ladder with counter-offers: walking away matches the handoff section 4 target (uniform)', () => {
  const d = JOB_TYPES.uniform.dist, co = counterOffers(d, 0.04, 0.12, 0.5, 0.5);
  const ch = CHANNELS.find((c) => c.id === 'poachS');
  const none = sourceChannel(d, 0.04, ch, { n: 40000 }).mean * 100;
  const walk = sourceChannel(d, 0.04, ch, { n: 40000, counter: { rE: 0.5, t: co.t, tq: co.t } }).mean * 100;
  const half = sourceChannel(d, 0.04, ch, { n: 40000, counter: { rE: 0.5, t: co.t, tq: co.tq } }).mean * 100;
  assert.ok(Math.abs(walk - 62.0) < 0.8, 'walk ' + walk.toFixed(1));
  assert.ok(walk < half && half < none, 'winning some counter-counters recovers part of the loss');
});
