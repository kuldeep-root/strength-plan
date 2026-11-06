import { esc, fmt, ymd, hm, fmtDate, fmtTime12, validateEntry, uuid, randomToken, csvCell, b64uEncode, b64uDecode } from "./util.js";
import * as db from "./db.js";
import * as sync from "./sync.js";
import { buildSeries, renderChart, visitCounts, fmtKg, fmtChange, WINDOW_DAYS } from "./chart.js";
import { DAYS, RAMP, GUIDE_HTML } from "./plan.js";

const yt = q => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q + " proper form tutorial");

const PROGRESS = { id: "progress", d: "Log", kind: "progress", tag: "Progress" };
const TABS = [...DAYS.slice(0, 7), PROGRESS, DAYS[7]]; // Mon..Sun, Log, Guide

const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0
const strip = document.getElementById("strip");
const panel = document.getElementById("panel");
const $ = sel => panel.querySelector(sel);

/* ------------------------------------------------------------------ set ticks (reset every Monday) */
function weekKey() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}
const WK = weekKey();
const tickKey = (dayId, i, s) => `t:${WK}:${dayId}:${i}:${s}`;
const pruneTicks = () => db.kvKeys("t:").forEach(k => { if (!k.startsWith(`t:${WK}:`)) db.kvDel(k); });

/* ------------------------------------------------------------------ tabs */
function buildStrip() {
  TABS.forEach((day, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role", "tab"); b.id = "tab-" + day.id; b.dataset.kind = day.kind; b.dataset.id = day.id;
    b.innerHTML = `<span class="d">${esc(day.d)}</span><span class="t">${esc(day.tag)}</span>${i === todayIdx ? '<span class="today">TODAY</span>' : ""}`;
    b.addEventListener("click", () => show(day.id, true));
    strip.appendChild(b);
  });
}

function simpleList(items, prefix) {
  return `<ol class="simple">${items.map((it, i) => `<li><span class="num">${prefix}${i + 1}</span><div><div class="nm">${esc(it.n)}</div><div class="cue">${esc(it.c)}</div></div><div class="dose">${esc(it.d)}${it.t ? `<br><button type="button" class="mini" data-t="${it.t}" data-l="${esc(it.n)}" data-k="Hold">▶ ${fmt(it.t)}</button>` : ""}</div></li>`).join("")}</ol>`;
}

function mainList(day) {
  return day.main.map((ex, i) => {
    const boxes = Array.from({ length: ex.s }, (_, s) => {
      const k = tickKey(day.id, i, s);
      const on = db.kvGet(k) === "1";
      return `<label><input type="checkbox" id="${k}" data-k="${k}" data-rest="${ex.rest}" data-l="${esc(ex.n)} · set ${s + 1} of ${ex.s}" ${on ? "checked" : ""}><span class="box">S${s + 1}</span></label>`;
    }).join("");
    return `<article class="ex">
      <div class="ex-top"><span class="num">${i + 1}</span><div>
        <h4>${esc(ex.n)}</h4>
        <div class="rx"><span><b>${ex.s}</b> × ${esc(ex.r)}</span><span>Rest ${fmt(ex.rest)}</span><span>1–3 reps in reserve</span></div>
      </div></div>
      <div class="sets">${boxes}<button type="button" class="restbtn" data-t="${ex.rest}" data-l="${esc(ex.n)}" data-k="Rest">⏱ Rest ${fmt(ex.rest)}</button></div>
      <details><summary>Form cues, alternative and video</summary>
        <dl class="dt">
          <dt>Form</dt><dd>${esc(ex.c)}</dd>
          <dt>Alternative</dt><dd>${esc(ex.alt)}</dd>
          <dt>Demo</dt><dd><a href="${yt(ex.q)}" target="_blank" rel="noopener noreferrer">Watch form videos ↗</a></dd>
        </dl>
      </details>
    </article>`;
  }).join("");
}

