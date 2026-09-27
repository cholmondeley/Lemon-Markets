// The dating page: page-wide woman / man switch, numbers bound into the prose, each act's figures
// and scrolling stories, and the playgrounds. Default tables come precomputed in site.json
// (scripts/dating/site-data.mjs); the reader's own scenarios run live, the heavy ones in a worker.
import '../styles.css';
import './dating.css';
import SITE from '../data/dating/site.json';
import digitized from '../data/dating/digitized.json';
import calibration from '../data/dating/calibration.json';
import status from '../data/dating/status.json';
import { initChrome } from '../chrome.js';
import { createStepper, watchVisible } from '../stepper.js';
import { normCdf } from '../model.js';
import * as D from './model.js';
import { lineChart, histChart, bars, table, sankey, waterfall, pct, ord, money, num, redrawAll } from './charts.js';

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
const FMT = { pct: (v) => pct(v), pct1: (v) => pct(v, 1), num: (v) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1)), k: (v) => Math.round(v / 1000), ord: (v) => ord(v * 100), pts: (v) => Math.round(v * 100) };
document.querySelectorAll('[data-v]').forEach((el) => {
  const v = get(el.dataset.v);
  if (typeof v === 'number') el.textContent = (FMT[el.dataset.f] || FMT.num)(v);
});

const fig = (id) => document.querySelector(`[data-fig="${id}"]`);
const bandLabel = (b) => (b.lo === 0 ? 'Bottom half' : b.hi === 1 ? `Top ${Math.round((1 - b.lo) * 100)}%` : `${ord(b.lo * 100)}–${ord(b.hi * 100)}`);
const lerpRows = (rows, key, v, fields) => {
  let j = rows.findIndex((r) => r[key] >= v);
  if (j <= 0) j = 1; if (j < 0) j = rows.length - 1;
  const a = rows[j - 1], b = rows[j], t = Math.max(0, Math.min(1, (v - a[key]) / (b[key] - a[key])));
  return Object.fromEntries(fields.map((f) => [f, Array.isArray(a[f]) ? a[f].map((x, i) => x + (b[f][i] - x) * t) : a[f] + (b[f] - a[f]) * t]));
};
// Invert a monotone table: the x at which rows[i][yKey] reaches y.
const invert = (rows, xKey, yKey, y) => {
  if (y <= rows[0][yKey]) return rows[0][xKey];
  for (let i = 1; i < rows.length; i++) if (rows[i][yKey] >= y) { const a = rows[i - 1], b = rows[i]; return a[xKey] + (b[xKey] - a[xKey]) * (y - a[yKey]) / (b[yKey] - a[yKey]); }
  return rows[rows.length - 1][xKey];
};

// ---------- Prologue and Act I ----------
lineChart(fig('cohorts'), {
  height: 380, aria: 'Line chart: share of US women married by age, one line per decade of birth. By 30: about 89% for the 1940s, 52% for the 1990s; the 2000s cohort is at 17% by 24.',
  x: { min: 15, max: 45, ticks: [15, 20, 25, 30, 35, 40, 45], tipFmt: (v) => `Age ${v}` },
  y: { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1], fmt: (v) => pct(v) },
  series: Object.entries(SITE.cohorts).map(([c, pts]) => ({ label: `Born ${c}s`, color: `--coh-${c}`, width: c >= '1990' ? 3 : 2, points: pts })),
});
{
  const ch = SITE.channels, h = SITE.hcmst.at(-1);
  const focus = { Online: '--dating', 'Through friends': '--ink-muted' };
  lineChart(fig('channels'), {
    height: 340, aria: `Line chart of how couples met, 1940 to 2022: online rises from zero after 1995 to 39% in 2017 and ${pct(h.online)} for couples who met in 2020-22; meeting through friends falls from 34% to 20%.`,
    x: { min: 1940, max: 2022, ticks: [1940, 1960, 1980, 2000, 2021], fmt: (v) => (v === 2021 ? '2020-22' : v) },
    y: { min: 0, max: 0.7, ticks: [0, 0.2, 0.4, 0.6], fmt: (v) => pct(v) },
    series: [
      ...Object.entries(ch.series).map(([label, ys]) => ({ label, color: focus[label] || '--rule-strong', width: label === 'Online' ? 3 : focus[label] ? 2 : 1.5, points: ch.years.map((y, i) => [y, ys[i]]) })),
      { label: `2020-22 (n=${h.n})`, color: '--dating', width: 0.01, dots: true, points: [[2021, h.online]] },
    ],
  });
}
SITE.calcExamples.forEach((ex, i) => {
  document.querySelector(`[data-fig-title="calc${i}"]`).textContent = ex.who;
  bars(fig('calc' + i), ex.steps.map(([label, v], j) => ({ label, value: Math.log10(v), text: v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : num(v), cls: j === 0 ? 'neutral' : i === 0 ? 'men' : 'women', hl: j === ex.steps.length - 1 })), { max: 7.5 });
});

