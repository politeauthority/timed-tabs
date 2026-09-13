/**
 * The Settings page: the groups and their pills, every field, the staged changes and the bar that saves them, and the site-access warning.
 */
import { $, makeSwitch, setRevealed, settingRow } from "./dom.js";
import { FIELDS, GROUPS, getSettings, saveSettings } from "../shared/settings.js";
import { FLAGS, flagOn, flagRequires } from "../shared/flags.js";
import { WEB_ORIGINS, hasWebAccess } from "../shared/permissions.js";
import { api } from "../shared/browser.js";
import { draftSettings, isPopup, state } from "./state.js";
import { hooks } from "./hooks.js";
import { indicators } from "../background/indicators/index.js";
import { makeLeadControl, setRowChanged } from "./overrides.js";
import { refreshDiag } from "./diagnostics.js";
import { requestPermission } from "./permissions.js";
import { showBackup } from "./backup.js";
import { toUnit } from "../shared/time.js";
import { toasts, write } from "./feedback.js";

export function renderFields() {
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
    sec.append(h, help);
    // A group with sections gets a headed block of rows per section; the
    // rest get one block. Rows in a sectioned group that name no section
    // land in the first, so a field is never dropped.
    const fields = FIELDS.filter((f) => f.group === g.id);
    const sections = g.sections ?? [null];
    for (const [i, sub] of sections.entries()) {
      const rows = document.createElement("div");
      rows.className = "group-rows";
      const own = sub
        ? fields.filter((f) => f.section === sub.id || (i === 0 && !sections.some((x) => x.id === f.section)))
        : fields;
      rows.append(...own.map(renderField));
      if (sub) {
        const sh = document.createElement("h3");
        sh.className = "group-section-title";
        sh.textContent = `${sub.emoji ? sub.emoji + " " : ""}${sub.title}`;
        sec.append(sh);
        if (sub.help) {
          const subHelp = document.createElement("p");
          subHelp.className = "group-help";
          subHelp.textContent = sub.help;
          sec.append(subHelp);
        }
      }
      sec.append(rows);
    }
    return sec;
  });
  root.replaceChildren(...sections);
  updateFieldVisibility(false);
  renderGroupTabs();
  showGroup(currentGroup());
  refreshSettingsDirty();
}

/**
 * Pills on the Settings page that are not settings. Their sections are
 * written in panel.html rather than rendered from FIELDS, and they are shown
 * and hidden by showGroup like any group. Kept out of shared/settings.js,
 * which describes user preferences and nothing else.
 */
export const EXTRA_GROUPS = [
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
    // No pill of its own: it shows at the foot of the Advanced group.
    under: "advanced",
    // Folded by default; the fold's own toggle refreshes it when opened.
    onShow: () => {
      if ($("diag").open) refreshDiag();
    },
  },
];

/** Every pill, in order: the settings groups, then the extras with no home elsewhere. */
export const PILLS = [...GROUPS, ...EXTRA_GROUPS.filter((g) => !g.under)];

/** Which group of settings is on show. Remembered like the folds are. */
export const GROUP_KEY = "settings-group";

export function currentGroup() {
  let stored = null;
  try {
    stored = localStorage.getItem(`ui:${GROUP_KEY}`);
  } catch {
    // Private window or blocked storage: fall back to the first group.
  }
  return PILLS.some((g) => g.id === stored) ? stored : GROUPS[0].id;
}

