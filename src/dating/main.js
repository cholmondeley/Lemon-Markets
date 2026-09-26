// The dating page: page-wide woman / man switch, numbers bound into the prose, each act's figures
// and scrolling stories, and the playgrounds. Default tables come precomputed in site.json
// (scripts/dating/site-data.mjs); the reader's own scenarios run live, the heavy one in a worker.
import '../styles.css';
import './dating.css';
import SITE from '../data/dating/site.json';
import digitized from '../data/dating/digitized.json';
import calibration from '../data/dating/calibration.json';
import { initChrome } from '../chrome.js';
import { createStepper, watchVisible } from '../stepper.js';
import * as D from './model.js';
import { lineChart, histChart, bars, table, pct, ord, money, num, redrawAll } from './charts.js';

initChrome();

// ---------- woman / man ----------
const sexSubs = [];
const getSex = () => document.body.dataset.sex;
function setSex(sex) {
  document.body.dataset.sex = sex;
  document.querySelectorAll('.sex-switch button').forEach((b) => b.classList.toggle('active', b.dataset.sex === sex));
  try { localStorage.setItem('lemon-dating-sex', sex); } catch { /* storage may be unavailable */ }
  sexSubs.forEach((f) => f(sex));
  requestAnimationFrame(redrawAll);
}
document.querySelectorAll('.sex-switch button').forEach((b) => b.addEventListener('click', () => setSex(b.dataset.sex)));
try { const saved = localStorage.getItem('lemon-dating-sex'); if (saved === 'man' || saved === 'woman') setSex(saved); } catch { /* ignore */ }

// ---------- numbers in the prose ----------
const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), SITE);
const FMT = { pct: (v) => pct(v), pct1: (v) => pct(v, 1), num: (v) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1)), k: (v) => Math.round(v / 1000) };
document.querySelectorAll('[data-v]').forEach((el) => {
  const v = get(el.dataset.v);
  if (typeof v === 'number') el.textContent = (FMT[el.dataset.f] || FMT.num)(v);
});

const fig = (id) => document.querySelector(`[data-fig="${id}"]`);
const bandLabel = (b) => (b.lo === 0 ? 'Bottom half' : b.hi === 1 ? `Top ${Math.round((1 - b.lo) * 100)}%` : `${ord(b.lo * 100)}–${ord(b.hi * 100)}`);

// ---------- Prologue and Act I ----------
lineChart(fig('cohorts'), {
  height: 280, aria: 'Line chart: share of US women married by 25 and by 30, by decade of birth, falling from 82% and 89% for the 1940s to 27% and 52% for the 1990s.',
  x: { min: 1940, max: 2000, ticks: [1940, 1950, 1960, 1970, 1980, 1990, 2000], fmt: (v) => v + 's' },
  y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => pct(v) },
  series: [
    { label: 'Married by 30', color: '--dating', width: 3, dots: true, points: SITE.cohorts.rows.map((r) => [r.cohort, r.by30]) },
    { label: 'Married by 25', color: '--neutral', dots: true, points: SITE.cohorts.rows.map((r) => [r.cohort, r.by25]) },
  ],
});
{
  const ch = SITE.channels;
  const focus = { Online: '--dating', 'Through friends': '--ink-muted' };
  lineChart(fig('channels'), {
    height: 320, aria: 'Line chart of how couples met, 1940 to 2017: online rises from zero after 1995 to 39% in 2017; meeting through friends falls from 34% to 20%.',
    x: { min: 1940, max: 2017, ticks: [1940, 1960, 1980, 2000, 2017] },
    y: { min: 0, max: 0.4, ticks: [0, 0.1, 0.2, 0.3, 0.4], fmt: (v) => pct(v) },
    series: Object.entries(ch.series).map(([label, ys]) => ({ label, color: focus[label] || '--rule-strong', width: label === 'Online' ? 3 : focus[label] ? 2 : 1.5,
      points: ch.years.map((y, i) => [y, ys[i]]) })),
  });
}
SITE.calcExamples.forEach((ex, i) => {
  document.querySelector(`[data-fig-title="calc${i}"]`).textContent = ex.who;
  bars(fig('calc' + i), ex.steps.map(([label, v], j) => ({ label, value: Math.log10(v), text: num(v), cls: i === 0 ? 'men' : 'women', hl: j === ex.steps.length - 1 })), { max: 5 });
});
bars(fig('bench'), [
  { label: 'United States', value: SITE.bench.singleWomen2029PerThousand, text: num(SITE.bench.singleWomen2029PerThousand), cls: 'accent', hl: true },
  ...SITE.bench.metros.slice(0, 6).map((m) => ({ label: m.name.split('-')[0].split(',')[0], value: m.women, text: num(m.women), cls: 'women' })),
], { max: 70 });

