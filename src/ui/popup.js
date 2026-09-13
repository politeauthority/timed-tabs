/**
 * This tab, in the popup: the readout and fuse, the actions, why a page is left alone, the rules for the page and its page settings.
 */
import { $, makeSwitch, markSaved, svgIcon, wildcardSpans } from "./dom.js";
import { RULE_FIELDS, RULE_MANAGE_FIELD, explainSettings, ruleName } from "../shared/rules.js";
import { THIS_TAB_SUBJECT, defsFor, fieldEmoji, ruleChipText } from "./rule-text.js";
import { api } from "../shared/browser.js";
import { featureOn } from "../shared/flags.js";
import { formatRemaining, snoozeSeconds } from "../shared/time.js";
import { groupNameOf, isGroupRef } from "../shared/groups.js";
import { isPopup, state } from "./state.js";
import { openPageView } from "./pages.js";
import { renderOverride } from "./overrides.js";
import { toasts } from "./feedback.js";

export let fetchedAt = 0;

export async function refreshTab() {
  if (!isPopup) return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  state.currentTab = tab ?? null;
  if (!state.currentTab) return;
  state.tabState = await api.runtime
    .sendMessage({ type: "timed-tabs:tab-state", tabId: state.currentTab.id })
    .catch(() => null);
  fetchedAt = Date.now();
  renderTab();
}

/** Fold or unfold a popup section, remembered on the tab until it closes. */
export function setSectionFold(section, open, persist = true) {
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
  const flip = () => {
    const el = $(`tab-${section}`);
    // Nothing under the heading, nothing to fold.
    if (el.classList.contains("is-empty")) return;
    setSectionFold(section, el.classList.contains("is-collapsed"));
  };
  $(`tab-${section}-toggle`).addEventListener("click", flip);
  document.querySelector(`.settings-title[data-toggles="tab-${section}"]`)?.addEventListener("click", flip);
}

export function renderTab() {
  // What this tab actually does, rules and overrides included; the globals
  // only until the background has answered for it.
  const eff = state.tabState?.effective ?? state.settings;
  $("tab").hidden = false;
  // A tab that both pauses while you are on it and restarts when you return
  // still has a clock worth seeing and dragging; it just says so.
  $("tab-paused-note").hidden = !(eff.pauseWhileActive && eff.resetOnActivate);
  if (!state.currentTab || !state.tabState) return;

  // The switch reads as "enabled": on while the timer runs, off while the
  // tab never expires. Off, the rest of the popup has nothing to say: the
  // fuse, the actions and the rules go, and the switch stays to bring them back.
  const enabled = $("act-enabled");
  const unmanaged = Boolean(state.tabState.unmanaged);
  // A page left alone is not enabled either, whatever its own switch says.
  enabled.checked = !unmanaged && !state.tabState.neverExpire;
  document.body.dataset.never = state.tabState.neverExpire ? "on" : "off";
  document.body.dataset.unmanaged = unmanaged ? "on" : "off";
  const enabledLabel = enabled.closest("label");
  enabled.disabled = unmanaged;
  enabledLabel.title = unmanaged
    ? "Timed Tabs leaves this page alone, so there is nothing to enable here."
    : state.tabState.neverExpire
      ? "Off: this tab never expires. Switch on to time it again."
      : "Enabled on this tab. Switch off and it never expires.";
  enabled.setAttribute("aria-label", enabledLabel.title);
  renderTabWhy();
  $("act-ignore").checked = Boolean(state.tabState.ignoreRules);
  // Each section starts the way it starts, then stays as this tab last left
  // it: Page settings open, Rules folded until the tab opens it.
  setSectionFold("settings", state.tabState.folds?.settings !== false, false);
  setSectionFold("rules", state.tabState.folds?.rules === true, false);
  // The rules section only appears when a rule matches this page, or rules are already ignored.
  $("tab-rules").hidden = !state.currentTab;
  renderTabRules();
  renderTabSettings();

  const icon = $("tab-icon");
  if (state.currentTab.favIconUrl) {
    icon.src = state.currentTab.favIconUrl;
    icon.hidden = false;
  } else {
    icon.hidden = true;
  }
  $("tab-title").textContent = state.currentTab.title || state.currentTab.url || "";
  updateReadout();
}

/**
 * A page Timed Tabs leaves alone says what decided that. A rule that switches
 * Manage tabs off is named, with a button to its page; otherwise it is the
 * General setting "Only manage tabs a rule matches" with nothing caught. The
 * master switch off is the banner's job, so it is not repeated here.
 */