// ---------- Act II ----------
fig('ratio').innerHTML = `<div class="tiles">
  <div class="tile men"><b>73%</b><span>of 18-29-year-olds on the apps are men (Pew 2022): 2.7 men per woman</span></div>
  <div class="tile"><b>1.5 : 1</b><span>men per woman over a whole year: women try the apps and leave faster</span></div>
  <div class="tile women"><b>54%</b><span>of women on the apps are at least sometimes overwhelmed by messages</span></div>
  <div class="tile men"><b>64%</b><span>of men on the apps feel insecure about how few they get</span></div></div>`;
const pctTicks = [[0, '0%'], [25, '25%'], [50, '50%'], [75, '75%'], [100, '100%']];
const binTip = (who) => (i, share) => `<b>${i}–${i + 1}%</b><div class="k">${pct(share, 1)} of ${who}</div>`;
histChart(fig('likeW'), { height: 280, bins: SITE.hist.womenLike, color: '--women', maxBin: 60, xTicks: [[0, '0%'], [20, '20%'], [40, '40%'], [60, '60%']], tip: binTip('women'), aria: 'Histogram: most women like under 10% of profiles; median 4.5%.' });
histChart(fig('likeM'), { height: 280, bins: SITE.hist.menLike, color: '--men', xTicks: pctTicks, tip: binTip('men'), aria: 'Histogram: men like a broad range of profiles; median 26%.' });
histChart(fig('recvM'), { height: 300, bins: SITE.hist.menReceived, color: '--men', maxBin: 40, xTicks: [[0, '0%'], [10, '10%'], [20, '20%'], [30, '30%'], [40, '40%']], marks: [{ bin: 5, text: 'median ≈ 5%' }], tip: binTip('men'), aria: 'Histogram of the share of women who like each man: peaked at 3-5%, long right tail to 35%.' });
{
  const H = SITE.hinge, rows = [];
  [['men', 'Men'], ['women', 'Women']].forEach(([k, lab]) => {
    rows.push({ group: lab });
    [['top1', 'Top 1%'], ['top5', 'Top 5%'], ['top10', 'Top 10%'], ['bottom50', 'Bottom 50%']].forEach(([key, l]) => rows.push({ label: `${l} of ${lab.toLowerCase()}`, value: H[k][key], text: pct(H[k][key]), cls: k }));
  });
  bars(fig('hinge'), rows, { max: 1 });
}
{
  const a = SITE.attention;
  bars(fig('attention'), [
    { label: 'Men today', sub: "top 5% of women's share of men's likes", value: a.men, text: pct(a.men), cls: 'men' },
    { label: 'Women today', sub: "top 5% of men's share of women's likes", value: a.women, text: pct(a.women), cls: 'women', hl: true },
    { label: 'If women agreed far less on which men are attractive', value: a.agreeLess, text: pct(a.agreeLess), cls: 'accent' },
    { label: 'If dating apps were 50/50 men and women', value: a.even, text: pct(a.even), cls: 'accent' },
    { label: 'Both', value: a.both, text: pct(a.both), cls: 'accent' },
  ], { max: 0.6 });
}
const meanOf = (h) => D.histMean(D.histPoints(h));
const W = D.activityWeighted(D.histPoints(digitized.luap_like_rate_women), meanOf(digitized.luap_received_ratio_men)).pts;
const scaled = (pts, f) => pts.map((p) => ({ x: Math.min(0.99, p.x * f), w: p.w }));

