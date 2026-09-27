# The Lemon Market

An interactive simulation of how selection bias fills the pool of "available" people
with overselling, in both hiring and dating markets. It is a Monte Carlo simulation of
the continuous-time Markov chain in Connor's essay
[Deception is Amplified by Default](https://bosoncutter.substack.com/p/deception-is-amplified-by-default)
(Boson Cutter), with plain-language labels for the parameters.

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # static site in dist/ (relative paths, works from any subpath)
npm run preview  # serve the built site
npm test         # checks the simulation against the closed-form theory
```

Requires Node 18+.

Two essays, two URLs: `hiring/index.html` (`/Lemon-Markets/hiring/`) and `dating/index.html`
(`/Lemon-Markets/dating/`). The root `index.html` is a landing page to choose between
them; old links with a `#section` still land on the hiring essay. In dev, open http://localhost:5173/hiring/ or http://localhost:5173/dating/.

## Layout

The hiring page is a scrolling essay in five acts, plus a closing playbook.

| Path | What it is |
| --- | --- |
| `src/model.js` | The model: agent generation, one simulation step, pool statistics, closed-form theory. No DOM. |
| `src/story.js` | Act I scrolling story: one seeded population drawn as a mirrored dot histogram, driven by `data-*` attributes on each `.step` in `hiring/index.html`. |
| `src/playground.js` | Act I "Try it yourself" panel: the live simulator. |
| `src/act2.js` | Act II: one candidate's range of worth before and after an interview, and the interview playground. |
| `src/act3.js` | Act III: the sourcing ladder (quintile bars by channel), scroll story and playground. |
| `src/act4.js` | Act IV: counter-offers (who gets countered, the winner's curse), the calculator and the pipeline under counters. |
| `src/act5.js` | Act V: stopping rules (look-then-leap, recall, noisy reads), from precomputed data in `src/data/stopping.json`. |
| `src/density.js` | Shared density-curve drawing for Acts II and IV. |
| `src/jobs.js` | Page-wide job type (Professional / Unskilled / Worst case) and the `data-th` numbers in the copy. |
| `src/stepper.js` | Shared scroll-to-step logic for the scrolling stories. |
| `scripts/stopping-data.mjs` | Regenerates `src/data/stopping.json` (about 30 s). Rerun after changing the model or job types. |
| `scripts/targets.mjs` | Regenerates the handoff's test-target tables for any job type (see `docs/test-targets-lognormal.md`). |
| `src/chrome.js` | Masthead act rail, hero parallax dots, fade-in on scroll. |
| `src/colors.js` | Theme colors and canvas helpers shared by the charts. |
| `src/styles.css` | Styles (light and dark themes via CSS variables). |
| `test/model.test.js` | Simulation-vs-theory tests, including the Act I headline numbers. |
| `docs/methodology.md` | Full math and code walkthrough, written for outside review. |

## The dating page

`dating/index.html` is the dating edition: seven acts (the move online, the attention market, the app funnel,
who is left, the clock, the search, what to do) with a page-wide woman / man switch.

| Path | What it is |
| --- | --- |
| `src/dating/model.js` | Single-stage models: attention market, commitment filter, McCall reservation value, search odds, copulas. No DOM. |
| `src/dating/chain.js` | The chained model on one grid of people: who is single, the app funnel, search with first dates, mutual commitment, never-married cohorts. |
| `src/dating/scenario.js` | The calibrated model assembled from the data (attention layer plus mate value: who commits to whom); shared by the scripts and the page's worker. |
| `src/dating/main.js`, `charts.js`, `worker.js`, `dating.css` | The page: figures, scrolling stories, playgrounds, the live-scenario worker. |
| `scripts/dating/*.py` | Data aggregates (parquet, PSID, HCMST, NHANES, GSS, NSFG, ACS, NLSY97, digitized charts), run with `uv run`. |
| `scripts/dating/sensitivity.mjs`, `fit.mjs`, `chain.mjs`, `site-data.mjs` | Attention-market calibration, the mate-value fit (PSID sorting, census, ACS), the results and sweeps, and the page's precomputed tables. |
| `docs/dating/methodology.md`, `claims.md`, `sensitivity.md`, `results.md` | Methodology, the claim-by-claim source ledger, and the generated tables. |

Regenerate everything with the commands at the end of `docs/dating/methodology.md`.

## Parameter names

| On the page | In the model |
| --- | --- |
| Market churn | gamma = alpha_O / beta_O: search time divided by tenure for someone exactly as advertised (default 0.07; the handoff's targets use 0.04). Not the unemployment rate; P(available) runs from about gamma to 2x gamma depending on the job type. |
| Pool size | N |
| Truth ratio | X = actual quality / advertised quality, mean 1. Lognormal with CV 0.48 (Professional, default) or 0.19 (Unskilled); Uniform(0, 2] as the essay's worst case |

The market runs unscreened. Screening (a validity correlation r, with benchmarks 0.18 and 0.44 from
Sackett, Zhang, Berry & Lievens 2022) comes back in Act II as a property of reading one candidate,
not as a change to the population.
