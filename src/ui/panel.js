/**
 * Panel logic, shared by the toolbar popup (mini UI), the full page and the
 * preferences pane. The "This tab" section only exists in the popup; the
 * page and preferences views show one page at a time (Tabs, Rules, Settings).
 */
import { api } from "../shared/browser.js";
import { hasWebAccess, WEB_ORIGINS } from "../shared/permissions.js";
import {
  DEFAULTS,
  FIELDS,
  GROUPS,
  getRules,
  getSettings,
  saveRules,
  saveSettings,
  watchRules,
} from "../shared/settings.js";
import {
  MAX_PRIORITY,
  RULE_FIELDS,
  clampPriority,
  matchesRule,
  newRule,
  patternForUrl,
} from "../shared/rules.js";
import { exportText, parseBundle } from "../shared/backup.js";
import { formatDuration, formatRemaining, toUnit } from "../shared/time.js";
import { indicators } from "../background/indicators/index.js";

// The same file serves three contexts: the toolbar popup (default), the
// preferences pane (options.html sets data-context) and a full page
// (panel.html?view=page). Set the page context before anything renders.
if (new URLSearchParams(location.search).get("view") === "page") {
  document.body.dataset.context = "page";
}
const context = document.body.dataset.context;
const isPopup = context === "popup";
const params = new URLSearchParams(location.search);

// ---- Pages -----------------------------------------------------------------
// The full page and the preferences pane show one page at a time, chosen by
// the URL hash: #tabs (default), #rules (also #rule-<id>), #settings.

const PAGES = ["tabs", "rules", "settings"];