// ---------- Act III ----------
{
  const [a, b] = SITE.nsfg;
  bars(fig('nsfg'), [
    { group: 'No sexual partner in the past year' },
    { label: '2017-19', value: a.men.single_partners_share['0'], text: pct(a.men.single_partners_share['0']), cls: 'neutral' },
    { label: '2022-23', value: b.men.single_partners_share['0'], text: pct(b.men.single_partners_share['0']), cls: 'men', hl: true },
    { group: 'Had sex with someone met online' },
    { label: '2017-19', value: a.men.app_sex_single, text: pct(a.men.app_sex_single, 1), cls: 'neutral' },
    { label: '2022-23', value: b.men.app_sex_single, text: pct(b.men.app_sex_single, 1), cls: 'men', hl: true },
    { group: 'Share of all partners held by the top 10% of men' },
    { label: '2017-19', value: a.men.single_top10_share_of_partners, text: pct(a.men.single_top10_share_of_partners), cls: 'neutral' },
    { label: '2022-23', value: b.men.single_top10_share_of_partners, text: pct(b.men.single_top10_share_of_partners), cls: 'men', hl: true },
  ], { max: 1 });
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
  height: 280, aria: 'Casual share by attractiveness group: app data rises from 23% to 52%; selection alone tracks it.',
  x: { min: 1, max: 8, ticks: [1, 2, 3, 4, 5, 6, 7, 8], fmt: (v) => (v === 1 ? 'least' : v === 8 ? 'most' : v), tipFmt: (v) => `Attractiveness group ${v} of 8` },
  y: { min: 0, max: 0.6, ticks: [0, 0.2, 0.4, 0.6], fmt: (v) => pct(v) },
  series: [
    { label: 'Selection alone', color: '--men', points: SITE.intent.model.map((v, i) => [i + 1, v]) },
    { label: 'App data', color: '--neutral', width: 0.01, dots: true, points: SITE.intent.luap.map((v, i) => [i + 1, v / 100]) },
  ],
});
bars(fig('commitBars'), SITE.commitBars.flatMap((r) => [
  { label: `${ord(r.p * 100)}-percentile man`, value: r.median, text: pct(r.median, r.median < 0.1 ? 1 : 0), cls: 'men', hl: r.p === 0.9 },
  { label: '<small>…to a top-10% woman</small>', value: r.top10, text: pct(r.top10, r.top10 < 0.1 ? 1 : 0), cls: 'women', rowCls: 'second' },
]), { max: 1, cls: 'pair-bars' });
{
  const pick = [1, 3, 5], cols = ['--men', '--dating', '--ink-muted'], Ns = Array.from({ length: 51 }, (_, i) => i);
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
{
  const m = SITE.poolMix;
  bars(fig('poolMix'), [
    { label: 'All men', value: m.all, text: pct(m.all), cls: 'neutral' },
    { label: 'Single men 25-35', value: m.single2535, text: pct(m.single2535), cls: 'men' },
    { label: 'Men on the apps', value: m.onApps, text: pct(m.onApps), cls: 'men' },
    { label: 'Never-married men at 40', value: m.never40, text: pct(m.never40), cls: 'men', hl: true },
  ], { max: 0.6 });
}

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
  height: 280, aria: 'Never-married men by age: the casual share rises and their average value as partners falls.',
  x: { min: 25, max: 50, ticks: [25, 30, 35, 40, 45, 50], tipFmt: (v) => `Age ${v}` }, y: { min: 0, max: 0.8, ticks: [0, 0.2, 0.4, 0.6, 0.8], fmt: (v) => pct(v) },
  series: [
    { label: 'Casual', color: '--men', width: 2.5, dots: true, points: SITE.age.cohortMen.map((r) => [r.age, r.casual]) },
    { label: 'Avg value pctile', color: '--neutral', dots: true, points: SITE.age.cohortMen.map((r) => [r.age, r.value]) },
  ],
});
lineChart(fig('herAge'), {
  height: 300, aria: 'A median woman\'s five-year odds by starting age: a committed man stays near 30% into her thirties; one at least as rare as she is falls steeply.',
  x: { min: 22, max: 38, ticks: [22, 26, 30, 34, 38], tipFmt: (v) => `Starting at ${v}` }, y: { min: 0, max: 0.5, ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5], fmt: (v) => pct(v) },
  series: [
    { label: 'A man who commits', color: '--neutral', width: 2.5, dots: true, points: SITE.herByAge.map((r) => [r.start, r.any]) },
    { label: 'As good as her or better', color: '--women', width: 2.5, dots: true, points: SITE.herByAge.map((r) => [r.start, r.rare]) },
  ],
});