function show(id, push) {
  const day = TABS.find(d => d.id === id) || TABS[todayIdx];
  strip.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", b.dataset.id === day.id ? "true" : "false"));
  const tab = document.getElementById("tab-" + day.id);
  if (tab) tab.scrollIntoView({ block: "nearest", inline: "center" });
  panel.dataset.kind = day.kind;
  if (push) { try { history.replaceState(null, "", "#" + day.id); } catch (e) { /* ignore */ } }
  if (day.kind === "guide") { panel.innerHTML = GUIDE_HTML; return; }
  if (day.kind === "progress") { renderProgress(); return; }
  if (day.kind === "rest") {
    panel.innerHTML = `<div class="dayhead"><h2>${esc(day.title)}</h2><p class="focus">${esc(day.focus)}</p></div>
      <div class="note">${esc(day.restNote)}</div>
      <section class="block"><div class="bh"><h3>Today's plan</h3><span class="bm">Recovery</span></div>${simpleList(day.rest, "")}</section>`;
    return;
  }
  const sets = day.main.reduce((a, e) => a + e.s, 0);
  panel.innerHTML = `<div class="dayhead"><h2>${esc(day.title)}</h2><p class="focus">${esc(day.focus)}</p>
      <div class="meta"><span class="pill">${esc(day.time)}</span><span class="pill">${day.main.length} exercises</span><span class="pill">${sets} working sets</span></div></div>
    <section class="block"><div class="bh"><h3>Warm-up</h3><span class="bm">~10 min · dynamic</span></div>${simpleList(day.warm, "W")}<p class="ramp">${esc(RAMP)}</p></section>
    <section class="block"><div class="bh"><h3>Main workout</h3><span class="bm">Tick a set to start rest</span></div>${mainList(day)}</section>
    <section class="block"><div class="bh"><h3>Cool-down</h3><span class="bm">~6 min · static</span></div>${simpleList(day.cool, "C")}</section>
    <div class="foot"><span>Ticks are saved on this phone and reset each Monday.</span><button type="button" class="ghost" id="clear">Clear today's ticks</button></div>`;
  document.getElementById("clear").addEventListener("click", () => {
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; db.kvDel(cb.dataset.k); });
  });
}

/* ------------------------------------------------------------------ rest / hold timer (survives screen lock) */
const T = {
  el: document.getElementById("timer"), lab: document.getElementById("tlab"), clock: document.getElementById("tclock"), bar: document.getElementById("tbar"),
  end: 0, total: 0, iv: null, ctx: null, wl: null, kind: "Rest"
};
const left = () => Math.max(0, Math.ceil((T.end - Date.now()) / 1000));
function beep() {
  try {
    if (T.ctx) {
      const o = T.ctx.createOscillator(), g = T.ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(T.ctx.destination);
      g.gain.setValueAtTime(.001, T.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(.3, T.ctx.currentTime + .02);
      g.gain.exponentialRampToValueAtTime(.001, T.ctx.currentTime + .6);
      o.start(); o.stop(T.ctx.currentTime + .65);
    }
  } catch (e) { /* ignore */ }
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ }
}
function paint() {
  const l = left();
  T.clock.textContent = fmt(l);
  T.bar.style.width = (T.total ? (1 - l / T.total) * 100 : 0) + "%";
}
async function wake() {
  try {
    if ("wakeLock" in navigator && !T.wl && document.visibilityState === "visible") {
      T.wl = await navigator.wakeLock.request("screen");
      T.wl.addEventListener("release", () => { T.wl = null; });
    }
  } catch (e) { /* ignore */ }
}
function unwake() { try { if (T.wl) { T.wl.release().catch(() => {}); T.wl = null; } } catch (e) { /* ignore */ } }
function finish() {
  clearInterval(T.iv); T.iv = null;
  T.el.classList.add("done");
  T.lab.innerHTML = `<small>Done</small><span>${T.kind === "Rest" ? "Rest over. Next set." : "Hold done. Switch side or move on."}</span>`;
  beep(); unwake();
}
function tick() { paint(); if (left() <= 0) finish(); }
function start(sec, label, kind) {
  try {
    if (!T.ctx) { const A = window.AudioContext || window.webkitAudioContext; if (A) T.ctx = new A(); }
    else if (T.ctx.state === "suspended") T.ctx.resume();
  } catch (e) { /* ignore */ }
  clearInterval(T.iv);
  T.kind = kind; T.total = sec; T.end = Date.now() + sec * 1000;
  T.el.classList.add("on"); T.el.classList.remove("done");
  T.el.dataset.kind = panel.dataset.kind || "upper";
  T.lab.innerHTML = `<small>${esc(kind)}</small><span>${esc(label)}</span>`;
  paint();
  T.iv = setInterval(tick, 250);
  wake();
}
document.getElementById("tplus").addEventListener("click", () => {
  if (!T.iv) start(15, "Extra time", "Rest");
  else { T.end += 15000; T.total += 15; paint(); }
});
document.getElementById("tstop").addEventListener("click", () => { clearInterval(T.iv); T.iv = null; T.el.classList.remove("on"); unwake(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && T.iv) { tick(); wake(); } });

