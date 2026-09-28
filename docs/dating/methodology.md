# The Lemon Market, dating edition: methodology and code notes

What every chart and number on the dating page computes, the math behind it, where each input comes
from, how it was calibrated and checked, and what it leaves out. Written for an outside reviewer.
Code references are to `src/dating/model.js` (single-stage models), `src/dating/chain.js` (the
chained model), `src/dating/scenario.js` (the calibrated model assembled from the data) and the
scripts in `scripts/dating/`. The source ledger, claim by claim, is `docs/dating/claims.md`; the
generated tables are `docs/dating/sensitivity.md` and `docs/dating/results.md`.

Contents

1. [Data](#1-data)
2. [Conventions: percentiles and the Gaussian copula](#2-conventions-percentiles-and-the-gaussian-copula)
3. [The attention market](#3-the-attention-market)
4. [Inbox load](#4-inbox-load)
5. [Who is single: the commitment filter and the lemon effect](#5-who-is-single-the-commitment-filter-and-the-lemon-effect)
6. [Mate value and commitment](#6-mate-value-and-commitment)
7. [The app funnel](#7-the-app-funnel)
8. [Search: first dates, months of dating, commitment](#8-search-first-dates-months-of-dating-commitment)
9. [Age](#9-age)
10. [Search math: the rarity you can find](#10-search-math-the-rarity-you-can-find)
11. [Levers: age gaps, GLP-1s, men's levers, exchange rates](#11-levers-age-gaps-glp-1s-mens-levers-exchange-rates)
12. [Why marriage keeps falling](#12-why-marriage-keeps-falling)
13. [Parameters, fits and defaults](#13-parameters-fits-and-defaults)
14. [Validation](#14-validation)
15. [Assumptions and limitations](#15-assumptions-and-limitations)
16. [Files and how to regenerate](#16-files-and-how-to-regenerate)

---

## 1. Data

| Source | What we use | Script |
|---|---|---|
| Dating Calculator parquet (`dcalc_app_v2.parquet`): ACS persons with NHANES-imputed bodies, up to 8 imputation draws per person, weights summing to US adults (~262M) | Single and never-married shares by age and sex; WHR by age; ever married by earnings quintile; never-married profile at 40-49; example standards; metro counts; WHR-income exchange rates; men's earnings and height scales for the calculator | `pools.py`, `exchange.py`, `status.py` |
| PSID 1968-2021 (`psid_slim.parquet`; never the 7GB PSIDSHELF .dta) | Couples' status sorting: the author's Castes cascade rebuilt, and a latent status correlation | `assort.py` |
| HCMST 2017-2020-2022 (Rosenfeld; Stanford, public "small" file v2.2) | How couples met by year met, including couples who met in 2020-22 | `hcmst.py` |
| NHANES 2017-Mar 2020 and 2021-23 (women 20-29, measured waist, hip, BMI) | GLP-1 and glute simulations | `glp1.py` |
| Paul, "What really happens inside a dating app" (blog.luap.info, Jan 2025) | Four histograms (like rate given and received, by sex), digitized; intent by attractiveness; retention | `digitize.py` |
| Hinge like shares (top 1/5/10%, bottom 50%) | Calibration target for exposure | constants |
| OkCupid (Rudder, OkTrends / *Dataclysm*) | Share of the opposite sex interested in a person by age, digitized | `digitize.py` |
| Geruso et al. (2023), App. Fig. A4 | Monthly birth probability by age, digitized | `digitize.py` |
| The author's cohort chart (census, share of women married by age for each decade of birth) | Digitized curves, the page's opening chart and §12 | `digitize.py` |
| GSS 1972-2024 R3a (years 2000+) | Partner concentration | `gss.py` |
| NSFG 2017-19 and 2022-23 | Sex with someone first met online; partners in the past year; concentration | `nsfg.py` |
| ACS 2024 1-year PUMS | Age gaps in recent marriages by the husband's income; reach by the wife's age at marriage | `agegap.py` |
| NLSY97 (men) | Measured AFQT, height, BMI and income: joint-tail check of the copula | `tails.py` |
| Literature | Connelly & Ones (2010) reads of personality; Feingold (1992) looks vs traits and self vs other ratings; Solomon & Jackson (2014) personality and breakup; STEP 1 and SURMOUNT-1; the author's dating power equation | constants |

Weights: parquet and ACS aggregates use person weights; GSS uses `wtssps` (else `wtssall`); NSFG uses
the wave weight; HCMST the wave's combined weight; NHANES the MEC exam weight. Digitized histograms
are relative counts; their medians reproduce the source post's stated medians.

## 2. Conventions: percentiles and the Gaussian copula

Every trait is handled as a percentile and mapped to a normal score z = Φ⁻¹(percentile). Joint
behavior comes from correlations between normal scores, which is a Gaussian copula. Marginal shapes
never matter (income's skew, WHR's range): only ranks and how they co-move.

A Gaussian copula has no tail dependence. We checked it against measured joint tails in NLSY97 men
(`tails.py`, n = 2,299). Normal-score correlations: height-income 0.06, fitness-income 0.02,
IQ-height 0.09, IQ-fitness 0.06, IQ-income 0.38. Pairs and most triples in the top 10-20% match the
Gaussian prediction (top 10% on IQ and income: 23.5 per 1,000 observed vs 25.6 predicted; t-copulas
overshoot). All four traits at once run 1.5-2.5x above it, but on 3-17 people. The page uses the
Gaussian copula only; t-copula versions (`traitRarityT`, `hitRateT`) are kept for this check.

Numerics: `normSf` uses the Numerical Recipes `erfcc` form for small relative error far out in the
tail; integrals use composite Simpson's rule.

## 3. The attention market

`receivedRatio`, `attentionMarket` in `model.js`.

Each person on one side has appeal z ~ N(0, 1): what a swipe measures (looks, height, photos, job
line). A viewer's impression is ρz + √(1 − ρ²)e, with ρ the consensus and e her own taste. Viewer i
likes a fixed share lᵢ of what she is shown, so she likes anyone above tᵢ = z₁₋ₗᵢ. With equal exposure
the share of viewers who like a person at z is R(z) = Σᵢ wᵢ P(ρz + √(1−ρ²)e > tᵢ), whose average over z
is the mean like rate (a test checks this).

**Activity weighting.** People who like more also swipe more, so like rates are re-weighted by x^a with
a chosen so the received mean matches (a = 0.14 women, 0.30 men).

**Fit.** ρ is fitted by grid search to the digitized received-ratio histogram, with binomial noise for
100 views per profile, minimizing the KS distance. Women rating men: ρ = 0.48 (KS 0.052); men rating
women: ρ = 0.56 (KS 0.025). The concentration on men comes from women's low like rate (4.5%), which
turns moderate agreement into a steep tail. Act II's bars: the top 5% of women get 31% of men's likes
(Hinge); the top 5% of men get 41% of women's. If women agreed far less (ρ = 0.2): 27%. If apps were
50/50: with one man per woman instead of 2.7, a woman with time for the same conversations can like
2.7 times as many profiles (§4), and the top 5% get 32%. Both: 24%. The playground's "men per woman"
slider scales women's like rates by 2.7 / ratio.

**Exposure.** Views ∝ e^{κz}; κ fitted to Hinge's top-5% share alone: 0.74 for men, 0.86 for women.
Out of sample: men's top 1% 17% (Hinge 16%), top 10% 57% (58%), bottom half 5.9% (4%).

## 4. Inbox load

`inboxLoad`: likes arriving to the average woman per day = men per woman × swipes per man × men's like
rate. At 2.7 men per woman (Pew 2022, 18-29 current users), 100 swipes a day and a 39%
activity-weighted like rate, about a hundred likes a day arrive; with time for 5 she keeps the top ~5%.
The "your year on the apps" playground uses the same inbox (270 profile views a day per woman), with
each man's chance of liking her from the funnel (§7).

## 5. Who is single: the commitment filter and the lemon effect

`singlePool`, `casualShareOnApp`, `commitmentByPercentile`.

A share b of men are casual; serious men pair off at rate λ when they meet someone they want, casual
men at k_c·λ; relationships end at rate δ. Stationary chance of being single: δ / (δ + kλ), with λ
proportional to the likes a man gets. Calibrated to the founder's chart (casual share on the app by
attractiveness, 8 groups: 23 → 52%): b = 0.2, k_c = 0.1, x = λ/δ at the median man 1.65 (RMSE 2.5
points). No difference in intent by looks is needed; selection alone produces the gradient.

Why b = 0.2 is grounded: the least attractive men get few matches and pair off slowest, so their
share on the app (23%) is close to the share among all men; b = 0.20-0.23 both fit. On the apps the
casual share is 34%; among single men 25-35, 29%; among never-married men at 40, 48%.

**Lemon effect (Connor).** e is the part of a man's value the profile does not show; relationships end
sooner for people worse than they look: δ = exp(−0.3 e), breakup odds x1.35 per SD (Solomon & Jackson
2014, the largest single personality effect on breakup in HILDA).

## 6. Mate value and commitment

`hisCommit`, `herCommit`, `hisInterest`, `herInterest` in `scenario.js`.

**Mate value.** A man's value is the author's dating power equation (".1 height + .5 status + .2 social
skills + .2 attractiveness", performativebafflement.substack.com/p/dating-power-maxxing-for-men),
standardized: x = (0.2·looks + 0.548·other)/0.583, where "other" combines status, social skills and
height. So looks (what the apps see) and value correlate 0.34. His value is his potential, the same at
25 and 40; women's age preferences act on his market instead (below). A woman's value is her appeal
for her age y, shifted by age: y_eff = y + s(a), with s(a) = Φ⁻¹(½·interest(a)) from the OkCupid curve
(half the peak interest = from the median to the 25th percentile).

**Commitment after months of dating.** Each side commits only to someone near or above their own level:

    P(he commits)  = [serious ? 1 : k_c] · m · Φ((y_eff − x − a(M) + d − κ·Δw_m) / σ)
    P(she commits) = Φ((x − y_eff + d − κ·Δw_w) / σ)

d = tolerance (how far below their own level people commit), σ = 0.5 (a committed judgment is noisy),
m = commitScale (the chance a mutual commitment works out: chemistry, timing, everything else).
Δw is the McCall reservation shift of a person's options over the median person's: prospects arrive
at a rate set by the calibrated app demand for their looks, and more prospects raise the bar
(w = L·E[(q − w)⁺]); κ = 0.25 scales it. a(M) = ½ · s_men(M) is the age discount on an older man's bar:
the OkCupid share of women whose age range includes him falls fast after 30, so an older man commits to
women he could not hold at 28. Both must commit.

**Relaxing toward what you can get** (`reservationValue`, `relaxedOutcome`). Top people on both sides
don't hold out for someone at their own level when they rarely meet one; they settle for the best they
can expect (a 666 man ends up with "kinda hot, kinda smart, and nice", not an Instagram model). The
searcher's own-level bar above is capped by an optimal-stopping reservation value over the offers they
actually get: with K more months-long evaluations before a planning horizon, each an offer with chance
p (the other side would commit and it works out), offer values X ~ G (the evaluated people, weighted by
their chance of committing),

    R_K = p · E[max(X, R_(K−1))] + (1 − p) · R_(K−1),   R_0 = G's 5th percentile,

and the searcher commits to X with Φ((X − min(own bar, R_K)) / σ). The bar only ever falls. Planning
horizons: women 32, men 36 (women sooner: the age effect), chosen from 32/35/38 and 32/36/42 so the top
deciles' lifetime marriage rates match Add Health's (below). Without it, a 99th-percentile woman
committed less often than a 90th, because she would only take a top-1% man and almost never met one.

**Fits** (`fit.mjs`, coarse grid):
- d = 0.753 so that couples formed in the model correlate 0.756 in mate value, the PSID latent status
  correlation (§6a);
- m = 0.228 so that a woman searching from 25, averaged over appeal, finds a committed man by 30 at the
  census rate, lagged and among women who want to marry: 35.6% of never-married women 27 marry by 32
  (committing comes about two years before the wedding; HCMST's median from relationship start to wedding
  is 2.8 years for 2005-17 weddings), divided by the 89% of never-married women 23-28 who expect to marry
  (NSFG 2017-19, `nsfg_expect.py`) = 39.9%.

**Checked against Add Health** (`addhealth.py`, `addhealth_curve.py`). Add Health's interviewers rated
every respondent's physical attractiveness 1-5 at waves I-IV. Ever married by about 37 (wave V), by
percentile of the averaged rating within sex: women 67 / 71 / 75 / 81 / 85% from the bottom fifth to the
top tenth, men 57 / 66 / 75 / 76 / 85%; the two sexes' top deciles match. One interviewer's rating is
noisy (ratings of the same person correlate 0.30 a year apart and 0.14 in adulthood), so the averaged
score correlates about r = 0.6 with true appeal; undoing that, ever married by ~37 at the 10th / 50th /
90th / 99th percentile of true appeal is women 61 / 75 / 86 / 92%, men 49 / 72 / 88 / 95%. The model,
committed by 35 searching from 22: women 30 / 74 / 92 / 92%, men (apps, by 38) 16 / 59 / 86 / 94%. The top
matches; the bottom is lower in the model. That is expected: Add Health's cohort (born ~1976-83) dated
mostly before the apps, the model's level is set by today's census (women born in the 1990s), and falling
pairing hits the bottom of both sexes first. Add Health's own terms bar AI tools from individual-level
data, so the author ran `addhealth.py` and only its group estimates were used here.

**Will he commit?** (Act IV's chart shows his decision alone, without m.) A serious man of 30 with a
median woman of 28: 10th-percentile man 100%, 25th 99%, median 83%, 75th 33%, 90th 4.7%, 95th 0.8%;
with a top-10% woman: 100%, 100%, 100%, 98%, 81%, 56%. Then the relationship works out 23% of the time.

**Outcome bars.** "As good as her or better" is rank for rank on potential (for a lever that raises her
appeal, like GLP-1s, measured against where she started, `rareV`, so the target doesn't move with her) (his value percentile for
his age at least her appeal percentile for her age). "A top-10 / 5 / 1% man" is on standing now:
current mate value, with his status moved to his age's median and spread (`status.py`: men's earnings
rank among men 22-55 climbs into the 40s and fans out, so top earners are mostly over 35), ranked among
all men 22-55. "A millionaire husband" is the top 8.2% on the same scale (the share of men 22-55
worth $1M+, parquet: 0.5% at 22-26, 5% at 32-36, 17% at 47-55). That is what she marries into, and what makes an age gap buy top-tier men: a 23-year-old
at the 80th percentile open to men 15 years older goes from 1.3% to 5.1% for a top-10% man. Commitment
itself runs on potential.

### 6a. How tightly couples sort (PSID)

`assort.py`, on PSID couple-years 2000+ with the wife's father linked (n = 17,417):

- **The author's cascade, rebuilt** (Castes notebook, near-match version): the husband's wealth tier
  is his wife's father's or one below (33.6%), else his income tier is (40.0%), else she has at least his
  education (19.9%); full mismatch 6.4%, so 93.6% matched, exactly as in the notebook (prestige, 0.2%
  there, left out). **But random pairing would score 89.6% on the same criteria**: they are lenient
  (the education rescue alone is met by 67% of random pairs), so the cascade cannot pin down how
  tightly couples sort.
- **Latent correlation.** A two-factor model on normal scores: the husband's own earnings and
  education against the wife's father's peak income, wealth and education and her own education, one
  loading per measure, with education allowed to match directly (residual 0.28). Fitted by least
  squares to the off-diagonal correlations: ρ = 0.76 (RMSE 0.05), close to Clark's ~0.8. The raw
  composite correlation is 0.56 (noise pulls it down). Simulating the cascade at ρ = 0.76 with those
  loadings and the observed tier shares gives 95.8% matched (observed 93.6%, random 89.6%).
- The model's mate value is fitted to 0.76.

## 7. The app funnel

`appFunnel`. One year on an app, counted from the women's side. A woman at appeal y is shown viewsW men,
likes her share by her read, is liked back by each man at his own rate, and has time for datesW first
dates, which go to the best-reading of her matches. Only a share activeW of women users actually date
in a year. Per man at relative exposure s: likes, matches and dates = (viewsW / ratio) · s ·
E_y[...], with dates also × activeW; a date ends in sex with p(z) = p₀e^{γz}.

**Calibration to NSFG 2022-23** (straight, 18-35): women with any app sex average 2.8 partners (datesW =
13, p ≈ 0.2); activeW = 0.2; γ = 1 reproduces men's 3.4 partners; ratio = 1.5 men per woman over a year.
Outputs: 60% of male users get no first date in a year (84% of the bottom half); the top 10% of men get
66% of first dates. The funnel also returns likes, matches and dates split by the other side's looks
bin, for the "your year on the apps" Sankey and its target slider.

## 8. Search: first dates, months of dating, commitment

`search`, `evaluate`, `keepTop` (`chain.js`); `herYears`, `hisYears` (`scenario.js`).

**Her search, year by year.** Her pool is the single men from `below` = 2 years younger to `gap` years
older, weighted by how many single men there are at each age; each age's pool is never-married men
(frailty model, §9) plus previously married men single again, in census proportions. Half of casual men
are recognizable from the profile and skipped (stated intent; never married at 42). Each year:

    shown (exposure tilt) → likes (her read 0.48·looks + 0.2·value + noise) → matches (he likes her
    back, at his like rate, given her appeal at her age) → 13 first dates (the best-reading matches)
    → months of dating: only with men who want to keep seeing her (his interest: the same bar as
    committing, read twice as noisily; casual men keep dating a woman who likes them 80% of the time)
    → she properly dates the best 2 by a fresh read after the first date (0.3·looks + 0.5·value)
    → success if both commit.

Odds over the years: 1 − Π(1 − oddsₜ), for each bar: any committed man; one at least as rare as she is
(his value percentile ≥ her appeal percentile for her age); top 10 / 5 / 1% of men by value.

**His search.** Women decide who gets first dates, so his first dates are the funnel's number for a man
with his looks (fewer as he ages, via the OkCupid men's curve), with the single women of his target
ages who would pick him: her read of him (0.48·looks + 0.2·value) against her own like rate (pickier
the more appealing she is), times his liking her back. Then months of dating need her interest; he
properly dates the best two a year; success if both commit. Bars: her appeal for her age at the 50 / 75 /
90 / 95th percentile, and as good as him or better. For a median man of 30 (women 22-30), five years: 24%.

**In person (men).** He approaches two women a month (the post: once a month puts a man in the top
quarter of single men), choosing women he likes; each says yes to a date if her read of him (0.3 looks,
0.45 value) clears her own bar, set at her app like rate × 2.7 (she isn't flooded: the 50/50 logic of
§3). No swipe funnel, no competition with the top 10% for her dozen first dates. A median man: 1.7
first dates a year (0.75 on the apps), 50% odds in five years (24%).

**Reads.** Connelly & Ones (2010): strangers ~.17, coworkers ~.26, friends ~.47. Profile: 0.48 looks,
0.2 value; after a first date 0.3 looks, 0.5 value. Channels: apps 15,000 profiles a year, 13 first
dates; friends 60 introductions, 6 first dates, a better read (0.3, 0.45) and no swipe stage. The
friends channel is not on the page: introductions are adversely selected (the people friends set up
are often the ones who couldn't find someone otherwise), and nothing here measures by how much.

## 9. Age

- **Interest by age**: OkCupid, digitized; women peak at 22 (65% of peak at 30, 38% at 35, 23% at 40),
  men at 26.
- **Fecundity**: 69% of lifetime fecundity since 20 used by 30, 87% by 35 (Geruso et al. 2023).
- **Never-married men** (`cohort`): a frailty model. A man's first-marriage hazard at age A is H(A)·f,
  f = k·e^{θx} (k = 1 serious, 0.1 casual; x his value); H(A) is fitted year by year so the population
  never-married share matches the census, so the output is only who is left. θ = 1.15 is fitted to the
  ACS share ever married at 40-49 by earnings quintile (model 59 / 74 / 81 / 87 / 92% vs ACS 59 / 72 / 80
  / 86 / 91%), with earnings correlating 0.8 with status (so 0.69 with value). Among never-married men,
  the casual share rises from 23% at 25 to 57% at 45, and their average value falls from the 45th to the
  27th percentile. The census agrees in direction (never-married men 40-49: median earnings $36k vs
  $67k).
- **Her odds by starting age** (a median woman, five years, open to +2): any committed man 41% at 22,
  28% at 30, 21% at 36; one at least as rare as she is 34%, 11%, 4%. Census (share of never-married
  women who marry within five years): 28%, 35%, 23%. Fitted at 25; the model runs above the census at
  22, close to it from 24 to 28 and from 36 to 38, and below it from 30 to 34 (real women that age also
  meet men through friends, work and remarriage).

## 10. Search math: the rarity you can find

`bvnUpper`, `hitRate`, `findOdds`, `bestRarity`, `traitRarity`.

True quality Q ~ N(0, 1); the up-front read S = rQ + √(1 − r²)e. Going deep only with people whose S is
in the top p, the chance one of them is at least 1 in N is h = P(Q > z_{1/N}, S > z_p)/p, and with n
evaluated 1 − (1 − h)ⁿ. With r = 1 this reproduces the author's table (top-1% pool, 20 evaluated: 88% /
18% / 2% / 0.8% for 1 in 1k / 10k / 100k / 250k). At r = 0.5 a "top 1%" pool is 13% truly top 1%, and
the odds of 1 in 10,000 fall to 7%.

**Your odds** (Act VI's playground, replacing the earlier search calculator): the reader's likes on
the apps (women: a day; men: a week) map to a percentile through the funnel (§4, §7), and the worker
runs `herYears` (from 25) or `hisYears` (from 30, women 22-30, everything else median).

**Likes, not messages.** Rudder's (2014) OkCupid messages per week by attractiveness percentile are
digitized (`okc_messages`: women about 2 / 6 / 11 / 25 a week at the 10th / 50th / 90th / 99th
percentile), but they come from a different app era and don't map onto today's apps: luap's one figure
("match to talk was 35%") gives either ~0.1 conversations a day at the median (35% of matches) or ~31
messages a day (35% of likes), neither consistent with the lived "30 a day for the top 1-5%". The
calculators use likes only.

## 11. Levers: age gaps, GLP-1s, men's levers, exchange rates

- **Age gaps, empirical** (`agegap.py`, ACS 2024, married within five years). Share of husbands in the
  top 10% of men by current income, gap 10+ vs under 2, by the wife's age at marriage: 18-22 5.8% vs
  1.3% (4.4x, 337 couples with a 10+ gap), 23-26 7.9% vs 4.6% (1.7x, 795), 27-35 about 1x, 36-45 1.4x.
  Current income rises with age, so part of what a gap buys is an established man.
- **Age gaps, modeled.** Open to men 15 years older instead of 2: for a median woman almost nothing
  (from 27: any 38% → 38%, as rare 22% → 22%): the top men aren't in her reach either way. For a
  90th-percentile woman from 31: top 10% 5.0% → 14.8%, top 5% 0.9% → 6.2%, top 1% 0.02% → 0.37%. From 23
  a gap lowers her odds: young attractive women can already reach top men their own age (on potential).
- **GLP-1s and the gym** (`glp1.py`). NHANES women 20-29 (n = 923), each given 500 simulated responses:
  weight loss from the trials (semaglutide 2.4 mg, STEP 1: −14.9%, SD ~11 points; tirzepatide 15 mg,
  SURMOUNT-1: −20.9%, SD ~10; averaged), scaled by fat to lose ((BMI − 20)/(38 − 20), the trials'
  women were around BMI 38), floor BMI 18.5; waist falls 0.84x as fast as weight in logs (SURMOUNT-1:
  waist −17.5% for weight −20.9%); hips follow the waist at the between-person log-log slope 0.657 (the
  author's WHR notebook), so WHR moves only a third as far as the waist; glute work adds an inch of hip.
  Chance of reaching WHR ≤ 0.74 (GLP-1 / + glutes): top 5-10% 23% / ~100%; top 10-25% 4% / 21%; top
  25-50% 1% / 3%; median and below ≈ 0. A median woman moves from about the 50th to the 69th WHR
  percentile (appeal 50th → 61st at a body share of 0.6).
- **Women's levers**, for a median, 70th-percentile and top-10% woman (the page's dropdown): start at
  23, age gaps of 10 and 15, GLP-1 plus glutes (her WHR percentile from her appeal, WHR z = appeal z /
  0.6, moved by the NHANES bands), three men a year. The waterfall is a top-20% woman. For a top-20%
  woman on WHR (80th percentile) from 27, GLP-1 plus glutes: any committed man 43% → 48%, top 10% 0.2% →
  0.9%. The waterfall: a top-20% woman going for a top-10% man, one step at a time: not looking till 27
  1.0%; start at 23 1.0% (top-10% men today are mostly older); open to men 15 years older 4.1%; GLP-1
  plus glutes 7.5%; dating 2 → 3 men a year 10.1%. Starting at 23 adds nothing on its own because top-10%
  men today are rare among single men her age (0.2-0.6% at 22-25, 2% at 30, 4% at 38).
- **Millionaire odds and GLP-1s** (five years from 25, open to +2 / +15 years): a top-5% WHR woman 1.8% /
  6.5% → 3.6% / 9.3% with GLP-1 plus glutes; top 5-10% 0.5% / 3.6% → 1.9% / 6.6%; top 10-25% 0.1% / 1.7%
  → 0.6% / 3.6%; median ≈ 0 / 0.1% → 0 / 0.4%.
- **Men's levers** (`hisYears`, a median man of 30, women 22-30, five years), each on the apps and in
  person (two approaches a month): baseline 24% / 50%. Status to the 90th percentile: 31% on the apps
  (status barely shows on a profile, so his dates don't change) but 69% in person, and a
  75th-percentile woman or better 2.8% → 38% in person. All of it (fit, status and social skills at the
  75th, about the 88th percentile as a partner) in person: 71%, and a 75th-percentile woman 55%. The body ladder uses the Dating Calculator's flags among single men
  25-35 (body half of looks, face at the median): out of overweight and obese (40%: body at the 60th
  percentile, looks 57th) 23%; fit (the `fit` flag, identical to `abs`: 5.3%, body fat up to 20%; looks
  87th, 6.6 first dates a year) 66%; strict abs (`abs_strict`: 2.2%, body fat up to 17%; looks 92nd)
  67%, and a 75th-percentile woman or better 0.8% → 28%. Status to the 90th percentile: any 12% (he is
  choosier) but a 75th-percentile woman 4.7%.
- **Exchange rates** (`exchange.py`): the income or net worth that as many single men 28-42 clear as
  single women 22-29 clear a WHR tier. WHR ≤ 0.74 (4.0%) ↔ $163k+ or $1.1M+. Metros: single women 22-29
  at WHR ≤ 0.74 per single man 28-42 worth $1M+ (bodies imputed from NHANES).

## 12. Why marriage keeps falling (analysis; cut from the page)

From the digitized cohort curves (women married by 25 / by 30 / share of those single at 25 who marry
by 30): 1950s 74 / 84 / 39%; 1970s 50 / 70 / 40%; 1980s 37 / 59 / 34%; 1990s 27 / 52 / 34%. The 1980s
cohort turned 30 around 2010, before Tinder (2012); the 1990s cohort dated from 25 to 30 on the apps. The
25-to-30 transition is the same for both (34%), so the app-era fall (59% → 52% by 30) is all in marriage
before 25, and most of the fall since the 1950s (84% → 59%) predates the apps. The page's waterfall shows
those two blocks. What drove the earlier fall is not modeled here; the page cites women's economic
independence (marriage held among the top tenth of women by earnings and fell 15+ points for the bottom
70%: Hamilton Project), men's falling relative earnings (Autor, Dorn & Hanson 2019), and screens with
weaker, mixed evidence (Bellou 2015 finds broadband raised marriage rates).

## 13. Parameters, fits and defaults

| Parameter | Value | Source / note |
|---|---|---|
| Consensus, women rating men / men rating women | 0.48 / 0.56 | Fitted, §3 |
| Exposure tilt, men / women | 0.74 / 0.86 | Fitted to Hinge top 5%, §3 |
| Median like rate, men / women | 33% / 4.5% | luap |
| Casual share b, casual pair-off k_c, x at median | 0.2, 0.1, 1.65 | Fitted to luap intent chart, §5 |
| Lemon effect | 0.3 | Solomon & Jackson 2014 |
| Mate value weights (status, social, looks, height) | 0.5, 0.2, 0.2, 0.1 | The author's dating power equation |
| Tolerance d | 0.753 | Fitted: couples correlate 0.756 (PSID) |
| Commit scale m | 0.228 | Fitted: census 27 → 32 among women who expect to marry (39.9%) |
| Planning horizons (relaxing toward what you can get) | women 32, men 36 | Chosen: Add Health top deciles |
| θ (higher-value men marry faster) | 1.15 | Fitted: ACS ever married by earnings quintile |
| Commitment noise σ; first-date noise | 0.5; 1.0 | Assumptions, swept in `results.md` §H |
| Options premium κ | 0.25 | Assumption, swept |
| Age discount on an older man's bar | ½ × OkCupid shift | Assumption |
| Casual men recognizable from the profile; keep dating | 50%; 80% | Assumptions |
| Earnings-status correlation | 0.8 | Assumption |
| Reads: profile / first date / friend | (0.48, 0.2) / (0.3, 0.5) / (0.3, 0.45) | Connelly & Ones 2010 for the scale |
| First dates per actively dating woman, active share | 13 / yr, 0.2 | NSFG 2022-23, luap |
| Men per woman over a year | 1.5 | Pew ever-used, NSFG |
| Months-long dates per year | 2 | Author's 4-20 over a decade |
| Body share of a woman's appeal; of a man's looks | 0.6; 0.5 | Assumptions |
| Men's body rungs | 60th / 94.7th / 97.8th percentile | Parquet flags: not overweight, fit, strict abs |
| In person (men): approaches a year; her yes bar | 24; app like rate × 2.7 | The author's post; §3 |
| GLP-1 weight loss; waist per weight; hip slope; glutes | trials; 0.84; 0.657; 1 in | STEP 1, SURMOUNT-1, WHR notebook, assumption |

## 14. Validation

`npm test` runs 49 checks (21 hiring, 28 dating). Dating checks include the single-stage identities (tail
accuracy, digitized medians, law of total probability, McCall fixed point, bivariate tail limits,
the author's odds table), the grid and funnel accounting, the cohort reproducing the census, the
evaluate step's limits, and the calibrated scenario: men commit up and rarely down (a 25th-percentile man
to a 90th-percentile woman > 99%; a 90th-percentile man to a median woman < 10%); a median woman's
top-10% odds under 1% and rising steeply with her appeal; age gaps at least doubling top-10% and top-5%
odds for attractive women at 23 and 31; getting off the apps and getting fit each raising a median
man's odds by half or more; the census fit (27 → 32, among women who expect to marry); and relaxing,
which never lowers anyone's odds and lifts top women past 85% committed by 35.

Fitted exactly: the three targets in §13. Out of sample: Hinge top 1/10% and bottom 50%; NSFG men's 3.4
partners; the founder's intent gradient from selection alone; the census rate at which single women
marry at other ages (above it at 22, close at 24-28 and 36-38, below it at 30-34);
a median man's five-year odds (24% on the apps, 50% in person) against the census rate for never-married men 30 → 35 (27%, all
channels).

## 15. Assumptions and limitations

1. **One mate value per person**, a weighted index; people differ in taste only through noise.
2. **Bars rise with options by McCall search**; κ is an assumption and moves results (§H of `results.md`).
3. **Three targets for three free parameters**, plus two horizons chosen against Add Health's top deciles;
   the many fixed assumptions (§13) are swept, not fitted. The bottom of the appeal distribution is not
   fitted: the model puts it below Add Health's pre-app cohort.
4. **Two rankings of men**: commitment and "as good as her or better" on potential; "top 10% man" on
   standing now (status by age from earnings ranks; wealth is not modeled separately).
5. **Apps as the default channel**; in person for men; the model under-predicts marriage in the early
   thirties.
6. **Parquet bodies are imputed** from NHANES, so body measures are not linked to marital status.
7. **Digitized charts** carry reading error of about a point.
8. **Scope**: straight dating in the US.

## 16. Files and how to regenerate

| Command | Writes |
|---|---|
| `uv run scripts/dating/pools.py` | `src/data/dating/pools.json` |
| `uv run scripts/dating/digitize.py "<charts dir>"` | `src/data/dating/digitized.json`, `docs/dating/data/*.csv` |
| `uv run scripts/dating/gss.py` | `src/data/dating/gss.json` |
| `uv run scripts/dating/nsfg.py` | `src/data/dating/nsfg.json` |
| `uv run scripts/dating/agegap.py` | `src/data/dating/agegap.json` |
| `uv run scripts/dating/exchange.py` | `src/data/dating/exchange.json` |
| `uv run scripts/dating/tails.py` | `src/data/dating/tails.json` |
| `uv run scripts/dating/assort.py` | `src/data/dating/assort.json` |
| `uv run scripts/dating/hcmst.py` | `src/data/dating/hcmst.json` |
| `uv run scripts/dating/glp1.py` | `src/data/dating/glp1.json` |
| `uv run scripts/dating/status.py` | `src/data/dating/status.json` |
| `node scripts/dating/sensitivity.mjs` | `calibration.json`, `docs/dating/sensitivity.md` |
| `node scripts/dating/fit.mjs` (~10 min) | `src/data/dating/fitted.json` |
| `node scripts/dating/chain.mjs` | `docs/dating/results.md` |
| `node scripts/dating/site-data.mjs` | `src/data/dating/site.json` (the page's precomputed tables) |
