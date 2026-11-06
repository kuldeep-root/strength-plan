// Google Sheets sync (local-first).
// The phone's database is always the source of truth. Changes are marked "dirty" and pushed to a small
// Google Apps Script web app that writes them into the user's own Sheet; changes made in the Sheet are pulled back.
// Works offline: nothing is lost, the queue just waits.
import * as db from "./db.js";
import { normalizeWire } from "./util.js";

// Only genuine Apps Script web-app URLs are accepted, so the secret can never be sent anywhere else.
export const URL_RE = /^https:\/\/script\.google\.com\/(?:macros\/s|a\/macros\/[A-Za-z0-9.-]+\/s)\/[A-Za-z0-9_-]{20,}\/exec$/;
export const TOKEN_RE = /^[A-Za-z0-9]{16,64}$/;

export const state = { status: "unconfigured", error: "" }; // unconfigured | idle | syncing | offline | error
const listeners = new Set();
export const onChange = cb => { listeners.add(cb); return () => listeners.delete(cb); };
const emit = (dataChanged = false) => listeners.forEach(cb => { try { cb({ dataChanged }); } catch (_) { /* ignore */ } });

export class SyncError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const MESSAGES = {
  auth: "The secret does not match the script. Re-copy the script from this app's setup screen, paste it into Apps Script, and deploy a new version.",
  not_configured: "The script still has the placeholder secret. Paste the script copied from the setup screen and deploy a new version.",
  busy: "The sheet was busy. Will retry shortly.",
  bad_request: "The script did not understand the request. Make sure you pasted the latest script and deployed a new version.",
  server: "The script hit an error. Open Apps Script → Executions to see why.",
  html: "Google sent back a web page instead of data. In Apps Script open Deploy → Manage deployments and check that \"Who has access\" is Anyone, then deploy a new version.",
  timeout: "Google took too long to answer. Will retry.",
  network: "Could not reach Google. Will retry.",
  offline: "Offline. Changes are saved on this phone and will sync when you are back online."
};

export function getConfig() {
  const url = db.kvGet("cfg:url") || "";
  const token = db.kvGet("cfg:token") || "";
  return { url, token, ok: URL_RE.test(url) && TOKEN_RE.test(token) };
}

export function refreshStatus() {
  if (!getConfig().ok) state.status = "unconfigured";
  else if (state.status === "unconfigured") state.status = "idle";
}

export async function saveConfig(url, token) {
  if (!URL_RE.test(url)) throw new SyncError("bad_url", "That is not a Google Apps Script web app URL.");
  if (!TOKEN_RE.test(token)) throw new SyncError("bad_token", "The secret is missing or malformed.");
  db.kvSet("cfg:url", url);
  db.kvSet("cfg:token", token);
  db.kvDel("sync:cursor");
  db.kvDel("sync:last");
  await db.markAllDirty(); // a freshly connected sheet gets the whole history
  state.status = "idle"; state.error = "";
  await db.flush();
  emit(true);
}

export async function clearConfig() {
  db.kvDel("cfg:url"); db.kvDel("cfg:token"); db.kvDel("sync:cursor"); db.kvDel("sync:last");
  state.status = "unconfigured"; state.error = "";
  await db.flush();
  emit(false);
}

export const toWire = r => ({ id: r.id, date: r.date, time: r.time, weight: r.weightKg, note: r.note, updatedAt: r.updatedAt, deleted: !!r.deleted });

function netError(e) {
  if (e && e.name === "AbortError") return new SyncError("timeout", MESSAGES.timeout);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return new SyncError("offline", MESSAGES.offline);
  return new SyncError("network", MESSAGES.network);
}

async function callScript(cfg, payload, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let text;
  try {
    // No Content-Type header on purpose: the body goes out as text/plain, a "simple" request that needs no CORS preflight.
    const res = await fetch(cfg.url, {
      method: "POST",
      body: JSON.stringify({ v: 1, token: cfg.token, ...payload }),
      redirect: "follow", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      signal: ctrl.signal
    });
    text = await res.text();
  } catch (e) {
    throw netError(e);
  } finally {
    clearTimeout(timer);
  }
  let json;
  try { json = JSON.parse(text); } catch (_) { throw new SyncError("html", MESSAGES.html); }
  if (!json || json.ok !== true) {
    const code = json && typeof json.error === "string" ? json.error : "server";
    throw new SyncError(code, MESSAGES[code] || MESSAGES.server);
  }
  return json;
}

export async function testConnection(url, token) {
  if (!URL_RE.test(url)) throw new SyncError("bad_url", "That does not look like a Web app URL. It starts with https://script.google.com/macros/s/ and ends with /exec.");
  if (!TOKEN_RE.test(token)) throw new SyncError("bad_token", "Create the secret first (step 1).");
  return callScript({ url, token }, { action: "ping" }, 20000);
}

let running = false;
let rerun = false;
let failUntil = 0;
let timer = null;

export async function syncNow(reason = "manual") {
  const cfg = getConfig();
  if (!cfg.ok) { state.status = "unconfigured"; emit(false); return { ok: false }; }
  if (running) { rerun = true; return { ok: false, busy: true }; }
  // After a failure, background retries wait 30 s. A manual tap or "network is back" retries immediately.
  if (reason === "auto" && Date.now() < failUntil) return { ok: false };

  running = true; state.status = "syncing"; state.error = ""; emit(false);
  let dataChanged = false;
  try {
    for (let i = 0; i < 25; i++) {
      const dirty = await db.getDirty(200);
      const since = Number(db.kvGet("sync:cursor")) || 0;
      const res = await callScript(cfg, { action: "sync", since, changes: dirty.map(toWire) });
      const remote = (Array.isArray(res.entries) ? res.entries : []).map(normalizeWire).filter(Boolean);
      await db.markPushed(dirty.map(r => ({ id: r.id, updatedAt: r.updatedAt })));
      if ((await db.applyRemote(remote)) > 0) dataChanged = true;
      if (Number.isFinite(res.cursor)) db.kvSet("sync:cursor", res.cursor);
      if (dirty.length < 200) break;
    }
    db.kvSet("sync:last", Date.now());
    state.status = "idle"; failUntil = 0;
  } catch (e) {
    state.status = e instanceof SyncError && e.code === "offline" ? "offline" : "error";
    state.error = e instanceof SyncError ? e.message : MESSAGES.server;
    failUntil = Date.now() + 30000;
  } finally {
    running = false;
  }
  await db.flush();
  emit(dataChanged);
  if (rerun) { rerun = false; scheduleSync(500); }
  return { ok: state.status === "idle" };
}

export function scheduleSync(delay = 1500) {
  if (!getConfig().ok) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow("auto"), delay);
}

export function start() {
  refreshStatus();
  window.addEventListener("online", () => syncNow("online"));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow("auto"); });
  syncNow("auto");
}