/* ------------------------------------------------------------------ progress tab */
let checkins = [];       // visible (not deleted), newest first
let pendingCount = 0;    // records waiting to sync
let editingId = null;
let showAll = false;
let setupOpen = false;
let linkOpen = false;
let installEvt = null;
let renderToken = 0;

async function loadCheckins() {
  const all = await db.getAllCheckins();
  pendingCount = all.filter(r => r.dirty).length;
  checkins = all.filter(r => !r.deleted).sort((a, b) => b.ts - a.ts);
}
const progressVisible = () => panel.dataset.kind === "progress" && !!$("#pf-form");

async function renderProgress() {
  const token = ++renderToken;
  panel.innerHTML = `<div class="dayhead"><h2>Progress</h2><p class="focus">Check in after each session. The chart shows the last ${WINDOW_DAYS} days; every entry is kept.</p></div>
    <section class="card" id="pf-form"></section>
    <section class="card" id="pf-chart"></section>
    <section class="card" id="pf-list"></section>
    <section class="card" id="pf-sync"></section>
    <section class="card" id="pf-setup" hidden></section>`;
  await loadCheckins();
  if (token !== renderToken || !progressVisible()) return;
  renderForm(); renderChartCard(); renderList(); renderSync(); renderSetup();
}

function renderForm() {
  const box = $("#pf-form"); if (!box) return;
  const rec = editingId ? checkins.find(r => r.id === editingId) : null;
  const now = new Date();
  const date = rec ? rec.date : ymd(now), time = rec ? rec.time : hm(now);
  const w = rec && rec.weightKg !== null ? String(rec.weightKg) : "";
  box.innerHTML = `<h3>${rec ? "Edit check-in" : "Gym check-in"}</h3>
    <form id="ck-form" novalidate>
      <div class="row2">
        <div class="field"><label for="ck-date">Date</label><input id="ck-date" type="date" required value="${esc(date)}" max="${esc(ymd(now))}"></div>
        <div class="field"><label for="ck-time">Time</label><input id="ck-time" type="time" required value="${esc(time)}"></div>
      </div>
      <div class="field"><label for="ck-w">Weight in kg (optional)</label><input id="ck-w" type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 76.4" value="${esc(w)}"></div>
      <div class="field"><label for="ck-note">Note (optional)</label><input id="ck-note" type="text" maxlength="200" autocomplete="off" placeholder="e.g. Lower A, felt strong" value="${esc(rec ? rec.note : "")}"></div>
      <div class="err" id="ck-msg" role="status" aria-live="polite"></div>
      <div class="btnrow">
        <button class="btn primary" type="submit">${rec ? "Update check-in" : "Save check-in"}</button>
        ${rec ? '<button class="btn" type="button" data-act="cancel-edit">Cancel</button>' : '<button class="btn" type="button" data-act="now">Set to now</button>'}
      </div>
    </form>`;
}

