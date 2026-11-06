// 90-day weight chart: pure functions (data in, SVG markup out). No DOM access.
import { dayNum, dateOfDayNum, ymd, MONTHS } from "./util.js";

export const WINDOW_DAYS = 90;

export function buildSeries(checkins, nowMs = Date.now()) {
  const today = dayNum(ymd(new Date(nowMs)));
  const start = today - (WINDOW_DAYS - 1);
  const byDay = new Map();
  for (const c of checkins) {
    if (c.deleted || c.weightKg === null || c.weightKg === undefined) continue;
    const d = dayNum(c.date);
    if (d < start || d > today) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(c.weightKg);
  }
  const points = [...byDay.keys()].sort((a, b) => a - b).map(d => {
    const arr = byDay.get(d);
    return { d, date: dateOfDayNum(d), kg: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 };
  });
  // 7-day trailing average over the days that have a reading
  const trend = points.map(p => {
    const win = points.filter(q => q.d <= p.d && q.d > p.d - 7);
    return { d: p.d, kg: win.reduce((a, q) => a + q.kg, 0) / win.length };
  });
  const first = points[0] || null;
  const last = points.length ? points[points.length - 1] : null;
  const change = first && last && points.length > 1 ? Math.round((last.kg - first.kg) * 10) / 10 : null;
  return { start, today, points, trend, first, last, change };
}

// Distinct days with at least one check-in in the last 7 and 30 days (today included).
export function visitCounts(checkins, nowMs = Date.now()) {
  const today = dayNum(ymd(new Date(nowMs)));
  const days = new Set(checkins.filter(c => !c.deleted).map(c => dayNum(c.date)));
  const count = n => [...days].filter(d => d <= today && d > today - n).length;
  return { week: count(7), month: count(30) };
}

const trim = n => String(Math.round(n * 100) / 100);

export function renderChart(series) {
  const { points, trend, start } = series;
  const W = 360, H = 230, L = 38, R = 12, T = 14, B = 28;
  const iw = W - L - R, ih = H - T - B;

  const vals = [...points.map(p => p.kg), ...trend.map(p => p.kg)];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { const mid = (hi + lo) / 2; lo = mid - 0.5; hi = mid + 0.5; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const rawStep = (hi - lo) / 4;
  const step = [0.5, 1, 2, 2.5, 5, 10].find(s => s >= rawStep) || 20;
  const yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step;

  const x = d => L + ((d - start) / (WINDOW_DAYS - 1)) * iw;
  const y = v => T + (1 - (v - yMin) / (yMax - yMin)) * ih;

  let g = "";
  for (let v = yMin; v <= yMax + 1e-9; v += step) {
    g += `<line class="g-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    g += `<text class="g-lab" x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${trim(v)}</text>`;
  }
  [0, 15, 30, 45, 60, 75, 89].forEach((off, i, arr) => {
    const [, m, d] = dateOfDayNum(start + off).split("-").map(Number);
    const anchor = i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle";
    g += `<text class="g-lab" x="${x(start + off).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${d} ${MONTHS[m - 1]}</text>`;
  });
  if (trend.length > 1) {
    g += `<path class="g-trend" d="${trend.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)} ${y(p.kg).toFixed(1)}`).join(" ")}"/>`;
  }
  points.forEach((p, i) => {
    const cls = i === points.length - 1 ? "g-dot g-last" : "g-dot";
    g += `<circle class="${cls}" cx="${x(p.d).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="3.2"/>`;
  });
  g += `<circle class="g-sel" id="g-sel" cx="-20" cy="-20" r="5.5"/>`;

  const label = points.length
    ? `Weight over the last ${WINDOW_DAYS} days. ${points.length} days with a reading. Latest ${points[points.length - 1].kg.toFixed(1)} kilograms.`
    : `Weight over the last ${WINDOW_DAYS} days. No readings yet.`;
  const html = `<svg class="chart" id="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${g}</svg>`;
  return { html, plot: { W, H, x, y } };
}

export const fmtKg = n => (Math.round(n * 10) / 10).toFixed(1);
export const fmtChange = c => (c === null ? "—" : `${c > 0 ? "+" : c < 0 ? "−" : ""}${Math.abs(c).toFixed(1)} kg`);