// ---------- Act II ----------
{
  const host = fig('ratio');
  host.innerHTML = `<div class="tiles">
    <div class="tile men"><b>73%</b><span>of 18-29-year-olds on the apps are men (Pew 2022): 2.7 men per woman</span></div>
    <div class="tile"><b>1.5 : 1</b><span>men per woman over a whole year: women try the apps and leave faster</span></div>
    <div class="tile women"><b>54%</b><span>of women on the apps are at least sometimes overwhelmed by messages</span></div>
    <div class="tile men"><b>64%</b><span>of men on the apps feel insecure about how few they get</span></div></div>`;
}
const pctTicks = [[0, '0%'], [25, '25%'], [50, '50%'], [75, '75%'], [100, '100%']];
const binTip = (who) => (i, share) => `<b>${i}–${i + 1}%</b><div class="k">${pct(share, 1)} of ${who}</div>`;
histChart(fig('likeW'), { height: 280, bins: SITE.hist.womenLike, color: '--women', maxBin: 60, xTicks: [[0, '0%'], [20, '20%'], [40, '40%'], [60, '60%']], tip: binTip('women'), aria: 'Histogram: most women like under 10% of profiles; median 4.5%.' });
histChart(fig('likeM'), { height: 280, bins: SITE.hist.menLike, color: '--men', xTicks: pctTicks, tip: binTip('men'), aria: 'Histogram: men like a broad range of profiles; median 26%.' });
histChart(fig('recvM'), { height: 300, bins: SITE.hist.menReceived, color: '--men', maxBin: 40, xTicks: [[0, '0%'], [10, '10%'], [20, '20%'], [30, '30%'], [40, '40%']], marks: [{ bin: 5, text: 'median ≈ 5%' }], tip: binTip('men'), aria: 'Histogram of the share of women who like each man: peaked at 3-5%, long right tail to 35%.' });
{
  const H = SITE.hinge;
  const model = { men: { top1: 0.17, top5: 0.41, top10: 0.57, bottom50: 0.059 }, women: { top1: 0.11, top5: 0.31, top10: 0.46, bottom50: 0.105 } };
  const rows = [];
  [['men', 'Men'], ['women', 'Women']].forEach(([k, lab]) => {
    rows.push({ group: lab });
    [['top1', 'Top 1%'], ['top5', 'Top 5%'], ['top10', 'Top 10%'], ['bottom50', 'Bottom 50%']].forEach(([key, l]) => rows.push({
      label: `${l} of ${lab.toLowerCase()}`, value: H[k][key], text: pct(H[k][key]), cls: k, sub: `model ${pct(model[k][key])}`,
      tip: `<b>${l} of ${lab.toLowerCase()}</b><div>Hinge: ${pct(H[k][key])}</div><div class="k">Model: ${pct(model[k][key])}${key === 'top5' ? ' (fitted)' : ' (out of sample)'}</div>` }));
  });
  bars(fig('hinge'), rows, { max: 1 });
}
const meanOf = (h) => D.histMean(D.histPoints(h));
const W = D.activityWeighted(D.histPoints(digitized.luap_like_rate_women), meanOf(digitized.luap_received_ratio_men)).pts;
const scaled = (pts, f) => pts.map((p) => ({ x: Math.min(0.99, p.x * f), w: p.w }));
{
  const rows = [0.5, 1, 2, 4].map((f) => [f === 1 ? '× 1 (today)' : `× ${f}`,
    ...[0.2, 0.48, 0.7].map((rho) => pct(D.attentionMarket({ rho, openness: scaled(W, f), kappa: calibration.exposure.men, M: 500 }).top5))]);
  table(fig('counterfactual'), ["Women's like rates", 'Agreement 0.2', '0.48 (today)', '0.7'], rows, { hl: 1 });
  fig('counterfactual').insertAdjacentHTML('beforeend', '<p class="src">Model. Liking more flattens the power law far more than agreeing less does.</p>');
}