// ---------- Act VI ----------
table(fig('searchOdds'), ['Up-front read', '1 in 1,000', '1 in 10,000', '1 in 100,000', '1 in 250,000', 'Best found, median luck'],
  SITE.searchOdds.map((r) => [r.r === 1 ? 'Perfect' : r.r.toFixed(2), ...r.odds.map((o, j) => pct(o, j >= 2 ? 1 : 0)), `1 in ${r.median.toLocaleString('en-US')}`]), { hl: 2 });
// ---------- Act VII ----------
{
  const draw = () => table(fig('levers'), ['Strategy', 'Committed man', 'As good as her or better', 'Top 10% man', 'Top 5%'],
    SITE.leversBy[document.getElementById('leverWho').value].map((l) => [l.label, pct(l.any), pct(l.rare), pct(l.top10, 1), pct(l.top5, 1)]), { hl: 0 });
  document.getElementById('leverWho').addEventListener('change', draw);
  draw();
}
waterfall(fig('waterfall'), SITE.waterfall.map((w) => ({ label: w.label, value: w.any })), { max: 1, sub: (s, i) => `as good as her or better: ${pct(SITE.waterfall[i].rare)} · top 10%: ${pct(SITE.waterfall[i].top10, 1)}` });
table(fig('exchange'), ['Her WHR', 'Share of single women 22-29', 'Men she can reach: earning', 'or worth'],
  SITE.exchange.tiers.map((t) => [`≤ ${t.whr}`, pct(t.share, t.share < 0.01 ? 2 : 1), money(t.income) + '+', money(t.net_worth) + '+']), { hl: 2 });
