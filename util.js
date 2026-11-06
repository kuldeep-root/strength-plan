// Small shared helpers: escaping, dates, validation. No DOM or storage access here.

export const esc = s => String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
export const fmt = s => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
export const pad2 = n => String(n).padStart(2, "0");

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// 32-character secret, 5 bits per character (the alphabet has exactly 32 symbols, so no modulo bias).
export function randomToken() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map(x => A[x & 31]).join("");
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const hm = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(s) {
  const m = DATE_RE.exec(s || "");
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && y >= 2020 && y <= 2100;
}
export const isValidTime = s => TIME_RE.test(s || "");

export function tsOf(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
}

// Whole-day number (days since 1970-01-01) for a YYYY-MM-DD string. DST-proof.
export function dayNum(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
export function dateOfDayNum(n) {
  const d = new Date(n * 86400000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function fmtDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${DOW[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1]}`;
}
export function fmtTime12(time) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? "pm" : "am"}`;
}

export function parseWeight(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return { ok: true, value: null };
  if (!/^\d{2,3}(\.\d{1,2})?$/.test(s)) return { ok: false, error: "Enter weight in kg, like 76.4" };
  const v = Math.round(parseFloat(s) * 10) / 10;
  if (v < 30 || v > 250) return { ok: false, error: "Weight should be between 30 and 250 kg" };
  return { ok: true, value: v };
}

export function cleanNote(s) {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
}

export function validateEntry({ date, time, weight, note }, now = Date.now()) {
  if (!isValidDate(date)) return { ok: false, error: "Pick a valid date." };
  if (!isValidTime(time)) return { ok: false, error: "Pick a valid time." };
  const ts = tsOf(date, time);
  if (ts > now + 5 * 60 * 1000) return { ok: false, error: "That time is in the future." };
  const w = parseWeight(weight);
  if (!w.ok) return { ok: false, error: w.error };
  return { ok: true, value: { date, time, ts, weightKg: w.value, note: cleanNote(note) } };
}

// Strict parser for rows coming back from the sheet. Anything odd is dropped, never trusted.
export const ID_RE = /^[0-9a-fA-F-]{36}$/;
export function normalizeWire(w) {
  if (!w || typeof w !== "object") return null;
  const id = String(w.id || "");
  if (!ID_RE.test(id)) return null;
  const date = String(w.date || ""), time = String(w.time || "");
  if (!isValidDate(date) || !isValidTime(time)) return null;
  let weightKg = null;
  if (w.weight !== null && w.weight !== undefined && w.weight !== "") {
    const n = Number(w.weight);
    if (!Number.isFinite(n) || n < 30 || n > 250) return null;
    weightKg = Math.round(n * 10) / 10;
  }
  const updatedAt = Number(w.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  return { id, date, time, ts: tsOf(date, time), weightKg, note: cleanNote(w.note), updatedAt, deleted: w.deleted === true, dirty: 0 };
}

// CSV cell with spreadsheet-formula neutralising (=, +, -, @ at the start would run as a formula in Excel).
export function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export const b64uEncode = s => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const b64uDecode = s => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