// ---------- Act III ----------
{
  const [a, b] = SITE.nsfg;
  const rows = [
    { group: 'No sexual partner in the past year' },
    { label: '2017-19', value: a.men.single_partners_share['0'], text: pct(a.men.single_partners_share['0']), cls: 'neutral' },
    { label: '2022-23', value: b.men.single_partners_share['0'], text: pct(b.men.single_partners_share['0']), cls: 'men', hl: true },
    { group: 'Had sex with someone met online' },
    { label: '2017-19', value: a.men.app_sex_single, text: pct(a.men.app_sex_single, 1), cls: 'neutral' },
    { label: '2022-23', value: b.men.app_sex_single, text: pct(b.men.app_sex_single, 1), cls: 'men', hl: true },
    { group: 'Share of all partners held by the top 10% of men' },
    { label: '2017-19', value: a.men.single_top10_share_of_partners, text: pct(a.men.single_top10_share_of_partners), cls: 'neutral' },
    { label: '2022-23', value: b.men.single_top10_share_of_partners, text: pct(b.men.single_top10_share_of_partners), cls: 'men', hl: true },
  ];
  bars(fig('nsfg'), rows, { max: 1 });
}
bars(fig('noDate'), [...SITE.funnel.bands.map((b) => ({ label: bandLabel(b), sub: `${pct(b.share)} of single men`, value: b.noDate, text: pct(b.noDate), cls: 'men' })),
  { label: 'All men on the apps', value: SITE.funnel.all.noDate, text: pct(SITE.funnel.all.noDate), cls: 'accent', hl: true }], { max: 1 });
{
  const tot = SITE.funnel.bands.reduce((s, b) => s + b.share * b.dates, 0);
  bars(fig('datesBand'), SITE.funnel.bands.map((b) => ({ label: bandLabel(b), sub: `${pct(b.share)} of men`, value: (b.share * b.dates) / tot, text: `${pct((b.share * b.dates) / tot)} · ${num(b.dates)}/yr`, cls: 'men',
    tip: `<b>${bandLabel(b)}</b><div>${num(b.dates)} first dates a year each</div><div class="k">${pct((b.share * b.dates) / tot)} of all first dates</div>` })), { max: 0.5 });
}
{
  const L = SITE.lanaLi;
  const steps = [['Likes received', L.likesReceived], ['Matches', L.matches], ['Conversations', L.convos], ['Meetup attempts', L.meetups]];
  fig('lana').innerHTML = '<div class="funnel">' + steps.map(([l, v]) => `<div class="fs"><span>${l}</span><span class="bt"><i class="bf" style="width:${(Math.sqrt(v / L.likesReceived) * 100).toFixed(1)}%"></i></span><span class="bv">${v.toLocaleString('en-US')}</span></div>`).join('') + '</div><p class="src">Bar widths on a square-root scale.</p>';
}

