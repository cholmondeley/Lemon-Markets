// Shared drawing for the density-curve charts (Acts II and IV): a truth-ratio grid,
// summaries, a red-to-blue fill, one labelled density row, and the axis.

import { C, honestyColor } from './colors.js';

export const GRID = 360;

export function gridFor(xMax) {
  const xs = new Float64Array(GRID);
  for (let i = 0; i < GRID; i++) xs[i] = ((i + 0.5) / GRID) * xMax;
  return xs;
}

// Mean and central-80% range of a density on a grid.
export function summarize(xs, f) {
  const dx = xs[1] - xs[0];
  let tot = 0, m = 0;
  for (let i = 0; i < xs.length; i++) { tot += f[i] * dx; m += xs[i] * f[i] * dx; }
  let c = 0, lo = xs[0], hi = xs[xs.length - 1], gotLo = false;
  for (let i = 0; i < xs.length; i++) {
    c += f[i] * dx / tot;
    if (!gotLo && c >= 0.1) { lo = xs[i]; gotLo = true; }
    if (c >= 0.9) { hi = xs[i]; break; }
  }
  return { mean: m / tot, lo, hi };
}

// Horizontal red -> grey -> blue fill for a density area.
export function honestyGradient(ctx, x0, x1, xMax) {
  const grad = ctx.createLinearGradient(x0, 0, x1, 0);
  for (let i = 0; i <= 12; i++) { const v = (i / 12) * xMax; grad.addColorStop(i / 12, honestyColor(v)); }
  return grad;
}

// Draws one density row: area, 80% bracket, mean tick, label.
export function drawRow(ctx, g, f, yBase, scale, label, alpha, stats) {
  if (alpha < 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.moveTo(g.xAt(0), yBase);
  for (let i = 0; i < g.xs.length; i++) ctx.lineTo(g.xAt(g.xs[i]), yBase - Math.min(g.rowH, f[i] * scale));
  ctx.lineTo(g.xAt(g.xMax), yBase); ctx.closePath();
  ctx.globalAlpha = alpha * 0.55; ctx.fillStyle = g.grad; ctx.fill();
  ctx.globalAlpha = alpha; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.strokeStyle = C.ruleStrong; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(g.xAt(0), yBase); ctx.lineTo(g.xAt(g.xMax), yBase); ctx.stroke();
  // 80% bracket
  const by = yBase + 12, lx = g.xAt(stats.lo), hx = g.xAt(stats.hi);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(lx, by - 4); ctx.lineTo(lx, by); ctx.lineTo(hx, by); ctx.lineTo(hx, by - 4); ctx.stroke();
  ctx.fillStyle = C.inkMuted; ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
  ctx.fillText('80%: ' + stats.lo.toFixed(2) + '–' + stats.hi.toFixed(2), (lx + hx) / 2, by + 14);
  // mean
  const mx = g.xAt(stats.mean);
  ctx.beginPath(); ctx.arc(mx, by, 3.5, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();
  ctx.textAlign = 'left'; ctx.font = '600 11px "IBM Plex Sans", sans-serif'; ctx.fillStyle = C.ink;
  ctx.fillText(label, g.padX, yBase - g.rowH + 2);
  ctx.restore();
}

export function drawAxis(ctx, g, y) {
  ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]); ctx.strokeStyle = C.inkFaint;
  ctx.beginPath(); ctx.moveTo(g.xAt(1), g.top); ctx.lineTo(g.xAt(1), y); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = C.inkFaint; ctx.textAlign = 'center';
  for (let v = 0; v <= g.xMax + 1e-9; v += 0.5) {
    const last = v === g.xMax;
    const honest = g.w < 520 ? '1.0' : '1.0 as advertised';
    ctx.fillText(v === 1 ? honest : v.toFixed(1) + (last && g.plus ? '+' : ''), Math.min(g.xAt(v), g.w - 22), y);
  }
  ctx.textAlign = 'left';
}