export function showGroup(id) {
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
    const on = (extra.under ?? extra.id) === id;
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
export function renderGroupTabs() {
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
export function updateFieldVisibility(animate = true) {
  for (const row of $("fields").querySelectorAll(".field[data-key]")) {
    const field = FIELDS.find((f) => f.key === row.dataset.key);
    setRevealed(row, !(field?.showWhen && !field.showWhen(draftSettings())), animate);
  }
}

export function renderField(field) {
  const row = document.createElement("div");
  row.className = "field";
  row.dataset.key = field.key;

  // A row with no label of its own is all control: the flags list is headed
  // by its section instead.
  const label = document.createElement("label");
  if (field.label) {
    label.className = "field-label";
    label.textContent = field.label;
    if (field.help) {
      const help = document.createElement("span");
      help.className = "field-help";
      help.textContent = field.help;
      label.append(help);
    }
    row.append(label);
  }

  const control = document.createElement("div");
  control.className = "field-control";
  row.append(control);

  const value = draftSettings()[field.key];

  if (field.type === "toggle") {
    const sw = makeSwitch(Boolean(value), async (checked) => {
      // A setting that needs an optional permission cannot be switched on
      // without it. `requestPermission` must be reached from this handler
      // with nothing awaited before it, or the browser sees no user gesture.
      if (checked && field.requires && !(await requestPermission(field.requires))) {
        sw.input.checked = false;
        return;
      }
      stage({ [field.key]: checked });
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
      stage({ [field.key]: select.value }),
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
      const raw = Math.round(Number(num.value) * Number(units.value));
      if (!Number.isFinite(raw)) return;
      // Kept inside the field's range, and the control shows what was kept.
      const seconds = Math.min(field.max ?? Infinity, Math.max(field.min ?? 1, raw));
      if (seconds !== raw) {
        const u = toUnit(seconds);
        num.value = String(u.value);
        units.value = String(u.unit);
      }
      stage({ [field.key]: seconds });
    };
    num.addEventListener("change", commit);
    units.addEventListener("change", commit);
    control.append(num, units);
  } else if (field.type === "lead") {
    const lead = makeLeadControl(value, () => draftSettings().tabLifetimeSeconds, (v) => stage({ [field.key]: v }));
    lead.num.id = `f-${field.key}`;
    label.htmlFor = lead.num.id;
    lead.units.setAttribute("aria-label", `${field.label} unit`);
    control.append(lead.num, lead.units);
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
    range.addEventListener("change", () => stage({ [field.key]: Number(range.value) }));
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
      stage({ [field.key]: clamped });
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
    // A list may show only some of the indicators; the others keep whatever
    // the stored list says, so the halves do not overwrite each other.
    const shown = indicators.filter((ind) => !field.only || field.only.includes(ind.id));
    for (const ind of shown) {
      const sw = makeSwitch(value.includes(ind.id), async () => {
        const checked = new Set([...list.querySelectorAll("input:checked")].map((i) => i.value));
        const ids = indicators
          .map((i) => i.id)
          .filter((id) => (shown.some((i) => i.id === id) ? checked.has(id) : draftSettings().indicators.includes(id)));
        stage({ indicators: ids });
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
      // So the unsaved mark can land on the one switch that moved.
      sub.dataset.subKey = `indicators:${ind.id}`;
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
    const syncDependents = (animate = true) => {
      for (const [id, entry] of switches) {
        const parent = flagRequires(id);
        setRevealed(entry.row, !(parent && !flagOn(draftSettings(), parent)), animate);
      }
    };
    for (const flag of FLAGS) {
      const sw = makeSwitch(value?.[flag.id] === true, (checked) => {
        stage({ featureFlags: { ...draftSettings().featureFlags, [flag.id]: checked } });
        syncDependents();
      });
      sw.input.id = `f-flag-${flag.id}`;
      const sub = settingRow(flag.label, flag.help, sw.el);
      sub.querySelector(".field-label").htmlFor = sw.input.id;
      sub.dataset.subKey = `featureFlags:${flag.id}`;
      if (flag.requires) sub.classList.add("flag-dependent");
      switches.set(flag.id, { input: sw.input, row: sub });
      list.append(sub);
    }
    syncDependents(false);
    row.append(list);
  }
  return row;
}

/**
 * Reflect the master switch on the body, which is what hides the readouts and
 * shows the banner. Doing it with a data attribute rather than the `hidden`
 * attribute keeps it clear of the show/hide the popup and the pages already do.
 */
export function applyManagementState() {
  document.body.dataset.managing = state.settings.tabManagement === false ? "off" : "on";
}

/**
 * Put a change on the page without storing it. A key set back to its stored
 * value leaves the draft, so undoing an edit by hand is as good as Discard.
 */
export function stage(partial) {
  for (const [key, value] of Object.entries(partial)) {
    if (JSON.stringify(value) === JSON.stringify(state.settings[key])) delete state.settingsDraft[key];
    else state.settingsDraft[key] = value;
  }
  updateFieldVisibility();
  refreshSettingsDirty();
}

/**
 * Mark the rows whose value is not what is stored and show the bar with the
 * count. A list row (indicators, flags) marks the one switch that moved
 * rather than the whole list.
 */
export function refreshSettingsDirty() {
  const root = $("fields");
  let n = 0;
  for (const row of root.querySelectorAll(".field[data-key]:not(.field-group)")) {
    const on = row.dataset.key in state.settingsDraft;
    setRowChanged(row, on);
    if (on && !row.hidden) n += 1;
  }
  const draft = draftSettings();
  for (const sub of root.querySelectorAll(".field[data-sub-key]")) {
    const [key, id] = sub.dataset.subKey.split(":");
    const on =
      key === "indicators"
        ? state.settings.indicators.includes(id) !== draft.indicators.includes(id)
        : Boolean(state.settings.featureFlags?.[id]) !== Boolean(draft.featureFlags?.[id]);
    setRowChanged(sub, on);
    if (on) n += 1;
  }
  const bar = $("settings-bar");
  bar.hidden = n === 0;
  $("settings-bar-text").textContent = `${n} unsaved change${n === 1 ? "" : "s"}`;
}

/** Store every staged change at once, then redraw from what is stored. */
export async function saveSettingsDraft() {
  const partial = { ...state.settingsDraft };
  const keys = Object.keys(partial);
  if (!keys.length) return;
  const what = keys.length === 1 ? `“${fieldLabel(keys[0])}”` : `${keys.length} settings`;
  const ok = await write(() => saveSettings(partial), { what, key: "settings" });
  if (!ok) return;
  const before = state.settings;
  state.settings = { ...state.settings, ...partial };
  state.settingsDraft = {};
  if ("tabManagement" in partial) applyManagementState();
  if ("featureFlags" in partial) hooks.renderFlagged();
  hooks.renderFields();
  toasts.success("Saved", what, "settings");
  // Switching notifications on sends one straight away: the quickest way to
  // find out whether the operating system lets them through.
  if (partial.notifyOnExpire && !before.notifyOnExpire) {
    const r = await api.runtime.sendMessage({ type: "timed-tabs:notify-test" }).catch((e) => ({ ok: false, error: String(e) }));
    if (r && !r.ok) console.warn("[timed-tabs] test notification failed:", r.error);
  }
  if ($("overview").open) hooks.refreshOverview();
}

$("settings-save").addEventListener("click", saveSettingsDraft);

$("settings-discard").addEventListener("click", () => {
  state.settingsDraft = {};
  hooks.renderFields();
});

/** The label of a settings field, for naming what was just saved. */
export function fieldLabel(key) {
  const f = FIELDS.find((f) => f.key === key);
  return f?.label ?? f?.name ?? key;
}

/**
 * Store a change at once. The Settings page no longer goes through here (it
 * stages, see `stage`); what does is the odd control elsewhere that has no
 * bar to wait for: the tab sort, "Turn it back on", a permission revoked.
 */
export async function save(partial, label = null) {
  const keys = Object.keys(partial);
  // `label` names the row that was touched when the key alone cannot: the
  // indicators list is shown in halves that share one key.
  const what =
    keys.length === 1 ? `“${label ?? fieldLabel(keys[0])}”` : `${keys.length} settings`;
  const ok = await write(() => saveSettings(partial), {
    what,
    key: keys.length === 1 ? keys[0] : "settings",
  });
  if (!ok) {
    // The write did not land, so the controls are showing something storage
    // does not have. Put them back to what is really there.
    state.settings = await getSettings().catch(() => state.settings);
    hooks.renderFields();
    return false;
  }
  state.settings = { ...state.settings, ...partial };
  if ("tabManagement" in partial) applyManagementState();
  // A flag can show or hide whole sections; the rules page depends on site-groups.
  if ("featureFlags" in partial) hooks.renderFlagged();
  updateFieldVisibility();
  toasts.success("Saved", what, keys.length === 1 ? keys[0] : "settings");
  if (isPopup) hooks.refreshTab();
  if ($("overview").open) hooks.refreshOverview();
  return true;
}

// The banner's own way back, so the switch is reachable from the popup.
$("off-resume").addEventListener("click", () => save({ tabManagement: true }));

export async function refreshPermissionWarning() {
  $("permission-warning").hidden = await hasWebAccess();
}

/**
 * A permission can be taken away in about:addons long after the setting was
 * switched on, which would leave the panel promising something that can no
 * longer happen. Switch those settings back off when their permission goes.
 */
export async function syncPermissionFields() {
  const gated = FIELDS.filter((f) => f.requires && state.settings[f.key]);
  const lost = [];
  for (const field of gated) {
    const held = await api.permissions.contains(field.requires).catch(() => true);
    if (!held) lost.push(field.key);
  }
  if (!lost.length) return;
  await save(Object.fromEntries(lost.map((key) => [key, false])));
  hooks.renderFields();
}

$("grant-permission").addEventListener("click", async () => {
  await api.permissions.request(WEB_ORIGINS).catch(() => false);
  refreshPermissionWarning();
});

api.permissions.onAdded?.addListener(refreshPermissionWarning);

api.permissions.onRemoved?.addListener(() => {
  refreshPermissionWarning();
  syncPermissionFields();
});