// ---------- Act IV ----------
lineChart(fig('intent'), {
  height: 280, aria: 'Casual share by attractiveness group: founder data rises from 23% to 52%; the model tracks it.',
  x: { min: 1, max: 8, ticks: [1, 2, 3, 4, 5, 6, 7, 8], fmt: (v) => (v === 1 ? 'least' : v === 8 ? 'most' : v), tipFmt: (v) => `Attractiveness group ${v} of 8` },
  y: { min: 0, max: 0.6, ticks: [0, 0.2, 0.4, 0.6], fmt: (v) => pct(v) },
  series: [
    { label: 'Model', color: '--men', points: SITE.intent.model.map((v, i) => [i + 1, v]) },
    { label: 'Founder data', color: '--neutral', width: 0.01, dots: true, points: SITE.intent.luap.map((v, i) => [i + 1, v / 100]) },
  ],
});
table(fig('commitGrid'), ['His appeal', 'Says serious', 'Her 10th', 'Her 50th', 'Her 90th', 'Her 99th'],
  SITE.commitGrid.map((r) => [ord(r.u * 100), pct(r.serious), ...r.commits.map((c) => ({ text: pct(c), cls: 'heat' }))]), { hl: 3 });
{
  const pick = [1, 3, 5];
  const cols = ['--men', '--dating', '--ink-muted'];
  const Ns = Array.from({ length: 51 }, (_, i) => i);
  lineChart(fig('stillSingle'), {
    height: 300, aria: 'Chance still single after N first dates: with a 40% chance per woman, near zero by 8 dates; in the model, most men are still single after 20.',
    x: { min: 0, max: 50, ticks: [0, 10, 20, 30, 40, 50], tipFmt: (v) => `${v} first dates` },
    y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => pct(v) },
    series: [
      ...pick.map((k, j) => ({ label: bandLabel(SITE.perDate[k]) + ' men', color: cols[j], points: Ns.map((n) => [n, Math.pow(1 - SITE.perDate[k].p, n)]) })),
      { label: '40% per woman', color: '--neutral', dash: [5, 4], points: Ns.map((n) => [n, Math.pow(0.6, n)]) },
    ],
  });
}
bars(fig('cheat'), SITE.cheating.quintiles.map((q) => ({ label: `Quintile ${q.q}`, sub: `median ${q.median} partner${q.median === 1 ? '' : 's'}`, value: q.cheated, text: pct(q.cheated), cls: 'men', hl: q.q === 5 })), { max: 0.5 });

