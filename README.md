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

## Layout

| Path | What it is |
| --- | --- |
| `src/model.js` | The model: agent generation, one simulation step, pool statistics, closed-form theory. No DOM. |
| `src/main.js` | UI, canvas rendering, controls, animation loop. |
| `src/styles.css` | Styles (light and dark themes via CSS variables). |
| `test/model.test.js` | Simulation-vs-theory tests. |
| `docs/methodology.txt` | Full math and code walkthrough, written for outside review. |

## Parameter names

| On the page | In the model |
| --- | --- |
| Market Churn | gamma = alpha_O / beta_O (how much time even an honest person spends on the market relative to off it) |
| Pool Size | N |
| Your Screening Skill | r, a validity correlation; narrows the truth-ratio spread by sqrt(1 - r^2) |
| Truth Ratio | X = actual quality / advertised quality |

Screening benchmarks (0.18 unstructured, 0.44 structured interviews) are from Sackett,
Zhang, Berry & Lievens (2022), *Journal of Applied Psychology*, Table 2, validity
corrected for criterion unreliability. The mapping from r to the truth-ratio spread is
this project's own stylized assumption; see `docs/methodology.txt`, section 5.
