/**
 * Override rows: a setting a rule or a tab may take over, with its checkbox, its control and the lead control the time-or-share fields use.
 */
import { RULE_VISUAL_FIELDS } from "../shared/rules.js";
import { formatLead, parseLead } from "../shared/lead.js";
import { indicators } from "../background/indicators/index.js";
import { makeSwitch, markSaved, settingRow } from "./dom.js";
import { state } from "./state.js";
import { toUnit } from "../shared/time.js";

/**
 * A number and a unit for a lead (see shared/lead.js): seconds, minutes and
 * hours, or a share of the lifetime. `lifetime()` is the ceiling an amount is
 * clamped to when read, asked for at that moment because a rule can change
 * it. Returns the two controls and a read/set pair over the stored string.
 */
export function makeLeadControl(current, lifetime, onChange) {
  const num = document.createElement("input");
  num.type = "number";
  num.min = "1";
  num.step = "1";
  const units = document.createElement("select");
  for (const [label, unit] of [
    ["sec left", "1"],
    ["min left", "60"],
    ["hours left", "3600"],
    ["% of lifetime left", "%"],
  ]) {
    units.add(new Option(label, unit));
  }
  const set = (value) => {
    const lead = parseLead(value) ?? { percent: 60 };
    if ("percent" in lead) {
      num.value = String(lead.percent);
      units.value = "%";
    } else {
      const u = toUnit(lead.seconds);
      num.value = String(u.value);
      units.value = String(u.unit);
    }
    num.max = units.value === "%" ? "99" : "";
  };
  const read = () => {
    const n = Math.round(Number(num.value));
    if (units.value === "%") {
      const percent = Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 60;
      return formatLead({ percent });
    }
    const raw = Number.isFinite(n) ? Math.max(1, n) * Number(units.value) : 60;
    // The lifetime is the ceiling: a longer lead means "from the start", so
    // it is stored as the lifetime itself rather than a number that would
    // outlive a later, shorter lifetime unnoticed.
    const cap = lifetime();
    return formatLead({ seconds: cap > 0 ? Math.min(raw, cap) : raw });
  };
  set(current);
  const changed = () => {
    set(read());
    onChange(read());
  };
  num.addEventListener("change", changed);
  units.addEventListener("change", changed);
  return { num, units, read, set };
}

/**
 * A titled block of override rows. `store` is { set, base(key), commit(set) }:
 * the current overrides, the value shown while a row is off, and how to save.
 * Rows whose `showWhen` fails against the layered settings are hidden, so a
 * dependent option (flash lead, favicon style) only appears once its parent is on.
 */
export function renderOverrideGroup(title, defs, store) {
  const group = document.createElement("div");
  group.className = "rule-overrides";
  const heading = document.createElement("p");
  heading.className = "rule-overrides-title";
  heading.textContent = title;
  group.append(heading);
  const rows = defs.map((def) => [def, renderOverride(def, store, () => applyVisibility())]);
  const applyVisibility = () => {
    const layered = { ...state.settings, ...store.set };
    for (const key of RULE_VISUAL_FIELDS) if (key in store.set) layered[key] = store.set[key];
    for (const [def, row] of rows) row.hidden = Boolean(def.showWhen && !def.showWhen(layered));
  };
  for (const [, row] of rows) group.append(row);
  applyVisibility();
  return group;
}

export function renderOverride(def, store, onChanged = () => {}, opts = {}) {
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
  } else if (def.type === "lead") {
    // The ceiling is the lifetime these tabs will have: this rule's, if it
    // sets one, else what lies underneath.
    const lifetime = () => Number(store.set.tabLifetimeSeconds ?? store.base("tabLifetimeSeconds") ?? 0);
    const lead = makeLeadControl(current, lifetime, () => commit(true));
    control.append(lead.num, lead.units);
    read = lead.read;
    setValue = lead.set;
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

export function setRowChanged(rowEl, on) {
  rowEl.classList.toggle("is-changed", on);
  const label = rowEl.querySelector(".field-label-text") ?? rowEl.querySelector(".field-label");
  if (!label) return;
  let mark = label.querySelector(":scope > .changed-mark");
  if (on && !mark) {
    mark = document.createElement("span");
    mark.className = "changed-mark";
    mark.textContent = "unsaved";
    // On the label's first line: before the help, where there is help.
    const help = label.querySelector(":scope > .field-help");
    if (help) help.before(mark);
    else label.append(mark);
  } else if (!on && mark) mark.remove();
}