// ---------- Act V ----------
{
  const okc = SITE.age.okcupid, peak = (k) => Math.max(...okc[k]);
  lineChart(fig('interest'), {
    height: 300, aria: 'Interest by age: women peak at 22 and fall to 23% of peak by 40; men peak at 26.',
    x: { min: 18, max: 48, ticks: [20, 25, 30, 35, 40, 45], tipFmt: (v) => `Age ${v}` },
    y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => pct(v) },
    series: [
      { label: 'Women', color: '--women', width: 2.5, points: okc.age.map((a, i) => [a, okc.women[i] / peak('women')]) },
      { label: 'Men', color: '--men', points: okc.age.map((a, i) => [a, okc.men[i] / peak('men')]) },
    ],
  });
  const host = fig('body');
  host.innerHTML = '<div class="fig-row"><div data-sub="fec"></div><div data-sub="whr"></div></div>';
  const ge = SITE.age.geruso;
  const used = (age) => { let u = 0, t = 0; ge.age.forEach((a, i) => { if (a < 20) return; t += ge.monthly[i]; if (a < age) u += ge.monthly[i]; }); return u / t; };
  lineChart(host.querySelector('[data-sub="fec"]'), {
    height: 220, endLabels: false, aria: 'Share of lifetime fecundity used since 20: 69% by 30, 87% by 35.',
    x: { min: 20, max: 45, ticks: [20, 25, 30, 35, 40, 45], tipFmt: (v) => `Age ${v}` }, y: { min: 0, max: 1, ticks: [0, 0.5, 1], fmt: (v) => pct(v), label: 'Fecundity used since 20' },
    series: [{ label: 'Fecundity used', color: '--dating', width: 2.5, points: Array.from({ length: 26 }, (_, i) => [20 + i, used(20 + i)]) }],
  });
  lineChart(host.querySelector('[data-sub="whr"]'), {
    height: 220, endLabels: false, aria: 'Share of women at WHR 0.74 or below: about 5% at 20, 2% at 30, 1% at 40.',
    x: { min: 18, max: 50, ticks: [20, 30, 40, 50], tipFmt: (v) => `Age ${v}` }, y: { min: 0, max: 0.06, ticks: [0, 0.02, 0.04, 0.06], fmt: (v) => pct(v), label: 'Women at WHR ≤ 0.74' },
    series: [{ label: 'WHR ≤ 0.74', color: '--women', width: 2.5, points: SITE.age.whr.map((r) => [r.age, r.le074]) }],
  });
}
lineChart(fig('nevermarried'), {
  height: 280, aria: 'Never-married men: casual share rises from 23% at 25 to 60% at 45; average appeal percentile falls from 46th to 30th.',
  x: { min: 25, max: 50, ticks: [25, 30, 35, 40, 45, 50], tipFmt: (v) => `Age ${v}` }, y: { min: 0, max: 0.8, ticks: [0, 0.2, 0.4, 0.6, 0.8], fmt: (v) => pct(v) },
  series: [
    { label: 'Casual', color: '--men', width: 2.5, dots: true, points: SITE.age.cohortMen.map((r) => [r.age, r.casual]) },
    { label: 'Avg appeal pctile', color: '--neutral', dots: true, points: SITE.age.cohortMen.map((r) => [r.age, r.appeal]) },
  ],
});
lineChart(fig('herAge'), {
  height: 300, aria: 'Chance of a committed man within five years by starting age: 47% at 22, 19% at 30; the census stays near 34% until 34.',
  x: { min: 22, max: 38, ticks: [22, 26, 30, 34, 38], tipFmt: (v) => `Starting at ${v}` }, y: { min: 0, max: 0.6, ticks: [0, 0.2, 0.4, 0.6], fmt: (v) => pct(v) },
  series: [
    { label: 'Model', color: '--women', width: 2.5, dots: true, points: SITE.herByAge.map((r) => [r.start, r.any]) },
    { label: 'Less on looks', color: '--dating', dash: [5, 3], points: SITE.herByAge.map((r) => [r.start, r.adapt]) },
    { label: 'Census', color: '--neutral', points: SITE.herByAge.map((r) => [r.start, r.census]) },
  ],
});

// ---------- Act VI ----------
table(fig('searchOdds'), ['Up-front read', '1 in 1,000', '1 in 10,000', '1 in 100,000', '1 in 250,000', 'Best found, median luck'],
  SITE.searchOdds.map((r) => [r.r === 1 ? 'Perfect' : r.r.toFixed(2), ...r.odds.map((o, j) => pct(o, j >= 2 ? 1 : 0)), `1 in ${r.median.toLocaleString('en-US')}`]), { hl: 2 });
table(fig('herAppeal'), ['Her appeal', 'Matches (yr 1)', 'Committed man', 'Top 10%', 'Top 5%', 'Top 1%', 'As rare as her'],
  SITE.herByAppeal.map((r) => [ord(r.v * 100), num(r.matches), pct(r.any), pct(r.top10), pct(r.top5, 1), pct(r.top1, 1), pct(r.equal)]), { hl: 2 });
table(fig('hisAppeal'), ['His appeal', 'First dates in 5 yrs', 'Committed woman', 'Top 10%', 'Top 5%', 'Top 1%', 'As rare as him'],
  SITE.hisByAppeal.map((r) => [bandLabel(r), num(r.dates5y), pct(r.any), pct(r.top10), pct(r.top5, 1), pct(r.top1, 1), pct(r.equal)]), { hl: 1 });

