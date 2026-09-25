// Pure model code: no DOM, no rendering. See docs/methodology.txt for the math.
//
// Each agent has a fixed "truth ratio" x = actual quality / advertised quality and
// is either Available ('A') or Taken ('U'). Time is measured so the hiring rate
// beta = 1; a taken agent returns to the market at rate gamma / x.

export const GAMMA_MIN = 0.03;
export const GAMMA_MAX = 1.3;
export const PRESET_HIRING = 0.04;
export const PRESET_DATING = 0.33;
export const BETA = 1;
export const DT = 0.05;
export const MIN_X = 0.02; // avoids dividing by zero in gamma / x

// Market Churn slider (0-100) <-> gamma, log scale.
export const gammaFromSlider = (v) => GAMMA_MIN * Math.pow(GAMMA_MAX / GAMMA_MIN, v / 100);
export const sliderFromGamma = (g) => 100 * Math.log(g / GAMMA_MIN) / Math.log(GAMMA_MAX / GAMMA_MIN);

// Screening skill r (validity correlation) -> half-width w of the truth-ratio
// distribution Uniform(1 - w, 1 + w). r = 0 gives the essay's Uniform(0, 2).
export function spreadWidth(r) { return Math.sqrt(1 - r * r); }

export function genAgents(n, screening, rng = Math.random) {
  const w = spreadWidth(screening);
  const arr = [];
  for (let i = 0; i < n; i++) {
    const u = rng() * 2;
    const x = Math.max(1 + (u - 1) * w, MIN_X);
    arr.push({ x, s: 'A', flip: -999 });
  }
  return arr;
}

// Advance every agent by one step of length dt. Each agent flips with
// probability (rate * dt): A -> U at BETA, U -> A at gamma / x.
export function step(agents, gamma, dt, tick, rng = Math.random) {
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (a.s === 'A') {
      if (rng() < BETA * dt) { a.s = 'U'; a.flip = tick; }
    } else if (rng() < (gamma / a.x) * dt) {
      a.s = 'A'; a.flip = tick;
    }
  }
}

export function poolStats(pool) {
  if (pool.length === 0) return { avgX: NaN, fracLiars: NaN };
  let sum = 0, liars = 0;
  for (let i = 0; i < pool.length; i++) {
    sum += pool[i].x;
    if (pool[i].x < 1) liars++;
  }
  return { avgX: sum / pool.length, fracLiars: liars / pool.length };
}

// Steady-state closed forms for X ~ Uniform(1 - w, 1 + w). At w = 1 these are
// exactly the formulas in the source essay.
//   PA      = P(available)
//   PXlt1_A = P(X < 1 | available)   (share of the market that is overselling)
//   EXA     = E[X | available]
//   EXU     = E[X | taken]
export function theory(gamma, w) {
  const L = Math.log((1 + w + gamma) / (1 - w + gamma));
  const PA = gamma * L / (2 * w);
  return {
    PA,
    PXlt1_A: Math.log((1 + gamma) / (1 - w + gamma)) / L,
    EXA: (2 * w - gamma * L) / L,
    EXU: (1 - gamma + gamma * gamma * L / (2 * w)) / (1 - PA),
  };
}
