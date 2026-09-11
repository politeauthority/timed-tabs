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
  getGroups,
  getRules,
  saveGroups,
  getSettings,
  saveRules,
  saveSettings,
  watchSettings,
  watchGroups,
  watchRules,
} from "../shared/settings.js";
import {
  cleanName,
  cleanPatterns,
  findGroup,
  groupNameOf,
  groupRef,
  isGroupRef,
  nameTaken,
  newGroup,
  renameGroup,
  rulesUsingGroup,
} from "../shared/groups.js";
import {
  MAX_PRIORITY,
  RULE_FIELDS,
  RULE_TIMING_FIELDS,
  RULE_VISUAL_FIELDS,
  clampPriority,
  explainSettings,
  matchesRule,
  newRule,
  patternForUrl,
} from "../shared/rules.js";
import { exportText, parseBundle } from "../shared/backup.js";
import { compareVersions, getDisplayVersion } from "../shared/version.js";
import { groupRecent } from "../shared/recent.js";
import { formatDuration, formatRemaining, formatSpan, snoozeSeconds, toUnit } from "../shared/time.js";
import { sortTabs, TAB_SORTS } from "../shared/tab-sort.js";
import { FLAGS, activeFeatures, featureOn, flagOn, flagRequires } from "../shared/flags.js";
import { indicators } from "../background/indicators/index.js";
import { mountToasts } from "./toasts.js";

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
// the URL hash: #tabs (default), #rules, #settings.

const PAGES = ["tabs", "rules", "settings"];

