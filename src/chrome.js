// Page-level motion: floating hero dots with parallax, the act progress rail,
// and fade-up reveals for elements marked .float-in.

import { mulberry32 } from './model.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initChrome() {
  // Hero: a scatter of red / neutral / blue dots drifting at different depths.
  const field = document.querySelector('.hero-field');
  const dots = [];
  if (field) {
    const rng = mulberry32(7);
    const tones = ['red', 'red', 'red', 'mid', 'mid', 'blue', 'blue', 'lemon'];
    for (let i = 0; i < 46; i++) {
      const d = document.createElement('span');
      const depth = 0.15 + rng() * 0.85;
      d.className = 'hero-dot tone-' + tones[Math.floor(rng() * tones.length)];
      d.style.left = (rng() * 100).toFixed(2) + '%';
      d.style.top = (rng() * 100).toFixed(2) + '%';
      d.style.setProperty('--size', (4 + depth * 16).toFixed(1) + 'px');
      d.style.setProperty('--dur', (9 + rng() * 10).toFixed(1) + 's');
      d.style.setProperty('--delay', (-rng() * 12).toFixed(1) + 's');
      d.style.opacity = (0.35 + depth * 0.6).toFixed(2);
      field.appendChild(d);
      dots.push({ el: d, depth });
    }
  }

  const rail = Array.from(document.querySelectorAll('.rail-seg[data-act]'));
  const acts = rail.map((seg) => document.getElementById(seg.dataset.act));

  function onScroll() {
    const y = window.scrollY, vh = window.innerHeight;
    if (!reduceMotion) dots.forEach(({ el, depth }) => { el.style.translate = '0 ' + (-y * depth * 0.6).toFixed(1) + 'px'; });
    rail.forEach((seg, i) => {
      const sec = acts[i];
      if (!sec) return;
      const r = sec.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (vh * 0.5 - r.top) / r.height));
      seg.style.setProperty('--p', p.toFixed(3));
      seg.classList.toggle('is-current', r.top < vh * 0.5 && r.bottom > vh * 0.5);
    });
    document.body.classList.toggle('scrolled', y > 40);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -12% 0px' });
  document.querySelectorAll('.float-in').forEach((el) => io.observe(el));
}