export function renderTabWhy() {
  const why = $("tab-why");
  const go = $("tab-why-go");
  if (!state.tabState?.unmanaged || state.settings.tabManagement === false) {
    why.hidden = true;
    return;
  }
  const rule = [...(state.tabState.rules ?? [])]
    .filter((r) => !r.ignored && r.set?.manageTabs === false)
    .sort((a, b) => b.priority - a.priority)[0];
  const ruleRow = $("tab-why-rule");
  go.onclick = null;
  ruleRow.onclick = null;
  ruleRow.hidden = !rule;
  if (rule) {
    $("tab-why-text").textContent = "Left alone: this rule switches Manage tabs off for the page.";
    // The rule, highlighted: badge, name, pattern, and the chip that did it.
    const prio = document.createElement("span");
    prio.className = "rule-priority";
    prio.textContent = String(rule.priority);
    const name = document.createElement("span");
    name.className = "rule-name-text";
    name.textContent = ruleName(rule);
    const pattern = document.createElement("span");
    pattern.className = "rule-pattern-static";
    if (isGroupRef(rule.pattern)) pattern.textContent = `🗂️ ${groupNameOf(rule.pattern)}`;
    else pattern.append(...wildcardSpans(rule.pattern));
    const chip = document.createElement("span");
    chip.className = "rule-chip";
    chip.textContent = `${fieldEmoji(RULE_MANAGE_FIELD)} ${ruleChipText(RULE_MANAGE_FIELD, false)}`;
    ruleRow.replaceChildren(prio, name, ...(ruleName(rule) !== rule.pattern ? [pattern] : []), chip);
    ruleRow.title = `Open “${ruleName(rule)}” to change it`;
    const open = () => openPageView(`#rule-${rule.id}`);
    ruleRow.onclick = open;
    go.textContent = "Edit rule";
    go.onclick = open;
  } else {
    $("tab-why-text").textContent = "Left alone: “Only manage tabs a rule matches” is on in General, and no rule catches this page.";
    go.textContent = "Settings";
    go.onclick = () => openPageView("#settings", { group: "general" });
  }
  why.hidden = false;
}