table(fig('glp'), ['Where she starts on WHR', 'WHR', 'Reaches ≤ 0.74: GLP-1 / + glutes', 'WHR percentile after', 'Top-10% man, 5 yrs'],
  SITE.glp.map((g) => [`Top ${Math.round(g.lo * 100)}-${Math.round(g.hi * 100)}%`, g.whr.toFixed(2), `${pct(g.q1)} / ${pct(g.q2)}`, `${ord(g.pct0 * 100)} → ${ord(g.pct2 * 100)}`, `${pct(g.top10_0)} → ${pct(g.top10_2)}`]), { hl: 1 });
{
  const ages = [...new Set(SITE.reach.map((x) => x.wife_age))];
  table(fig('reach'), ["Wife's age at marriage", 'Gap under 2 years', 'Gap 10+ years', 'Lift', 'Couples with a 10+ gap'], ages.map((wa) => {
    const a = SITE.reach.find((x) => x.wife_age === wa && x.gap === 'under 2'), c = SITE.reach.find((x) => x.wife_age === wa && x.gap === '10+');
    return [wa, pct(a.top10, 1), pct(c.top10, 1), `${(c.top10 / a.top10).toFixed(1)}×`, c.n.toLocaleString('en-US')];
  }), { hl: 0 });
}
{
  const m = SITE.exchange.metros.filter((x) => x.women_per_millionaire != null);
  bars(fig('metrosW'), m.slice(0, 8).map((x) => ({ label: x.name.split('-')[0].split(',')[0], value: x.women_per_millionaire, text: x.women_per_millionaire.toFixed(1), cls: 'women' })), { max: 1.5 });
}
table(fig('menLevers'), ['Strategy', 'His value pctile', 'First dates a year', 'Committed woman', '75th-pctile woman+', '90th-pctile woman+'],
  SITE.menLevers.map((l) => [l.label, ord(l.mvPct * 100), num(l.dates), pct(l.any), pct(l.p75, 1), pct(l.p90, 1)]), { hl: 0 });
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
const clampP = (p) => Math.max(0.01, Math.min(0.99, p));

// Concrete signals -> percentiles. Men: likes a week (the funnel's likes a year / 52). Women: likes a day.
const menLikes = SITE.funnelByU.map((r) => ({ p: r.p / 100, w: r.likes / 52 }));
const menPctFromLikes = (perWeek) => clampP(invert(menLikes, 'p', 'w', perWeek));
const womenLikes = SITE.womenByU.map((r) => ({ v: r.v, d: r.likesPerDay }));
const womenPctFromLikes = (perDay) => clampP(invert(womenLikes, 'v', 'd', perDay));
const menLikesAt = (v) => 0.05 * Math.pow(5000, v / 100);        // slider 0-100 -> 0.05-250 a week
const womenLikesAt = (v) => 5 * Math.pow(60, v / 100);            // slider 0-100 -> 5-300 a day
// A woman's appeal for her age from her app appeal (which already carries her age): OkCupid shift.
const womenShift = (a) => D.zTop(1 - 0.5 * Math.max(1e-4, D.curveAt(digitized.okcupid_age, 'women', Math.min(a, 48))));
const forHerAge = (pApp, age) => clampP(normCdf(D.zTop(1 - pApp) - womenShift(age)));

// Act II: attention market
{
  const lorenz = lineChart($('p2chart'), {
    height: 280, aria: 'Share of all likes held by the top X% of men.',
    x: { min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v) => v + '%', tipFmt: (v) => `Top ${v}% of men` },
    y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => pct(v) }, series: [],
  });
  const run = () => {
    // Fewer men per woman: the same conversations a day let a woman like more of what she's shown.
    const ratio = +$('p2ratio').value / 10, f = 2.7 / ratio, rho = +$('p2rho').value / 100, kappa = +$('p2kappa').value / 100;
    $('p2ratioOut').textContent = ratio.toFixed(1); $('p2rhoOut').textContent = rho.toFixed(2); $('p2kappaOut').textContent = kappa.toFixed(2);
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
  ['p2ratio', 'p2rho', 'p2kappa'].forEach((id) => $(id).addEventListener('input', run));
  run();
}