function pageFromHash() {
  const h = location.hash.replace(/^#/, "");
  if (h.startsWith("rule-")) return "rules";
  if (PAGES.includes(h)) return h;
  // Backup was a page of its own once; an old link to it lands on its pill.
  if (h === "backup") return "settings";
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

// @dev-only-start  (scripts/build.mjs removes everything down to @dev-only-end from release builds)
// Dev build only (see background): dev.json may list UI actions to replay,
// e.g. "uiActions": [{ "at": 3000, "click": "#tab-rules-list input" }] or
// [{ "at": 3000, "set": "#fuse-range", "value": "80" }] to drive a control
// that a bare click cannot work, like a slider.
// The same two marks the background uses, for the same reason: Chrome has no
// "-dev@" id to recognise a dev build by, so the manifest name carries it.
if (
  (typeof api.runtime.id === "string" && api.runtime.id.includes("-dev@")) ||
  api.runtime.getManifest().name.endsWith("(dev)")
) {
  fetch(api.runtime.getURL("dev.json"), { cache: "no-store" })
    .then((r) => r.json())
    .then((dev) => {
      for (const a of dev.uiActions ?? []) {
        setTimeout(() => {
          const selector = a.click ?? a.set;
          const el = document.querySelector(selector);
          if (!el) {
            console.log("[timed-tabs:ui] uiAction: no element for", selector);
            return;
          }
          if (a.set === undefined) {
            el.click();
            return;
          }
          el.value = a.value;
          for (const type of ["input", "change"]) {
            el.dispatchEvent(new Event(type, { bubbles: true }));
          }
        }, a.at ?? 0);
      }
    })
    .catch(() => {});
}
// @dev-only-end
const $ = (id) => document.getElementById(id);

/** An <svg class="icon"> referencing the sprite in panel.html. */
function svgIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

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
    h.textContent = `${g.emoji ? g.emoji + " " : ""}${g.title}`;
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
  renderGroupTabs();
  showGroup(currentGroup());
}

/**
 * Pills on the Settings page that are not settings. Their sections are
 * written in panel.html rather than rendered from FIELDS, and they are shown
 * and hidden by showGroup like any group. Kept out of shared/settings.js,
 * which describes user preferences and nothing else.
 */
const EXTRA_GROUPS = [
  {
    id: "backup",
    emoji: "💾",
    title: "Backup",
    short: "Backup",
    help: "Every setting and every rule as one JSON document, to keep or to restore.",
    onShow: () => showBackup(),
  },
  {
    id: "diagnostics",
    emoji: "🩺",
    title: "Diagnostics",
    short: "Diagnostics",
    help: "What the background is doing for each tab.",
    onShow: () => refreshDiag(),
  },
];
/** Every pill, in order: the settings groups, then the extras. */
const PILLS = [...GROUPS, ...EXTRA_GROUPS];

/** Which group of settings is on show. Remembered like the folds are. */
const GROUP_KEY = "settings-group";
function currentGroup() {
  let stored = null;
  try {
    stored = localStorage.getItem(`ui:${GROUP_KEY}`);
  } catch {
    // Private window or blocked storage: fall back to the first group.
  }
  return PILLS.some((g) => g.id === stored) ? stored : GROUPS[0].id;
}

function showGroup(id) {
  try {
    localStorage.setItem(`ui:${GROUP_KEY}`, id);
  } catch {
    // ignore
  }
  for (const sec of $("fields").querySelectorAll(".group")) {
    sec.hidden = sec.id !== `group-${id}`;
  }
  // An extra refreshes as it comes into view, not on every call: renderFields
  // lands here on any settings change, and refilling the backup box then
  // would throw away text pasted into it but not yet loaded.
  for (const extra of EXTRA_GROUPS) {
    const sec = $(`group-${extra.id}`);
    const on = extra.id === id;
    const arriving = on && sec.hidden;
    sec.hidden = !on;
    if (arriving) extra.onShow();
  }
  for (const pill of $("settings-jump").querySelectorAll("[data-group]")) {
    const on = pill.dataset.group === id;
    pill.classList.toggle("is-selected", on);
    pill.setAttribute("aria-selected", String(on));
    pill.tabIndex = on ? 0 : -1;
  }
}

/**
 * The pills over the settings. They switch which group is shown rather than
 * scrolling to it, so the page is only ever as long as one group. Backup and
 * Diagnostics come last: they are not settings, but they live on this page
 * and are reached the same way.
 */
function renderGroupTabs() {
  const nav = $("settings-jump");
  nav.setAttribute("role", "tablist");
  nav.replaceChildren(
    ...PILLS.map((g) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "jump-pill";
      pill.dataset.group = g.id;
      pill.setAttribute("role", "tab");
      pill.setAttribute("aria-controls", `group-${g.id}`);
      pill.title = g.help;
      pill.textContent = `${g.emoji ? g.emoji + " " : ""}${g.short ?? g.title}`;
      pill.addEventListener("click", () => showGroup(g.id));
      // Arrow keys move between tabs, which is what role="tablist" promises.
      pill.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const at = PILLS.findIndex((x) => x.id === g.id);
        const next = PILLS[(at + step + PILLS.length) % PILLS.length];
        showGroup(next.id);
        nav.querySelector(`[data-group="${next.id}"]`)?.focus();
      });
      return pill;
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
    const sw = makeSwitch(Boolean(value), async (checked) => {
      // A setting that needs an optional permission cannot be switched on
      // without it. `requestPermission` must be reached from this handler
      // with nothing awaited before it, or the browser sees no user gesture.
      if (checked && field.requires && !(await requestPermission(field.requires))) {
        sw.input.checked = false;
        return;
      }
      await save({ [field.key]: checked });
      // Switching notifications on sends one straight away: the quickest way
      // to find out whether the operating system lets them through.
      if (checked && field.key === "notifyOnExpire") {
        const r = await api.runtime.sendMessage({ type: "timed-tabs:notify-test" }).catch((e) => ({ ok: false, error: String(e) }));
        if (r && !r.ok) console.warn("[timed-tabs] test notification failed:", r.error);
      }
    });
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
  } else if (field.type === "percent" && field.slider) {
    const range = document.createElement("input");
    range.type = "range";
    range.min = String(field.min ?? 0);
    range.max = String(field.max ?? 100);
    range.step = "1";
    range.value = String(value);
    range.id = `f-${field.key}`;
    label.htmlFor = range.id;
    const out = document.createElement("output");
    out.className = "field-suffix field-readout";
    out.setAttribute("for", range.id);
    const show = () => {
      out.textContent = `${range.value}%`;
    };
    show();
    // Follow the thumb while dragging, but only write once it is let go.
    range.addEventListener("input", show);
    range.addEventListener("change", () => save({ [field.key]: Number(range.value) }));
    control.append(range, out);
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
  } else if (field.type === "flags") {
    // One row per flag, the same shape as the indicator list.
    row.classList.add("field-group");
    control.remove();
    const list = document.createElement("div");
    list.className = "field-group-rows";
    const switches = new Map();
    // A flag that requires another is hidden until that one is on: with the
    // master switch off there is nothing to choose, and a list of greyed-out
    // switches only invites reading. Its own value is kept, so turning the
    // parent back on shows the switches exactly as they were left.
    const syncDependents = () => {
      for (const [id, entry] of switches) {
        const parent = flagRequires(id);
        entry.row.hidden = Boolean(parent) && !flagOn(settings, parent);
      }
    };
    for (const flag of FLAGS) {
      const sw = makeSwitch(value?.[flag.id] === true, async (checked) => {
        await save({ featureFlags: { ...settings.featureFlags, [flag.id]: checked } });
        syncDependents();
        markSaved(sub);
      });
      sw.input.id = `f-flag-${flag.id}`;
      const sub = settingRow(flag.label, flag.help, sw.el);
      sub.querySelector(".field-label").htmlFor = sw.input.id;
      if (flag.requires) sub.classList.add("flag-dependent");
      switches.set(flag.id, { input: sw.input, row: sub });
      list.append(sub);
    }
    syncDependents();
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

/**
 * Reflect the master switch on the body, which is what hides the readouts and
 * shows the banner. Doing it with a data attribute rather than the `hidden`
 * attribute keeps it clear of the show/hide the popup and the pages already do.
 */
function applyManagementState() {
  document.body.dataset.managing = settings.tabManagement === false ? "off" : "on";
}

// ---- Saying whether it worked ----------------------------------------------
// An outcome with no natural home on the page goes to a toast: a success
// fades, a failure stays until it is dismissed. A rule card or a per-tab
// control keeps its "Saved" tick instead, since that sits on the thing that
// changed, which a message at the bottom of the window cannot do.

// The popup is 320px wide and only as tall as its content, so a pile deep
// enough for the full page would cover most of it.
const toasts = mountToasts(document.body, isPopup ? { max: 2 } : {});

/** The label of a settings field, for naming what was just saved. */
function fieldLabel(key) {
  return FIELDS.find((f) => f.key === key)?.label ?? key;
}

/** What a rejected write left behind, in a form worth showing a user. */
function reasonFor(err) {
  const text = err?.message ?? String(err ?? "");
  return text.replace(/^Error:\s*/, "").trim();
}

/**
 * Run a write and say whether it landed. Returns true on success; on failure
 * it reports and answers false, so the caller can put back what is really in
 * storage rather than leaving a value on screen that was never stored.
 *
 * `note` is what the toast can promise about the damage. One `set` either
 * happened or did not, so the default is safe; a caller writing in several
 * steps has to say something less certain.
 */
async function write(run, { what, key = null, note = "Nothing was changed." }) {
  try {
    await run();
    return true;
  } catch (err) {
    console.warn(`[timed-tabs] could not save ${what}:`, err);
    const reason = reasonFor(err);
    toasts.error(
      `Could not save ${what}`,
      [reason, note].filter(Boolean).join(" "),
      key ? `save:${key}` : null,
    );
    return false;
  }
}

async function save(partial) {
  const keys = Object.keys(partial);
  const what =
    keys.length === 1 ? `“${fieldLabel(keys[0])}”` : `${keys.length} settings`;
  const ok = await write(() => saveSettings(partial), {
    what,
    key: keys.length === 1 ? keys[0] : "settings",
  });
  if (!ok) {
    // The write did not land, so the controls are showing something storage
    // does not have. Put them back to what is really there.
    settings = await getSettings().catch(() => settings);
    renderFields();
    return false;
  }
  settings = { ...settings, ...partial };
  if ("tabManagement" in partial) applyManagementState();
  // A flag can show or hide whole sections; the rules page depends on site-groups.
  if ("featureFlags" in partial) renderFlagged();
  updateFieldVisibility();
  toasts.success("Saved", what, keys.length === 1 ? keys[0] : "settings");
  if (isPopup) refreshTab();
  if ($("overview").open) refreshOverview();
  return true;
}

/**
 * Inline confirmation on the row whose value has just been written to storage.
 *
 * A settings row says nothing, because `save` has already raised a toast
 * naming the setting. Everywhere else the tick stays: on a rule card or a
 * per-tab control it sits on the thing that changed, which a message at the
 * bottom of the window cannot do.
 */
function markSaved(el, container = null) {
  if (!el) return;
  if ($("fields").contains(el)) return;
  container ??= el.querySelector(":scope > .field-control") ?? el;
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

/** Fold or unfold a popup section, remembered on the tab until it closes. */
function setSectionFold(section, open, persist = true) {
  const el = $(`tab-${section}`);
  const toggle = $(`tab-${section}-toggle`);
  if (!el || !toggle) return;
  el.classList.toggle("is-collapsed", !open);
  toggle.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  const what = section === "settings" ? "page settings" : "rules for this page";
  toggle.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} ${what}`);
  if (persist) tabAction("fold", { section, open });
}

for (const section of ["settings", "rules"]) {
  const flip = () => setSectionFold(section, $(`tab-${section}`).classList.contains("is-collapsed"));
  $(`tab-${section}-toggle`).addEventListener("click", flip);
  document.querySelector(`.settings-title[data-toggles="tab-${section}"]`)?.addEventListener("click", flip);
}

function renderTab() {
  // What this tab actually does, rules and overrides included; the globals
  // only until the background has answered for it.
  const eff = tabState?.effective ?? settings;
  const hideTimer = Boolean(eff.pauseWhileActive && eff.resetOnActivate);
  $("tab").hidden = hideTimer;
  $("tab-paused").hidden = !hideTimer;
  if (!currentTab || !tabState) return;

  $("act-never").checked = tabState.neverExpire;
  $("act-never-paused").checked = tabState.neverExpire;
  $("act-ignore").checked = Boolean(tabState.ignoreRules);
  // The sections the user folded away on this tab stay folded.
  for (const section of ["settings", "rules"]) {
    setSectionFold(section, tabState.folds?.[section] !== false, false);
  }
  // The rules section only appears when a rule matches this page, or rules are already ignored.
  $("tab-rules").hidden = !currentTab;
  renderTabRules();
  renderTabSettings();
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
  // The count in the heading says it all; with none, the section is just the heading.
  $("tab-rules-count").textContent = String(matched.length);
  $("tab-rules-count").classList.toggle("is-zero", !matched.length);
  $("act-ignore-wrap").hidden = !matched.length;
  $("tab-rules-note").hidden = !matched.length;
  if (!matched.length) {
    list.replaceChildren();
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
      // The row is the switch (it borrows makeSwitch's parts below), so the
      // tooltip belongs on it; sw.el itself is never inserted.
      row.title = allOff
        ? "All rules are ignored for this tab"
        : r.ignored
          ? "Apply this rule again"
          : "Ignore this rule for this tab";
      row.classList.add("tab-rule-switch");
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

// ---- Page settings ---------------------------------------------------------

/**
 * Settings that are details of another one. They say nothing without the
 * setting they qualify, so a rule touching one is not reason enough to list it
 * here; the rule card below prints what it sets.
 */
const DEPENDENT_SETTINGS = new Set([
  "flashLeadSeconds",
  "quietUntilPercent",
  "faviconStyle",
]);

/**
 * Always listed, whatever they are set to. How long this tab has and whether
 * looking at it starts that over are the two questions the popup exists to
 * answer.
 */
const ALWAYS_SHOWN = new Set(["tabLifetimeSeconds", "resetOnActivate"]);

/**
 * Which of the eleven per-tab settings the popup lists.
 *
 * It used to render all of them and hide whatever sat at its default behind
 * "Show more", so the section opened with more concealed than shown -- and the
 * test for "doing something" was the value's truthiness, which buried any
 * setting a rule had switched *off*: a rule setting `flashBeforeExpiry: false`
 * read as untouched. The list is now what something actually changed on this
 * page, plus the two questions above. Everything else is a default, and
 * defaults belong on the settings page.
 */
function belongsInPageSettings(key, entry) {
  if (ALWAYS_SHOWN.has(key)) return true;
  if (DEPENDENT_SETTINGS.has(key)) return false;
  return entry?.from !== "global";
}

/** The tab's own layer: explicit overrides, plus the two older per-tab switches. */
function tabOverrides() {
  const out = { ...(tabState?.overrides ?? {}) };
  if (tabState?.neverExpire && !("neverExpire" in out)) out.neverExpire = true;
  if (
    tabState?.resetOnActivate !== null &&
    tabState?.resetOnActivate !== undefined &&
    !("resetOnActivate" in out)
  ) {
    out.resetOnActivate = tabState.resetOnActivate;
  }
  return out;
}

/**
 * The one marker a row still carries: this tab has taken the setting over.
 *
 * A rule is no longer badged. Naming it here cost the label its width -- the
 * row read "Lifetim" beside a pill spelling out the rule -- and said a third
 * time what the rule card below already prints in full. The rule's name rides
 * in the row's tooltip instead, where it takes no space.
 */
function thisTabBadge(onClear) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "setting-source is-tab";
  el.textContent = "this tab";
  el.title = "Set on this tab, until it closes. Click to hand it back to the rules and your defaults.";
  el.addEventListener("click", onClear);
  return el;
}

/** How a rule that changed a value names itself, for the row's tooltip. */
function ruleSourceText(entry) {
  const r = entry.rule;
  const name = r?.description || r?.pattern || "a rule";
  return `Set by ${name}${r?.priority !== undefined ? ` (priority ${r.priority})` : ""}.`;
}

/**
 * Which settings the popup lists for this tab. The set only grows while the
 * popup is open: a row that appeared because a rule or this tab set something
 * stays put when that is handed back, so nothing jumps under the pointer.
 */
let pageSettingsKeys = null;

function renderTabSettings() {
  const section = $("tab-settings");
  if (!tabState || !settings || !featureOn(settings, "mini-ui-page-settings")) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const overrides = tabOverrides();
  const explained = explainSettings(settings, tabState.rules ?? [], overrides);

  // The row's checkbox means "this tab sets this". Off, it shows what the
  // rules and globals would give, which is exactly `explained` without the
  // tab layer -- so base() reads from a second pass with no overrides.
  const inherited = explainSettings(settings, tabState.rules ?? [], {});
  const store = {
    set: { ...(tabState.overrides ?? {}) },
    base: (key) => inherited[key]?.value,
    commit: async (next) => {
      const before = tabState.overrides ?? {};
      const keys = new Set([...Object.keys(before), ...Object.keys(next)]);
      for (const key of keys) {
        if (before[key] === next[key]) continue;
        await tabAction("override", { key, value: key in next ? next[key] : null });
      }
    },
  };

  const allDefs = defsFor(RULE_FIELDS, THIS_TAB_SUBJECT);
  const wanted = allDefs.filter((def) => belongsInPageSettings(def.key, explained[def.key])).map((d) => d.key);
  pageSettingsKeys ??= new Set();
  for (const k of wanted) pageSettingsKeys.add(k);
  const defs = allDefs.filter((def) => pageSettingsKeys.has(def.key));

  const list = $("tab-settings-list");
  const existing = new Map([...list.querySelectorAll(".override")].map((el) => [el.dataset.key, el]));
  const sameRows = defs.length === existing.size && defs.every((d) => existing.has(d.key));

  const decorate = (row, def) => {
    const entry = explained[def.key];
    // Which rule won is the row's tooltip; otherwise the help text is.
    row.title = entry.from === "rule" ? ruleSourceText(entry) : (def.help ?? "");
    // The "this tab" pill lives beside the label, so the value column keeps
    // its place whether or not the tab has taken the setting over.
    const label = row.querySelector(".field-label");
    label?.querySelector(".setting-source")?.remove();
    if (entry.from === "tab") {
      // neverExpire and resetOnActivate live in the tab's own state, not in
      // the overrides map; undoing them goes through their own actions.
      const legacy = !(def.key in (tabState.overrides ?? {}));
      const undo = legacy
        ? () => tabAction(def.key, def.key === "neverExpire" ? false : null)
        : () => tabAction("override", { key: def.key, value: null });
      // In the popup the marker is a dot before the label, not a text pill:
      // a 300px row has no room for both a label and "this tab".
      const badge = thisTabBadge(undo);
      badge.classList.add("is-dot");
      badge.setAttribute("aria-label", "Set on this tab. Click to hand it back to the rules and your defaults.");
      label?.prepend(badge);
    }
  };

  if (sameRows) {
    // Same rows as before: refresh each in place. No rebuild, no flicker, and
    // a control being edited is left alone.
    for (const def of defs) {
      const row = existing.get(def.key);
      const isOn = def.key in store.set;
      const value = isOn ? store.set[def.key] : (inherited[def.key]?.value ?? (def.type === "toggle" ? false : undefined));
      row.override?.refresh(isOn, value);
      if (!row.contains(document.activeElement)) decorate(row, def);
    }
  } else {
    if (list.contains(document.activeElement)) return;
    list.replaceChildren(
      ...defs.map((def) => {
        // No onChanged: the commit goes through tabAction, which re-renders.
        const row = renderOverride(def, store, () => {}, { adopt: true, compact: true });
        decorate(row, def);
        return row;
      }),
    );
  }

  $("tab-settings-clear").hidden = Object.keys(overrides).length === 0;
}

$("tab-settings-clear").addEventListener("click", async () => {
  await tabAction("clearOverrides");
  renderTabSettings();
});

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
  if (def?.type === "percent") return `${v}%`;
  if (def?.type === "indicators") {
    const names = (Array.isArray(v) ? v : []).map((id) => indicators.find((i) => i.id === id)?.label ?? id);
    return names.length ? names.join(", ") : "nothing";
  }
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
    time.replaceChildren(svgIcon("infinity"));
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

  // A drag owns the fuse until it is let go, so the tick must not fight it.
  if (fuseDrag === null) paintFuse(exempt ? 0 : progress * 100);
  setFuseEnabled(!exempt);
  $("act-reset").disabled = exempt;
  const snooze = $("act-snooze");
  snooze.disabled = exempt;
  // The button shows no words, so the tooltip has to carry both what it is
  // and what it will do.
  const snoozeLabel = exempt
    ? "Snooze (this tab has no timer running)"
    : `Snooze — adds ${formatRemaining(snoozeFor(tabState))}`;
  snooze.title = snoozeLabel;
  snooze.setAttribute("aria-label", snoozeLabel);
}

/**
 * The fuse doubles as a slider: drag it to put this tab's clock wherever you
 * want. The floor is 2% rather than 0 so a drag to the left cannot be mistaken
 * for a reset, while the far right expires the tab on purpose. The control is
 * a real <input type="range"> laid over the ramp, so dragging, the keyboard
 * and ARIA are the browser's job; we only paint what it reports.
 */
const FUSE_MIN_PERCENT = 2;
/** Percent while a drag is in flight, null when the tick owns the fuse again. */
let fuseDrag = null;

function paintFuse(pct) {
  const clamped = Math.min(100, Math.max(0, pct));
  $("fuse-burnt").style.width = `${clamped}%`;
  $("fuse-marker").style.left = `${clamped}%`;
  if (fuseDrag === null) {
    $("fuse-range").value = String(
      Math.round(Math.max(FUSE_MIN_PERCENT, clamped)),
    );
  }
}

function setFuseEnabled(enabled) {
  $("fuse").classList.toggle("is-disabled", !enabled);
  $("fuse-range").disabled = !enabled;
}

/** Show what letting go here would leave, without waiting for the background. */
function previewFuse(pct) {
  paintFuse(pct);
  if (!tabState?.lifetimeSeconds) return;
  $("remaining").textContent = formatRemaining(
    (tabState.lifetimeSeconds * (100 - pct)) / 100,
  );
  $("remaining-note").textContent = "left, when you let go";
}

/** What one press of Snooze will grant this tab, given its own lifetime. */
function snoozeFor(t) {
  return snoozeSeconds(
    t?.effective?.tabLifetimeSeconds ?? settings.tabLifetimeSeconds,
    settings.snoozePercent,
  );
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

function flashTabError() {
  toasts.error(
    "Could not change this tab",
    "Timed Tabs did not answer. Try again.",
    "tab-action",
  );
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

let overviewSeq = 0;
async function refreshOverview() {
  const seq = ++overviewSeq;
  const groups = await api.runtime
    .sendMessage({ type: "timed-tabs:all-tabs" })
    .catch(() => []);
  const list = $("overview-list");
  // A slower earlier request must not paint over a newer one, and a rebuild
  // must not pull an armed Close or a focused control out from under the user.
  if (seq !== overviewSeq) return;
  if (list.querySelector(".is-armed") || list.contains(document.activeElement)) return;
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
    // Order within each window; the windows themselves keep their own order.
    const rows = sortTabs(g.tabs, settings.tabSort).map(renderTabRow);
    if (groups.length === 1) {
      frag.append(...rows);
      return;
    }
    const group = document.createElement("details");
    group.className = "window-group";
    const sum = document.createElement("summary");
    sum.className = "window-title chev";
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

  // Snooze: the one row control that acts instead of toggling, so it says how
  // much it grants rather than whether it is on.
  const snooze = quickToggle(
    "plus",
    false,
    false,
    exempt
      ? "This tab has no timer to snooze"
      : `Snooze: adds ${formatRemaining(snoozeFor(t))}`,
    "qtoggle-snooze",
  );
  snooze.disabled = exempt;
  snooze.removeAttribute("aria-pressed");
  snooze.addEventListener("click", async () => {
    await api.runtime
      .sendMessage({
        type: "timed-tabs:tab-action",
        tabId: t.tabId,
        action: "snooze",
      })
      .catch(() => {});
    refreshOverview();
    if (currentTab?.id === t.tabId) refreshTab();
  });
  row.append(snooze);

  const timer = quickToggle(
    "timer",
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
    "restart",
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
    "close",
    false,
    false,
    "Close this tab",
    "qtoggle-close",
  );
  close.removeAttribute("aria-pressed"); // a plain button, not a toggle
  let armed = null;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    close.classList.remove("is-armed");
    close.replaceChildren(svgIcon("close"));
    close.title = "Close this tab";
    close.setAttribute("aria-label", "Close this tab");
  };
  close.addEventListener("click", async () => {
    if (!armed) {
      close.classList.add("is-armed");
      close.replaceChildren(
        svgIcon("close"),
        document.createTextNode("Close?"),
      );
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

function quickToggle(iconName, pressed, inherited, label, cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `qtoggle ${cls}`;
  if (inherited) b.classList.add("is-inherited");
  b.replaceChildren(svgIcon(iconName));
  b.setAttribute("aria-pressed", String(Boolean(pressed)));
  b.setAttribute("aria-label", label);
  b.title = label;
  return b;
}

function renderSortControl() {
  const select = $("overview-sort");
  if (select.options.length !== TAB_SORTS.length) {
    select.replaceChildren(
      ...TAB_SORTS.map((o) => new Option(o.label, o.id)),
    );
  }
  select.value = settings.tabSort;
}

// `save` persists the choice and redraws the list, so the order survives a
// reload and follows the profile.
$("overview-sort").addEventListener("change", (e) =>
  save({ tabSort: e.target.value }),
);

// The banner's own way back, so the switch is reachable from the popup.
$("off-resume").addEventListener("click", () => save({ tabManagement: true }));

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
  // One row per address; a page that keeps expiring shows a count instead of a pile of rows.
  root.replaceChildren(...groupRecent(list).map(renderRecentRow));
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
  if (item.count > 1) {
    const count = document.createElement("span");
    count.className = "trow-count";
    count.textContent = `×${item.count}`;
    count.title = `Closed ${item.count} times`;
    when.append(count, `last closed ${timeAgo(item.expiredAt)}`);
  } else {
    when.textContent = `closed ${timeAgo(item.expiredAt)}`;
  }
  const url = document.createElement("span");
  url.className = "trow-url";
  url.textContent = item.url;
  url.title = item.url;
  const reopen = document.createElement("button");
  reopen.type = "button";
  reopen.className = "trow-reopen";
  reopen.append(svgIcon("reopen"), document.createTextNode("Reopen"));
  reopen.addEventListener("click", async () => {
    await api.runtime
      .sendMessage({ type: "timed-tabs:recent-reopen", url: item.url })
      .catch(() => {});
    if (isPopup) window.close();
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "qtoggle trow-remove";
  remove.replaceChildren(svgIcon("close"));
  const removeLabel = item.count > 1 ? `Remove all ${item.count} from this list` : "Remove from this list";
  remove.title = removeLabel;
  remove.setAttribute("aria-label", removeLabel);
  remove.addEventListener("click", async () => {
    row.remove();
    await api.runtime
      .sendMessage({ type: "timed-tabs:recent-remove", ids: item.ids ?? [item.id] })
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

// ---- Statistics ------------------------------------------------------------

const statsOn = () => featureOn(settings, "statistics-panel");

/**
 * Show or hide the whole section, which is all the flag does.
 *
 * The counting is not gated and must not be: the background tallies whatever
 * the flag says, so turning it on shows everything that happened while it was
 * off rather than starting from nothing. What the flag decides is whether
 * there is anything here to read.
 *
 * Hiding empties the body too. A `hidden` section keeps its DOM, and leaving
 * the last numbers sitting in it means they are still in the page for anything
 * that reads the document -- and would be what the user saw for an instant on
 * turning the flag back on, before the refresh landed.
 */
function renderStats() {
  const section = $("stats");
  if (!section) return;
  section.hidden = !statsOn();
  if (section.hidden) {
    $("stats-headline").textContent = "";
    $("stats-body").replaceChildren();
    return;
  }
  if (section.open) refreshStats();
}

/**
 * The tally, as tiles and a small chart.
 *
 * Deliberately the plainest rendering in the panel: `summarise` has already
 * decided what every number means, so there is nothing to work out here beyond
 * where to put it. The legend above it earns its place — this is the one list
 * on the page that keeps nothing about any particular tab, and next to
 * "Recently expired", which keeps rather a lot, that is worth saying.
 */
async function refreshStats() {
  // Belt and braces: every caller checks, but the section is polled on a timer
  // and asked to refresh from a few places, and a flag that is off should cost
  // the background no messages at all.
  if (!statsOn()) return;
  const s = await api.runtime.sendMessage({ type: "timed-tabs:stats" }).catch(() => null);
  const body = $("stats-body");
  const headline = $("stats-headline");
  if (!s) {
    headline.textContent = "";
    body.replaceChildren(statsEmpty("Statistics are not available right now."));
    return;
  }
  headline.textContent = s.expired ? s.expired.toLocaleString() : "";
  if (s.empty) {
    body.replaceChildren(statsEmpty("Nothing to count yet. Once a tab runs out of time, this fills in."));
    return;
  }

  const frag = document.createDocumentFragment();
  // The headline and the chart are both about expiries, so both wait until
  // there has been one. Snoozing a tab on your first day should not be met
  // with a bold zero and fourteen empty columns.
  if (s.expired > 0) frag.append(statsHeadline(s), statsChart(s));
  frag.append(statsTiles(s));
  body.replaceChildren(frag);
}

function statsEmpty(text) {
  const p = document.createElement("p");
  p.className = "overview-empty";
  p.textContent = text;
  return p;
}

/** The one number this whole section is about, and what it is made of. */
function statsHeadline(s) {
  const wrap = document.createElement("div");
  wrap.className = "stats-headline";

  const big = document.createElement("p");
  big.className = "stats-big";
  const n = document.createElement("span");
  n.className = "stats-big-number";
  n.textContent = s.expired.toLocaleString();
  const label = document.createElement("span");
  label.className = "stats-big-label";
  label.textContent = s.expired === 1 ? "tab seen off" : "tabs seen off";
  big.append(n, label);

  const parts = [
    [s.closed, "closed"],
    [s.discarded, "unloaded"],
    [s.reloaded, "reloaded"],
  ].filter(([count]) => count > 0);
  wrap.append(big);
  // Only worth a line when it says something the headline did not: one kind of
  // expiry on its own is already the number above.
  if (parts.length > 1) {
    const sub = document.createElement("p");
    sub.className = "stats-sub";
    sub.textContent = parts.map(([count, word]) => `${count.toLocaleString()} ${word}`).join(" · ");
    wrap.append(sub);
  }
  return wrap;
}

/**
 * Expiries per day, oldest on the left. `summarise` returns every day in the
 * window including the empty ones, so the gaps in the chart are real gaps.
 *
 * Drawn rather than charted: a run of `<div>`s with a height each, which needs
 * no library and takes the theme's colours for nothing.
 */
function statsChart(s) {
  const wrap = document.createElement("figure");
  wrap.className = "stats-chart";

  const peak = Math.max(1, ...s.days.map((d) => d.count));
  const bars = document.createElement("div");
  bars.className = "stats-bars";
  for (const day of s.days) {
    const bar = document.createElement("div");
    bar.className = "stats-bar";
    // A day with nothing in it keeps a sliver, so the run of days stays legible
    // as a run of days rather than becoming a gap in the middle of the chart.
    bar.style.setProperty("--h", day.count ? `${Math.max(8, (day.count / peak) * 100)}%` : "2px");
    if (!day.count) bar.classList.add("is-empty");
    bar.title = `${formatDay(day.date)}: ${day.count} ${day.count === 1 ? "tab" : "tabs"}`;
    bars.append(bar);
  }

  const caption = document.createElement("figcaption");
  caption.className = "stats-caption";
  caption.textContent = `Last ${s.days.length} days · busiest ${
    s.busiest ? `${formatDay(s.busiest.date)} with ${s.busiest.count}` : "day yet to come"
  }`;

  wrap.append(bars, caption);
  return wrap;
}

/** The rest of it, one tile each; a tile with nothing to say is left out. */
function statsTiles(s) {
  const tiles = [
    // First because it is the one that lasts: a clear leaves it, and a backup
    // carries it, so after either it may be the only tile here.
    s.killed && {
      value: s.killed.toLocaleString(),
      label: s.killed === 1 ? "tab killed, all time" : "tabs killed, all time",
      note: "kept through a clear and in backups",
    },
    s.snoozes && {
      value: s.snoozes.toLocaleString(),
      label: s.snoozes === 1 ? "snooze" : "snoozes",
      note: s.snoozeSeconds ? `${formatSpan(s.snoozeSeconds)} bought` : "",
    },
    s.resets && {
      value: s.resets.toLocaleString(),
      label: s.resets === 1 ? "timer restarted" : "timers restarted",
    },
    s.peakTabs && {
      value: s.peakTabs.toLocaleString(),
      label: "tabs at once, at most",
      note: s.peakAt ? formatDay(dayKeyOf(s.peakAt)) : "",
    },
    s.expired && {
      value: s.perDay >= 10 ? Math.round(s.perDay).toLocaleString() : s.perDay.toFixed(1),
      label: "a day, on average",
      note: `over ${s.daysTracked} ${s.daysTracked === 1 ? "day" : "days"}`,
    },
  ].filter(Boolean);

  const grid = document.createElement("div");
  grid.className = "stats-tiles";
  for (const t of tiles) {
    const tile = document.createElement("div");
    tile.className = "stats-tile";
    const value = document.createElement("span");
    value.className = "stats-tile-value";
    value.textContent = t.value;
    const label = document.createElement("span");
    label.className = "stats-tile-label";
    label.textContent = t.label;
    tile.append(value, label);
    if (t.note) {
      const note = document.createElement("span");
      note.className = "stats-tile-note";
      note.textContent = t.note;
      tile.append(note);
    }
    grid.append(tile);
  }
  return grid;
}

/** "11 Sep" from a "YYYY-MM-DD" key, in the reader's own locale. */
function formatDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The local day an epoch stamp fell on, so a date reads the way the chart does. */
function dayKeyOf(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

$("stats").addEventListener("toggle", (e) => {
  if (e.target.open) refreshStats();
});
$("stats-clear").addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "timed-tabs:stats-clear" }).catch(() => {});
  refreshStats();
});

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
  // The tab lists poll the background; only while they are on screen.
  clearInterval(overviewTimer);
  overviewTimer = null;
  clearInterval(recentTimer);
  recentTimer = null;
  if (page === "tabs") {
    if ($("overview").open) {
      refreshOverview();
      overviewTimer = setInterval(refreshOverview, 5000);
    }
    if ($("recent").open) refreshRecent();
    if (statsOn() && $("stats").open) refreshStats();
    // Recent list keeps itself fresh while the page is open; the tally rides
    // along on the same beat, since it moves for the same reasons.
    recentTimer = setInterval(() => {
      if ($("recent").open) refreshRecent();
      if (statsOn() && $("stats").open) refreshStats();
    }, 15000);
  } else if (page === "rules") {
    renderRules();
    applyRulesFilter();
  } else if (page === "settings") {
    renderFields();
    // `#backup` was a page of its own once. It still opens the Backup pill,
    // then reads as the Settings page it now is.
    if (location.hash === "#backup") {
      showGroup("backup");
      history.replaceState(null, "", "#settings");
    }
    refreshPermissionWarning();
  }
}

// ---- Rules editor ----------------------------------------------------------

let rules = [];
/** Site groups (shared/groups.js). Needs its own flag and beta features both on. */
let groups = [];
const groupsOn = () => featureOn(settings, "site-groups");
/**
 * The emoji of the settings group a rule field belongs to, so a rule's chips
 * and its override headings read like the Settings page: ⏳ for timing, 🚪 for
 * expiry, 🎨 for appearance. The rule-only timer switch counts as timing.
 */
function fieldEmoji(key) {
  const def = RULE_FIELD_DEFS.find((f) => f.key === key);
  const group = def?.group ?? (key === "neverExpire" ? "timing" : "appearance");
  return GROUPS.find((g) => g.id === group)?.emoji ?? "";
}

const activeGroups = () => (groupsOn() ? groups : []);
/** Rule ids the user has expanded this session (cards start collapsed). */
const expandedRules = new Set();
/**
 * The priority a rule had before its on/off switch zeroed it, so switching it
 * back on restores what the user chose rather than a default. Only for this
 * session: a rule left off is off, and its old priority is not worth storing.
 */
const offPriorities = new Map();
/** What a rule starts at, and what an off rule returns to with nothing remembered. */
const DEFAULT_RULE_PRIORITY = 5;
/** The rule "Add rule" just set up; its card flashes until this is cleared. */
let justAddedRuleId = null;
let justAddedTimer = null;
function markJustAdded(id) {
  clearTimeout(justAddedTimer);
  justAddedRuleId = id;
  justAddedTimer = setTimeout(() => {
    justAddedRuleId = null;
    document.querySelector(".rule.is-just-added")?.classList.remove("is-just-added");
  }, 2600);
}

/** What a rule may override: the global field definitions, reworded for a rule. */
const RULE_FIELD_TEXT = {
  tabLifetimeSeconds: {
    label: "Lifetime",
    help: "How long {tabs} may sit before {they} {expire}.",
  },
  onExpire: {
    label: "When a tab expires",
    short: "On expiry",
    help: "What to do with {tab} once it runs out of time in the background.",
  },
  resetOnActivate: {
    label: "Restart on focus",
    help: "Switching to {tab} gives it a full lifetime again.",
  },
  pauseWhileActive: {
    label: "Count background time only",
    short: "Background time only",
    help: "The clock stops while you are looking at {tab}.",
  },
  neverExpire: {
    label: "Timer off",
    help: "{Tabs} never {expire} and {show} no colour.",
  },
  indicators: {
    label: "Show remaining time with",
    short: "Indicators",
    help: "Only these indicators are used for {tabs}, whatever the global choice.",
  },
  faviconStyle: {
    label: "Favicon colour style",
    short: "Favicon style",
    help: "Where the colour goes on the icon of {tab}.",
  },
  hideWhileGreen: {
    label: "Leave fresh tabs alone",
    short: "Quiet while fresh",
    help: "Show nothing on {tab} until part of its lifetime has passed.",
  },
  quietUntilPercent: {
    label: "Show indicators after",
    short: "Show after",
    help: "The share of the lifetime of {tab} that must pass before anything is shown.",
  },
  flashBeforeExpiry: {
    label: "Flash before expiry",
    help: "{Tabs} {blink} during the last stretch before {they} {run} out of time.",
  },
  flashLeadSeconds: {
    label: "Start flashing",
    help: "How long before expiry {tab} starts flashing.",
  },
};
/** Help text placeholders, worded for the tabs a rule matches. */
/**
 * Help text is written once with {placeholders} and read in two places: a
 * rule, which speaks about every page it matches, and Page settings, which
 * speaks about the tab in front of you.
 */
const SUBJECT = { tabs: "matching tabs", Tabs: "Matching tabs", tab: "a matching tab", they: "they", expire: "expire", show: "show", blink: "blink", run: "run" };
const THIS_TAB_SUBJECT = { tabs: "this tab", Tabs: "This tab", tab: "this tab", they: "it", expire: "expires", show: "shows", blink: "blinks", run: "runs" };
const wordFor = (text, subject = SUBJECT) =>
  text.replace(/\{(\w+)\}/g, (_, k) => subject[k] ?? k);
const RULE_FIELD_DEFS = RULE_FIELDS.map((key) => {
  const base = FIELDS.find((f) => f.key === key) ?? { key, type: "toggle" };
  return { ...base, ...RULE_FIELD_TEXT[key] };
});
const defsFor = (keys, subject = SUBJECT) =>
  keys
    .map((k) => RULE_FIELD_DEFS.find((d) => d.key === k))
    .map((d) => ({ ...d, help: wordFor(d.help ?? "", subject) }));

/** What a brand-new rule starts with, so the scheme is explicit from the first keystroke. */
const NEW_RULE_PATTERN = "https://";

/** A rule with no usable pattern: blank, the untouched new-rule stub, or a host-less "/*" left over from a bad add. */
function isEmptyRule(r) {
  const p = (r.pattern ?? "").trim();
  return p === "" || p === "/*" || p === "@" || p === NEW_RULE_PATTERN;
}

/** Rules in display order: alphabetical by pattern, with the ones still being typed first. */
function sortedRules() {
  return [...rules].sort((a, b) => {
    const ea = isEmptyRule(a);
    const eb = isEmptyRule(b);
    if (ea !== eb) return ea ? -1 : 1;
    return a.pattern.localeCompare(b.pattern, undefined, { sensitivity: "base" });
  });
}

/** "Site group “news”, 4 sites" or why the rule currently matches nothing. */
function describeGroupTarget(rule) {
  const name = groupNameOf(rule.pattern);
  if (!groupsOn()) return `Targets site group “${name}”, but site groups are off in Settings → Feature flags, so this rule matches nothing`;
  const g = findGroup(groups, name);
  if (!g) return `Targets site group “${name}”, which does not exist, so this rule matches nothing`;
  const n = g.patterns.length;
  return `Site group “${g.name}”, ${n} site${n === 1 ? "" : "s"}`;
}

/** Why a group rule currently matches nothing, or null when it is fine. */
function groupTargetProblem(rule) {
  const name = groupNameOf(rule.pattern);
  if (!groupsOn())
    return "Site groups are off in Settings \u2192 Feature flags, so this rule matches nothing";
  if (!findGroup(groups, name))
    return `There is no site group \u201c${name}\u201d, so this rule matches nothing`;
  return null;
}

/**
 * A toggle override worded for a chip. A chip has no room for "Timer off: on",
 * so both readings are written out; every other type reads well enough as
 * "Label: value" and falls through to `ruleFieldLabel`.
 */
const RULE_CHIP_TOGGLE_TEXT = {
  resetOnActivate: { on: "Restarts on focus", off: "No restart on focus" },
  pauseWhileActive: { on: "Background time only", off: "Counts time while active" },
  neverExpire: { on: "Timer off", off: "Timer on" },
  hideWhileGreen: { on: "Leaves fresh tabs alone", off: "Shows from the start" },
  flashBeforeExpiry: { on: "Flashes before expiry", off: "No flash" },
};

/** Field labels that are sentences; a chip has no room for them. */
const RULE_CHIP_LABEL = {
  onExpire: "On expiry",
  indicators: "Shows with",
  faviconStyle: "Favicon",
  quietUntilPercent: "Shows after",
  flashLeadSeconds: "Flash lead",
};

function ruleChipText(key, value) {
  const pair = RULE_CHIP_TOGGLE_TEXT[key];
  if (pair) return value ? pair.on : pair.off;
  const label = RULE_CHIP_LABEL[key] ?? ruleFieldLabel(key);
  return `${label}: ${formatRuleValue(key, value)}`;
}

/** Group ids expanded this session. New groups start open. */
const expandedGroups = new Set();
let groupsSaving = false;

async function persistGroups() {
  groupsSaving = true;
  const ok = await write(() => saveGroups(groups), {
    what: "the site groups",
    key: "groups",
  });
  if (!ok) groups = await getGroups().catch(() => groups);
  groupsSaving = false;
  return ok;
}

function renderGroups() {
  const section = $("site-groups");
  if (!section) return;
  section.hidden = !groupsOn();
  if (section.hidden) return;
  const list = $("groups-list");
  if (!groups.length) {
    const p = document.createElement("p");
    p.className = "rules-empty";
    p.textContent = "No groups yet. Add one, list the sites it covers, then point a rule at it.";
    list.replaceChildren(p);
    return;
  }
  const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  list.replaceChildren(...sorted.map(renderGroup));
}

function renderGroup(group) {
  const el = document.createElement("div");
  el.className = "rule group";
  el.dataset.groupId = group.id;
  const open = expandedGroups.has(group.id);
  el.classList.toggle("is-collapsed", !open);
  const users = rulesUsingGroup(rules, group);

  const head = document.createElement("div");
  head.className = "rule-head";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "rule-toggle chev";
  toggle.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Collapse group" : "Expand group");
  toggle.addEventListener("click", () => {
    if (expandedGroups.has(group.id)) expandedGroups.delete(group.id);
    else expandedGroups.add(group.id);
    renderGroups();
  });
  const name = document.createElement("input");
  name.className = "group-name";
  name.value = group.name;
  name.placeholder = "Group name, e.g. news";
  name.setAttribute("aria-label", "Group name");
  name.addEventListener("change", async () => {
    const next = cleanName(name.value);
    if (!next || next === group.name) {
      name.value = group.name;
      return;
    }
    if (nameTaken(groups, next, group.id)) {
      name.value = group.name;
      name.title = `There is already a group called “${next}”`;
      return;
    }
    // Renaming repoints every rule that used the old name.
    const out = renameGroup(groups, rules, group.id, next);
    groups = out.groups;
    rules = out.rules;
    await persistGroups();
    await persistRules(false);
    renderGroups();
    renderRules();
    markSaved(head, head);
  });
  const del = document.createElement("button");
  del.type = "button";
  del.className = "rule-delete quiet";
  del.replaceChildren(svgIcon("trash"), document.createTextNode("Delete group"));
  if (users.length) {
    del.disabled = true;
    del.title = `Used by ${users.length} rule${users.length === 1 ? "" : "s"}. Point them elsewhere first.`;
  }
  let armed = null;
  del.addEventListener("click", async () => {
    if (!armed) {
      del.replaceChildren(svgIcon("trash"), document.createTextNode("Click again to delete"));
      del.classList.add("is-armed");
      armed = setTimeout(() => {
        armed = null;
        del.replaceChildren(svgIcon("trash"), document.createTextNode("Delete group"));
        del.classList.remove("is-armed");
      }, 4000);
      return;
    }
    clearTimeout(armed);
    groups = groups.filter((g) => g.id !== group.id);
    await persistGroups();
    renderGroups();
    renderRules();
  });
  head.append(toggle, name, del);
  el.append(head);

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "rule-summary";
  const n = group.patterns.length;
  summary.textContent = `${n} site${n === 1 ? "" : "s"} — ${users.length ? `used by ${users.length} rule${users.length === 1 ? "" : "s"}` : "not used by any rule yet"}`;
  summary.title = "Expand group";
  summary.addEventListener("click", () => {
    expandedGroups.add(group.id);
    renderGroups();
  });
  el.append(summary);

  const body = document.createElement("div");
  body.className = "rule-body";
  const patterns = document.createElement("textarea");
  patterns.className = "group-patterns";
  patterns.rows = Math.max(4, group.patterns.length + 1);
  patterns.value = group.patterns.join("\n");
  patterns.placeholder = "One address pattern per line, e.g.\n*.nytimes.com/*\nbbc.co.uk/*";
  patterns.setAttribute("aria-label", `Sites in group ${group.name}`);
  patterns.spellcheck = false;
  patterns.addEventListener("change", async () => {
    const next = cleanPatterns(patterns.value);
    groups = groups.map((g) => (g.id === group.id ? { ...g, patterns: next } : g));
    await persistGroups();
    renderGroups();
    renderRules();
    markSaved(head, head);
  });
  const meta = document.createElement("p");
  meta.className = "group-meta";
  meta.textContent = users.length
    ? `Rules that use this group: ${users.map((r) => r.description || groupRef(group.name)).join(", ")}. Point a rule at “Group: ${group.name}” in its target picker.`
    : `No rule uses this group yet. Pick “Group: ${group.name}” as a rule's target to apply it.`;
  body.append(patterns, meta);
  el.append(body);
  return el;
}

$("group-add")?.addEventListener("click", async () => {
  let name = "New group";
  for (let i = 2; nameTaken(groups, name); i++) name = `New group ${i}`;
  const g = newGroup({ name, patterns: [] });
  groups = [...groups, g];
  expandedGroups.add(g.id);
  await persistGroups();
  renderGroups();
  const card = $("groups-list").querySelector(`[data-group-id="${CSS.escape(g.id)}"]`);
  card?.scrollIntoView({ block: "start", behavior: "smooth" });
  const input = card?.querySelector(".group-name");
  if (input) {
    input.focus();
    input.select();
  }
});

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
      "No rules yet. Add one here, or open “Make / edit rules for this page” from the popup.";
    list.replaceChildren(p);
    return;
  }
  list.replaceChildren(...sortedRules().map(renderRule));
  if ($("rules-filter").value.trim()) applyRulesFilter();
}