export function renderTabRules() {
  const list = $("tab-rules-list");
  // Rows are rebuilt on every refresh; keep any "Saved" mark that is still showing.
  const liveMarks = new Map();
  for (const mark of list.querySelectorAll(
    "[data-saved-key] > .saved-mark.is-shown",
  )) {
    liveMarks.set(mark.parentElement.dataset.savedKey, mark);
  }
  const matched = state.tabState?.rules ?? [];
  const allOff = Boolean(state.tabState?.ignoreRules);
  // The count in the heading says it all; with none, the section is just the
  // heading, so there is nothing to fold and the chevron goes (see .is-empty).
  $("tab-rules-count").textContent = String(matched.length);
  $("tab-rules-count").classList.toggle("is-zero", !matched.length);
  $("tab-rules").classList.toggle("is-empty", !matched.length);
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
      // The name and nothing else: the popup is for switching a rule off
      // here, and the rule's page says the rest.
      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "tab-rule-name";
      name.textContent = ruleName(r);
      text.append(name);
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

/**
 * Settings that are details of another one. They say nothing without the
 * setting they qualify, so a rule touching one is not reason enough to list it
 * here; the rule card below prints what it sets.
 */
export const DEPENDENT_SETTINGS = new Set([
  "flashLead",
  "quietStart",
  "faviconStyle",
]);

/**
 * Always listed, whatever they are set to. How long this tab has and whether
 * looking at it starts that over are the two questions the popup exists to
 * answer.
 */
export const ALWAYS_SHOWN = new Set(["tabLifetimeSeconds", "resetOnActivate"]);

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
export function belongsInPageSettings(key, entry) {
  if (ALWAYS_SHOWN.has(key)) return true;
  if (DEPENDENT_SETTINGS.has(key)) return false;
  return entry?.from !== "global";
}

/** The tab's own layer: explicit overrides, plus the two older per-tab switches. */
export function tabOverrides() {
  const out = { ...(state.tabState?.overrides ?? {}) };
  if (state.tabState?.neverExpire && !("neverExpire" in out)) out.neverExpire = true;
  if (
    state.tabState?.resetOnActivate !== null &&
    state.tabState?.resetOnActivate !== undefined &&
    !("resetOnActivate" in out)
  ) {
    out.resetOnActivate = state.tabState.resetOnActivate;
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
export function thisTabBadge(onClear) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "setting-source is-tab";
  el.textContent = "this tab";
  el.title = "Set on this tab, until it closes. Click to hand it back to the rules and your defaults.";
  el.addEventListener("click", onClear);
  return el;
}

/** How a rule that changed a value names itself, for the row's tooltip. */
export function ruleSourceText(entry) {
  const r = entry.rule;
  const name = ruleName(r);
  return `Set by ${name}${r?.priority !== undefined ? ` (priority ${r.priority})` : ""}.`;
}

/**
 * Which settings the popup lists for this tab. The set only grows while the
 * popup is open: a row that appeared because a rule or this tab set something
 * stays put when that is handed back, so nothing jumps under the pointer.
 */
export let pageSettingsKeys = null;

export function renderTabSettings() {
  const section = $("tab-settings");
  if (!state.tabState || !state.settings || !featureOn(state.settings, "mini-ui-page-settings")) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const overrides = tabOverrides();
  const explained = explainSettings(state.settings, state.tabState.rules ?? [], overrides);

  // The row's checkbox means "this tab sets this". Off, it shows what the
  // rules and globals would give, which is exactly `explained` without the
  // tab layer -- so base() reads from a second pass with no overrides.
  const inherited = explainSettings(state.settings, state.tabState.rules ?? [], {});
  const store = {
    set: { ...(state.tabState.overrides ?? {}) },
    base: (key) => inherited[key]?.value,
    commit: async (next) => {
      const before = state.tabState.overrides ?? {};
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
      const legacy = !(def.key in (state.tabState.overrides ?? {}));
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

export function updateReadout() {
  if (!state.tabState) return;
  const drift = state.tabState.paused ? 0 : (Date.now() - fetchedAt) / 1000;
  const remaining = Math.max(0, state.tabState.remainingSeconds - drift);
  const progress = Math.min(
    1,
    (state.tabState.elapsedSeconds + drift) / state.tabState.lifetimeSeconds,
  );
  // Nothing is watching this page, so there is no time left to report: an
  // "expires in" with a number in it would be a promise nothing will keep.
  const unmanaged = Boolean(state.tabState.unmanaged);
  const exempt =
    unmanaged ||
    (state.tabState.effective?.neverExpire ?? state.tabState.neverExpire) ||
    state.currentTab?.pinned;

  const time = $("remaining");
  const note = $("remaining-note");
  if (unmanaged) {
    time.textContent = "—";
    note.textContent = "left alone";
  } else if (exempt) {
    time.replaceChildren(svgIcon("infinity"));
    note.textContent = state.currentTab?.pinned
      ? "pinned tabs never expire"
      : state.tabState.neverExpire
        ? "never expires"
        : "never expires (rule)";
  } else {
    time.textContent = formatRemaining(remaining);
    if (remaining <= 0) note.textContent = "";
    else if (state.tabState.paused)
      note.textContent = "left, paused while you're here";
    else note.textContent = state.tabState.extraSeconds ? "left, snoozed" : "left";
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
    ? unmanaged
      ? "Snooze (no rule matches this page, so no timer runs)"
      : "Snooze (this tab has no timer running)"
    : `Snooze — adds ${formatRemaining(snoozeFor(state.tabState))}`;
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
export const FUSE_MIN_PERCENT = 2;

/** Percent while a drag is in flight, null when the tick owns the fuse again. */
export let fuseDrag = null;

export function paintFuse(pct) {
  const clamped = Math.min(100, Math.max(0, pct));
  $("fuse-burnt").style.width = `${clamped}%`;
  $("fuse-marker").style.left = `${clamped}%`;
  if (fuseDrag === null) {
    $("fuse-range").value = String(
      Math.round(Math.max(FUSE_MIN_PERCENT, clamped)),
    );
  }
}

export function setFuseEnabled(enabled) {
  $("fuse").classList.toggle("is-disabled", !enabled);
  $("fuse-range").disabled = !enabled;
}

/** Show what letting go here would leave, without waiting for the background. */
export function previewFuse(pct) {
  paintFuse(pct);
  if (!state.tabState?.lifetimeSeconds) return;
  $("remaining").textContent = formatRemaining(
    (state.tabState.lifetimeSeconds * (100 - pct)) / 100,
  );
  $("remaining-note").textContent = "left, when you let go";
}

/** What one press of Snooze will grant this tab, given its own lifetime. */
export function snoozeFor(t) {
  return snoozeSeconds(
    t?.effective?.tabLifetimeSeconds ?? state.settings.tabLifetimeSeconds,
    state.settings.snoozePercent,
  );
}

export async function tabAction(action, value, sourceEl = null) {
  if (!state.currentTab) return;
  const reply = await api.runtime
    .sendMessage({
      type: "timed-tabs:tab-action",
      tabId: state.currentTab.id,
      action,
      value,
    })
    .catch(() => null);
  if (reply) state.tabState = reply;
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

export function flashTabError() {
  toasts.error(
    "Could not change this tab",
    "Timed Tabs did not answer. Try again.",
    "tab-action",
  );
}

/**
 * A word about what just happened, next to the icon buttons. It replaces the
 * "Saved" mark those two used to get, which would have stretched a button
 * that is now only as wide as its icon.
 */
export let actFlashTimer = null;

export function flashAction(text) {
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
  const added = snoozeFor(state.tabState);
  await tabAction("snooze");
  flashAction(`+${formatRemaining(added)}`);
});

// Dragging reports continuously; the commit waits until the drag is let go.
// The way back to the Rules page for this site. It went with the bottom nav,
// and this is the place for it: beside the rules it is about.
$("tab-rules-open").addEventListener("click", () =>
  openPageView("#rules", state.currentTab?.url ? { site: state.currentTab.url } : {}),
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

$("act-enabled").addEventListener("change", (e) =>
  tabAction("neverExpire", !e.target.checked, e.target.closest("label")),
);

$("act-ignore").addEventListener("change", (e) =>
  tabAction("ignoreRules", e.target.checked, e.target.closest("label")),
);