async function saveCheckin() {
  const msg = $("#ck-msg");
  const v = validateEntry({ date: $("#ck-date").value, time: $("#ck-time").value, weight: $("#ck-w").value, note: $("#ck-note").value });
  if (!v.ok) { msg.className = "err"; msg.textContent = v.error; return; }
  const now = Date.now();
  let rec;
  if (editingId) {
    const cur = await db.getCheckin(editingId);
    if (!cur) { editingId = null; msg.className = "err"; msg.textContent = "That entry no longer exists."; return; }
    rec = { ...cur, ...v.value, updatedAt: Math.max(now, cur.updatedAt + 1), dirty: 1 };
  } else {
    rec = { id: uuid(), ...v.value, updatedAt: now, deleted: false, dirty: 1 };
  }
  await db.putCheckins([rec]);
  const wasEditing = !!editingId;
  editingId = null;
  db.persistStorage();
  await loadCheckins();
  if (!progressVisible()) return;
  renderForm(); renderChartCard(); renderList(); renderSync();
  const m = $("#ck-msg"); if (m) { m.className = "err okmsg"; m.textContent = wasEditing ? "Updated." : "Saved."; }
  sync.scheduleSync(800);
}

function renderChartCard() {
  const box = $("#pf-chart"); if (!box) return;
  const s = buildSeries(checkins);
  const vc = visitCounts(checkins);
  const gym = `<p class="gymdays">Gym days: <b>${vc.week}</b> in the last 7 days · <b>${vc.month}</b> in the last 30 days</p>`;
  if (!s.points.length) {
    box.innerHTML = `<h3>Weight, last ${WINDOW_DAYS} days</h3><div class="empty">No weights in the last ${WINDOW_DAYS} days yet. Add your weight to a check-in and the chart appears here.</div>${gym}`;
    return;
  }
  const { html, plot } = renderChart(s);
  box.innerHTML = `<h3>Weight, last ${WINDOW_DAYS} days</h3>
    <p class="cap">Dots are daily averages. The line is a 7-day average, which smooths normal day-to-day swings. Tap the chart to read a day.</p>
    <div class="stats">
      <div class="stat"><b>${fmtKg(s.first.kg)}</b><span>First</span></div>
      <div class="stat"><b>${fmtKg(s.last.kg)}</b><span>Latest</span></div>
      <div class="stat"><b>${fmtChange(s.change)}</b><span>Change</span></div>
    </div>
    ${html}
    <div class="readout" id="readout" aria-live="polite"></div>
    ${gym}`;
  const svg = $("#chart-svg"), sel = $("#g-sel"), out = $("#readout");
  const pick = e => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * plot.W;
    let best = null, bd = Infinity;
    s.points.forEach((p, i) => { const d = Math.abs(plot.x(p.d) - sx); if (d < bd) { bd = d; best = i; } });
    if (best === null) return;
    const p = s.points[best], t = s.trend[best];
    sel.setAttribute("cx", plot.x(p.d).toFixed(1));
    sel.setAttribute("cy", plot.y(p.kg).toFixed(1));
    out.textContent = `${fmtDate(p.date)} · ${fmtKg(p.kg)} kg · 7-day avg ${fmtKg(t.kg)} kg`;
  };
  svg.addEventListener("pointerdown", pick);
  svg.addEventListener("pointermove", e => { if (e.pointerType === "mouse" ? e.buttons : true) pick(e); });
}

function renderList() {
  const box = $("#pf-list"); if (!box) return;
  if (!checkins.length) {
    box.innerHTML = `<h3>History</h3><div class="empty">No check-ins yet. Save your first one above.</div>`;
    return;
  }
  const shown = showAll ? checkins : checkins.slice(0, 10);
  box.innerHTML = `<h3>History</h3>
    <ul class="cklist">${shown.map(r => `<li class="ck">
      <div><div class="ck-when">${esc(fmtDate(r.date))} · ${esc(fmtTime12(r.time))}${r.dirty ? '<span class="wait" title="Waiting to sync">waiting</span>' : ""}</div>${r.note ? `<div class="ck-note">${esc(r.note)}</div>` : ""}</div>
      <div class="ck-w">${r.weightKg === null ? "—" : fmtKg(r.weightKg) + " kg"}</div>
      <div class="ck-act"><button class="btn small" type="button" data-act="edit" data-id="${esc(r.id)}">Edit</button><button class="btn small danger" type="button" data-act="del" data-id="${esc(r.id)}">Delete</button></div>
    </li>`).join("")}</ul>
    ${checkins.length > 10 ? `<div class="btnrow"><button class="btn small" type="button" data-act="toggle-all">${showAll ? "Show fewer" : `Show all ${checkins.length}`}</button></div>` : ""}`;
}