/**
 * Wrap a pattern input so its text is drawn by a mirror span behind it, with
 * every "*" in its own colour. An input cannot colour part of its value, so
 * the input's own text is transparent and only its caret and selection show.
 */
function mirrorWildcards(input) {
  const wrap = document.createElement("span");
  wrap.className = "rule-pattern-wrap";
  const mirror = document.createElement("span");
  mirror.className = "rule-pattern-mirror";
  mirror.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  mirror.append(text);
  const paint = () => {
    text.replaceChildren(
      ...input.value.split(/(\*)/).filter(Boolean).map((part) => {
        const s = document.createElement("span");
        if (part === "*") s.className = "wildcard";
        s.textContent = part;
        return s;
      }),
    );
    text.style.marginLeft = `-${input.scrollLeft}px`;
  };
  input.addEventListener("input", paint);
  input.addEventListener("scroll", paint);
  input.addEventListener("blur", paint);
  paint();
  wrap.append(mirror, input);
  return wrap;
}

/**
 * Delete, armed by the first click and fired by the second. The head row has
 * no room for a worded button, so it is an icon that grows the word only once
 * armed; an icon on its own cannot say "armed".
 */
function ruleDeleteButton(rule) {
  const del = document.createElement("button");
  del.type = "button";
  del.className = "rule-delete quiet icon-btn";
  const rest = () => {
    del.replaceChildren(svgIcon("trash"));
    del.title = "Delete rule";
    del.setAttribute("aria-label", "Delete rule");
    del.classList.remove("is-armed");
  };
  rest();
  let armed = null;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    rest();
  };
  del.addEventListener("click", () => {
    if (!armed) {
      del.replaceChildren(svgIcon("trash"), document.createTextNode("Click again"));
      del.title = "Click again to delete this rule";
      del.setAttribute("aria-label", "Click again to delete this rule");
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
  return del;
}

/**
 * The head of a rule card. Both displays carry the expand toggle, the target
 * picker and the pattern; the new one adds the priority badge, the group size
 * and the on/off switch, which is what turns the card into a row that can be
 * read without opening it.
 */
function ruleHead(rule, el, targetsGroup, open) {
  const head = document.createElement("div");
  head.className = "rule-head";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "rule-toggle chev";
  toggle.classList.toggle("is-open", open);
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
  const patternWrap = mirrorWildcards(pattern);
  // Hidden only when the picker below stands in for it: with site groups
  // off there is no picker, and the field is the one way to retarget the rule.
  patternWrap.hidden = targetsGroup && groupsOn();

  // With site groups on, the head gets a picker: an address, or one of the groups.
  let target = null;
  if (groupsOn()) {
    target = document.createElement("select");
    target.className = "rule-target";
    target.setAttribute("aria-label", "What this rule applies to");
    // A target carries the same mark as the rest of the UI: 🔗 for an
    // address, 🗂️ for a site group (its page heading's emoji).
    target.add(new Option("🔗 Address", ""));
    for (const g of groups) target.add(new Option(`🗂️ ${g.name}`, groupRef(g.name)));
    const current = targetsGroup ? groupRef(groupNameOf(rule.pattern)) : "";
    if (targetsGroup && !findGroup(groups, groupNameOf(rule.pattern))) {
      const missing = groupNameOf(rule.pattern);
      target.add(new Option(`🗂️ ${missing} (missing)`, current));
    }
    target.value = current;
    target.addEventListener("change", () => {
      const next = target.value || NEW_RULE_PATTERN;
      updateRule(rule.id, { pattern: next, match: "wildcard" }, true, "head");
    });
  }

  // Priority decides which rule wins, and the list is ordered by pattern
  // rather than by it, so it has to be readable without opening a card.
  const prio = document.createElement("button");
  prio.type = "button";
  prio.className = "rule-priority";
  prio.textContent = rule.priority === 0 ? "off" : String(rule.priority);
  prio.title =
    rule.priority === 0
      ? "Priority 0: this rule is switched off. Click to change it."
      : `Priority ${rule.priority}: when two rules disagree, the higher number wins. Click to change it.`;
  prio.setAttribute("aria-label", prio.title);
  prio.addEventListener("click", () => {
    setRuleExpanded(rule.id, true);
    el.querySelector('[data-row-key="priority"] input')?.focus();
  });

  // A group rule hides the pattern box, so the head says how big the group is
  // in its place; without it the row would be a bare picker.
  let groupCount = null;
  if (targetsGroup) {
    groupCount = document.createElement("span");
    groupCount.className = "rule-group-count";
    const g = groupsOn() ? findGroup(groups, groupNameOf(rule.pattern)) : null;
    const n = g?.patterns.length ?? 0;
    groupCount.textContent = g ? `${n} site${n === 1 ? "" : "s"}` : "matches nothing";
    groupCount.classList.toggle("is-problem", !g);
  }

  // Switching a rule off is zeroing its priority; the switch says so without
  // making the user find the number field first.
  const enabled = rule.priority > 0;
  const enable = makeSwitch(enabled, (on) => {
    if (!on) offPriorities.set(rule.id, rule.priority);
    const next = on ? (offPriorities.get(rule.id) || DEFAULT_RULE_PRIORITY) : 0;
    updateRule(rule.id, { priority: next }, true, "head");
  });
  enable.el.classList.add("rule-enable");
  enable.el.title = enabled
    ? "On. Switch off to park the rule without deleting it."
    : "Off (priority 0). Switch on to use it again.";
  enable.input.setAttribute("aria-label", "Rule on");

  head.append(
    toggle,
    prio,
    ...(target ? [target] : []),
    patternWrap,
    ...(groupCount ? [groupCount] : []),
    enable.el,
    ruleDeleteButton(rule),
  );
  return head;
}

/**
 * What a collapsed card says: what the rule is for, then a chip per setting it
 * changes, which is what makes a page of rules readable at a glance.
 */
function ruleSummary(rule, targetsGroup) {
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "rule-summary";
  summary.title = "Expand rule";
  summary.addEventListener("click", () => setRuleExpanded(rule.id, true));

  const meta = document.createElement("span");
  meta.className = "rule-meta";
  const metaParts = [];
  if (isEmptyRule(rule)) metaParts.push("No pattern yet, so this rule matches nothing");
  const problem = targetsGroup ? groupTargetProblem(rule) : null;
  if (problem) metaParts.push(problem);
  if (rule.description) metaParts.push(rule.description);
  if (!targetsGroup) metaParts.push(rule.match === "prefix" ? "starts with" : "wildcard");
  meta.textContent = metaParts.join(" \u00b7 ");
  meta.hidden = !metaParts.length;
  summary.append(meta);

  const chips = document.createElement("span");
  chips.className = "rule-chips";
  const sets = Object.entries(rule.set ?? {});
  if (!sets.length) {
    const none = document.createElement("span");
    none.className = "rule-chip is-empty";
    none.textContent = "changes nothing yet";
    chips.append(none);
  }
  for (const [k, v] of sets) {
    const chip = document.createElement("span");
    chip.className = "rule-chip";
    const emoji = fieldEmoji(k);
    chip.textContent = emoji ? `${emoji} ${ruleChipText(k, v)}` : ruleChipText(k, v);
    chips.append(chip);
  }
  summary.append(chips);
  return summary;
}

function renderRule(rule) {
  const el = document.createElement("div");
  el.className = "rule";
  el.dataset.ruleId = rule.id;
  el.classList.toggle("is-disabled", rule.priority === 0);

  const open = expandedRules.has(rule.id);
  el.classList.toggle("is-collapsed", !open);
  el.classList.toggle("is-just-added", rule.id === justAddedRuleId);

  const targetsGroup = isGroupRef(rule.pattern);
  el.append(ruleHead(rule, el, targetsGroup, open));
  el.append(ruleSummary(rule, targetsGroup));

  const body = document.createElement("div");
  body.className = "rule-body";
  el.append(body);

  if (targetsGroup) {
    const note = document.createElement("p");
    note.className = "rule-group-note";
    note.textContent = describeGroupTarget(rule) + ".";
    body.append(note);
  }

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
  const matchRow = withKey(
    "match",
    settingRow(
      "Match",
      rule.match === "prefix"
        ? "The address must begin with the pattern."
        : "The whole address must fit the pattern. * stands for anything.",
      match,
    ),
  );
  // A group's entries are always wildcards, so the mode has nothing to say.
  matchRow.hidden = targetsGroup;
  body.append(matchRow);

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

  const store = {
    get set() {
      return rules.find((r) => r.id === rule.id)?.set ?? {};
    },
    base: (key) => settings[key],
    commit: (set) => updateRule(rule.id, { set }, false),
  };
  body.append(
    renderOverrideGroup("⏳ Timer settings this rule changes", defsFor(RULE_TIMING_FIELDS), store),
    renderOverrideGroup("🎨 How matching tabs look", defsFor(RULE_VISUAL_FIELDS), store),
  );
  return el;
}

/**
 * A titled block of override rows. `store` is { set, base(key), commit(set) }:
 * the current overrides, the value shown while a row is off, and how to save.
 * Rows whose `showWhen` fails against the layered settings are hidden, so a
 * dependent option (flash lead, favicon style) only appears once its parent is on.
 */
function renderOverrideGroup(title, defs, store) {
  const group = document.createElement("div");
  group.className = "rule-overrides";
  const heading = document.createElement("p");
  heading.className = "rule-overrides-title";
  heading.textContent = title;
  group.append(heading);
  const rows = defs.map((def) => [def, renderOverride(def, store, () => applyVisibility())]);
  const applyVisibility = () => {
    const layered = { ...settings, ...store.set };
    for (const key of RULE_VISUAL_FIELDS) if (key in store.set) layered[key] = store.set[key];
    for (const [def, row] of rows) row.hidden = Boolean(def.showWhen && !def.showWhen(layered));
  };
  for (const [, row] of rows) group.append(row);
  applyVisibility();
  return group;
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
  t.classList.toggle("is-open", open);
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
  const text = document.createElement("span");
  text.className = "field-label-text";
  text.textContent = labelText;
  label.append(text);
  if (helpText) {
    const help = document.createElement("span");
    help.className = "field-help";
    help.textContent = helpText;
    label.append(help);
  }
  const ctl = document.createElement("div");
  ctl.className = "field-control";
  if (control) {
    ctl.append(control);
    // The label element is not associated with these controls (they are
    // built apart from it), so each one that has no name yet takes the row's.
    const inputs = control.matches?.("input,select,textarea") ? [control] : [...control.querySelectorAll("input,select,textarea")];
    for (const c of inputs) {
      if (!c.hasAttribute("aria-label") && !c.id) c.setAttribute("aria-label", labelText);
    }
  }
  row.append(label, ctl);
  return row;
}

function renderOverride(def, store, onChanged = () => {}, opts = {}) {
  const isOn = def.key in store.set;

  const on = document.createElement("input");
  on.type = "checkbox";
  on.checked = isOn;
  on.setAttribute("aria-label", `Change ${def.label}`);

  const control = document.createElement("span");
  control.className = "override-control";
  const current = isOn ? store.set[def.key] : (store.base(def.key) ?? (def.type === "toggle" ? false : undefined));

  let read;
  let setValue; // show a value without committing it; used to refresh a row in place
  let stacked = false;
  if (def.type === "toggle") {
    const sw = makeSwitch(Boolean(current), () => commit(true));
    control.append(sw.el);
    read = () => sw.input.checked;
    setValue = (v) => (sw.input.checked = Boolean(v));
  } else if (def.type === "choice") {
    const select = document.createElement("select");
    for (const opt of def.options) select.add(new Option(opt.label, opt.value));
    select.value = current ?? def.options[0].value;
    select.addEventListener("change", () => commit(true));
    control.append(select);
    read = () => select.value;
    setValue = (v) => (select.value = v ?? def.options[0].value);
  } else if (def.type === "percent") {
    const num = document.createElement("input");
    num.type = "number";
    num.min = String(def.min ?? 0);
    num.max = String(def.max ?? 100);
    num.step = "1";
    num.value = String(current ?? 40);
    num.addEventListener("change", () => commit(true));
    const suffix = document.createElement("span");
    suffix.className = "field-suffix";
    suffix.textContent = "%";
    control.append(num, suffix);
    read = () => {
      const n = Math.round(Number(num.value));
      const clamped = Number.isFinite(n) ? Math.min(def.max ?? 100, Math.max(def.min ?? 0, n)) : 40;
      num.value = String(clamped);
      return clamped;
    };
    setValue = (v) => (num.value = String(v ?? 40));
  } else if (def.type === "indicators") {
    const chosen = new Set(Array.isArray(current) ? current : []);
    control.classList.add("override-indicators");
    stacked = true;
    for (const ind of indicators) {
      const sw = makeSwitch(chosen.has(ind.id), () => commit(true));
      sw.input.value = ind.id;
      sw.input.disabled = !ind.supported();
      // A span, not a label: makeSwitch already built a label around the input.
      const item = document.createElement("span");
      item.className = "override-indicator";
      item.title = ind.description + (ind.supported() ? "" : " Not available in this browser.");
      const name = document.createElement("span");
      name.textContent = ind.label;
      item.append(sw.el, name);
      control.append(item);
    }
    read = () => [...control.querySelectorAll("input:checked")].map((i) => i.value);
    setValue = (v) => {
      const want = new Set(Array.isArray(v) ? v : []);
      for (const i of control.querySelectorAll("input")) i.checked = want.has(i.value);
    };
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
    num.addEventListener("change", () => commit(true));
    units.addEventListener("change", () => commit(true));
    control.append(num, units);
    read = () =>
      Math.max(def.min ?? 1, Math.round(Number(num.value) * Number(units.value)));
    setValue = (v) => {
      const u = toUnit(v ?? 1800);
      num.value = String(u.value);
      units.value = String(u.unit);
    };
  }

  // `compact`: one line per setting, for the popup. The checkbox is built
  // either way because commit() reads it, but it is not shown -- editing the
  // value is what takes the setting over -- and the help becomes the row's
  // tooltip rather than a sentence under every label.
  const wrap = opts.compact
    ? settingRow(def.short ?? def.label, "", control) // the popup row is one line; long labels get a short form
    : settingRow(def.label, def.help, control, { checkbox: on });
  if (opts.compact && def.help) wrap.title = def.help;
  wrap.classList.add("override");
  wrap.classList.toggle("is-compact", Boolean(opts.compact));
  wrap.classList.toggle("is-on", isOn);
  wrap.classList.toggle("is-stacked", stacked);
  wrap.classList.toggle("is-adopting", Boolean(opts.adopt));
  wrap.dataset.key = def.key;

  const commit = async (fromControl = false) => {
    // `adopt`: touching the value is itself the decision to override, so the
    // row ticks itself rather than quietly discarding what was just typed.
    if (fromControl && opts.adopt && !on.checked) on.checked = true;
    const set = { ...store.set };
    if (on.checked) set[def.key] = read();
    else delete set[def.key];
    wrap.classList.toggle("is-on", on.checked);
    const parent = wrap.parentElement;
    await store.commit(set);
    onChanged();
    // A commit may have rebuilt the list; mark the row that replaced this one.
    const live = wrap.isConnected ? wrap : parent?.querySelector(`.override[data-key="${CSS.escape(def.key)}"]`);
    markSaved(live ?? wrap);
  };
  on.addEventListener("change", commit);

  // For a list that refreshes: bring the row up to date without rebuilding
  // it. Nothing is touched while the user is in one of its controls.
  wrap.override = {
    def,
    refresh(nowOn, value) {
      if (wrap.contains(document.activeElement)) return;
      on.checked = nowOn;
      wrap.classList.toggle("is-on", nowOn);
      setValue(value);
    },
  };
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
  const ok = await write(() => saveRules(rules), {
    what: "the rules",
    key: "rules",
  });
  // Nothing was stored, so what is in memory is an edit that never happened.
  // Redrawing it would leave the page claiming a rule it does not have.
  if (!ok) rules = await getRules().catch(() => rules);
  rulesSaving = false;
  if (rerender || !ok) renderRules();
  if (ok && saved) {
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
  return ok;
}

// Two clicks, like delete. Removes every rule that has no usable pattern.
let removeEmptyArmed = null;
$("rules-remove-empty").addEventListener("click", async () => {
  const b = $("rules-remove-empty");
  if (!removeEmptyArmed) {
    b.replaceChildren(
      svgIcon("trash"),
      document.createTextNode("Click again to remove them"),
    );
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
    pattern ? r.pattern === pattern : isEmptyRule(r),
  );
  let rule = existing;
  if (!rule) {
    rule = newRule({ pattern: pattern || NEW_RULE_PATTERN, priority: DEFAULT_RULE_PRIORITY });
    rules = [...rules, rule];
    expandedRules.add(rule.id);
    // Draw the eye to the card that was just set up for this click; renders
    // triggered by the save keep the mark until it times out.
    markJustAdded(rule.id);
    await persistRules();
  } else {
    markJustAdded(rule.id);
    setRuleExpanded(rule.id, true);
  }
  const card = $("rules-list").querySelector(
    `[data-rule-id="${CSS.escape(rule.id)}"]`,
  );
  if (card) {
    card.classList.remove("is-filtered-out");
    // The expanded card is tall: align its top so the pattern field stays on screen.
    card.scrollIntoView({ block: "start", behavior: "smooth" });
    card.classList.add("is-just-added");
    const input = card.querySelector(".rule-pattern");
    if (input) {
      input.focus();
      // A fresh "https://" stub: park the caret at the end, ready for the host.
      if (!existing && !pattern) input.setSelectionRange(input.value.length, input.value.length);
    }
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
    const hit = rule ? matchesRule(rule, url, activeGroups()) || !rule.pattern.trim() : false;
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
  // Our own save arrives here too, after an extra async hop that outlives
  // the saving flag; what is in memory already matches it.
  if (rulesSaving || JSON.stringify(next) === JSON.stringify(rules)) return;
  rules = next;
  if (!isPopup) renderRules();
  if (isPopup) refreshTab();
});

/**
 * Settings saved by another instance (the full page while the popup is open,
 * or the reverse) arrive here. Anything a flag shows or hides follows at
 * once. A change this instance made itself is already applied, so it is
 * skipped rather than re-rendered under the user's cursor.
 */
watchSettings((next) => {
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  settings = next;
  applyManagementState();
  renderFields();
  // `?group=` picks the Settings group to arrive on -- what the flags note's
  // "Change" uses to send the popup somewhere specific. After renderFields,
  // which otherwise restores the last group looked at.
  const group = params.get("group");
  if (!isPopup && PILLS.some((g) => g.id === group)) showGroup(group);
  renderSortControl();
  renderFlagged();
});

/**
 * Say which beta features are on, and name them.
 *
 * The reason this exists is the question it answers: a flag can change the
 * popup enough that the documentation stops describing it, and there was no
 * way to tell from the screen that a switch was the cause. Naming the features
 * is the whole point, so the note lists them rather than counting them.
 *
 * Nothing is shown when none is on -- the ordinary case, which should cost no
 * space at all -- nor when "Beta features" is on by itself, since the master
 * switch changes nothing you could notice.
 */
function renderFlagsNote() {
  const on = activeFeatures(settings);
  const note = $("flags-note");
  note.hidden = on.length === 0;
  if (!on.length) return;
  // Terse on purpose: this sits above everything else for as long as a flag
  // is on, and the popup has no room to spare. The names are what earn their
  // place; the reason for saying any of it waits in the tooltip.
  const names = on.map((f) => f.label);
  $("flags-note-text").textContent =
    `${names.length === 1 ? "1 beta feature" : `${names.length} beta features`} on: ${names.join(", ")}`;
  note.title =
    "Timed Tabs may not match the user guide while a beta feature is on. Settings \u2192 Feature flags.";
}

/**
 * A small "beta" pill in the header while the "Beta features" switch is on.
 *
 * The note above only speaks when a feature is actually in force, which is
 * right for a note that names things. This badge answers a different
 * question -- is this profile opted into beta at all -- so it reads the
 * master switch itself, and stays up even when nothing under it is on yet.
 * It goes to the switch, so turning it back off is one click away.
 */
function renderBetaBadge() {
  const badge = $("beta-badge");
  const on = flagOn(settings, "beta-features");
  badge.hidden = !on;
  if (!on) return;
  const count = activeFeatures(settings).length;
  badge.title =
    (count === 0
      ? "Beta features is on, with nothing under it switched on yet."
      : `Beta features is on, with ${count === 1 ? "1 feature" : `${count} features`} in force.`) +
    " Timed Tabs may not match the user guide. Click to see the switches.";
}

/** Every part of the UI a feature flag can show or hide. */
function renderFlagged() {
  renderFlagsNote();
  renderBetaBadge();
  if (!isPopup) {
    renderGroups();
    renderRules();
    renderStats();
  }
  if (isPopup) renderTab();
}

watchGroups((next) => {
  if (groupsSaving || JSON.stringify(next) === JSON.stringify(groups)) return;
  groups = next;
  if (!isPopup) {
    renderGroups();
    renderRules();
  }
  if (isPopup) refreshTab();
});

// ---- Backup ----------------------------------------------------------------

const backupText = $("backup-text");

/**
 * Fill the box with everything as it stands, stamped with the build writing
 * it. That stamp is also the restamp: a bundle loaded from an older Timed Tabs
 * is shown again here as this one's, so copying it back out carries this
 * version rather than the one it arrived with.
 *
 * Async only for the version, which is resolved once per page and cached.
 */
async function showBackup() {
  const v = await getDisplayVersion().catch(() => null);
  // The lifetime count of tabs killed rides along; the rest of the tally does
  // not. A background that cannot be reached writes a zero, which a later
  // load can never lower anything with.
  const s = await api.runtime.sendMessage({ type: "timed-tabs:stats" }).catch(() => null);
  backupText.value = exportText(settings, rules, groups, v?.display ?? "", s);
}

/**
 * The outcome of a backup action. It has no row to sit on, so it goes to a
 * toast rather than the small line under the box, where a failure was easy to
 * miss.
 */
function backupNote(text, level = "info") {
  toasts.show({ level, message: text, key: "backup" });
}

$("backup-refresh").addEventListener("click", showBackup);

$("backup-copy").addEventListener("click", async () => {
  await showBackup();
  try {
    await navigator.clipboard.writeText(backupText.value);
    backupNote("Copied.", "success");
  } catch {
    backupText.select();
    backupNote(
      "Could not access the clipboard. The text is selected; press Ctrl/Cmd+C.",
      "error",
    );
  }
});

$("backup-download").addEventListener("click", async () => {
  await showBackup();
  const blob = new Blob([backupText.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `timed-tabs-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  backupNote("Downloaded.", "success");
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
  groups = [];
  renderFields();
  renderFlagged();
  if ($("overview").open) refreshOverview();
  backupNote(
    "Reset. All settings are back to defaults and all rules are gone.",
    "warning",
  );
  showBackupSoon();
});

async function applyBackup() {
  const here = (await getDisplayVersion().catch(() => null))?.display ?? "";
  let parsed;
  try {
    parsed = parseBundle(backupText.value, here);
  } catch (err) {
    backupNote(err.message, "error");
    return;
  }
  const loaded = { ...DEFAULTS, ...parsed.settings };
  const ok = await write(
    async () => {
      await saveSettings(loaded);
      await saveRules(parsed.rules);
      await saveGroups(parsed.groups ?? []);
    },
    {
      what: "the backup",
      key: "backup",
      note: "Some of it may have been applied; check your settings.",
    },
  );
  if (!ok) return;
  settings = loaded;
  rules = parsed.rules;
  groups = parsed.groups ?? [];
  // Not part of the write above: the tally is the background's, and a count
  // that fails to land is a number, not a setting the user is now looking at.
  if (parsed.stats.killed > 0) {
    await api.runtime
      .sendMessage({ type: "timed-tabs:stats-restore", killed: parsed.stats.killed })
      .catch(() => {});
    if (statsOn() && $("stats").open) refreshStats();
  }
  renderFields();
  renderFlagged();
  if ($("overview").open) refreshOverview();
  const ruleCount = `${rules.length} rule${rules.length === 1 ? "" : "s"}`;
  // Worth saying only when the bundle came from somewhere else. A file this
  // build wrote itself, or one too old to carry a stamp, says nothing — and
  // one from a later build is left to `parseBundle`, whose warning says both
  // where it came from and why that matters.
  const from =
    parsed.version &&
    parsed.version !== here &&
    !(compareVersions(parsed.version, here) > 0)
      ? ` Written by Timed Tabs ${parsed.version}.`
      : "";
  backupNote(
    parsed.warnings.length
      ? `Loaded with ${ruleCount}.${from} ${parsed.warnings.join(" ")}`
      : `Loaded settings and ${ruleCount}.${from}`,
    parsed.warnings.length ? "warning" : "success",
  );
  // Fills the box again from what is now in force, which is what restamps the
  // bundle with this build.
  showBackupSoon();
}

let backupTimer;
function showBackupSoon() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(showBackup, 300);
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
  const v = await getDisplayVersion();
  summary.textContent = [
    `version: ${v.display}${v.commit ? ` (${v.commit})` : ""}`,
    `ticks: ${d.ticks}`,
    `last tick: ${d.lastTick ? new Date(d.lastTick).toLocaleTimeString() : "never"}`,
    `last error: ${d.lastError ?? "none"}`,
    `active indicators: ${d.activeIndicators.join(", ") || "none"}`,
    `site access granted: ${d.hasHostPermission} (origins: ${(d.origins ?? []).join(", ") || "none"})`,
    `notifications: ${d.notifications ? `setting ${d.notifications.enabled ? "on" : "off"}, permission ${d.notifications.available ? "granted" : "not granted"}, click handler ${d.notifications.listening ? "armed" : "not armed"}` : "unknown"}`,
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

/**
 * A word about what just happened, next to the icon buttons. It replaces the
 * "Saved" mark those two used to get, which would have stretched a button
 * that is now only as wide as its icon.
 */
let actFlashTimer = null;
function flashAction(text) {
  const el = $("act-flash");
  el.textContent = text;
  clearTimeout(actFlashTimer);
  el.classList.remove("is-shown");
  void el.offsetWidth; // restart the fade when pressed again quickly
  el.classList.add("is-shown");
  actFlashTimer = setTimeout(() => el.classList.remove("is-shown"), 2200);
}

$("act-reset").addEventListener("click", async () => {
  await tabAction("reset");
  flashAction("Restarted");
});

$("act-snooze").addEventListener("click", async () => {
  // Read the amount before the action lands, so the flash names what was
  // granted rather than whatever the next state happens to say.
  const added = snoozeFor(tabState);
  await tabAction("snooze");
  flashAction(`+${formatRemaining(added)}`);
});

// Dragging reports continuously; the commit waits until the drag is let go.
// The way back to the Rules page for this site. It went with the bottom nav,
// and this is the place for it: beside the rules it is about.
$("tab-rules-open").addEventListener("click", () =>
  openPageView("#rules", currentTab?.url ? { site: currentTab.url } : {}),
);

$("fuse-range").addEventListener("input", (e) => {
  fuseDrag = Number(e.target.value);
  $("fuse").classList.add("is-dragging");
  previewFuse(fuseDrag);
});

$("fuse-range").addEventListener("change", async (e) => {
  const pct = Number(e.target.value);
  $("fuse").classList.remove("is-dragging");
  // Keep showing the dragged value until the reply lands, or the once-a-second
  // readout snaps back to the old state in between.
  await tabAction("progress", pct);
  fuseDrag = null;
});

$("act-never").addEventListener("change", (e) =>
  tabAction("neverExpire", e.target.checked, e.target.closest("label")),
);
$("act-never-paused").addEventListener("change", (e) =>
  tabAction("neverExpire", e.target.checked, e.target.closest("label")),
);
$("act-ignore").addEventListener("change", (e) =>
  tabAction("ignoreRules", e.target.checked, e.target.closest("label")),
);
/** True once the optional permissions a setting needs are granted. */
async function requestPermission(requires) {
  try {
    return await api.permissions.request(requires);
  } catch {
    return false;
  }
}

/**
 * A permission can be taken away in about:addons long after the setting was
 * switched on, which would leave the panel promising something that can no
 * longer happen. Switch those settings back off when their permission goes.
 */
async function syncPermissionFields() {
  const gated = FIELDS.filter((f) => f.requires && settings[f.key]);
  const lost = [];
  for (const field of gated) {
    const held = await api.permissions.contains(field.requires).catch(() => true);
    if (!held) lost.push(field.key);
  }
  if (!lost.length) return;
  await save(Object.fromEntries(lost.map((key) => [key, false])));
  renderFields();
}

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

/** The Settings group the flags row lives in, asked rather than assumed. */
const FLAGS_GROUP = FIELDS.find((f) => f.key === "featureFlags")?.group;

/**
 * "Change" on the flags note goes to the switches it is talking about. From
 * the popup that means opening the page, since the flags live on the Settings
 * page and the popup has no copy of them; from a page view it is a hop, a
 * group and a scroll.
 *
 * The group is the part that is easy to miss. Settings shows one group at a
 * time and the flags have a group of their own, so on any other group the row is inside
 * a hidden section -- and `scrollIntoView` on one of those does nothing at
 * all, which lands you on Settings with no idea what you were sent to look at.
 */
/** Take the user to the feature flags: the note's "Change" and the header badge both land here. */
function showFlagSettings() {
  // The popup has no page to scroll, so it asks the page it opens to arrive
  // on the right group, the way `site` asks the Rules page to arrive filtered.
  if (isPopup) return openPageView("#settings", FLAGS_GROUP ? { group: FLAGS_GROUP } : {});
  location.hash = "#settings";
  // After the hash has been routed and the section is displayed.
  requestAnimationFrame(() => {
    if (FLAGS_GROUP) showGroup(FLAGS_GROUP);
    $("fields")
      .querySelector('.field[data-key="featureFlags"]')
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

$("flags-note-manage").addEventListener("click", showFlagSettings);
$("beta-badge").addEventListener("click", showFlagSettings);

$("diag-refresh").addEventListener("click", refreshDiag);
$("diag-tick").addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "timed-tabs:tick" }).catch(() => {});
  refreshDiag();
});
api.permissions.onAdded?.addListener(refreshPermissionWarning);
api.permissions.onRemoved?.addListener(() => {
  refreshPermissionWarning();
  syncPermissionFields();
});

// Version, shown in the page header and the mini UI footer.
getDisplayVersion().then((v) => {
  const text = `v${v.display}`;
  const tip = v.commit
    ? `Version ${v.display} (${v.commit})`
    : `Version ${v.display}`;
  for (const id of ["version", "version-mini"]) {
    const el = $(id);
    if (!el) continue;
    el.textContent = text;
    el.title = tip;
  }
  // Beta and dev builds wear a badge next to the title so nobody mistakes
  // one for a release. The manifest version differs from the release name
  // for betas, so the tooltip spells both out.
  if (v.channel) {
    document.body.dataset.channel = v.channel;
    const badge = $("channel-badge");
    badge.textContent = v.channel;
    badge.hidden = false;
    badge.title =
      v.channel === "beta"
        ? `Beta build ${v.display}. The browser lists it as version ${v.version}.`
        : `Development build ${v.display}`;
  }
});

(async () => {
  applyBrowserTheme();
  settings = await getSettings();
  rules = await getRules();
  groups = await getGroups();
  if (!isPopup) {
    renderGroups();
    const site = params.get("site");
    if (site) $("rules-filter").value = site;
    renderRules();
    showBackup();
    rememberFold($("overview"), "overview", true);
    rememberFold($("recent"), "recent", false);
    rememberFold($("stats"), "stats", false);
    // After the fold, so a section remembered open is refreshed on the way in
    // -- and one the flag has off stays hidden whatever the fold said.
    renderStats();
    route();
  }
  renderFields();
  renderSortControl();
  applyManagementState();
  refreshPermissionWarning();
  syncPermissionFields();
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