// Act III: your year on the apps, as a Sankey split at the target percentile.
{
  const plot = sankey($('p3sankey'), { stages: [], height: 250 });
  // Share of a bin (index k of n equal-width percentile bins) at or above t.
  const above = (k, n, t) => Math.max(0, Math.min(1, ((k + 1) / n - t) * n));
  const split = (arr, t) => { let hi = 0, lo = 0; arr.forEach((v, k) => { const a = above(k, arr.length, t); hi += v * a; lo += v * (1 - a); }); return { hi, lo }; };
  let lastSex = null;
  const run = () => {
    const man = getSex() === 'man';
    if (lastSex !== getSex()) $('p3likes').value = man ? 51 : 70;   // a week for men, a day for women: start at the median
    lastSex = getSex();
    const likes = man ? menLikesAt(+$('p3likes').value) : womenLikesAt(+$('p3likes').value);
    const p = Math.round((man ? menPctFromLikes(likes) : womenPctFromLikes(likes)) * 100), t = +$('p3t').value / 100;
    $('p3likesOut').textContent = likes < 1 ? likes.toFixed(1) : num(likes); $('p3rank').textContent = `About the ${ord(p)} percentile${man ? ' of men on the apps' : ' of women on the apps'}.`;
    $('p3tOut').textContent = ord(t * 100);
    $('p3key').innerHTML = `<span><i style="background:var(--dating)"></i>${man ? 'Women' : 'Men'} at the ${ord(t * 100)} percentile or better</span><span><i style="background:var(--neutral)"></i>Below</span>`;
    if (man) {
      const r = SITE.funnelByU[p - 1];
      const L = split(r.L, t), M = split(r.M, t), Dd = split(r.D, t);
      // Median percentile of the women who like him.
      const tot = r.L.reduce((s, v) => s + v, 0);
      let c = 0, med = 0;
      for (let k = 0; k < r.L.length; k++) { c += r.L[k]; if (c >= tot / 2) { med = SITE.funnelBins[k]; break; } }
      plot.update({ stages: [{ label: 'Liked you', ...L }, { label: 'Matches', ...M }, { label: 'First dates', ...Dd }], fmt: (v) => (v >= 10 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) });
      readouts($('p3out'), [['Likes a week', num(r.likes / 52), `the median woman who likes you is ${ord(med * 100)} percentile`],
        [`Matches a year with a ${ord(t * 100)}+ woman`, num(M.hi), `of ${num(r.matches)} matches in all`],
        [`First dates a year with one`, Dd.hi.toFixed(1), `of ${r.dates.toFixed(1)} in all`], ['Chance of no date all year', pct(r.noDate), `any sex from the apps: ${pct(r.anySex)}`]]);
    } else {
      const w = lerpRows(SITE.womenByU, 'v', p / 100, ['likesPerDay', 'likesSent', 'matches', 'dates', 'L', 'M', 'D']);
      const L = split(w.L.map((x) => x * 365), t), M = split(w.M.map((x) => x * 365), t);
      const dates = w.dates, Dd = split(w.D.map((x) => x * dates), t);
      plot.update({ stages: [{ label: 'Liked you', ...L }, { label: 'You liked back', ...M }, { label: 'First dates', ...Dd }], fmt: (v) => (v >= 10 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) });
      readouts($('p3out'), [['Likes a day', num(w.likesPerDay), `${num(w.likesPerDay * 365)} a year`],
        [`From ${ord(t * 100)}+ men`, pct(L.hi / (L.hi + L.lo)), `${num(L.hi / 365)} a day`],
        [`Matches a year with them`, num(M.hi), `you like about ${pct(w.likesSent / 15000, 1)} of profiles`],
        [`First dates with them`, `${Dd.hi.toFixed(1)} of ${Math.round(dates)}`, 'a year, if you are actively dating']]);
    }
  };
  ['p3likes', 'p3t'].forEach((id) => $(id).addEventListener('input', run));
  sexSubs.push(run);
  run();
}