// ---------- Act VII ----------
table(fig('levers'), ['Strategy', 'Committed man', 'Top 10%', 'Top 5%', 'Top 1%'],
  SITE.levers.map((l) => [l.label, pct(l.any), pct(l.top10), pct(l.top5, 1), pct(l.top1, 1)]), { hl: 0 });
table(fig('exchange'), ['Her WHR', 'Share of single women 22-29', 'Men she can reach: earning', 'or worth'],
  SITE.exchange.tiers.map((t) => [`≤ ${t.whr}`, pct(t.share, t.share < 0.01 ? 2 : 1), money(t.income) + '+', money(t.net_worth) + '+']), { hl: 2 });
table(fig('exchangeM'), ['To reach women at WHR', 'About 1 in', 'Earn', 'or be worth', 'If you are fit, earn'],
  SITE.exchange.tiers.map((t) => [`≤ ${t.whr}`, Math.round(1 / t.share).toLocaleString('en-US'), money(t.income) + '+', money(t.net_worth) + '+', t.income_if_fit > 20000 ? money(t.income_if_fit) + '+' : 'anything']), { hl: 2 });
table(fig('glp'), ['Starting WHR pctile', 'Intervention', 'WHR', 'New WHR pctile', 'Appeal', 'Committed man', 'Top 10%'],
  SITE.glp.map((g) => [ord(g.start * 100), g.drug === 'semaglutide' ? 'Semaglutide-sized' : g.glute ? 'Tirzepatide + glutes' : 'Tirzepatide-sized', `${g.whr.toFixed(2)} → ${g.newWhr.toFixed(2)}`,
    ord(g.newPct * 100), `${ord(g.appeal0 * 100)} → ${ord(g.appeal1 * 100)}`, `${pct(g.any0)} → ${pct(g.any1)}`, `${pct(g.top10_0)} → ${pct(g.top10_1)}`]), { hl: 5 });
{
  const ages = [...new Set(SITE.reach.map((x) => x.wife_age))];
  table(fig('reach'), ["Wife's age at marriage", 'Gap under 2 years', 'Gap 10+ years', 'Lift', 'Couples with a 10+ gap'], ages.map((wa) => {
    const a = SITE.reach.find((x) => x.wife_age === wa && x.gap === 'under 2'), c = SITE.reach.find((x) => x.wife_age === wa && x.gap === '10+');
    return [wa, pct(a.top10, 1), pct(c.top10, 1), `${(c.top10 / a.top10).toFixed(1)}×`, c.n.toLocaleString('en-US')];
  }), { hl: 0 });
}
{
  const m = SITE.exchange.metros.filter((x) => x.women_per_millionaire != null);
  const row = (x, cls) => ({ label: x.name.split('-')[0].split(',')[0], value: x.women_per_millionaire, text: x.women_per_millionaire.toFixed(1), cls });
  bars(fig('metrosW'), m.slice(0, 8).map((x) => row(x, 'women')), { max: 1.5 });
  bars(fig('metrosM'), [...m].reverse().slice(0, 8).map((x) => row(x, 'men')), { max: 1.5 });
}
bars(fig('abs'), SITE.exchange.absWorth.map((a) => ({ label: `Fit, earning ${money(a.income)}`, value: a.equivalent_income, text: money(a.equivalent_income), cls: 'men' })), { max: 900000 });
bars(fig('options'), SITE.options.map((o) => ({ label: o.options === 1 ? "Today's options" : `${o.options}× today's options`, value: o.any, text: `${pct(o.any)} · top 10%: ${pct(o.top10)}`, cls: 'women', hl: o.options === 1,
  sub: `a 90th-percentile man commits to a median woman ${pct(o.commit90)} of the time` })), { max: 1 });

