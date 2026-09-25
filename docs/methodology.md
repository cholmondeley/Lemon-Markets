# The Lemon Market: methodology and code notes

This document describes what every chart and number on the page computes, the math behind it, where
the parameters come from, and how the code was checked. It is written for an outside reviewer. Code
references are to files in `src/`; the model is pure JavaScript with no DOM in `src/model.js`.

Contents

1. [The market model](#1-the-market-model)
2. [Truth-ratio distributions (job types)](#2-truth-ratio-distributions-job-types)
3. [Steady state](#3-steady-state)
4. [Simulation (Act I)](#4-simulation-act-i)
5. [Reading one candidate (Act II)](#5-reading-one-candidate-act-ii)
6. [Where you source (Act III)](#6-where-you-source-act-iii)
7. [Counter-offers (Act IV)](#7-counter-offers-act-iv)
8. [When to stop (Act V)](#8-when-to-stop-act-v)
9. [Parameters and defaults](#9-parameters-and-defaults)
10. [Validation](#10-validation)
11. [Assumptions and limitations](#11-assumptions-and-limitations)
12. [Open items for the reviewer](#12-open-items-for-the-reviewer)
13. [Files](#13-files)

---

## 1. The market model

Source: Connor, "Deception is Amplified by Default", *Boson Cutter* (Substack), 2026. The two-state
chain and the closed forms for the uniform case are the essay's. Everything else on the page (the
lognormal job types, Acts II to V) is ours.

Each person has a true value V and an observed value O (how good they look on paper). The **truth
ratio** is X = V / O. X < 1 means they oversell; X > 1 means they are better than they look.

A person is either **Available** (A, looking) or **Unavailable** (U, employed). Transitions form a
continuous-time Markov chain:

- A → U at the hiring rate β, which depends only on O. Everyone on the page has the same résumé
  quality (O fixed), so β is the same for everyone.
- U → A at the leaving rate α_V = α_O / X, where α_O is the rate for someone exactly as advertised.
  People who oversell by half leave twice as fast. The functional form is the essay's assumption.

Time is measured so that β = 1 (one unit = one average search). Define the single market parameter

    γ = α_O / β = search time ÷ tenure, for someone exactly as advertised.

The stationary probability that a person with truth ratio x is looking is

    P(A | x) = (γ / x) / (γ / x + 1) = γ / (γ + x).                                          (1)

**γ is not the unemployment rate.** P(A) across the population comes out at roughly γ to 2γ,
depending on the distribution of X (Section 3).

**Page default γ = 0.07**: about a 3.5-month search per four-year job, close to the source essay's
white-collar example (~1/15). The handoff's reference tables use γ = 0.04; the tests keep those as
fixed checks, and `docs/test-targets-lognormal.md` reports both where they differ. Moving from 0.04 to
0.07 barely changes the professional headline numbers (Section 3): more churn on its own slightly
*softens* the skew, because people cycle back regardless of quality.

## 2. Truth-ratio distributions (job types)

The reader picks a job type with a switch that is shared by every act (`JOB_TYPES` in `model.js`,
state in `jobs.js`). All three have mean 1: on average, people deliver what their résumé claims.

| Job type | Distribution of X | CV (SD / mean) | Basis |
|---|---|---|---|
| **Professional** (default) | lognormal | 0.48 | SD of output ≈ 48% of the mean in high-complexity jobs |
| **Unskilled** | lognormal | 0.19 | SD of output ≈ 19% of the mean in low-complexity jobs |
| **Worst case** | Uniform(0, 2] | 0.577 | The source essay's assumption |

The CVs come from Hunter, Schmidt & Judiesch (1990), "Individual differences in output variability as
a function of job complexity", *Journal of Applied Psychology* (to be verified; see Section 12).
Given a fixed résumé, the spread of real performance is roughly the spread of output among people
doing the same job, because a résumé explains little of it.

For a lognormal with CV c: σ² = ln(1 + c²), μ = −σ²/2, so E[X] = 1.

**Why not the uniform as the default.** Uniform(0, 2] puts 10% of people below X = 0.2 and 1% below
0.02. Those people are hired and let go over and over, so they are almost always looking, and they
drive most of the essay's headline severity. The lognormal has almost no mass near zero and a long
right tail (a few people far better than their résumé, many a little worse), which matches the
performance literature better. Under the lognormal, 59% of people oversell at least a little, yet the
average is exactly as advertised.

**Charts.** The truth-ratio axis runs to the 99.5th percentile rounded up to a half (3.0 for
professional, 2.0 for the other two); anything beyond sits in the last column (`displayMax`).
Colors are symmetric in log ratio: 0.5 or below is full red, 1 is grey, 2 or above is full blue.

## 3. Steady state

### Closed forms (uniform)

For X ~ Uniform(1 − w, 1 + w) with L = ln((1 + w + γ) / (1 − w + γ)):

    P(A)        = γ L / (2w)                                                                  (2)
    P(X<1 | A)  = ln((1 + γ) / (1 − w + γ)) / L                                               (3)
    E[X | A]    = (2w − γ L) / L                                                              (4)
    E[X | U]    = (1 − γ + γ² L / (2w)) / (1 − P(A))                                          (5)
    P(X<0.4 | A)= ln((0.4 + γ) / γ) / L        (w = 1 only: the bottom fifth)

At w = 1 these are the essay's formulas. `theory(gamma, w)` implements them; the page uses w = 1 only.

### Any distribution (`steadyState`)

For the lognormal job types there is no closed form, so the page integrates over quantiles with the
midpoint rule: E[f(X)] = ∫₀¹ f(Q(u)) du with M = 20,000 points, weighting each point by (1). This
gives P(A), E[X | A], E[X | U], the SD of X in the looking pool, the share of the pool that
oversells, the share from the bottom and top fifths of the whole population, and pool quantiles.
Checked against (2) to (5) for the uniform to 1e-4.

### Headline numbers (page default γ = 0.07; γ = 0.04 in brackets)

| | Professional | Unskilled | Worst case |
|---|---|---|---|
| Share of everyone looking, P(A) | 7.8% (4.6%) | 6.7% (4.0%) | 11.9% (7.9%) |
| Oversell, whole population | 59% | 54% | 50% |
| Oversell, among those looking | 74% (75%) | 61% (61%) | 81% (83%) |
| Average truth ratio of those looking | 0.83 (0.82) | 0.97 (0.97) | 0.52 (0.47) |
| Average truth ratio of the employed | 1.01 (1.01) | 1.00 (1.00) | 1.06 (1.05) |
| Looking pool from the bottom fifth | 33% (34%) | 25% (25%) | 56% (61%) |
| Looking pool from the top fifth | 10% (10%) | 15% (15%) | 6% (6%) |

## 4. Simulation (Act I)

A direct simulation of the chain (not MCMC). Each person has a fixed X and flips state independently
each step of length dt = 0.05 with probability rate × dt: A → U with β dt, U → A with (γ / x) dt
(`step` in `model.js`).

**Why rate × dt.** For independent two-state chains the stationary share in A depends only on the
ratio of the per-step probabilities. With q = γ dt / x, the discrete chain's P(A | x) = q / (dt + q)
equals (1) exactly whenever q < 1. Only people with x < γ dt (0.002 at γ = 0.04) hit the cap of
probability 1; their mass is negligible. The alternative 1 − exp(−rate dt) distorts the ratio and
matched theory worse in testing.

**No floor on x.** X is drawn so it is never exactly 0 (`2(1 − u)` for the uniform, exp of a normal
for the lognormal), so γ / x is always finite. An earlier version clamped x at 0.02; that biases
E[X | A] by +2% under the uniform at γ = 0.04. Resampling below 0.02 is worse (+11%), because it
removes exactly the people most likely to be looking. Exact discrete-chain values at γ = 0.04:

| Treatment | P(A) | E[X \| A] | P(X<1 \| A) |
|---|---|---|---|
| Theory | 0.0786 | 0.4687 | 0.8286 |
| No floor (shipped) | 0.0786 | 0.4688 | 0.8286 |
| Clamp at 0.02 | 0.0772 | 0.4782 | 0.8254 |
| Resample below 0.02 | 0.0712 | 0.5215 | 0.8089 |

**The scrolling story** (`story.js`) uses one seeded population so every reader sees the same run
(mulberry32, seed 20260924 + column count). People are stratified by quantile, so the starting
population has exactly the job type's shape: 500 people on wide screens, 300 on narrow ones. Everyone
starts looking (the essay's initial condition). One scroll step covers 12 time units; after that the
market runs live at 0.5 units a second. The clock shows months at 3.5 months per unit, which is
illustrative: a 3.5-month search per four-year job gives γ = 0.07. The chips show theory values
next to "this run" counts; with about 40 people looking, a single run is noisy. The average marker
is drawn at the theoretical E[X | A], not the run's mean, for the same reason.

**The playground** (`playground.js`) is the live simulator: 260 people by default, a new random
population each load, γ on a log slider from 0.03 to 1.3, and "Jump to steady state" runs 4,000
steps (t = 200). The theory lines come from `steadyState`.

## 5. Reading one candidate (Act II)

**Signal model.** An assessment with validity r produces

    s = r (x − 1) / SD + √(1 − r²) ε,     ε ~ N(0, 1),                                        (6)

where SD is the population SD of X (its CV). Across the whole population s has variance 1 and
correlation r with X. The same form is used in every act.

**Validities.** Unstructured interview r = 0.18, structured r = 0.44: Sackett, Zhang, Berry &
Lievens (2022), *Journal of Applied Psychology*, Table 2, validity corrected for criterion
unreliability. The paper's headline estimates, which also correct for range restriction, are 0.19
and 0.42. The page treats 0.44 as about the best any interview reaches, which is why the playground
offers only unstructured / structured (and a perfect read in Act V for reference).

**How much one interview narrows the range.** The page quotes the exact figure for the skewed looking
pool: the drop in the spread of what the person might be worth, averaged over every interview result,

    narrowing = 1 − √(E_s[Var(X | s)]) / SD(X | A),                                          (7)

computed by quadrature (`exactNarrowing`: 1,200 quantile points, s from −6 to 6 in steps of 0.05).
The textbook figure 1 − √(1 − r²) assumes a bell curve; the skewed pool narrows a little less:

| r | Textbook | Professional | Unskilled | Worst case |
|---|---|---|---|---|
| 0.18 | 1.6% | 1.1% | 1.5% | 1.4% |
| 0.44 | 10.2% | 8.3% | 9.8% | 9.6% |
| 0.90 | 56.4% | 52.1% | 55.6% | 58.7% |

**Curves.** The "before" curve is the looking pool's density f(x) γ / (γ + x). The "after" curve
multiplies by the likelihood of the interview result and renormalizes (`poolDensity`). The story
uses one fixed result, s = 1 ("it goes well", better than about five in six).

**Several interviews.** The playground lets interviews accumulate. They are treated as independent
reads: n reads averaging s̄ have likelihood exp(−n (s̄ − m)² / (2(1 − r²))). Real interviews share
error (the same candidate impression), so the page says the gain in practice is smaller. Switching
between unstructured and structured re-reads the same interviews: each interview's noise ε is kept.

**Star candidate.** A playground button sets the candidate's truth by fiat, uniform between 1.5 and 4,
to show how little one interview moves toward a real star. It is not drawn from the pool.

**Best of k** (`bestOfK`). Draw k people from the looking pool (inverse-CDF sampling on a 4,000-point
quantile grid), read each with (6), hire the top read; average X of the hire over 30,000 trials.
Professional, k = 5: 0.82 (no interview), 0.90 (r = .18), 1.02 (r = .44).

## 6. Where you source (Act III)

Each channel draws a slate from a pool, reads each person with validity r, and hires the top read
(`sourceChannel`). A hire's quality percentile is its quantile u in the whole population; its
quintile is floor(5u). Following the handoff spec:

| Channel | Pool | Read r | Network ρ | Slate |
|---|---|---|---|---|
| Charm alone | looking | 0 | — | 5 |
| Unstructured interview | looking | 0.18 | — | 5 |
| Structured interview | looking | 0.44 | — | 5 |
| Random poach | employed | 0 | — | 5 |
| Poach + structured | employed | 0.44 | — | 5 |
| Job-hunting friend | looking | 0.49 | — | 3 |
| Employed ex-colleague | employed | 0.49 | — | 3 |
| A-player referral | employed | 0.49 | .3 / .5 / .8 | 3 |

- **Pools.** Looking: accept a draw with probability γ / (γ + x). Employed: x / (γ + x).
- **Referrals.** You only get one name, so the "slate" is inside the referrer's head: they weigh the
  people they could send and send the one they rate best. The page uses 3 ("generous"; most referrers
  probably consider one to three). The handoff's tables used 5.
- **The referrer's read**, r = 0.49, is the validity of peer ratings (Schmidt & Hunter, 1998),
  standing in for how well a former co-worker knows someone's work.
- **Network homophily.** A-player contacts have latent quality z ~ N(ρ z_ref, 1 − ρ²), mapped to the
  population by u = Φ(z), x = Q(u), then kept with the pool's odds. The referrer sits at the 90th
  percentile (z_ref = 1.2816) or, in the playground, the 99th (2.3263). ρ is assumed, not estimated;
  the story shows .3, .5 and .8, and the playground defaults to .8.
- **Monte Carlo.** 20,000 slates per row on the page, seeded, cached per job type.

Professional, γ = 0.07, mean percentile of the hire (interview 5, referrer weighs 3):

| Channel | Mean percentile | Truth ratio |
|---|---|---|
| Charm alone | 38.5 | 0.83 |
| Unstructured interview (open market) | 43.5 | 0.91 |
| Structured interview (open market) | 50.7 | 1.02 |
| Random poach | 50.6 | 1.01 |
| Poach + structured | 65.6 | 1.30 |
| Job-hunting friend | 48.4 | 0.97 |
| Employed ex-colleague | 62.2 | 1.22 |
| A-player referral ρ = .3 / .5 / .8 | 72.6 / 78.6 / 85.8 | 1.44 / 1.57 / 1.65 |
| Best case: 99th-percentile referrer, ρ = .8 | — | ≈ 2.50 |

At ρ = .8 the network does most of the work: even a referrer who weighs only one person lands at the
81st percentile.

At a slate of one, every interview row falls to the pool average, and a referral is a random draw
from the referrer's network ("nepotism is a referral with a slate of one").

## 7. Counter-offers (Act IV)

Everyone here has a job and an outside offer (the employed pool). Their current employer reads them
with validity r_E and counters when its read clears a threshold t, set so that a share c of people
are countered. The employer matches up to its own valuation, so you win only the countered people it
valued least: those whose read falls in the bottom q of countered reads (the **winner's curse**).

- **c = 12%**: Faberman, Mueller, Şahin & Topa (2022), *Econometrica*, about 12% of employed people
  with an outside offer got some form of counter.
- **r_E = 0.7**: two supervisors rating the same person's overall performance agree at about .52
  (Viswesvaran, Ones & Schmidt, 1996, *Journal of Applied Psychology*), so one supervisor tracks true
  performance at about √.52 ≈ .72. Several raters weighing in would push it higher (two raters
  combined ≈ .83); counters made for other reasons (replacement cost, blanket retention policies)
  would pull it lower. The handoff's default was 0.5, labeled an assumption.
- **q = 0.5**: you win half the fights.

**Exact computation** (`counterOffers`). On a 4,000-point quantile grid of the employed pool, the
probability that someone with truth ratio x is countered is 1 − Φ((t − m(x)) / σ), with
m(x) = r_E (x − 1) / SD and σ = √(1 − r_E²). t is found by bisection so the countered share is c;
a second threshold t_q (share above it c (1 − q)) marks the countered people you win, those with
t < read ≤ t_q. Group means of X and of the percentile u follow by quadrature.

Professional, γ = 0.07, c = 12%, q = 0.5:

| r_E | Countered | Countered and won | Not countered | Gap | Lift |
|---|---|---|---|---|---|
| .5 | 1.54 | 1.35 | 0.94 | 0.40 | +43% |
| .7 (page) | 1.75 | 1.48 | 0.91 | 0.57 | +62% |
| .8 | 1.85 | 1.56 | 0.90 | 0.65 | +73% |

**Break-even.** Everyone has the same résumé, so a person with truth ratio X creates X times the value
V an as-advertised hire creates. A countered hire you win creates (E[X | won] − E[X | not countered])
× V more per year than one nobody fought for. That is the most you could pay above what you'd pay the
other person and still come out even. Page default: salary $150,000, V = $300,000 a year, giving
about $170,000 a year (114% of salary) at r_E = .7. For unskilled jobs the gap is smaller (0.22,
about 45% of salary), and the page's wording switches accordingly. V is a placeholder: roles are opened only when a
hire should create noticeably more value than they cost.

**Pipeline under counters.** For employed-pool channels you offer down your ranked slate. Each
candidate is countered if the employer's read exceeds t; you keep a countered candidate only if you
win the counter-counter, which by the winner's curse happens when the read is at most t_q. "Walk
away" sets t_q = t. The first acceptor is hired. The handoff used a coin flip for the counter-counter;
the winner's curse keeps the pipeline consistent with the calculator. Counters concentrate in the best
channels: at r_E = .7, the first choice from an A-player referral (ρ = .8) is countered 40% of the
time, against 12% for a random poach; that row goes 86th → 80th (walk away) → 82nd (counter back).

**The "strong first offer" conclusion** follows from the size of the break-even. The model does not
simulate how the size of the first offer changes the chance of a counter.

## 8. When to stop (Act V)

**Setup** (`stoppingRun`). Candidates arrive one at a time from the looking pool (the open market).
You read each with validity r (r = 1 is a perfect read, the textbook secretary problem). Look-then-
leap: pass on the first round(f n) (at least 1), then hire the first whose read beats the best read
so far. If nobody does, you take the last candidate; with **recall**, you go back to the best read you
saw who is still available. Percentiles are within the candidate stream.

**Quality-filtered availability.** Other employers are interviewing the same people. Each candidate
gets an independent structured read from them (r = 0.44) and is hired away at rate proportional to
exp(κ × that read), normalized to one hire per average search, with κ = 0.54. Someone in the top 10%
of interviews (z ≈ 1.28) is hired away about e^(0.54 × 1.28) ≈ 2 times as fast as the median. A
candidate seen at position i is still available at the end with probability exp(−rate × elapsed),
where the whole search lasts D = 1 average search. κ and D are assumptions. In testing, κ from 0 to 1
changed the results by a point or two, because recall only needs someone good to remain, not the
single best; longer searches (D = 2, 4) shrink recall's value more.

**Data.** `scripts/stopping-data.mjs` runs every combination (3 job types × 5, 10, 20, 50 or 100
candidates × r ∈ {1, 0.44, 0.18} × recall on/off × 11 cut-offs from 2% to 60%) at 6,000 searches
per point and writes `src/data/stopping.json` (about 40 s). The page reads it; nothing is simulated
in the browser.

Professional, γ = 0.07, look at 20% first:

| Interviewed | Read | Top-5% hire | with recall | Top-10% hire | with recall | Mean percentile | with recall |
|---|---|---|---|---|---|---|---|
| 100 | Perfect | 68% | 84% | 79% | 97% | 88th | 97th |
| 100 | Structured | 25% | 28% | 35% | 39% | 70th | 74th |
| 10 | Perfect | 16% | 21% | 29% | 37% | 73rd | 81st |
| 10 | Structured | 10% | 11% | 17% | 19% | 58th | 60th |

Findings the page reports: with a perfect read and 100 candidates, evaluating ~20% beats the
textbook 37% if a top-5% hire is good enough (68% vs 60%), and needs about 30% fewer interviews
(53 vs 74). With realistic
interview counts (~10) and reads, the stopping rule and recall move results by a few points; what's
in the slate matters more.

**Sources.** The problem reached a wide audience through Martin Gardner's 1960 *Scientific American*
column; Lindley (1961) and Dynkin (1963) worked out the 1/e rule; Ferguson (1989), "Who Solved the
Secretary Problem?", *Statistical Science*, tells the history. Recall ("backward solicitation") is
studied in Yang (1974), *Journal of Applied Probability*. The numbers on the page come from our own
simulations, modeled on the author's earlier dating simulations (evaluate a fraction, take the first
who beats them, fall back to the last).

## 9. Parameters and defaults

| On the page | Symbol | Default | Source / note |
|---|---|---|---|
| Market churn | γ = α_O / β | 0.07 | 3.5-month search per four-year job, close to the essay's white-collar example (~1/15); provisional (Section 11). Handoff targets use 0.04. |
| Job type | CV of X | 0.48 (professional) | Section 2 |
| People in this market | N | 260 (playground) | Looking plus employed |
| Hiring rate | β | 1 | Sets the time unit |
| Time step | dt | 0.05 | |
| Interview validity | r | 0.18 / 0.44 | Sackett et al. (2022) |
| Ex-colleague / referrer read | r | 0.49 | Peer ratings, Schmidt & Hunter (1998) |
| Candidates you interview | k | 5 (Act III), 10 (Act V playground) | |
| People a referrer weighs | k | 3 | Author's judgment ("generous") |
| Network homophily | ρ | .3 / .5 / .8 in the story; .8 in the playground | Assumed |
| A-player referrer | z_ref | 90th percentile (99th optional) | Handoff spec |
| Counter rate | c | 12% | Faberman et al. (2022) |
| Employer's read | r_E | 0.7 | Viswesvaran et al. (1996) |
| Counters you win | q | 50% | Winner's curse |
| Value / salary | V / S | $300,000 / $150,000 | Placeholder |
| Competing-offer selectivity | κ | 0.54 | Assumed |
| Search length (recall) | D | 1 average search | Assumed |

## 10. Validation

`npm test` runs 21 checks in `test/model.test.js`. The deploy workflow runs them before every build.

- **Closed forms**: `theory` reproduces the essay's formulas at w = 1; population mean X is 1.
- **Quadrature**: `steadyState` matches the closed forms for the uniform to 1e-4; every job type has
  mean 1; headline numbers at the handoff's γ = 0.04 (75%, 0.82, 34%, 4.6% professional; 83%, 0.47,
  61% uniform). The tests pin γ = 0.04 explicitly so they stay tied to the handoff's targets.
- **Simulation vs theory**: 40,000 people run to t = 60 for each job type; P(A), E[X | A],
  P(X<1 | A) and E[X | U] within sampling error.
- **No floor**: mass below x = 0.02 is kept.
- **Act II**: textbook narrowing (1.6%, 4.9%, 10.2%); exact narrowing (1.1%, 8.2%, 52.0%
  professional; 9.3% uniform); best of five reproduces the handoff's section 5 targets (0.469, 0.572,
  0.751 uniform) and the professional values (0.821, 0.894, 1.014); the pool density integrates to
  E[X | A].
- **Act III**: the ladder reproduces all nine handoff section 3 means for the uniform within 0.8
  points, and the professional table in `docs/test-targets-lognormal.md`.
- **Act IV**: the calculator reproduces the handoff section 4 table for the uniform within 0.006;
  q = 1 wins every countered candidate; walking away reproduces the handoff's pipeline target (62.0);
  winning some counter-counters recovers part of the loss.
- **Act V**: a perfect read at 37% with no recall finds the single best about 37% of the time (the
  classic 1/e result); recall lifts the average.

`scripts/targets.mjs` regenerates the handoff's section 3 to 5 tables for any job type (the uniform
run reproduces every handoff table). `docs/test-targets-lognormal.md` holds the professional and
unskilled tables, the page-default tables, and the Act V grid, for independent re-simulation.

The page was checked in a browser on desktop and phone widths, in light and dark themes, with no
console errors.

## 11. Assumptions and limitations

1. **One churn rate for everyone**, and people who oversell leave in exact proportion to how much they
   oversold (α_V = α_O / X). Other monotone forms would change the numbers.
2. **Job search is changing.** AI tools have made résumés more polished and less informative, and
   employers and candidates widely report that searching has gotten harder. The market hasn't settled
   into a new equilibrium, so the default γ = 0.07 is provisional. In this model the two channels
   pull in different directions: less informative résumés widen the spread of X, which worsens the
   skew (at γ = 0.055 with a gamma-distributed X, raising the CV from 0.58 to 0.71 drops E[X | A]
   from 0.70 to 0.58); more churn alone slightly softens it (0.695 at γ = 0.04 to 0.715 at 0.08).
   The page does not yet model AI-driven loss of résumé informativeness directly; the job-type
   spread is the closest lever.
3. **No state for searching while employed.** On-the-job searchers (about 22% of the employed searched
   in the last four weeks, per Faberman et al. 2022) are counted as employed. A real applicant pool
   mixes them with the out-of-work, so it is likely less lemon-heavy than Act I shows.
4. **Hiring depends only on the résumé** (O fixed); the page conditions on one résumé quality.
5. **X is fixed per person**; no learning, aging, entry or exit. Everyone starts looking in Act I.
6. **Distribution of X.** Lognormal spreads are taken from output variability, a proxy for how far
   performance strays from a résumé. The uniform is kept as a worst case.
7. **Signals are linear-normal (6)**; interviews are independent reads of the same person in the Act II
   playground (real interviews share error).
8. **Assumed parameters**: ρ, the referrer's slate of 3, r_E (grounded but not measured for counters),
   q, V, κ and D. The model's referral gaps are larger than measured real-world referral effects.
9. **Counter-offers**: counters happen only on quality reads; the size of the first offer does not
   change counter rates.
10. **Stopping**: percentiles are within the candidate stream; candidates arrive at an even pace.
11. **Scope**: the model applies to scarce, deception-rewarding matching markets (the essay's own scope).
    Dating is not modeled yet.

## 12. Open items for the reviewer

Citations to verify (some were written from memory or relayed from the handoff):

- Hunter, Schmidt & Judiesch (1990): output SD ≈ 48% (high complexity) and 19% (low complexity) of
  the mean.
- Viswesvaran, Ones & Schmidt (1996): interrater reliability of supervisory ratings of overall job
  performance ≈ .52.
- Schmidt & Hunter (1998): peer-rating validity ≈ .49.
- Faberman, Mueller, Şahin & Topa (2022): ~12% counter rate; ~22% of employed searched in the last
  four weeks.
- Act III evidence cards: Burks, Cowgill, Hoffman & Housman (2015, QJE); Pallais & Sands (2016, JPE);
  Friebel, Heinz, Hoffman & Zubanov (2023, JPE), especially "bigger bonuses bring more but
  lower-quality referrals"; Bennedsen, Nielsen, Pérez-González & Wolfenzon (2007, QJE).
- Secretary problem: Gardner (1960), Lindley (1961), Dynkin (1963), Ferguson (1989), Yang (1974).

Modeling choices worth scrutinizing:

- Mapping output variability to the spread of X given a résumé (Section 2).
- The exact-narrowing definition (7), averaged over interview results.
- Winner's-curse counter-counters in the pipeline instead of the handoff's coin flip (Section 7).
- Quality-filtered availability for recall (κ, D) in Act V.
- The value-based break-even and the $300,000 / $150,000 placeholder.

## 13. Files

| Path | Contents |
|---|---|
| `src/model.js` | All model code: distributions, steady state, simulation step, signals, Acts II–V functions. No DOM. |
| `src/jobs.js` | Job-type switch and the page's `data-th` numbers (every figure in the prose). |
| `src/story.js`, `src/playground.js` | Act I story and live simulator. |
| `src/act2.js` … `src/act5.js` | Acts II–V stories and playgrounds. |
| `src/density.js`, `src/colors.js`, `src/stepper.js`, `src/chrome.js` | Shared drawing, colors, scroll steps, page chrome. |
| `src/data/stopping.json` | Precomputed Act V grid (`scripts/stopping-data.mjs`). |
| `scripts/targets.mjs` | Regenerates the handoff tables for any job type. |
| `test/model.test.js` | The checks in Section 10. |
| `docs/test-targets-lognormal.md` | Target tables for independent re-simulation. |
