// Act III: where you source. A ladder of 100% stacked bars, one per hiring channel,
// showing which fifth of true quality the hire lands in, plus the mean percentile.
// In the story, rows appear as the reader scrolls (ROW_STEP says when); the playground
// shows every row and lets the reader change network homophily, the referrer, how
// many candidates you interview, and how many people the referrer weighs.

import { PRESET_HIRING, CHANNELS, sourceChannel, Z90, Z99 } from './model.js';
import { getDist, onJobChange, standardLadder, ordinal } from './jobs.js';
import { createStepper, watchVisible } from './stepper.js';

const ROW_STEP = { charm: 0, unstructured: 1, structured: 1, poach: 2, poachS: 3, friend: 4, excol: 5, ap3: 6, ap5: 6, ap8: 7 };
const LABEL_MIN = 0.09;   // label a segment only if it is at least 9% wide

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Builds the ladder DOM for a list of channels; returns { rows, update }.
export function buildLadder(host, channels) {
  host.innerHTML = '';
  host.classList.add('ladder');
  const rows = {};
  let group = null;
  channels.forEach((ch) => {
    if (ch.group !== group) {
      group = ch.group;
      host.appendChild(el('div', 'lgroup', group)).dataset.group = group;
    }
    const row = el('div', 'lrow');
    row.dataset.id = ch.id; row.dataset.group = ch.group;
    const name = row.appendChild(el('span', 'lname', ch.label));
    const bar = row.appendChild(el('div', 'lbar'));
    bar.setAttribute('role', 'img');
    const segs = [0, 1, 2, 3, 4].map((q) => {
      const s = bar.appendChild(el('i', 'seg q' + (q + 1)));
      s.style.transitionDelay = (q * 0.07).toFixed(2) + 's';
      s.appendChild(el('b'));
      return s;
    });
    const mean = row.appendChild(el('span', 'lmean mono', '—'));
    host.appendChild(row);
    rows[ch.id] = { row, name, bar, segs, mean };
  });
  function update(results) {
    for (const [id, r] of Object.entries(results)) {
      const R = rows[id];
      if (!R) continue;
      r.q.forEach((v, q) => {
        R.segs[q].style.setProperty('--w', (v * 100).toFixed(2));
        R.segs[q].firstChild.textContent = v >= LABEL_MIN ? Math.round(v * 100) + '%' : '';
      });
      R.mean.textContent = ordinal(Math.round(r.mean * 100));
      R.bar.setAttribute('aria-label', 'Hires by fifth of true quality, bottom to top: ' +
        r.q.map((v) => Math.round(v * 100) + '%').join(', ') + '. Mean percentile ' + Math.round(r.mean * 100) + '.');
    }
  }
  return { rows, update };
}

export function createAct3Story(root) {
  const stage = root.querySelector('.stage');
  const stepper = createStepper(root, stage);
  const lad = buildLadder(stage.querySelector('.ladder-host'), CHANNELS);
  let visible = false, last = -1;
  watchVisible(root, (v) => { visible = v; });

  function refresh() { lad.update(standardLadder()); }
  refresh();
  onJobChange(refresh);

  function frame() {
    if (!visible) return;
    const { active, step } = stepper.update();
    if (active === last) return;
    last = active;
    const all = step.focus === 'all';
    const shownGroups = new Set();
    for (const [id, R] of Object.entries(lad.rows)) {
      const at = ROW_STEP[id];
      const shown = at <= active;
      R.row.classList.toggle('shown', shown);
      R.row.classList.toggle('dim', shown && !all && at !== active);
      if (shown) shownGroups.add(R.row.dataset.group);
    }
    stage.querySelectorAll('.lgroup').forEach((g) => g.classList.toggle('shown', shownGroups.has(g.dataset.group)));
  }
  return { frame };
}

// ---------- Try it yourself ----------
export function createAct3Play(root) {
  const $ = (id) => root.querySelector('#' + id);
  const rhoSlider = $('a3rho'), kSlider = $('a3k'), krSlider = $('a3kr');
  const chans = CHANNELS.filter((c) => c.id !== 'ap5' && c.id !== 'ap8').map((c) => (c.id === 'ap3' ? { ...c, id: 'ap' } : c));
  const lad = buildLadder($('a3ladder'), chans);
  Object.values(lad.rows).forEach((R) => R.row.classList.add('shown'));
  const state = { rho: 0.3, zRef: Z90, k: 5, kRef: 3 };
  // Controls sit inside the ladder, under the rows they affect.
  lad.rows.poachS.row.after($('a3ctrlInterview'));
  lad.rows.ap.row.after($('a3ctrlReferral'));
  let pending = null, visible = false;
  watchVisible(root, (v) => { visible = v; if (v && pending) schedule(pending); }, '100px');

  function apLabel() { return 'A-player referral (ρ = ' + state.rho.toFixed(2).replace(/^0/, '') + ')'; }

  // Recompute on the next frame; 'all' reruns every row, anything else only the referral rows.
  function schedule(what) {
    pending = pending === 'all' || what === 'all' ? 'all' : what;
    if (!visible) return;
    requestAnimationFrame(() => {
      if (!pending) return;
      const d = getDist(), res = {};
      const list = pending === 'all' ? chans : chans.filter((c) => c.referral);
      list.forEach((c) => {
        const ch = c.id === 'ap' ? { ...c, rho: state.rho } : c;
        const k = c.referral ? state.kRef : state.k;
        res[c.id] = sourceChannel(d, PRESET_HIRING, ch, { k, n: 10000, zRef: state.zRef, seed: 51 + chans.indexOf(c) });
      });
      pending = null;
      lad.rows.ap.name.textContent = apLabel();
      lad.update(res);
    });
  }

  rhoSlider.addEventListener('input', () => {
    state.rho = +rhoSlider.value / 100;
    $('a3rhoOut').textContent = state.rho.toFixed(2);
    schedule('ap');
  });
  kSlider.addEventListener('input', () => {
    state.k = +kSlider.value;
    $('a3kOut').textContent = String(state.k);
    $('a3kNote').textContent = state.k === 1 ? 'One candidate: nothing to compare, so the interview can\'t help.' : 'Applies to the open market and poaching rows above.';
    schedule('all');
  });
  krSlider.addEventListener('input', () => {
    state.kRef = +krSlider.value;
    $('a3krOut').textContent = String(state.kRef);
    $('a3krNote').textContent = state.kRef === 1 ? 'They pass along whoever comes to mind. For a family member, that\'s nepotism.' : 'How many people they think through before sending you one.';
    schedule('ref');
  });
  root.querySelectorAll('[data-zref]').forEach((b) => b.addEventListener('click', () => {
    state.zRef = b.dataset.zref === '99' ? Z99 : Z90;
    root.querySelectorAll('[data-zref]').forEach((x) => x.classList.toggle('active', x === b));
    schedule('ap');
  }));
  onJobChange(() => schedule('all'));
  schedule('all');

  return { frame() {} };
}