// ---------- scrolling stories ----------
const stories = [...document.querySelectorAll('[data-scrolly]')].map((root) => {
  const st = createStepper(root, root.querySelector('.stage'));
  let visible = false;
  watchVisible(root, (v) => { visible = v; });
  return () => { if (visible) st.update(); };
});
function loop() { stories.forEach((f) => f()); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

// ---------- playgrounds ----------
const readouts = (host, items) => { host.innerHTML = items.map(([label, value, small]) => `<div class="ro"><span>${label}</span><b>${value}</b>${small ? `<small>${small}</small>` : ''}</div>`).join(''); };
const $ = (id) => document.getElementById(id);

// Act II: attention market
{
  const lorenz = lineChart($('p2chart'), {
    height: 280, aria: 'Share of all likes held by the top X% of men.',
    x: { min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v) => v + '%', tipFmt: (v) => `Top ${v}% of men` },
    y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => pct(v) }, series: [],
  });
  const run = () => {
    const f = Math.pow(4, (+$('p2like').value - 40) / 40), rho = +$('p2rho').value / 100, kappa = +$('p2kappa').value / 100;
    $('p2likeOut').textContent = '×' + f.toFixed(2).replace(/\.?0+$/, ''); $('p2rhoOut').textContent = rho.toFixed(2); $('p2kappaOut').textContent = kappa.toFixed(2);
    const m = D.attentionMarket({ rho, openness: scaled(W, f), kappa, M: 600 });
    const L = m.likes, tot = L.reduce((s, v) => s + v, 0), n = L.length, pts = [[0, 0]];
    let c = 0;
    for (let i = n - 1, k = 1; i >= 0; i--, k++) { c += L[i] / tot; if (k % 6 === 0) pts.push([(k / n) * 100, c]); }
    lorenz.update({ series: [
      { label: 'Men', color: '--men', width: 2.5, points: pts },
      { label: 'Equal', color: '--neutral', dash: [4, 4], points: [[0, 0], [100, 1]] },
    ] });
    readouts($('p2out'), [['Top 1% of men get', pct(m.top1)], ['Top 5% get', pct(m.top5), 'Hinge: 41%'], ['Top 10% get', pct(m.top10), 'Hinge: 58%'], ['Bottom half share', pct(m.bottom50, 1), 'Hinge: 4%']]);
  };
  ['p2like', 'p2rho', 'p2kappa'].forEach((id) => $(id).addEventListener('input', run));
  run();
}

// Act III: your year on the apps
{
  const run = () => {
    const p = +$('p3u').value;
    $('p3uOut').textContent = ord(p);
    if (getSex() === 'man') {
      const r = SITE.funnelByU[p - 1];
      readouts($('p3out'), [['Likes received a year', num(r.likes)], ['Matches a year', num(r.matches)], ['First dates a year', r.dates.toFixed(1)], ['Chance of no date all year', pct(r.noDate), `any sex from apps: ${pct(r.anySex)}`]]);
    } else {
      const ws = SITE.womenByU, v = p / 100;
      let j = ws.findIndex((w) => w.v >= v); if (j <= 0) j = 1; if (j < 0) j = ws.length - 1;
      const a = ws[j - 1], b = ws[j], t = Math.max(0, Math.min(1, (v - a.v) / (b.v - a.v)));
      const lerp = (k) => a[k] + (b[k] - a[k]) * t;
      readouts($('p3out'), [['Likes you send a year', num(lerp('likes'))], ['Matches a year', num(lerp('matches'))], ['First dates you have time for', num(Math.min(13, lerp('matches')))],
        ['Share of matches you can date', pct(Math.min(1, 13 / lerp('matches'))), 'so you date only the best-looking']]);
    }
  };
  $('p3u').addEventListener('input', run);
  sexSubs.push(run);
  run();
}

