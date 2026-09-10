/**
 * Panel logic, shared by the toolbar popup and the preferences pane.
 * The "This tab" section only exists in the popup (body[data-context=popup]).
 */
import { api } from "../shared/browser.js";
import { hasWebAccess, WEB_ORIGINS } from "../shared/permissions.js";
import { DEFAULTS, FIELDS, getSettings, saveSettings } from "../shared/settings.js";
import { formatRemaining, toUnit } from "../shared/time.js";
import { indicators } from "../background/indicators/index.js";

// The same file serves three contexts: the toolbar popup (default), the
// preferences pane (options.html sets data-context) and a full page
// (panel.html?view=page). Set the page context before anything renders.
if (new URLSearchParams(location.search).get("view") === "page") {
  document.body.dataset.context = "page";
}
const context = document.body.dataset.context;
const isPopup = context === "popup";
const isPage = context === "page";
const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };

// ---- All tabs -------------------------------------------------------------

function renderFields() {
  const root = $("fields");
  root.replaceChildren(...FIELDS.map(renderField));
  updateFieldVisibility();
}

/** Rows with `showWhen` appear only while their condition holds. */
function updateFieldVisibility() {
  for (const row of $("fields").children) {
    const field = FIELDS.find((f) => f.key === row.dataset.key);
    row.hidden = Boolean(field?.showWhen && !field.showWhen(settings));
  }
}

function renderField(field) {
  const row = document.createElement("div");
  row.className = "field";
  row.dataset.key = field.key;
  if (field.type === "indicators") row.classList.add("field-indicators");

  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = field.label;
  if (field.help) {
    const help = document.createElement("span");
    help.className = "field-help";
    help.textContent = field.help;
    label.append(help);
  }
  row.append(label);

  const control = document.createElement("div");
  control.className = "field-control";
  row.append(control);

  const value = settings[field.key];

  if (field.type === "toggle") {
    const sw = makeSwitch(Boolean(value), (checked) => save({ [field.key]: checked }));
    sw.input.id = `f-${field.key}`;
    label.htmlFor = sw.input.id;
    control.append(sw.el);
  } else if (field.type === "choice") {
    const select = document.createElement("select");
    select.id = `f-${field.key}`;
    label.htmlFor = select.id;
    for (const opt of field.options) select.add(new Option(opt.label, opt.value));
    select.value = value;
    select.addEventListener("change", () => save({ [field.key]: select.value }));
    control.append(select);
  } else if (field.type === "duration") {
    const { value: n, unit } = toUnit(value);
    const num = document.createElement("input");
    num.type = "number";
    num.min = "1";
    num.step = "1";
    num.value = String(n);
    num.id = `f-${field.key}`;
    label.htmlFor = num.id;
    const units = document.createElement("select");
    units.setAttribute("aria-label", `${field.label} unit`);
    for (const [label, secs] of [
      ["sec", 1],
      ["min", 60],
      ["hours", 3600],
    ]) {
      units.add(new Option(label, String(secs)));
    }
    units.value = String(unit);
    const commit = () => {
      const seconds = Math.max(field.min ?? 1, Math.round(Number(num.value) * Number(units.value)));
      if (Number.isFinite(seconds)) save({ [field.key]: seconds });
    };
    num.addEventListener("change", commit);
    units.addEventListener("change", commit);
    control.append(num, units);
  } else if (field.type === "indicators") {
    control.classList.add("field-control-stack");
    for (const ind of indicators) {
      const sw = makeSwitch(value.includes(ind.id), () => {
        const ids = [...control.querySelectorAll("input:checked")].map((i) => i.value);
        save({ indicators: ids });
      });
      sw.input.value = ind.id;
      sw.input.disabled = !ind.supported();
      sw.el.append(document.createTextNode(ind.label + (ind.supported() ? "" : " (not available here)")));
      control.append(sw.el);
    }
  }
  return row;
}

function makeSwitch(checked, onChange) {
  const el = document.createElement("label");
  el.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const track = document.createElement("span");
  track.className = "switch-track";
  el.append(input, track);
  return { el, input };
}