function pageFromHash() {
  const h = location.hash.replace(/^#/, "");
  if (h.startsWith("rule-")) return "rules";
  if (PAGES.includes(h)) return h;
  return context === "options" ? "settings" : "tabs";
}

function route() {
  if (isPopup) return;
  const page = pageFromHash();
  document.body.dataset.page = page;
  for (const a of document.querySelectorAll("[data-page-link]")) {
    if (a.dataset.pageLink === page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  onPageShown(page);
}

window.addEventListener("hashchange", route);

// Dev build only (see background): dev.json may list UI actions to replay,
// e.g. "uiActions": [{ "at": 3000, "click": "#tab-rules-list input" }].
if (typeof api.runtime.id === "string" && api.runtime.id.includes("-dev@")) {
  fetch(api.runtime.getURL("dev.json"), { cache: "no-store" })
    .then((r) => r.json())
    .then((dev) => {
      for (const a of dev.uiActions ?? []) {
        setTimeout(() => {
          const el = document.querySelector(a.click);
          if (el) el.click();
          else console.log("[timed-tabs:ui] uiAction: no element for", a.click);
        }, a.at ?? 0);
      }
    })
    .catch(() => {});
}
const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };

// ---- All tabs -------------------------------------------------------------

function renderFields() {
  const root = $("fields");
  const sections = GROUPS.map((g) => {
    const sec = document.createElement("section");
    sec.className = "group";
    sec.id = `group-${g.id}`;
    const h = document.createElement("h2");
    h.className = "settings-title";
    h.textContent = g.title;
    const help = document.createElement("p");
    help.className = "group-help";
    help.textContent = g.help;
    const rows = document.createElement("div");
    rows.className = "group-rows";
    rows.append(...FIELDS.filter((f) => f.group === g.id).map(renderField));
    sec.append(h, help, rows);
    return sec;
  });
  root.replaceChildren(...sections);
  updateFieldVisibility();
  renderJumpLinks();
}

function renderJumpLinks() {
  const nav = $("settings-jump");
  const links = [
    ...GROUPS.map((g) => ({ id: `group-${g.id}`, title: g.title })),
    { id: "backup", title: "Backup" },
    { id: "diagnostics", title: "Diagnostics" },
  ];
  nav.replaceChildren(
    ...links.map(({ id, title }) => {
      const a = document.createElement("a");
      a.href = `#${id}`;
      a.textContent = title;
      a.addEventListener("click", (e) => {
        // Stay on the settings page; just scroll.
        e.preventDefault();
        const el = $(id);
        if (el.tagName === "DETAILS") el.open = true;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return a;
    }),
  );
}

/** Rows with `showWhen` appear only while their condition holds. */
function updateFieldVisibility() {
  for (const row of $("fields").querySelectorAll(".field[data-key]")) {
    const field = FIELDS.find((f) => f.key === row.dataset.key);
    row.hidden = Boolean(field?.showWhen && !field.showWhen(settings));
  }
}

function renderField(field) {
  const row = document.createElement("div");
  row.className = "field";
  row.dataset.key = field.key;

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
    const sw = makeSwitch(Boolean(value), (checked) =>
      save({ [field.key]: checked }),
    );
    sw.input.id = `f-${field.key}`;
    label.htmlFor = sw.input.id;
    control.append(sw.el);
  } else if (field.type === "choice") {
    const select = document.createElement("select");
    select.id = `f-${field.key}`;
    label.htmlFor = select.id;
    for (const opt of field.options)
      select.add(new Option(opt.label, opt.value));
    select.value = value;
    select.addEventListener("change", () =>
      save({ [field.key]: select.value }),
    );
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
      const seconds = Math.max(
        field.min ?? 1,
        Math.round(Number(num.value) * Number(units.value)),
      );
      if (Number.isFinite(seconds)) save({ [field.key]: seconds });
    };
    num.addEventListener("change", commit);
    units.addEventListener("change", commit);
    control.append(num, units);
  } else if (field.type === "percent") {
    const num = document.createElement("input");
    num.type = "number";
    num.min = String(field.min ?? 0);
    num.max = String(field.max ?? 100);
    num.step = "1";
    num.value = String(value);
    num.id = `f-${field.key}`;
    label.htmlFor = num.id;
    num.addEventListener("change", () => {
      const n = Math.round(Number(num.value));
      if (!Number.isFinite(n)) return;
      const clamped = Math.min(field.max ?? 100, Math.max(field.min ?? 0, n));
      num.value = String(clamped);
      save({ [field.key]: clamped });
    });
    const suffix = document.createElement("span");
    suffix.className = "field-suffix";
    suffix.textContent = "% of the lifetime";
    control.append(num, suffix);
  } else if (field.type === "indicators") {
    // One full-width row per indicator, like every other setting.
    row.classList.add("field-group");
    control.remove();
    const list = document.createElement("div");
    list.className = "field-group-rows";
    for (const ind of indicators) {
      const sw = makeSwitch(value.includes(ind.id), async () => {
        const ids = [...list.querySelectorAll("input:checked")].map(
          (i) => i.value,
        );
        await save({ indicators: ids });
        markSaved(sub);
      });
      sw.input.value = ind.id;
      sw.input.disabled = !ind.supported();
      sw.input.id = `f-indicator-${ind.id}`;
      const sub = settingRow(
        ind.label,
        ind.description +
          (ind.supported() ? "" : " Not available in this browser."),
        sw.el,
      );
      sub.querySelector(".field-label").htmlFor = sw.input.id;
      list.append(sub);
    }
    row.append(list);
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
  for (const key of Object.keys(partial)) {
    const row = $("fields").querySelector(
      `.field[data-key="${CSS.escape(key)}"]`,
    );
    if (row && !row.classList.contains("field-group")) markSaved(row);
  }
  if (isPopup) refreshTab();
  if ($("overview").open) refreshOverview();
}

/** Inline confirmation on the row whose value has just been written to storage. */
function markSaved(
  el,
  container = el.querySelector(":scope > .field-control") ?? el,
) {
  if (!el) return;
  let mark = container.querySelector(":scope > .saved-mark");
  if (!mark) {
    mark = document.createElement("span");
    mark.className = "saved-mark";
    mark.setAttribute("role", "status");
    mark.textContent = "Saved";
    container.append(mark);
  }
  clearTimeout(mark._timer);
  mark.classList.remove("is-shown");
  void mark.offsetWidth; // restart the transition when saving again quickly
  mark.classList.add("is-shown");
  mark._timer = setTimeout(() => mark.classList.remove("is-shown"), 1800);
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
  tabState = await api.runtime
    .sendMessage({ type: "timed-tabs:tab-state", tabId: currentTab.id })
    .catch(() => null);
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
  $("act-ignore").checked = Boolean(tabState.ignoreRules);
  // The rules section only appears when a rule matches this page, or rules are already ignored.
  $("tab-rules").hidden = !(tabState.rules?.length || tabState.ignoreRules);
  renderTabRules();
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

function renderTabRules() {
  const list = $("tab-rules-list");
  // Rows are rebuilt on every refresh; keep any "Saved" mark that is still showing.
  const liveMarks = new Map();
  for (const mark of list.querySelectorAll(
    "[data-saved-key] > .saved-mark.is-shown",
  )) {
    liveMarks.set(mark.parentElement.dataset.savedKey, mark);
  }
  const matched = tabState?.rules ?? [];
  const allOff = Boolean(tabState?.ignoreRules);
  if (!matched.length) {
    const p = document.createElement("p");
    p.className = "tab-rules-empty";
    p.textContent = "No rules match this page.";
    list.replaceChildren(p);
    return;
  }
  // Highest priority first, so the rule that wins is at the top.
  list.replaceChildren(
    ...[...matched].reverse().map((r) => {
      const row = document.createElement("label");
      row.className = "tab-rule";
      row.classList.toggle("is-ignored", r.ignored);
      row.classList.toggle("is-masked", allOff);
      row.dataset.savedKey = `rule-${r.id}`;
      const sw = makeSwitch(!r.ignored, async (on) => {
        await tabAction("ignoreRule", { ruleId: r.id, ignored: !on }, row);
      });
      sw.input.disabled = allOff;
      sw.el.title = allOff
        ? "All rules are ignored for this tab"
        : r.ignored
          ? "Apply this rule again"
          : "Ignore this rule for this tab";
      sw.el.classList.add("tab-rule-switch");
      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "tab-rule-name";
      name.textContent = r.description || r.pattern;
      const meta = document.createElement("small");
      meta.textContent = ` · priority ${r.priority}${r.description ? ` · ${r.pattern}` : ""}`;
      name.append(meta);
      const sets = document.createElement("span");
      sets.className = "tab-rule-sets";
      sets.textContent = describeRule(r).replaceAll("\n", " · ");
      text.append(name, sets);
      row.append(sw.input, sw.el.querySelector(".switch-track"), text);
      // makeSwitch built a <label>; we use its parts inside our own row label.
      row.classList.add("switch");
      return row;
    }),
  );
  for (const [key, mark] of liveMarks) {
    list.querySelector(`[data-saved-key="${key}"]`)?.append(mark);
  }
}

function describeRule(r) {
  const parts = Object.entries(r.set ?? {}).map(
    ([k, v]) => `${ruleFieldLabel(k)}: ${formatRuleValue(k, v)}`,
  );
  return parts.length ? parts.join("\n") : "Sets nothing";
}

function ruleFieldLabel(key) {
  return RULE_FIELD_DEFS.find((f) => f.key === key)?.label ?? key;
}

function formatRuleValue(key, v) {
  const def = RULE_FIELD_DEFS.find((f) => f.key === key);
  if (def?.type === "duration") return formatDuration(v);
  if (def?.type === "choice")
    return def.options.find((o) => o.value === v)?.label ?? String(v);
  return v ? "on" : "off";
}

function updateReadout() {
  if (!tabState) return;
  const drift = tabState.paused ? 0 : (Date.now() - fetchedAt) / 1000;
  const remaining = Math.max(0, tabState.remainingSeconds - drift);
  const progress = Math.min(
    1,
    (tabState.elapsedSeconds + drift) / tabState.lifetimeSeconds,
  );
  const exempt =
    (tabState.effective?.neverExpire ?? tabState.neverExpire) ||
    currentTab?.pinned;

  const time = $("remaining");
  const note = $("remaining-note");
  if (exempt) {
    time.textContent = "∞";
    note.textContent = currentTab?.pinned
      ? "pinned tabs never expire"
      : tabState.neverExpire
        ? "never expires"
        : "never expires (rule)";
  } else {
    time.textContent = formatRemaining(remaining);
    if (remaining <= 0) note.textContent = "";
    else if (tabState.paused)
      note.textContent = "left, paused while you're here";
    else note.textContent = tabState.extraSeconds ? "left, snoozed" : "left";
  }

  const pct = exempt ? 0 : progress * 100;
  $("fuse").setAttribute("aria-valuenow", String(Math.round(pct)));
  $("fuse-burnt").style.width = `${pct}%`;
  $("fuse-marker").style.left = `${pct}%`;
  $("act-reset").disabled = exempt;
  $("act-snooze").disabled = exempt;
}

async function tabAction(action, value, sourceEl = null) {
  if (!currentTab) return;
  const reply = await api.runtime
    .sendMessage({
      type: "timed-tabs:tab-action",
      tabId: currentTab.id,
      action,
      value,
    })
    .catch(() => null);
  if (reply) tabState = reply;
  fetchedAt = Date.now();
  renderTab();
  // Confirm on the control that was used, once the background has answered.
  if (reply && sourceEl) {
    const key = sourceEl.dataset?.savedKey;
    const target = sourceEl.isConnected
      ? sourceEl
      : key
        ? document.querySelector(`[data-saved-key="${key}"]`)
        : null;
    if (target) markSaved(target, target);
  }
  if (!reply) flashTabError();
}

let tabErrorTimer;
function flashTabError() {
  const note = $("remaining-note");
  const prev = note.textContent;
  note.textContent = "could not save, try again";
  clearTimeout(tabErrorTimer);
  tabErrorTimer = setTimeout(() => {
    if (note.textContent === "could not save, try again")
      note.textContent = prev;
  }, 2500);
}

// ---- Fold state, remembered across page opens ------------------------------
// localStorage on the extension origin; wrapped because it can be unavailable.

function foldGet(key, fallback) {
  try {
    const v = localStorage.getItem(`fold:${key}`);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function foldSet(key, open) {
  try {
    localStorage.setItem(`fold:${key}`, open ? "1" : "0");
  } catch {
    // ignore
  }
}

/** Apply a remembered fold state to a <details> and keep it updated. */
function rememberFold(details, key, fallbackOpen) {
  details.open = foldGet(key, fallbackOpen);
  details.addEventListener("toggle", () => foldSet(key, details.open));
}

// ---- All open tabs ---------------------------------------------------------

let overviewTimer = null;

async function refreshOverview() {
  const groups = await api.runtime
    .sendMessage({ type: "timed-tabs:all-tabs" })
    .catch(() => []);
  const list = $("overview-list");
  const total = groups.reduce((n, g) => n + g.tabs.length, 0);
  $("overview-count").textContent = total
    ? `${total} tab${total === 1 ? "" : "s"}`
    : "";
  if (!total) {
    const empty = document.createElement("p");
    empty.className = "overview-empty";
    empty.textContent = "No tabs are being timed.";
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  groups.forEach((g, i) => {
    const rows = g.tabs.map(renderTabRow);
    if (groups.length === 1) {
      frag.append(...rows);
      return;
    }
    const group = document.createElement("details");
    group.className = "window-group";
    const sum = document.createElement("summary");
    sum.className = "window-title";
    const name = document.createElement("span");
    name.className = "window-name";
    name.textContent = g.focused ? "Active window" : `Window ${i + 1}`;
    const count = document.createElement("span");
    count.className = "overview-count";
    count.textContent = `${g.tabs.length} tab${g.tabs.length === 1 ? "" : "s"}`;
    sum.append(name, count);
    group.append(sum, ...rows);
    rememberFold(group, `window-${i}`, true);
    frag.append(group);
  });
  list.replaceChildren(frag);
}

function renderTabRow(t) {
  const row = document.createElement("div");
  row.className = "trow";
  const timerOff = t.effective?.neverExpire ?? t.neverExpire;
  const exempt = timerOff || t.pinned;
  if (t.active) row.classList.add("is-active");
  if (exempt) row.classList.add("is-off");
  if (!exempt && t.progress >= 1) {
    row.classList.add("is-expired");
    row.title = "Expired";
  }

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
    api.runtime
      .sendMessage({
        type: "timed-tabs:tab-action",
        tabId: t.tabId,
        action: "focus",
      })
      .catch(() => {});
    if (isPopup) window.close();
    else setTimeout(refreshOverview, 300);
  });
  row.append(title);

  if (t.rules?.length) {
    const tag = document.createElement("span");
    tag.className = "trow-rules";
    if (t.ignoreRules) tag.classList.add("is-ignored");
    tag.textContent =
      (t.rules.length === 1 ? "1 rule" : `${t.rules.length} rules`) +
      (t.ignoreRules ? " ignored" : "");
    tag.title = [...t.rules]
      .reverse()
      .map(
        (r) =>
          `${r.description ? r.description + " — " : ""}${r.pattern} (${r.priority})\n${describeRule(r)}`,
      )
      .join("\n\n");
    row.append(tag);
  }

  const time = document.createElement("span");
  time.className = "trow-time";
  if (t.pinned) time.textContent = "pinned";
  else if (timerOff)
    time.textContent = t.neverExpire ? "timer off" : "timer off (rule)";
  else if (t.paused)
    time.textContent = `${formatRemaining(t.remainingSeconds)} · paused`;
  else time.textContent = formatRemaining(t.remainingSeconds);
  row.append(time);

  const fuse = document.createElement("div");
  fuse.className = "trow-fuse";
  fuse.style.setProperty(
    "--pct",
    `${exempt ? 0 : Math.round(t.progress * 100)}%`,
  );
  row.append(fuse);

  const timer = quickToggle(
    "⏱",
    !t.neverExpire,
    false,
    t.neverExpire ? "Timer is off. Turn on" : "Timer is on. Turn off",
    "qtoggle-timer",
  );
  timer.disabled = t.pinned;
  timer.addEventListener("click", async () => {
    await api.runtime
      .sendMessage({
        type: "timed-tabs:tab-action",
        tabId: t.tabId,
        action: "neverExpire",
        value: !t.neverExpire,
      })
      .catch(() => {});
    refreshOverview();
    if (currentTab?.id === t.tabId) refreshTab();
  });
  row.append(timer);

  const effective = t.resetOnActivate ?? settings.resetOnActivate;
  const inherited =
    t.resetOnActivate === null || t.resetOnActivate === undefined;
  const focus = quickToggle(
    "↻",
    effective,
    inherited,
    (effective ? "Restarts on focus" : "Keeps counting on focus") +
      (inherited ? " (default)" : "") +
      ". Click to change",
    "qtoggle-focus",
  );
  focus.addEventListener("click", async () => {
    await api.runtime
      .sendMessage({
        type: "timed-tabs:tab-action",
        tabId: t.tabId,
        action: "resetOnActivate",
        value: !effective,
      })
      .catch(() => {});
    refreshOverview();
  });
  row.append(focus);

  // Close the tab: two clicks within a few seconds, the first only arms it.
  const close = quickToggle(
    "✕",
    false,
    false,
    "Close this tab",
    "qtoggle-close",
  );
  let armed = null;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    close.classList.remove("is-armed");
    close.textContent = "✕";
    close.title = "Close this tab";
    close.setAttribute("aria-label", "Close this tab");
  };
  close.addEventListener("click", async () => {
    if (!armed) {
      close.classList.add("is-armed");
      close.textContent = "Close?";
      close.title = "Click again to close this tab";
      close.setAttribute("aria-label", "Click again to close this tab");
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    await api.runtime
      .sendMessage({
        type: "timed-tabs:tab-action",
        tabId: t.tabId,
        action: "close",
      })
      .catch(() => {});
    refreshOverview();
    if (isPopup && currentTab?.id === t.tabId) window.close();
  });
  close.addEventListener("blur", () => {
    if (armed) setTimeout(disarm, 200);
  });
  row.append(close);
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

// ---- Recently expired ------------------------------------------------------

async function refreshRecent() {
  const list = await api.runtime
    .sendMessage({ type: "timed-tabs:recent" })
    .catch(() => []);
  $("recent-count").textContent = list.length ? String(list.length) : "";
  const root = $("recent-list");
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "overview-empty";
    p.textContent = "No tabs have expired yet.";
    root.replaceChildren(p);
    return;
  }
  root.replaceChildren(...list.map(renderRecentRow));
}

function renderRecentRow(item) {
  const row = document.createElement("div");
  row.className = "trow";
  const icon = document.createElement("img");
  icon.className = "trow-icon";
  icon.alt = "";
  if (item.favIconUrl) icon.src = item.favIconUrl;
  const title = document.createElement("span");
  title.className = "trow-title";
  title.textContent = item.title || item.url;
  const when = document.createElement("span");
  when.className = "trow-when";
  when.textContent = `closed ${timeAgo(item.expiredAt)}`;
  const url = document.createElement("span");
  url.className = "trow-url";
  url.textContent = item.url;
  url.title = item.url;
  const reopen = document.createElement("button");
  reopen.type = "button";
  reopen.className = "trow-reopen";
  reopen.textContent = "Reopen";
  reopen.addEventListener("click", async () => {
    await api.runtime
      .sendMessage({ type: "timed-tabs:recent-reopen", url: item.url })
      .catch(() => {});
    if (isPopup) window.close();
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "qtoggle trow-remove";
  remove.textContent = "✕";
  remove.title = "Remove from this list";
  remove.setAttribute("aria-label", "Remove from this list");
  remove.addEventListener("click", async () => {
    row.remove();
    await api.runtime
      .sendMessage({ type: "timed-tabs:recent-remove", id: item.id })
      .catch(() => {});
    refreshRecent();
  });
  row.append(icon, title, when, url, reopen, remove);
  return row;
}

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

let recentTimer = null;
$("recent").addEventListener("toggle", (e) => {
  if (e.target.open) refreshRecent();
});
$("recent-clear").addEventListener("click", async () => {
  await api.runtime
    .sendMessage({ type: "timed-tabs:recent-clear" })
    .catch(() => {});
  refreshRecent();
});

/** Per-page setup when a page becomes visible. */
function onPageShown(page) {
  if (page === "tabs") {
    if ($("overview").open) refreshOverview();
    if ($("recent").open) refreshRecent();
    // Recent list keeps itself fresh while the page is open.
    clearInterval(recentTimer);
    recentTimer = setInterval(() => {
      if ($("recent").open) refreshRecent();
    }, 15000);
  } else if (page === "rules") {
    renderRules();
    applyRulesFilter();
  } else if (page === "settings") {
    renderFields();
    refreshPermissionWarning();
    showBackup();
  }
}

// ---- Rules editor ----------------------------------------------------------

let rules = [];
/** Rule ids the user has expanded this session (cards start collapsed). */
const expandedRules = new Set();

/** What a rule may override: the global field definitions, reworded for a rule. */
const RULE_FIELD_TEXT = {
  tabLifetimeSeconds: {
    label: "Lifetime",
    help: "How long matching tabs may sit before they expire.",
  },
  onExpire: {
    label: "When a tab expires",
    help: "What to do with a matching background tab once it runs out of time.",
  },
  resetOnActivate: {
    label: "Restart on focus",
    help: "Switching to a matching tab gives it a full lifetime again.",
  },
  pauseWhileActive: {
    label: "Count background time only",
    help: "The clock stops while you are looking at a matching tab.",
  },
  neverExpire: {
    label: "Timer off",
    help: "Matching tabs never expire and show no colour.",
  },
};
const RULE_FIELD_DEFS = RULE_FIELDS.map((key) => {
  const base = FIELDS.find((f) => f.key === key) ?? { key, type: "toggle" };
  return { ...base, ...RULE_FIELD_TEXT[key] };
});

/** A rule with no usable pattern: blank, or a host-less "/*" left over from a bad add. */
function isEmptyRule(r) {
  const p = (r.pattern ?? "").trim();
  return p === "" || p === "/*";
}

function renderRules() {
  const list = $("rules-list");
  const empties = rules.filter(isEmptyRule).length;
  const removeBtn = $("rules-remove-empty");
  removeBtn.hidden = empties === 0;
  if (empties)
    removeBtn.textContent = `Remove ${empties} empty rule${empties === 1 ? "" : "s"}`;
  if (!rules.length) {
    const p = document.createElement("p");
    p.className = "rules-empty";
    p.textContent =
      "No rules yet. Add one here, or open “Rules for this site” from the popup.";
    list.replaceChildren(p);
    return;
  }
  list.replaceChildren(...rules.map(renderRule));
  if ($("rules-filter").value.trim()) applyRulesFilter();
  const target = location.hash.startsWith("#rule-")
    ? location.hash.slice(6)
    : null;
  if (target) {
    const el = list.querySelector(`[data-rule-id="${CSS.escape(target)}"]`);
    if (el) {
      el.classList.add("is-target");
      el.scrollIntoView({ block: "center" });
      el.querySelector(".rule-pattern")?.focus();
      history.replaceState(
        null,
        "",
        location.pathname + location.search + "#rules",
      );
    }
  }
}

function renderRule(rule) {
  const el = document.createElement("div");
  el.className = "rule";
  el.dataset.ruleId = rule.id;
  el.classList.toggle("is-disabled", rule.priority === 0);

  const open = expandedRules.has(rule.id);
  el.classList.toggle("is-collapsed", !open);

  // Header: expand toggle, pattern field, delete button.
  const head = document.createElement("div");
  head.className = "rule-head";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "rule-toggle";
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Collapse rule" : "Expand rule");
  toggle.title = open ? "Collapse" : "Expand";
  toggle.addEventListener("click", () =>
    setRuleExpanded(rule.id, !expandedRules.has(rule.id)),
  );
  const pattern = document.createElement("input");
  pattern.className = "rule-pattern";
  pattern.placeholder = "Type an address pattern, e.g. example.com/*";
  pattern.value = rule.pattern;
  pattern.setAttribute("aria-label", "Address pattern");
  pattern.addEventListener("change", () =>
    updateRule(rule.id, { pattern: pattern.value.trim() }, true, "head"),
  );
  const del = document.createElement("button");
  del.type = "button";
  del.className = "rule-delete";
  del.textContent = "Delete rule";
  // Two clicks within a few seconds; the first only arms the button.
  let armed = null;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    del.textContent = "Delete rule";
    del.classList.remove("is-armed");
  };
  del.addEventListener("click", () => {
    if (!armed) {
      del.textContent = "Click again to delete";
      del.classList.add("is-armed");
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    rules = rules.filter((r) => r.id !== rule.id);
    persistRules();
  });
  del.addEventListener("blur", () => {
    if (armed) setTimeout(disarm, 200);
  });
  head.append(toggle, pattern, del);
  el.append(head);

  // Collapsed summary: description and what the rule changes, in one line.
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "rule-summary";
  const summaryParts = [];
  if (!rule.pattern.trim())
    summaryParts.push("No pattern yet, so this rule matches nothing");
  if (rule.description) summaryParts.push(rule.description);
  summaryParts.push(
    `${rule.match === "prefix" ? "starts with" : "wildcard"}, priority ${rule.priority}`,
  );
  const sets = Object.entries(rule.set ?? {}).map(
    ([k, v]) => `${ruleFieldLabel(k)}: ${formatRuleValue(k, v)}`,
  );
  summaryParts.push(sets.length ? sets.join(" · ") : "changes nothing yet");
  summary.textContent = summaryParts.join(" — ");
  summary.title = "Expand rule";
  summary.addEventListener("click", () => setRuleExpanded(rule.id, true));
  el.append(summary);

  const body = document.createElement("div");
  body.className = "rule-body";
  el.append(body);

  const descWrap = document.createElement("div");
  descWrap.className = "rule-description-wrap";
  const desc = document.createElement("input");
  desc.className = "rule-description";
  desc.placeholder = "What is this rule for? (optional)";
  desc.value = rule.description ?? "";
  desc.setAttribute("aria-label", "Description");
  desc.addEventListener("change", async () => {
    await updateRule(rule.id, { description: desc.value.trim() }, false);
    markSaved(descWrap, descWrap);
  });
  descWrap.append(desc);
  body.append(descWrap);

  // How it matches, and how strongly.
  const match = document.createElement("select");
  match.add(new Option("Wildcard", "wildcard"));
  match.add(new Option("Starts with", "prefix"));
  match.value = rule.match;
  match.addEventListener("change", () =>
    updateRule(rule.id, { match: match.value }, true, "match"),
  );
  body.append(
    withKey(
      "match",
      settingRow(
        "Match",
        rule.match === "prefix"
          ? "The address must begin with the pattern."
          : "The whole address must fit the pattern. * stands for anything.",
        match,
      ),
    ),
  );

  const prioInput = document.createElement("input");
  prioInput.type = "number";
  prioInput.min = "0";
  prioInput.max = String(MAX_PRIORITY);
  prioInput.step = "1";
  prioInput.value = String(rule.priority);
  prioInput.addEventListener("change", () =>
    updateRule(
      rule.id,
      { priority: clampPriority(prioInput.value) },
      true,
      "priority",
    ),
  );
  body.append(
    withKey(
      "priority",
      settingRow(
        "Priority",
        rule.priority === 0
          ? "0: this rule is switched off."
          : "When two rules disagree, the higher number wins. 0 switches a rule off.",
        prioInput,
      ),
    ),
  );

  const overrides = document.createElement("div");
  overrides.className = "rule-overrides";
  const heading = document.createElement("p");
  heading.className = "rule-overrides-title";
  heading.textContent = "Settings this rule changes";
  overrides.append(heading);
  for (const def of RULE_FIELD_DEFS)
    overrides.append(renderOverride(rule, def));
  body.append(overrides);
  return el;
}

function setRuleExpanded(id, open) {
  if (open) expandedRules.add(id);
  else expandedRules.delete(id);
  const card = $("rules-list").querySelector(
    `[data-rule-id="${CSS.escape(id)}"]`,
  );
  if (!card) return;
  card.classList.toggle("is-collapsed", !open);
  const t = card.querySelector(".rule-toggle");
  t.setAttribute("aria-expanded", String(open));
  t.setAttribute("aria-label", open ? "Collapse rule" : "Expand rule");
  t.title = open ? "Collapse" : "Expand";
}

function withKey(key, row) {
  row.dataset.rowKey = key;
  return row;
}

/** A label + help on the left and a control on the right, matching the global settings rows. */
function settingRow(labelText, helpText, control, { checkbox } = {}) {
  const row = document.createElement("div");
  row.className = "field";
  const label = document.createElement("label");
  label.className = "field-label";
  if (checkbox) label.append(checkbox, " ");
  label.append(labelText);
  if (helpText) {
    const help = document.createElement("span");
    help.className = "field-help";
    help.textContent = helpText;
    label.append(help);
  }
  const ctl = document.createElement("div");
  ctl.className = "field-control";
  if (control) ctl.append(control);
  row.append(label, ctl);
  return row;
}

function renderOverride(rule, def) {
  const isOn = def.key in (rule.set ?? {});

  const on = document.createElement("input");
  on.type = "checkbox";
  on.checked = isOn;
  on.setAttribute("aria-label", `Change ${def.label} for matching tabs`);

  const control = document.createElement("span");
  control.className = "override-control";
  const current = isOn
    ? rule.set[def.key]
    : (settings[def.key] ?? (def.type === "toggle" ? false : undefined));

  let read;
  if (def.type === "toggle") {
    const sw = makeSwitch(Boolean(current), () => commit());
    control.append(sw.el);
    read = () => sw.input.checked;
  } else if (def.type === "choice") {
    const select = document.createElement("select");
    for (const opt of def.options) select.add(new Option(opt.label, opt.value));
    select.value = current ?? def.options[0].value;
    select.addEventListener("change", () => commit());
    control.append(select);
    read = () => select.value;
  } else {
    const { value: n, unit } = toUnit(current ?? 1800);
    const num = document.createElement("input");
    num.type = "number";
    num.min = "1";
    num.step = "1";
    num.value = String(n);
    const units = document.createElement("select");
    for (const [label, secs] of [
      ["sec", 1],
      ["min", 60],
      ["hours", 3600],
    ])
      units.add(new Option(label, String(secs)));
    units.value = String(unit);
    num.addEventListener("change", () => commit());
    units.addEventListener("change", () => commit());
    control.append(num, units);
    read = () =>
      Math.max(1, Math.round(Number(num.value) * Number(units.value)));
  }

  const wrap = settingRow(def.label, def.help, control, { checkbox: on });
  wrap.classList.add("override");
  wrap.classList.toggle("is-on", isOn);

  const commit = async () => {
    const set = { ...(rule.set ?? {}) };
    if (on.checked) set[def.key] = read();
    else delete set[def.key];
    wrap.classList.toggle("is-on", on.checked);
    await updateRule(rule.id, { set }, false);
    markSaved(wrap);
  };
  on.addEventListener("change", commit);
  return wrap;
}

function updateRule(id, patch, rerender = true, part = null) {
  rules = rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
  return persistRules(rerender, part ? { id, part } : null);
}

let rulesSaving = false;
/** Save all rules; optionally show "Saved" on one part ("head", "match", "priority") of one rule. */
async function persistRules(rerender = true, saved = null) {
  rulesSaving = true;
  await saveRules(rules);
  rulesSaving = false;
  if (rerender) renderRules();
  if (saved) {
    const card = $("rules-list").querySelector(
      `[data-rule-id="${CSS.escape(saved.id)}"]`,
    );
    if (card) {
      if (saved.part === "head")
        markSaved(card, card.querySelector(".rule-head"));
      else markSaved(card.querySelector(`[data-row-key="${saved.part}"]`));
    }
  }
  if ($("overview").open) refreshOverview();
}

// Two clicks, like delete. Removes every rule that has no usable pattern.
let removeEmptyArmed = null;
$("rules-remove-empty").addEventListener("click", async () => {
  const b = $("rules-remove-empty");
  if (!removeEmptyArmed) {
    b.textContent = "Click again to remove them";
    b.classList.add("is-armed");
    removeEmptyArmed = setTimeout(() => {
      removeEmptyArmed = null;
      b.classList.remove("is-armed");
      renderRules();
    }, 4000);
    return;
  }
  clearTimeout(removeEmptyArmed);
  removeEmptyArmed = null;
  b.classList.remove("is-armed");
  rules = rules.filter((r) => !isEmptyRule(r));
  await persistRules();
});

$("rule-add").addEventListener("click", async () => {
  // With an address filter active, start the new rule from that site.
  const site = $("rules-filter").value.trim();
  const pattern = site ? patternForUrl(site) : "";
  // Don't pile up blank rules: reuse one that is still empty, or one with the same pattern.
  const existing = rules.find((r) =>
    pattern ? r.pattern === pattern : !r.pattern.trim(),
  );
  let rule = existing;
  if (!rule) {
    rule = newRule({ pattern, priority: 5 });
    rules = [...rules, rule];
    expandedRules.add(rule.id);
    await persistRules();
  } else {
    setRuleExpanded(rule.id, true);
  }
  const card = $("rules-list").querySelector(
    `[data-rule-id="${CSS.escape(rule.id)}"]`,
  );
  if (card) {
    card.classList.remove("is-filtered-out");
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.querySelector(".rule-pattern")?.focus();
  }
});

/** Show only rules that match the address typed in the filter box. Matches open up; they can still be folded. */
let lastFilter = "";
function applyRulesFilter() {
  const url = $("rules-filter").value.trim();
  const note = $("rules-filter-note");
  $("rules-filter-clear").hidden = !url;
  const rows = [...$("rules-list").querySelectorAll(".rule")];
  const changed = url !== lastFilter;
  lastFilter = url;
  if (!url) {
    for (const el of rows) el.classList.remove("is-filtered-out");
    note.hidden = true;
    return;
  }
  let shown = 0;
  for (const el of rows) {
    const rule = rules.find((r) => r.id === el.dataset.ruleId);
    const hit = rule ? matchesRule(rule, url) || !rule.pattern.trim() : false;
    el.classList.toggle("is-filtered-out", !hit);
    if (hit) {
      shown += 1;
      if (changed) setRuleExpanded(rule.id, true);
    }
  }
  note.hidden = false;
  note.textContent = shown
    ? `${shown} of ${rules.length} rule${rules.length === 1 ? "" : "s"} match this address. Disabled rules (priority 0) are included.`
    : `No rules match this address. Add rule starts one for ${patternForUrl(url) || "it"}.`;
}

$("rules-filter").addEventListener("input", applyRulesFilter);
$("rules-filter-clear").addEventListener("click", () => {
  $("rules-filter").value = "";
  applyRulesFilter();
});

watchRules((next) => {
  if (rulesSaving) return;
  rules = next;
  if (!isPopup) renderRules();
  if (isPopup) refreshTab();
});

// ---- Backup ----------------------------------------------------------------

const backupText = $("backup-text");
const backupStatus = $("backup-status");

function showBackup() {
  backupText.value = exportText(settings, rules);
  backupStatus.textContent = "";
}

function backupNote(text) {
  backupStatus.textContent = text;
}

$("backup-refresh").addEventListener("click", showBackup);

$("backup-copy").addEventListener("click", async () => {
  showBackup();
  try {
    await navigator.clipboard.writeText(backupText.value);
    backupNote("Copied.");
  } catch {
    backupText.select();
    backupNote(
      "Could not access the clipboard. The text is selected; press Ctrl/Cmd+C.",
    );
  }
});

$("backup-download").addEventListener("click", () => {
  showBackup();
  const blob = new Blob([backupText.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `timed-tabs-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  backupNote("Downloaded.");
});

$("backup-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  backupText.value = await file.text();
  e.target.value = "";
  await applyBackup();
});

$("backup-apply").addEventListener("click", applyBackup);

// Two clicks within a few seconds, so a stray click cannot wipe everything.
let resetArmed = null;
$("backup-reset").addEventListener("click", async () => {
  const b = $("backup-reset");
  if (!resetArmed) {
    b.textContent = "Click again to reset all settings and rules";
    b.classList.add("is-armed");
    resetArmed = setTimeout(() => {
      resetArmed = null;
      b.textContent = "Reset everything to defaults";
      b.classList.remove("is-armed");
    }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  b.textContent = "Reset everything to defaults";
  b.classList.remove("is-armed");
  await api.storage.sync.clear();
  await api.storage.local.clear();
  settings = { ...DEFAULTS };
  rules = [];
  renderFields();
  if (!isPopup) renderRules();
  if ($("overview").open) refreshOverview();
  backupNote(
    "Reset. All settings are back to defaults and all rules are gone.",
  );
  showBackupSoon();
});

async function applyBackup() {
  let parsed;
  try {
    parsed = parseBundle(backupText.value);
  } catch (err) {
    backupNote(err.message);
    return;
  }
  await saveSettings({ ...DEFAULTS, ...parsed.settings });
  settings = { ...DEFAULTS, ...parsed.settings };
  rules = parsed.rules;
  await saveRules(rules);
  renderFields();
  if (!isPopup) renderRules();
  if ($("overview").open) refreshOverview();
  const ruleCount = `${rules.length} rule${rules.length === 1 ? "" : "s"}`;
  backupNote(
    parsed.warnings.length
      ? `Loaded with ${ruleCount}. ${parsed.warnings.join(" ")}`
      : `Loaded settings and ${ruleCount}.`,
  );
  showBackupSoon();
}

let backupTimer;
function showBackupSoon() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    const note = backupStatus.textContent;
    showBackup();
    backupStatus.textContent = note;
  }, 300);
}

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
  document.documentElement.style.colorScheme = isDark(ground)
    ? "dark"
    : "light";
}

function cssColor(v) {
  if (!v) return null;
  if (Array.isArray(v))
    return v.length === 4 ? `rgba(${v.join(",")})` : `rgb(${v.join(",")})`;
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
  const d = await api.runtime
    .sendMessage({ type: "timed-tabs:diag" })
    .catch((e) => ({ error: String(e) }));
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
      const cells = [
        t.tabId,
        t.active ? "yes" : "",
        state,
        t.progress.toFixed(2),
        t.favicon,
        t.iconAdopted ? "yes" : "no",
        t.url,
      ];
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

$("act-reset").addEventListener("click", (e) =>
  tabAction("reset", undefined, e.currentTarget),
);
$("act-snooze").addEventListener("click", (e) =>
  tabAction("snooze", settings.tabLifetimeSeconds, e.currentTarget),
);
$("act-never").addEventListener("change", (e) =>
  tabAction("neverExpire", e.target.checked, e.target.closest("label")),
);
$("act-never-paused").addEventListener("change", (e) =>
  tabAction("neverExpire", e.target.checked, e.target.closest("label")),
);
$("act-ignore").addEventListener("change", (e) =>
  tabAction("ignoreRules", e.target.checked, e.target.closest("label")),
);
$("grant-permission").addEventListener("click", async () => {
  await api.permissions.request(WEB_ORIGINS).catch(() => false);
  refreshPermissionWarning();
});
async function openPageView(hash = "", extraParams = {}) {
  const base = api.runtime.getURL("ui/panel.html");
  const q = new URLSearchParams({ view: "page", ...extraParams });
  const url = `${base}?${q}${hash}`;
  const [existing] = await api.tabs.query({ url: `${base}*` }).catch(() => []);
  if (existing) {
    await api.tabs.update(existing.id, { active: true, url });
    await api.windows
      .update(existing.windowId, { focused: true })
      .catch(() => {});
  } else {
    await api.tabs.create({ url });
  }
  if (isPopup) window.close();
}

$("open-page").addEventListener("click", () => openPageView("#tabs"));
for (const b of document.querySelectorAll(".mini-nav [data-open]")) {
  b.addEventListener("click", () => {
    const what = b.dataset.open;
    if (what === "rules-for-site")
      openPageView("#rules", currentTab?.url ? { site: currentTab.url } : {});
    else openPageView(`#${what}`);
  });
}
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
  rules = await getRules();
  if (!isPopup) {
    const site = params.get("site");
    if (site) $("rules-filter").value = site;
    renderRules();
    showBackup();
    rememberFold($("overview"), "overview", true);
    rememberFold($("recent"), "recent", false);
    route();
  }
  renderFields();
  refreshPermissionWarning();
  if (isPopup) {
    await refreshTab();
    setInterval(updateReadout, 1000);
    setInterval(refreshTab, 5000);
    // A navigation in the current tab can change which rules apply.
    api.tabs.onUpdated?.addListener(
      (tabId, change) => {
        if (change.url && tabId === currentTab?.id) refreshTab();
      },
      { properties: ["url"] },
    );
  }
})();