// Act IV: the commitment filter (casual men pair off at the fitted 10% of the serious rate)
{
  const menEq = D.attentionMarket({ rho: calibration.consensus.womenOnMen, openness: W, M: 600 });
  const chart = lineChart($('p4chart'), {
    height: 280, aria: 'Casual share among single men by appeal percentile.',
    x: { min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v) => ord(v), tipFmt: (v) => `${ord(v)} percentile` },
    y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => pct(v) }, series: [],
  });
  const run = () => {
    const b = +$('p4b').value / 100, x50 = +$('p4x').value / 100;
    $('p4bOut').textContent = pct(b); $('p4xOut').textContent = x50.toFixed(2) + '×';
    const g = D.commitmentByPercentile(menEq, { x50, b, kc: calibration.commitment.kc, groups: 20 });
    chart.update({ series: [
      { label: 'Single men', color: '--men', width: 2.5, points: g.map((d) => [Math.round(d.uMid * 100), d.casualOnApp]) },
      { label: 'All men', color: '--neutral', dash: [4, 4], points: [[0, b], [100, b]] },
    ] });
  };
  ['p4b', 'p4x'].forEach((id) => $(id).addEventListener('input', run));
  run();
}

// The worker runs the reader's own scenarios (the calibrated model on the page's grid). Each
// playground sends one request at a time and, while dragging, only the latest.
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let workerReady = false, workerSeq = 0;
const workerWaiting = [], workerCallbacks = new Map();
worker.onmessage = ({ data }) => {
  if (data.ready) { workerReady = true; workerWaiting.splice(0).forEach((m) => worker.postMessage(m)); return; }
  const cb = workerCallbacks.get(data.id); workerCallbacks.delete(data.id); cb?.(data.result);
};
const ask = (type, params) => new Promise((resolve) => {
  const m = { id: ++workerSeq, type, params };
  workerCallbacks.set(m.id, resolve);
  if (workerReady) worker.postMessage(m); else workerWaiting.push(m);
});
function live(host, request, render) {
  let busy = false, pending = false;
  const go = () => {
    if (busy) { pending = true; return; }
    busy = true; pending = false; host.classList.add('busy');
    const { type, params } = request();
    ask(type, params).then((r) => { busy = false; host.classList.remove('busy'); render(r); if (pending) go(); });
  };
  return go;
}
const warming = (host) => readouts(host, [['Warming up the model', '…', 'a few seconds the first time'], ['', '…'], ['', '…'], ['', '…']]);