const fmtRel = ms => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${fmtDate(ymd(new Date(ms)))}`;
};

function renderSync() {
  const box = $("#pf-sync"); if (!box) return;
  const cfg = sync.getConfig(), st = sync.state;
  let dot = "", text = "";
  if (!cfg.ok) text = "Not connected to a Google Sheet. Check-ins are saved on this phone only.";
  else if (st.status === "syncing") { dot = "busy"; text = "Syncing…"; }
  else if (st.status === "offline") { dot = "busy"; text = `Offline. ${pendingCount} waiting to sync.`; }
  else if (st.status === "error") { dot = "err"; text = st.error; }
  else {
    const last = Number(db.kvGet("sync:last")) || 0;
    dot = "ok";
    text = last ? `Synced ${fmtRel(last)}${pendingCount ? ` · ${pendingCount} waiting` : ""}` : "Connected. Waiting for the first sync.";
  }
  const id = cfg.ok ? cfg.url.split("/").slice(-2)[0] : "";
  box.innerHTML = `<h3>Backup &amp; Google Sheet</h3>
    <div class="sync-line"><span class="sync-dot ${dot}"></span><div><div id="sync-text">${esc(text)}</div>${cfg.ok ? `<div class="small">Sheet script …${esc(id.slice(-8))}</div>` : ""}</div></div>
    <div class="btnrow">
      ${cfg.ok ? '<button class="btn" type="button" data-act="sync-now"' + (st.status === "syncing" ? " disabled" : "") + ">Sync now</button>" : '<button class="btn primary" type="button" data-act="open-setup">Set up Google Sheet</button>'}
      <button class="btn" type="button" data-act="csv">Download CSV</button>
      ${installEvt ? '<button class="btn" type="button" data-act="install">Install app</button>' : ""}
    </div>
    ${cfg.ok ? `<div class="btnrow"><button class="btn small" type="button" data-act="show-link">Link for another device</button><button class="btn small danger" type="button" data-act="disconnect">Disconnect sheet</button></div>` : ""}
    <div id="pf-link"></div>
    <p class="small" id="pf-persist"></p>`;
  if (linkOpen && cfg.ok) renderLink();
  db.isPersisted().then(p => {
    const el = $("#pf-persist");
    if (el) el.textContent = `Storage: ${db.info.mode === "idb" ? "on-device database" : "basic fallback"} · protected from automatic clean-up: ${p ? "yes" : "not yet (installing the app helps)"}`;
  });
}

function renderLink() {
  const cfg = sync.getConfig(); const box = $("#pf-link"); if (!box || !cfg.ok) return;
  const link = location.origin + location.pathname + "#connect=" + b64uEncode(JSON.stringify({ u: cfg.url, t: cfg.token }));
  box.innerHTML = `<p class="small">Open this link on your other device to connect it to the same sheet. It contains your secret, so send it only to yourself and delete the message afterwards.</p>
    <textarea class="code" id="link-box" readonly rows="4"></textarea>
    <div class="btnrow"><button class="btn small" type="button" data-act="copy-link">Copy link</button></div>`;
  $("#link-box").value = link;
}

function renderSetup() {
  const box = $("#pf-setup"); if (!box) return;
  const cfg = sync.getConfig();
  box.hidden = !(setupOpen && !cfg.ok);
  if (box.hidden) return;
  const token = cfg.token;
  box.innerHTML = `<h3>Connect a Google Sheet</h3>
    <p class="cap">One-time setup, about 10 minutes. It is easiest on a computer, signed in to the Google account that should own the sheet. Your check-ins stay on this phone and are also copied into that sheet.</p>
    <ol class="steps">
      <li><b>Create your private secret.</b> It stops anyone else from writing to your sheet.
        ${token && sync.TOKEN_RE.test(token) ? `<div class="token" id="su-token">${esc(token)}</div><div class="btnrow"><button class="btn small" type="button" data-act="copy-token">Copy secret</button><button class="btn small" type="button" data-act="new-token">Make a new one</button></div>`
          : `<div class="btnrow"><button class="btn small primary" type="button" data-act="gen-token">Create secret</button></div>`}
      </li>
      <li><b>Copy the script.</b> This button copies it with your secret already inside.
        <div class="btnrow"><button class="btn small" type="button" data-act="copy-script"${token ? "" : " disabled"}>Copy script</button></div>
        <details><summary>Show the script</summary><textarea class="code" id="script-box" readonly rows="8" placeholder="Press “Copy script” to load it here."></textarea></details>
      </li>
      <li>Go to <b>sheets.new</b> to make a new Google Sheet. Open <b>Extensions → Apps Script</b>, delete the sample code, paste the script, and press <b>Save</b>.</li>
      <li>In the function menu choose <b>setupSheet</b> and press <b>Run</b>. Google asks for permission: <b>Review permissions → your account → Advanced → Go to the project (unsafe) → Allow</b>. It is your own script, so this is expected.</li>
      <li>Press <b>Deploy → New deployment</b>, click the gear, choose <b>Web app</b>. Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then <b>Deploy</b>. "Anyone" only means the address is reachable. Nothing is read or written without your secret. Copy the <b>Web app URL</b>.</li>
      <li><b>Paste the Web app URL here.</b>
        <div class="field"><label for="su-url">Web app URL</label><input id="su-url" type="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec"></div>
        <div class="btnrow"><button class="btn primary" type="button" data-act="connect">Connect and test</button><button class="btn" type="button" data-act="close-setup">Close</button></div>
      </li>
    </ol>
    <div class="err" id="su-msg" role="status" aria-live="polite"></div>`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}

async function downloadCsv() {
  const all = (await db.getAllCheckins()).filter(r => !r.deleted).sort((a, b) => a.ts - b.ts);
  const lines = ["date,time,weight_kg,note", ...all.map(r => [r.date, r.time, r.weightKg === null ? "" : r.weightKg, r.note].map(csvCell).join(","))];
  const blob = new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `strength-checkins-${ymd(new Date())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const ACTIONS = {
  now() { const n = new Date(); $("#ck-date").value = ymd(n); $("#ck-time").value = hm(n); },
  "cancel-edit"() { editingId = null; renderForm(); },
  edit(btn) { editingId = btn.dataset.id; renderForm(); $("#pf-form").scrollIntoView({ behavior: "smooth", block: "start" }); },
  async del(btn) {
    if (!confirm("Delete this check-in?")) return;
    const cur = await db.getCheckin(btn.dataset.id); if (!cur) return;
    await db.putCheckins([{ ...cur, deleted: true, updatedAt: Math.max(Date.now(), cur.updatedAt + 1), dirty: 1 }]);
    if (editingId === cur.id) editingId = null;
    await loadCheckins();
    if (!progressVisible()) return;
    renderForm(); renderChartCard(); renderList(); renderSync();
    sync.scheduleSync(800);
  },
  "toggle-all"() { showAll = !showAll; renderList(); },
  "sync-now"() { sync.syncNow("manual"); },
  csv() { downloadCsv(); },
  async install() { if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { /* ignore */ } installEvt = null; renderSync(); } },
  "open-setup"() { setupOpen = true; renderSetup(); $("#pf-setup").scrollIntoView({ behavior: "smooth", block: "start" }); },
  "close-setup"() { setupOpen = false; renderSetup(); },
  "gen-token"() { db.kvSet("cfg:token", randomToken()); renderSetup(); },
  async "new-token"() { if (confirm("Make a new secret? You will need to copy the script again.")) { db.kvSet("cfg:token", randomToken()); renderSetup(); } },
  async "copy-token"(btn) { btn.textContent = (await copyText(sync.getConfig().token)) ? "Copied" : "Select and copy it manually"; },
  async "copy-script"(btn) {
    const msg = $("#su-msg");
    try {
      const res = await fetch("apps-script/Code.gs", { cache: "no-cache" });
      if (!res.ok) throw new Error("fetch");
      const src = (await res.text()).replace("'__SECRET__'", `'${sync.getConfig().token}'`);
      $("#script-box").value = src;
      btn.textContent = (await copyText(src)) ? "Copied. Now paste it in Apps Script" : "Select the text below and copy it";
      msg.textContent = "";
    } catch (e) { msg.className = "err"; msg.textContent = "Could not load the script. Check your connection and try again."; }
  },
  async connect(btn) {
    const msg = $("#su-msg"), url = $("#su-url").value.trim(), token = sync.getConfig().token;
    msg.className = "err";
    if (!sync.TOKEN_RE.test(token)) { msg.textContent = "Create the secret first (step 1)."; return; }
    if (/\/dev$/.test(url)) { msg.textContent = "That is the test URL ending in /dev. Use the Web app URL from Deploy, which ends in /exec."; return; }
    btn.disabled = true; msg.textContent = "Testing the connection…";
    try {
      await sync.testConnection(url, token);
      await sync.saveConfig(url, token);
      setupOpen = false;
      sync.syncNow("manual");
      await loadCheckins();
      if (progressVisible()) { renderChartCard(); renderList(); renderSync(); renderSetup(); }
    } catch (e) {
      btn.disabled = false;
      msg.textContent = e && e.message ? e.message : "Could not connect.";
    }
  },
  async disconnect() {
    if (!confirm("Disconnect from the Google Sheet? Your check-ins stay on this phone and in the sheet.")) return;
    linkOpen = false; setupOpen = false;
    await sync.clearConfig();
    if (progressVisible()) { renderSync(); renderSetup(); }
  },
  "show-link"() { linkOpen = !linkOpen; renderSync(); },
  async "copy-link"(btn) { btn.textContent = (await copyText($("#link-box").value)) ? "Copied" : "Select and copy it manually"; }
};

