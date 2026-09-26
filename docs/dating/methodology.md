# The Lemon Market, dating edition: methodology and code notes

What every chart and number on the dating page computes, the math behind it, where each input comes
from, how it was calibrated and checked, and what it leaves out. Written for an outside reviewer.
Code references are to `src/dating/model.js` (single-stage models), `src/dating/chain.js` (the
chained model) and the scripts in `scripts/dating/`. The source ledger, claim by claim, is
`docs/dating/claims.md`; the generated tables are `docs/dating/sensitivity.md` and
`docs/dating/results.md`.

Contents

1. [Data](#1-data)
2. [Conventions: percentiles and the Gaussian copula](#2-conventions-percentiles-and-the-gaussian-copula)
3. [The attention market](#3-the-attention-market)
4. [Inbox load](#4-inbox-load)
5. [Who is single: the commitment filter and the lemon effect](#5-who-is-single-the-commitment-filter-and-the-lemon-effect)
6. [Bars that rise with options](#6-bars-that-rise-with-options)
7. [The app funnel](#7-the-app-funnel)
8. [Search, first dates and commitment](#8-search-first-dates-and-commitment)
9. [Age](#9-age)
10. [Search math: the rarity you can find](#10-search-math-the-rarity-you-can-find)
11. [Mitigations: age gaps, GLP-1s, exchange rates](#11-mitigations-age-gaps-glp-1s-exchange-rates)
12. [Parameters and defaults](#12-parameters-and-defaults)
13. [Validation](#13-validation)
14. [Assumptions and limitations](#14-assumptions-and-limitations)
15. [Files and how to regenerate](#15-files-and-how-to-regenerate)

---

## 1. Data

| Source | What we use | Script |
|---|---|---|
| Dating Calculator parquet (`dcalc_app_v2.parquet`): ACS persons with NHANES-imputed bodies, up to 8 imputation draws per person, weights summing to US adults (~262M) | Single and never-married shares by age and sex; WHR by age; marriage by earnings quintile; never-married profile at 40-49; incidence of the example standards; metro densities; WHR-income exchange rates | `pools.py`, `exchange.py` |
| Paul, "What really happens inside a dating app" (blog.luap.info, Jan 2025) | Four histograms (like rate given and received, by sex), digitized; intent by attractiveness; retention; app purposes | `digitize.py` |
| Hinge like shares (top 1/5/10%, bottom 50%) | Calibration target for exposure | constants |
| OkCupid (Rudder, OkTrends / *Dataclysm*) | Share of the opposite sex interested in a person by age, digitized | `digitize.py` |
| Geruso et al. (2023), App. Fig. A4 | Monthly birth probability by age, digitized | `digitize.py` |
| GSS 1972-2024 R3a (years 2000+) | Cheating by partner count, income, prestige, the author's tier list; partner concentration | `gss.py` |
| NSFG 2017-19 and 2022-23 | Sex with someone first met online; partners in the past year; concentration | `nsfg.py` |
| ACS 2024 1-year PUMS | Age gaps in recent marriages by the husband's income; reach by the wife's age at marriage | `agegap.py` |
| NLSY97 (men) | Measured AFQT, height, BMI and income: joint-tail check of the copula | `tails.py` |
| Literature | Connelly & Ones (2010) reads of personality; Feingold (1992) and Langlois et al. (2000) looks vs traits; Solomon & Jackson (2014) personality and breakup; STEP 1 and SURMOUNT-1 waist changes | constants |

Weights: parquet and ACS aggregates use person weights; GSS uses `wtssps` (else `wtssall`); NSFG uses
the wave weight. Digitized histograms are relative counts; their medians reproduce the source post's
stated medians (men like 26%, women 4.5%, men receive 5%, women 38%).

## 2. Conventions: percentiles and the Gaussian copula

Every trait is handled as a percentile and mapped to a normal score z = Φ⁻¹(percentile). Joint
behavior comes from correlations between normal scores, which is a Gaussian copula. Marginal shapes
never matter (income's skew, WHR's range): only ranks and how they co-move.

A Gaussian copula has no tail dependence. We checked it against measured joint tails in NLSY97 men
(`tails.py`, n = 2,299). Normal-score correlations: height-income 0.06, fitness-income 0.02,
IQ-height 0.09, IQ-fitness 0.06, IQ-income 0.38. Pairs and most triples in the top 10-20% match the
Gaussian prediction (top 10% on IQ and income: 23.5 per 1,000 observed vs 25.6 predicted; t-copulas
overshoot). All four traits at once run 1.5-2.5x above it (top 20% on all four: 7.4 per 1,000 vs 4.6),
but on 3-17 people. The page uses the Gaussian copula only; t-copula versions (`traitRarityT`,
`hitRateT`) are kept in the code for this check.

Numerics: `normSf` (upper normal tail) uses the Numerical Recipes `erfcc` form for small relative
error far out in the tail (1-in-250k targets); integrals use composite Simpson's rule.

## 3. The attention market

`receivedRatio`, `attentionMarket` in `model.js`.

Each person on one side has appeal z ~ N(0, 1): what a swipe measures (looks, height, photos, job
line). A viewer's impression is ρz + √(1 − ρ²)e, with ρ the consensus and e her own taste. Viewer i
likes a fixed share lᵢ of what she is shown (the founder's observation that a woman's like rate barely
moves with what she sees), so she likes anyone above tᵢ = z₁₋ₗᵢ. With equal exposure the share of
viewers who like a person at z is

    R(z) = Σᵢ wᵢ P(ρz + √(1−ρ²)e > tᵢ),

whose average over z is the mean like rate (a test checks this).

**Activity weighting.** People who like more also swipe more, so the received mean sits above the
per-person mean (men receive 7.0% vs women's 6.1% mean like rate; women receive 39% vs men's 33%). Like
rates are re-weighted by x^a with a chosen to match (a = 0.14 women, 0.30 men).

**Fit.** ρ is fitted by grid search to the digitized received-ratio histogram, with binomial noise for
100 views per profile, minimizing the KS distance. Women rating men: ρ = 0.48 (KS 0.052); men rating
women: ρ = 0.56 (KS 0.025). Men agree about women more than women agree about men; the concentration
on men comes from women's low like rate (4.5%), which turns moderate agreement into a steep tail.
The tail above the mode fits density ∝ x^−2.2 (Pareto index ≈ 1.2).

**Exposure.** Hinge counts likes including how often each profile is shown. Views ∝ e^{κz} (mean 1); κ
is fitted to Hinge's top-5% share alone: κ = 0.74 for men (a top-5% man is shown 4.2x as often as the
median), 0.86 for women. The other Hinge figures are out of sample:

| | Top 1% | Top 5% | Top 10% | Bottom 50% |
|---|---|---|---|---|
| Men, model | 17% | 41% (fitted) | 57% | 5.9% |
| Men, Hinge | 16% | 41% | 58% | 4% |
| Women, model | 11% | 31% (fitted) | 46% | 10.5% |
| Women, Hinge | 11% | 31% | 46% | 8% |

Cross-checks: Swipestats' match spreads (90th/50th, 50th/10th) fall between the equal-exposure and
Hinge-exposure versions; offline, GSS men 25-45 show the top 5% holding 40% of lifetime partners
(top 10%: 54%).

## 4. Inbox load

`inboxLoad`: likes arriving to the average woman per day = men per woman × swipes per man × men's like
rate; answering K conversations a day means answering the top K / incoming. At 2.7 men per woman (Pew
2022, 18-29 current users), 100 swipes a day and a 39% activity-weighted like rate, about 105 likes a
day arrive; with time for 5 she keeps the top ~5%.

## 5. Who is single: the commitment filter and the lemon effect

`singlePool`, `casualShareOnApp`, `commitmentByPercentile`.

A share b of men are casual; serious men pair off at rate λ when they meet someone they want, casual
men at k_c·λ; relationships end at rate δ. Stationary chance of being single: δ / (δ + kλ). λ is
proportional to the likes a man gets, so with x = λ/δ for a serious man,

    casual share among single men = [b/(1 + k_c x)] / [b/(1 + k_c x) + (1 − b)/(1 + x)].

Calibrated to the founder's chart (casual share on the app by attractiveness, 8 groups: 23, 22, 30,
33, 35, 41, 46, 52%): b = 0.2, k_c = 0.1, x at the median man = 1.65 (RMSE 2.5 points). No
difference in intent by looks is needed; selection alone produces the gradient. It requires casual men
to pair off at under b(1 − t)/((1 − b)t) ≈ 23% of the serious rate for the top share t = 52% to be
reachable at all.

**Lemon effect (Connor).** Partner quality Q = ρ_Qz z + √(1 − ρ_Qz²) e, where e is the part of quality a
profile does not show. Relationships end sooner for people worse than they look: δ = exp(−λ_L e).
λ_L = 0.3 means breakup odds x1.35 per SD of unseen quality, at the strength of the largest single
personality effect on breakup in HILDA (neuroticism OR 1.36 per unit; conscientiousness 0.88;
agreeableness 0.91; Solomon & Jackson 2014). Karney & Bradbury (1995) find neuroticism the most
consistent predictor. The hiring page's professional spread corresponds to 0.46, the top of the sweep.

The hiring page's two-state chain applied to dating churn (γ = time single / relationship length) is
in `sensitivity.md` §8 for comparison.

## 6. Bars that rise with options

`reservation` (McCall search) in `model.js`; `likeRateCurve`, `commitRule` in `chain.js`.

Prospects arrive at rate L with quality q ~ N(0, 1); the optimal policy accepts anyone above w, where
w = L·E[(q − w)⁺] = L(φ(w) − wS(w)). More arrivals raise the bar: the acceptance share S(w) falls.

- **Liking.** A person's like rate is the acceptance share at L = L₀·demand(u), with L₀ set so the
  median man likes 33% of profiles and the median woman 4.5% (founder). The founder's scatter of like
  rate against likes received slopes gently down for men, as this predicts.
- **Committing.** After months of dating, a serious person commits only if the partner clears a bar
  set the same way; the partner's value to them is β·(partner appeal) + √(1 − β²)·chemistry, with β the
  consensus of the committer's sex (0.56 for men judging women, 0.48 for women judging men). Casual
  people commit at k_c times the rate. **Both must commit.** The median-to-median chance (0.30) is
  fitted so that a median woman on an app, choosing like the app-wide consensus, has the census chance
  of marrying between 25 and 30 (34% of never-married women 25 are married by 30).

This is what keeps "serious" from reading as a commitment rate: "says serious" is stated intent (the
commitment filter), commitment is a separate, two-sided, option-dependent event. A 90th-percentile man
commits to a median woman he has dated for months 11% of the time (28% to a 90th-percentile woman).

## 7. The app funnel

`appFunnel`.

One year on an app, counted from the women's side. A woman at appeal y is shown viewsW men, likes her
share by her read, is liked back by each man at his own rate, and has time for datesW first dates,
which go to the best-reading of her matches (same read, so it is a higher threshold, not a second
draw). Only a share activeW of women users actually date in a year. With `ratio` men per woman, per man
at relative exposure s:

    likes   = (viewsW / ratio) · s · E_y[P(she likes him)]
    matches = (viewsW / ratio) · s · E_y[P(she likes him) · P(he likes her)]
    dates   = activeW · (viewsW / ratio) · s · E_y[P(he clears her date bar) · P(he likes her)]

capped softly at his own capacity datesM. A date ends in sex with probability p(z) = p₀e^{γz}; partners
~ Poisson(dates · p). A test checks that men's dates add up to active women's dates.

**Calibration to NSFG 2022-23** (straight, 18-35): women with any app sex average 2.8 partners, which
pins datesW · p ≈ 2.6 per actively dating woman (datesW = 13, p ≈ 0.2); with ~7% of single women having
any app sex and ~35-40% of them using apps, only ~20% of women users date in a year (activeW = 0.2),
matching the founder's 15-25% day-30 retention for women. γ = 1 reproduces men's 3.4 partners among
those with any (model 3.4). Ratio = 1.5 men per woman over a year (Pew ever-used 58/42; NSFG totals),
not the 2.7 seen at a moment.

Outputs: 60% of male users get no first date in a year (84% of the bottom half); the top 10% of men get
66% of first dates. NSFG context: 47% of straight single men 18-35 had no partner in the past year
(28% in 2017-19); 6.1% had sex with someone met online (13.3%); the top 10% hold 52% of partners.

Lana Li's Hinge data (a 35-year-old NYC founder over three years: ~680 likes, ~115 matches, ~19
meetup attempts a year) converts matches at 17%; the model's comparable man converts 10% of matches
with actively dating women. He is a best case (a top man in the best market for his target), shown as
an illustration, not a target.

## 8. Search, first dates and commitment

`search`, `keepTop`, `herYears` (in `scripts/dating/chain.mjs`).

A search: shown (exposure tilts who) → likes (her read a·z + c·Q + noise, unit variance) → matches
(he likes back) → first dates (the best-reading `dates` of her matches) → months of dating with the
best n of those dated, chosen by what a first date shows (read2 = 0.3z + 0.25Q, a fresh read) →
success if one of them is serious, above the quality bar, and both commit. Odds = 1 − (1 − h)ⁿ.

**Her search runs year by year** (`herYears`). Each year her pool is the single men `gap` years older
(never married from the cohort model plus previously married, in census proportions, §9), men's
interest in her is at that age's OkCupid level, applied as a shift in her appeal so the men with the
most options drop away first (`shiftForFactor`), men's options fall with their own age (OkCupid men's
curve, relative to 29), and she properly dates two a year. Years are independent tries.

**Reads.** Connelly & Ones (2010, Table 5, corrected self-other accuracy averaged over the Big Five):
strangers ~.17, incidental acquaintances ~.27, coworkers ~.26, friends ~.47, cohabitants ~.48,
family ~.57. Profile c = 0.10; after a first date c = 0.25; a friend's introduction c = 0.45; a
coworker c = 0.27. Looks vs quality ρ_Qz = 0.1 (Feingold 1992: attractiveness vs intelligence r = .04;
Langlois et al. 2000: small links to adjustment and social skills).

**Channels.** Apps: 15,000 profiles a year, 13 first dates. Friends: 60 introductions, 6 first dates.
Work: 25 people, 3 first dates. The model runs one channel per search.

## 9. Age

- **Interest by age**: OkCupid "portion of the dating pool interested", digitized; women peak at 22
  (65% of peak at 30, 38% at 35, 23% at 40), men at 26.
- **Fecundity**: share of the monthly-birth-probability curve from age 20 used by a given age: 69% by
  30, 87% by 35 (Geruso et al. 2023, digitized).
- **Never-married cohort** (`cohort`): a frailty model. A man's first-marriage hazard at age A is H(A)·f,
  f = k·demand(u)·e^{θQ}; H(A) is fitted year by year so the population never-married share matches the
  census (parquet, forced non-increasing). The output is only who is left: the casual share rises from
  23% at 25 to 60% at 45; appeal falls from the 46th to the 30th percentile. The census agrees in
  direction (never-married men 40-49: median earnings $36k vs $67k, BA+ 24% vs 39%).
- **Single at an age** (`singleAtAge`): never married plus previously married and single again, in the
  census single-never / single-previously-married shares for that age. The second group is weighted by
  having married (1 − survival) times the stationary chance of being single (commitment filter and lemon
  effect).

The model's age decline is steeper than the census after 28 (a woman starting at 30: 19% vs 35% marry
within five years). It leaves out offline channels, older and divorced men beyond the gap, and lower
bars later in life; the census rate for 30-35 needs much less weight on looks than the app default.

## 10. Search math: the rarity you can find

`bvnUpper`, `hitRate`, `findOdds`, `bestRarity`, `traitRarity`.

True quality Q ~ N(0, 1); the up-front read S = rQ + √(1 − r²)e. Going deep only with people whose S is
in the top p, the chance one of them is at least 1 in N is h = P(Q > z_{1/N}, S > z_p)/p, and with n
evaluated, 1 − (1 − h)ⁿ. With r = 1 this reproduces the author's table exactly (top-1% pool, 20
evaluated: 88% / 18% / 2% / 0.8% for 1 in 1k / 10k / 100k / 250k). At r = 0.5 a "top 1%" pool is 13%
truly top 1% and its median member is at the 91st percentile; 20 evaluations find 1 in 1k with 37%
odds. "Top q on each of k traits" with pairwise correlation ρ: ∫φ(v) S((z_q − √ρv)/√(1 − ρ))ᵏ dv.

## 11. Mitigations: age gaps, GLP-1s, exchange rates

- **Age gaps, empirical** (`agegap.py`, ACS 2024, opposite-sex married couples, married within five
  years). Share of recent marriages with the husband 10+ years older, by his income percentile among
  men 25-64: bottom half 8.0%, 50th-95th 6.2-6.9%, 95th-99th 9.6%, top 1% 12.2% (vs 4.9% among all
  top-1% marriages). Holding husbands to 30-45 it is 4.0% for the top 1% vs 2.7-3.8% for the
  50th-99th: most of the raw effect is that top earners marry later (median age 38 vs 34). Reach: share
  of husbands in the top 10% of men by income, gap 10+ vs under 2, by the wife's age at marriage: 18-22
  5.8% vs 1.3% (4.4x, 337 couples with a 10+ gap), 23-26 7.9% vs 4.6% (1.7x, 795), 27-35 about 1x, 36-45
  1.4x. Husband income is measured now, so older husbands have had more time to earn; that is part of
  what a gap buys (an established man).
- **Age gaps, modeled**: `herYears({ gap })`. The model has no income that rises with a man's age, so it
  speaks to commitment, not status: from the late twenties on a wide gap raises commitment odds (at 27,
  +15 years: 27% → 40%).
- **GLP-1s and the gym** (`exchange.py`). One woman changes; her peers do not. Waist falls by a share of
  baseline (semaglutide 2.4 mg, STEP 1: ~12%; tirzepatide 15 mg, SURMOUNT-1: −19.9 cm vs −3.4 cm, ~17%);
  hips fall by half the waist loss in cm (assumption, swept 0.3-0.7: gluteofemoral fat resists loss);
  glute training adds an inch of hip (assumption). Her appeal moves by 0.6 x her WHR z-score (body share,
  swept 0.4-0.8). A median woman (WHR 0.84) → 0.73 (97th percentile) with tirzepatide plus glutes.
- **Exchange rates** (`exchange.py`): the income or net worth that as many single men 28-42 clear as
  single women 22-29 clear a WHR tier. WHR ≤ 0.74 (4.0%) ↔ $163k+ income or $1.1M+ net worth; ≤ 0.70 ↔
  $371k / $5.6M; ≤ 0.666 ↔ $1.1M / $37M. A fit man earning I is as rare as any man earning ~4I. A
  counting exercise under assortative matching on market value, not a claim about any one person's
  preferences.

## 12. Parameters and defaults

| Parameter | Default | Source / note |
|---|---|---|
| Consensus, women rating men / men rating women | 0.48 / 0.56 | Fitted, §3 |
| Exposure tilt, men / women | 0.74 / 0.86 | Fitted to Hinge top 5%, §3 |
| Median like rate, men / women | 33% / 4.5% | luap |
| Casual share b, casual pair-off k_c, x at median | 0.2, 0.1, 1.65 | Fitted to luap intent chart, §5 |
| Lemon effect | 0.3 (swept 0-0.46) | Solomon & Jackson 2014 |
| Looks-quality ρ_Qz | 0.1 (0-0.2) | Feingold 1992 |
| Read of quality: profile / first date / friend / coworker | 0.10 / 0.25 / 0.45 / 0.27 | Connelly & Ones 2010 |
| Commitment, median to median | 0.30 (both must commit) | Fitted to census 25→30 |
| First dates per actively dating woman, active share | 13 / yr, 0.2 | NSFG 2022-23, luap |
| Men per woman over a year | 1.5 | Pew ever-used, NSFG |
| Date-to-sex | p₀e^{z}, fitted | NSFG 2022-23 |
| Months-long dates per year | 2 | Author's 4-20 over a decade |
| Body share of a woman's appeal | 0.6 (0.4-0.8) | Assumption |
| GLP-1 waist change | 12% / 17% of baseline | STEP 1, SURMOUNT-1 |
| Hip loss / waist loss, glute gain | 0.5 (0.3-0.7), 1 in | Assumptions |

## 13. Validation

`npm test` runs 42 checks (21 hiring, 21 dating). Dating checks include: tail accuracy of `normSf`;
digitized medians against the source post; received ratio averaging back to the mean like rate;
no-consensus, no-exposure gives equal likes; the commitment filter's limits; the McCall fixed point;
the bivariate tail's independence and orthant limits (P = 1/3 at r = 0.5); perfect reads reproducing
the author's odds table; trait rarity at ρ = 0 and 1; grid weights and quality marginal; blind search
evaluating the pool as it is; the cohort reproducing the census curve it is fitted to; the funnel's
accounting identity (men's dates = active women's dates); t-copula quantiles and its Gaussian limit.

Out-of-sample agreements: Hinge top 1/10% and bottom 50% from a fit to the top 5%; NSFG men's 3.4
partners; the founder's intent gradient from selection alone; GSS and Hinge concentration.

## 14. Assumptions and limitations

1. **Appeal is one number** per person, the swipe's consensus plus taste. Status that rises with a
   man's age (income, wealth) is not in the model; the age-gap and exchange-rate results on status rest
   on ACS and parquet data.
2. **Bars rise with options by McCall search** with normal prospects; the functional form sets how
   fast. Median rates are calibrated; the slope is not independently measured beyond the founder's
   scatter.
3. **Commitment strength is fitted to one census transition** (25→30). The model under-predicts
   marriage for women starting after 28 (§9).
4. **One channel per search**; offline dating after 30 is under-represented.
5. **Parquet bodies are imputed** from NHANES, so body measures are not linked to marital status; we do
   not use parquet correlations between bodies and marriage.
6. **Digitized charts** carry reading error of about a point.
7. **Scope**: straight dating in the US.

## 15. Files and how to regenerate

| Command | Writes |
|---|---|
| `uv run scripts/dating/pools.py` | `src/data/dating/pools.json` |
| `uv run scripts/dating/digitize.py` | `src/data/dating/digitized.json`, `docs/dating/data/*.csv` |
| `uv run scripts/dating/gss.py` | `src/data/dating/gss.json` |
| `uv run scripts/dating/nsfg.py` | `src/data/dating/nsfg.json` |
| `uv run scripts/dating/agegap.py` | `src/data/dating/agegap.json` |
| `uv run scripts/dating/exchange.py` | `src/data/dating/exchange.json` |
| `uv run scripts/dating/tails.py` | `src/data/dating/tails.json` |
| `node scripts/dating/sensitivity.mjs` | `calibration.json`, `docs/dating/sensitivity.md` |
| `node scripts/dating/chain.mjs` | `docs/dating/results.md` |
| `node scripts/dating/site-data.mjs` | `src/data/dating/site.json` (the page's precomputed tables) |