// Act V: your clock (her) and your odds (him).
{
  const out = $('p5out');
  const herParams = () => {
    const age = +$('p5age').value, d = womenLikesAt(+$('p5likes').value), v = forHerAge(womenPctFromLikes(d), age);
    $('p5likesOut').textContent = num(d); $('p5ageOut').textContent = age; $('p5gapOut').textContent = '+' + $('p5gap').value + ' years';
    $('p5rank').textContent = `About the ${ord(v * 100)} percentile for your age.`;
    return { start: age, v, gap: +$('p5gap').value };
  };
  const hisParams = () => {
    const perWeek = menLikesAt(+$('p5mlikes').value), uLooks = menPctFromLikes(perWeek);
    const age = +$('p5mage').value, inc = +$('p5inc').value === 0 ? 0 : 10000 * Math.pow(100, +$('p5inc').value / 100);
    const band = Object.values(status.earnings).find((b) => age >= b.lo && age <= b.hi) ?? Object.values(status.earnings).at(-1);
    let st = 0.5;
    const qs = band.q, es = band.earnings;
    if (inc <= es[0]) st = qs[0] / 2; else if (inc >= es.at(-1)) st = 0.995;
    else for (let i = 1; i < es.length; i++) if (inc <= es[i]) { st = qs[i - 1] + (qs[i] - qs[i - 1]) * (inc - es[i - 1]) / Math.max(1, es[i] - es[i - 1]); break; }
    const hq = status.height, ht = +$('p5height').value;
    let hp = 0.5;
    if (ht <= hq.inches[0]) hp = 0.03; else if (ht >= hq.inches.at(-1)) hp = 0.995;
    else for (let i = 1; i < hq.inches.length; i++) if (ht <= hq.inches[i]) { hp = hq.q[i - 1] + (hq.q[i] - hq.q[i - 1]) * (ht - hq.inches[i - 1]) / (hq.inches[i] - hq.inches[i - 1]); break; }
    let lo = +$('p5lo').value, hi = +$('p5hi').value;
    if (lo > hi) [lo, hi] = [hi, lo];
    $('p5mlikesOut').textContent = perWeek < 1 ? perWeek.toFixed(1) : num(perWeek); $('p5mlooks').textContent = `About the ${ord(uLooks * 100)} percentile on looks, among men on the apps.`;
    $('p5incOut').textContent = inc === 0 ? '$0' : money(inc); $('p5mstatus').textContent = `About the ${ord(clampP(st) * 100)} percentile for your age.`;
    $('p5heightOut').textContent = `${Math.floor(ht / 12)}'${ht % 12}"`; $('p5mageOut').textContent = age; $('p5rangeOut').textContent = `${lo}-${hi}`;
    return { age, uLooks, status: clampP(st), height: clampP(hp), lo, hi };
  };
  const go = live(out, () => (getSex() === 'man' ? { type: 'his', params: hisParams() } : { type: 'her', params: herParams() }), (r) => {
    if (r.mvPct != null) {
      readouts(out, [['Your value as a partner', ord(r.mvPct * 100), `${r.dates.toFixed(1)} first dates a year on the apps`], ['A woman who commits, within 5 years', pct(r.any)],
        ['…at the 75th percentile or better for her age', pct(r.p75, 1)], ['…90th or better', pct(r.p90, 1), `95th: ${pct(r.p95, 1)}`]]);
    } else {
      readouts(out, [['A man who commits, within 5 years', pct(r.any)], ['…as good as you or better', pct(r.rare)], ['…in the top 10% of men', pct(r.top10, 1)], ['…top 5%', pct(r.top5, 1), `top 1%: ${pct(r.top1, 1)}`]]);
    }
  });
  ['p5age', 'p5likes', 'p5gap', 'p5mlikes', 'p5inc', 'p5height', 'p5mage', 'p5lo', 'p5hi'].forEach((id) => $(id).addEventListener('input', go));
  sexSubs.push(go);
  herParams(); hisParams(); warming(out);
  go();
}

// Act VI: your odds over five years, from your likes alone.
{
  const host = $('p6bars');
  const plot = bars(host, [], { max: 1 });
  let lastSex = null;
  const params = () => {
    const man = getSex() === 'man';
    if (lastSex !== getSex()) $('p6likes').value = man ? 51 : 70;
    lastSex = getSex();
    const likes = man ? menLikesAt(+$('p6likes').value) : womenLikesAt(+$('p6likes').value);
    $('p6likesOut').textContent = likes < 1 ? likes.toFixed(1) : num(likes);
    if (man) {
      const u = menPctFromLikes(likes);
      $('p6rank').textContent = `About the ${ord(u * 100)} percentile on looks, among men on the apps.`;
      return { type: 'his', params: { age: 30, lo: 22, hi: 30, uLooks: u, status: 0.5, social: 0.5, height: 0.5 } };
    }
    const v = forHerAge(womenPctFromLikes(likes), 25);
    $('p6rank').textContent = `About the ${ord(v * 100)} percentile for your age.`;
    return { type: 'her', params: { start: 25, v, gap: 2 } };
  };
  const go = live(host, params, (r) => {
    const rows = r.mvPct != null
      ? [['A woman who commits', r.any, 'men'], ['…as good as you or better', r.rare, 'accent'], ['…at the 75th percentile or better', r.p75, 'men'], ['…90th or better', r.p90, 'men']]
      : [['A man who commits', r.any, 'women'], ['…as good as you or better', r.rare, 'accent'], ['…in the top 10% of men', r.top10, 'women'], ['…top 5%', r.top5, 'women']];
    plot.update(rows.map(([label, v, cls]) => ({ label, value: v, text: pct(v, v < 0.1 ? 1 : 0), cls })));
  });
  $('p6likes').addEventListener('input', go);
  sexSubs.push(go);
  go();
}