// Act IV: the commitment filter
{
  const menEq = D.attentionMarket({ rho: calibration.consensus.womenOnMen, openness: W, M: 600 });
  const chart = lineChart($('p4chart'), {
    height: 280, aria: 'Casual share among single men by appeal percentile.',
    x: { min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v) => ord(v), tipFmt: (v) => `${ord(v)} percentile` },
    y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => pct(v) }, series: [],
  });
  const run = () => {
    const b = +$('p4b').value / 100, kc = +$('p4kc').value / 100, x50 = +$('p4x').value / 100;
    $('p4bOut').textContent = pct(b); $('p4kcOut').textContent = pct(kc); $('p4xOut').textContent = x50.toFixed(2) + '×';
    const g = D.commitmentByPercentile(menEq, { x50, b, kc, groups: 20 });
    chart.update({ series: [
      { label: 'Single men', color: '--men', width: 2.5, points: g.map((d) => [Math.round(d.uMid * 100), d.casualOnApp]) },
      { label: 'All men', color: '--neutral', dash: [4, 4], points: [[0, b], [100, b]] },
    ] });
  };
  ['p4b', 'p4kc', 'p4x'].forEach((id) => $(id).addEventListener('input', run));
  run();
}

// Act V: her clock (worker)
{
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let seq = 0, pending = null, busy = false;
  const out = $('p5out');
  const send = () => {
    if (busy) { pending = true; return; }
    busy = true; pending = false; out.classList.add('busy');
    const params = { start: +$('p5age').value, v: +$('p5v').value / 100, gap: +$('p5gap').value };
    worker.postMessage({ id: ++seq, type: 'her', params });
  };
  worker.onmessage = ({ data }) => {
    if (data.ready) { send(); return; }
    busy = false; out.classList.remove('busy');
    const r = data.result;
    readouts(out, [['A man who commits, within 5 years', pct(r.any)], ['…who is also top 10% on quality', pct(r.top10)], ['…top 5%', pct(r.top5, 1)], ['…top 1%', pct(r.top1, 1),
      `matches in year one: ${num(r.matches)}; the men she dates commit ${pct(r.commits)} of the time`]]);
    if (pending) send();
  };
  const label = () => { $('p5ageOut').textContent = $('p5age').value; $('p5vOut').textContent = ord(+$('p5v').value); $('p5gapOut').textContent = '+' + $('p5gap').value + ' years'; };
  ['p5age', 'p5v', 'p5gap'].forEach((id) => $(id).addEventListener('input', () => { label(); send(); }));
  label();
  readouts(out, [['A man who commits, within 5 years', '…', 'warming up the model (a few seconds the first time)'], ['…who is also top 10% on quality', '…'], ['…top 5%', '…'], ['…top 1%', '…']]);
}

// Act VI: the search calculator
{
  const run = () => {
    const n = +$('p6n').value, r = Math.min(0.999, +$('p6r').value / 100), p = Math.pow(10, -3 + (3 * +$('p6p').value) / 100 - 1e-9);
    const k = +$('p6k').value, q = +$('p6q').value / 100;
    $('p6nOut').textContent = n; $('p6rOut').textContent = r >= 0.999 ? 'perfect' : r.toFixed(2); $('p6pOut').textContent = pct(p, p < 0.01 ? 1 : 0);
    $('p6kOut').textContent = k; $('p6qOut').textContent = pct(q);
    const odds = (N) => D.findOdds({ n, p, N, r });
    const med = D.bestRarity({ n, p, r });
    const rare = D.traitRarity({ k, q, rho: 0 }), rare2 = D.traitRarity({ k, q, rho: 0.2 });
    readouts($('p6out'), [['Find a 1 in 1,000', pct(odds(1e3))], ['Find a 1 in 10,000', pct(odds(1e4), 1)], ['Best you find, median luck', `1 in ${Math.round(med).toLocaleString('en-US')}`],
      [`Top ${pct(q)} on ${k} trait${k > 1 ? 's' : ''}`, `1 in ${Math.round(1 / rare).toLocaleString('en-US')}`, `if traits correlate at 0.2: 1 in ${Math.round(1 / rare2).toLocaleString('en-US')}`]]);
  };
  ['p6n', 'p6r', 'p6p', 'p6k', 'p6q'].forEach((id) => $(id).addEventListener('input', run));
  run();
}
