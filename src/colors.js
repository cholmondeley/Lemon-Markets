// Theme colors read from CSS custom properties, shared by every canvas.

export const C = {};

export function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  C.ink = v('--ink'); C.inkMuted = v('--ink-muted'); C.inkFaint = v('--ink-faint');
  C.surface = v('--surface'); C.surface2 = v('--surface-2'); C.surface3 = v('--surface-3');
  C.rule = v('--rule'); C.ruleStrong = v('--rule-strong');
  C.red = v('--red'); C.blue = v('--blue'); C.accent = v('--accent'); C.lemon = v('--lemon');
  C.redSoft = v('--red-soft');
  C._rgb = { red: hexToRgb(C.red), mid: hexToRgb(C.inkFaint), blue: hexToRgb(C.blue) };
  return C;
}

export function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const num = parseInt(hex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export const lerp = (a, b, t) => a + (b - a) * t;

// Red (overselling) -> neutral (as advertised) -> blue (underselling), as [r, g, b].
// Symmetric in log space, as suits a ratio: 0.5 or below is full red, 2 or above full blue.
export function honestyRgb(x) {
  const t = Math.max(-1, Math.min(1, Math.log2(Math.max(x, 1e-6))));
  const { red, mid, blue } = C._rgb;
  const k = Math.pow(Math.abs(t), 0.75);
  const end = t < 0 ? red : blue;
  return [0, 1, 2].map((i) => Math.round(lerp(mid[i], end[i], k)));
}

export function honestyColor(x) { return 'rgb(' + honestyRgb(x).join(',') + ')'; }

export function fitCanvas(canvas, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth;
  if (cssHeight === 'fill') cssHeight = canvas.parentElement.clientHeight || 230;
  else canvas.style.height = cssHeight + 'px';
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(cssHeight * dpr)) canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: cssHeight };
}