async function save(partial) {
  await saveSettings(partial);
  settings = { ...settings, ...partial };
  updateFieldVisibility();
  flash("Saved");
  if (isPopup) refreshTab();
  if ($("overview").open) refreshOverview();
}

let flashTimer;
function flash(text) {
  $("status").textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => ($("status").textContent = ""), 1500);
}

// ---- This tab -------------------------------------------------------------

let currentTab = null;
let tabState = null;
let fetchedAt = 0;

async function refreshTab() {
  if (!isPopup) return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  currentTab = tab ?? null;
  if (!currentTab) return;
  tabState = await api.runtime.sendMessage({ type: "timed-tabs:tab-state", tabId: currentTab.id }).catch(() => null);
  fetchedAt = Date.now();
  renderTab();
}

function renderTab() {
  const hideTimer = settings.pauseWhileActive && settings.resetOnActivate;
  $("tab").hidden = hideTimer;
  $("tab-paused").hidden = !hideTimer;
  if (!currentTab || !tabState) return;

  $("act-never").checked = tabState.neverExpire;
  $("act-never-paused").checked = tabState.neverExpire;
  if (hideTimer) return;

  const icon = $("tab-icon");
  if (currentTab.favIconUrl) {
    icon.src = currentTab.favIconUrl;
    icon.hidden = false;
  } else {
    icon.hidden = true;
  }
  $("tab-title").textContent = currentTab.title || currentTab.url || "";
  updateReadout();
}

function updateReadout() {
  if (!tabState) return;
  const drift = tabState.paused ? 0 : (Date.now() - fetchedAt) / 1000;
  const remaining = Math.max(0, tabState.remainingSeconds - drift);
  const progress = Math.min(1, (tabState.elapsedSeconds + drift) / tabState.lifetimeSeconds);
  const exempt = tabState.neverExpire || currentTab?.pinned;

  const time = $("remaining");
  const note = $("remaining-note");
  if (exempt) {
    time.textContent = "∞";
    note.textContent = currentTab?.pinned ? "pinned tabs never expire" : "never expires";
  } else {
    time.textContent = formatRemaining(remaining);
    if (remaining <= 0) note.textContent = "";
    else if (tabState.paused) note.textContent = "left, paused while you're here";
    else note.textContent = tabState.extraSeconds ? "left, snoozed" : "left";
  }

  const pct = exempt ? 0 : progress * 100;
  $("fuse").setAttribute("aria-valuenow", String(Math.round(pct)));
  $("fuse-burnt").style.width = `${pct}%`;
  $("fuse-marker").style.left = `${pct}%`;
  $("act-reset").disabled = exempt;
  $("act-snooze").disabled = exempt;
}

async function tabAction(action, value) {
  if (!currentTab) return;
  tabState = await api.runtime
    .sendMessage({ type: "timed-tabs:tab-action", tabId: currentTab.id, action, value })
    .catch(() => tabState);
  fetchedAt = Date.now();
  renderTab();
}

// ---- All open tabs ---------------------------------------------------------

let overviewTimer = null;

