// Scroll position -> active step for a scrollytelling block. The active step is the
// last .step whose top has passed 60% of the viewport (85% on phones); progress runs 0 -> 1 through it.
// Elements in the stage with data-steps="3 4" get .is-on while one of those steps is active.

export function createStepper(root, stage) {
  const steps = Array.from(root.querySelectorAll('.step'));
  const bound = Array.from(stage.querySelectorAll('[data-steps]')).map((el) => ({
    el, list: el.dataset.steps.split(/[\s,]+/).map(Number),
  }));
  const st = { steps, active: -1, progress: 0, step: {} };
  // On phones the cards pin to the bottom of the screen, so the next step takes over lower down.
  const narrow = window.matchMedia('(max-width: 900px)');

  st.update = () => {
    const vh = window.innerHeight, line = vh * (narrow.matches ? 0.85 : 0.6);
    let idx = 0;
    for (let i = 0; i < steps.length; i++) if (steps[i].getBoundingClientRect().top < line) idx = i;
    const r = steps[idx].getBoundingClientRect();
    st.progress = Math.max(0, Math.min(1, (line - r.top) / Math.max(1, r.height - vh * 0.35)));
    if (idx !== st.active) {
      st.active = idx;
      st.step = steps[idx].dataset;
      steps.forEach((s, i) => s.classList.toggle('is-active', i === idx));
      stage.dataset.step = idx;
      bound.forEach(({ el, list }) => el.classList.toggle('is-on', list.includes(idx)));
    }
    return st;
  };
  return st;
}

// Calls back with whether the element is near the viewport.
export function watchVisible(el, cb, margin = '200px') {
  new IntersectionObserver((entries) => cb(entries[0].isIntersecting), { rootMargin: margin }).observe(el);
}