/* ------------------------------------------------------------------ events */
panel.addEventListener("click", e => {
  const t = e.target.closest("button[data-t]");
  if (t) { start(+t.dataset.t, t.dataset.l, t.dataset.k); return; }
  const a = e.target.closest("button[data-act]");
  if (a && ACTIONS[a.dataset.act]) ACTIONS[a.dataset.act](a);
});
panel.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id === "ck-form") saveCheckin();
});
panel.addEventListener("change", e => {
  const cb = e.target; if (cb.type !== "checkbox") return;
  if (cb.checked) { db.kvSet(cb.dataset.k, "1"); start(+cb.dataset.rest, cb.dataset.l, "Rest"); } else db.kvDel(cb.dataset.k);
});

sync.onChange(async ({ dataChanged }) => {
  if (!progressVisible()) return;
  if (dataChanged) { await loadCheckins(); renderChartCard(); renderList(); }
  else { const all = await db.getAllCheckins(); pendingCount = all.filter(r => r.dirty).length; }
  renderSync(); // the setup card is deliberately not redrawn here, so a half-typed URL is never wiped
});

window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (progressVisible()) renderSync(); });
window.addEventListener("appinstalled", () => { installEvt = null; if (progressVisible()) renderSync(); });

/* ------------------------------------------------------------------ connect-link handling */
async function handleConnectLink() {
  const m = /^#connect=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return false;
  try { history.replaceState(null, "", location.pathname + location.search + "#progress"); } catch (e) { /* ignore */ }
  try {
    const o = JSON.parse(b64uDecode(m[1]));
    if (!sync.URL_RE.test(o.u) || !sync.TOKEN_RE.test(o.t)) throw new Error("bad");
    const id = o.u.split("/").slice(-2)[0];
    if (confirm(`Connect this device to a Google Sheet?\n\nScript ID ends in …${id.slice(-8)}\n\nOnly continue if you made this link yourself.`)) {
      await sync.saveConfig(o.u, o.t);
      sync.syncNow("manual");
    }
  } catch (e) { alert("That connect link is not valid."); }
  return true;
}

/* ------------------------------------------------------------------ start */
(async function main() {
  await db.initDb();
  pruneTicks();
  buildStrip();
  const linked = await handleConnectLink();
  const fromHash = (location.hash || "").replace("#", "");
  show(linked ? "progress" : TABS.some(d => d.id === fromHash) ? fromHash : TABS[todayIdx].id, false);
  sync.start();
  if ("serviceWorker" in navigator) {
    const reg = () => navigator.serviceWorker.register("sw.js").catch(() => {});
    if (document.readyState === "complete") reg(); else window.addEventListener("load", reg);
  }
})();