async function refreshOverview() {
  const groups = await api.runtime.sendMessage({ type: "timed-tabs:all-tabs" }).catch(() => []);
  const list = $("overview-list");
  const total = groups.reduce((n, g) => n + g.tabs.length, 0);
  $("overview-count").textContent = total ? `${total} tab${total === 1 ? "" : "s"}` : "";
  if (!total) {
    const empty = document.createElement("p");
    empty.className = "overview-empty";
    empty.textContent = "No tabs are being timed.";
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  groups.forEach((g, i) => {
    if (groups.length > 1) {
      const h = document.createElement("p");
      h.className = "window-title";
      h.textContent = g.focused ? "This window" : `Window ${i + 1}`;
      frag.append(h);
    }
    for (const t of g.tabs) frag.append(renderTabRow(t));
  });
  list.replaceChildren(frag);
}

function renderTabRow(t) {
  const row = document.createElement("div");
  row.className = "trow";
  const exempt = t.neverExpire || t.pinned;
  if (t.active) row.classList.add("is-active");
  if (exempt) row.classList.add("is-off");

  const icon = document.createElement("img");
  icon.className = "trow-icon";
  icon.alt = "";
  if (t.favIconUrl) icon.src = t.favIconUrl;
  row.append(icon);

  const title = document.createElement("button");
  title.type = "button";
  title.className = "trow-title";
  title.textContent = t.title;
  title.title = t.url ?? "";
  title.addEventListener("click", () => {
    api.runtime.sendMessage({ type: "timed-tabs:tab-action", tabId: t.tabId, action: "focus" }).catch(() => {});
    if (isPopup) window.close();
    else if (isPage) setTimeout(refreshOverview, 300);
  });
  row.append(title);

  const time = document.createElement("span");
  time.className = "trow-time";
  if (t.pinned) time.textContent = "pinned";
  else if (t.neverExpire) time.textContent = "timer off";
  else if (t.paused) time.textContent = `${formatRemaining(t.remainingSeconds)} · paused`;
  else time.textContent = formatRemaining(t.remainingSeconds);
  row.append(time);

  const fuse = document.createElement("div");
  fuse.className = "trow-fuse";
  fuse.style.setProperty("--pct", `${exempt ? 0 : Math.round(t.progress * 100)}%`);
  row.append(fuse);

  const timer = quickToggle("⏱", !t.neverExpire, false, t.neverExpire ? "Timer is off. Turn on" : "Timer is on. Turn off", "qtoggle-timer");
  timer.disabled = t.pinned;
  timer.addEventListener("click", async () => {
    await api.runtime
      .sendMessage({ type: "timed-tabs:tab-action", tabId: t.tabId, action: "neverExpire", value: !t.neverExpire })
      .catch(() => {});
    refreshOverview();
    if (currentTab?.id === t.tabId) refreshTab();
  });
  row.append(timer);

  const effective = t.resetOnActivate ?? settings.resetOnActivate;
  const inherited = t.resetOnActivate === null || t.resetOnActivate === undefined;
  const focus = quickToggle(
    "↻",
    effective,
    inherited,
    (effective ? "Restarts on focus" : "Keeps counting on focus") + (inherited ? " (default)" : "") + ". Click to change",
    "qtoggle-focus",
  );
  focus.addEventListener("click", async () => {
    await api.runtime
      .sendMessage({ type: "timed-tabs:tab-action", tabId: t.tabId, action: "resetOnActivate", value: !effective })
      .catch(() => {});
    refreshOverview();
  });
  row.append(focus);
  return row;
}

function quickToggle(glyph, pressed, inherited, label, cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `qtoggle ${cls}`;
  if (inherited) b.classList.add("is-inherited");
  b.textContent = glyph;
  b.setAttribute("aria-pressed", String(Boolean(pressed)));
  b.setAttribute("aria-label", label);
  b.title = label;
  return b;
}

$("overview").addEventListener("toggle", (e) => {
  clearInterval(overviewTimer);
  overviewTimer = null;
  if (e.target.open) {
    refreshOverview();
    overviewTimer = setInterval(refreshOverview, 5000);
  }
});

// ---- Theme -----------------------------------------------------------------
// Take the panel's colours from the browser's live theme so the popup and
// the page match the chrome around them, including custom themes. Falls
// back to the prefers-color-scheme palette in panel.css when unavailable.

async function applyBrowserTheme() {
  if (!api.theme?.getCurrent) return;
  const theme = await api.theme.getCurrent().catch(() => null);
  const c = theme?.colors;
  if (!c) return;
  // The popup sits in Firefox's panel; the page and preferences views sit on toolbar-like ground.
  const ground = isPopup
    ? cssColor(c.popup ?? c.toolbar ?? c.frame)
    : cssColor(c.toolbar ?? c.popup ?? c.frame);
  const ink = isPopup
    ? cssColor(c.popup_text ?? c.toolbar_text ?? c.tab_background_text)
    : cssColor(c.toolbar_text ?? c.popup_text ?? c.tab_background_text);
  if (!ground || !ink) return;
  const root = document.documentElement.style;
  root.setProperty("--ground", ground);
  root.setProperty("--ink", ink);
  const focus = cssColor(c.toolbar_field_border_focus ?? c.button_primary);
  if (focus) root.setProperty("--focus", focus);
  // Native controls (selects, number spinners) need to know which side they're on.
  const dark = isDark(ground);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function cssColor(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v.length === 4 ? `rgba(${v.join(",")})` : `rgb(${v.join(",")})`;
  return String(v);
}

/** Rough luminance test on a CSS colour, via the canvas parser. */
function isDark(color) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  const m = /^#([0-9a-f]{6})$/i.exec(ctx.fillStyle);
  if (!m) return globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

api.theme?.onUpdated?.addListener(() => applyBrowserTheme());

// ---- Permissions -----------------------------------------------------------

async function refreshPermissionWarning() {
  $("permission-warning").hidden = await hasWebAccess();
}

// ---- Diagnostics -----------------------------------------------------------

async function refreshDiag() {
  const d = await api.runtime.sendMessage({ type: "timed-tabs:diag" }).catch((e) => ({ error: String(e) }));
  const summary = $("diag-summary");
  if (!d || d.error) {
    summary.textContent = `Background not reachable: ${d?.error ?? "no reply"}`;
    return;
  }
  summary.textContent = [
    `ticks: ${d.ticks}`,
    `last tick: ${d.lastTick ? new Date(d.lastTick).toLocaleTimeString() : "never"}`,
    `last error: ${d.lastError ?? "none"}`,
    `active indicators: ${d.activeIndicators.join(", ") || "none"}`,
    `site access granted: ${d.hasHostPermission} (origins: ${(d.origins ?? []).join(", ") || "none"})`,
    `lifetime: ${d.settings?.tabLifetimeSeconds}s, tick every ${d.settings?.tickSeconds}s`,
  ].join("\n");
  document.querySelector("#diag-tabs tbody").replaceChildren(
    ...d.lastSnapshot.map((t) => {
      const tr = document.createElement("tr");
      const state = t.discarded ? "unloaded" : t.status;
      const cells = [t.tabId, t.active ? "yes" : "", state, t.progress.toFixed(2), t.favicon, t.iconAdopted ? "yes" : "no", t.url];
      for (const v of cells) {
        const td = document.createElement("td");
        td.textContent = String(v ?? "");
        td.title = String(v ?? "");
        tr.append(td);
      }
      return tr;
    }),
  );
}

// ---- Wire up ---------------------------------------------------------------

$("act-reset").addEventListener("click", () => tabAction("reset"));
$("act-snooze").addEventListener("click", () => tabAction("snooze", settings.tabLifetimeSeconds));
$("act-never").addEventListener("change", (e) => tabAction("neverExpire", e.target.checked));
$("act-never-paused").addEventListener("change", (e) => tabAction("neverExpire", e.target.checked));
$("grant-permission").addEventListener("click", async () => {
  await api.permissions.request(WEB_ORIGINS).catch(() => false);
  refreshPermissionWarning();
});
$("open-page").addEventListener("click", async () => {
  const url = api.runtime.getURL("ui/panel.html?view=page");
  const [existing] = await api.tabs.query({ url }).catch(() => []);
  if (existing) {
    await api.tabs.update(existing.id, { active: true });
    await api.windows.update(existing.windowId, { focused: true }).catch(() => {});
  } else {
    await api.tabs.create({ url });
  }
  if (isPopup) window.close();
});
$("diag-refresh").addEventListener("click", refreshDiag);
$("diag-tick").addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "timed-tabs:tick" }).catch(() => {});
  refreshDiag();
});
$("diagnostics").addEventListener("toggle", (e) => {
  if (e.target.open) refreshDiag();
});
api.permissions.onAdded?.addListener(refreshPermissionWarning);
api.permissions.onRemoved?.addListener(refreshPermissionWarning);

(async () => {
  applyBrowserTheme();
  settings = await getSettings();
  if (location.hash === "#overview" || isPage) $("overview").open = true;
  renderFields();
  refreshPermissionWarning();
  if (isPopup) {
    await refreshTab();
    setInterval(updateReadout, 1000);
    setInterval(refreshTab, 5000);
  }
})();
