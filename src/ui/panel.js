/**
 * The panel's wire-up, shared by the toolbar popup (mini UI), the full page
 * and the preferences pane. Each section of the page is drawn by a module of
 * its own (see docs/developer/ui-modules.md); this file routes the hash to a
 * page, fills the hooks the sections call across seams, watches storage, and
 * runs the start-up sequence. The "This tab" section only exists in the
 * popup; the page and preferences views show one page at a time.
 */
import { api } from "../shared/browser.js";
import { getGroups, getRules, getSettings, watchSettings, watchGroups, watchRules } from "../shared/settings.js";
import { getDisplayVersion } from "../shared/version.js";
import { state, context, isPopup, params } from "./state.js";
import { $, setRevealed } from "./dom.js";
import { applyBrowserTheme } from "./theme.js";
import { refreshDiag } from "./diagnostics.js";
import { rememberFold } from "./folds.js";
import { hooks } from "./hooks.js";
import { refreshTab, renderTab, updateReadout } from "./popup.js";
import { showBackup } from "./backup.js";
import { PILLS, applyManagementState, refreshPermissionWarning, renderFields, showGroup, syncPermissionFields } from "./settings-page.js";
import { refreshOverview, refreshStats, renderSortControl, renderStats, startTabsPage, statsOn, stopTabsPage } from "./tabs-page.js";
import { applyRulesFilter, draftDirty, renderGroups, renderRules, ruleDrafts } from "./rules-list.js";
import { refreshEditorDirty, renderRuleEditor, startEditorPage, stopEditorPage } from "./rule-editor.js";
import { renderRuleTest, renderRuleTestResult } from "./rule-test.js";
import { renderBetaBadge, renderFlagsNote } from "./flags-note.js";
// The hub functions sections call across the seams; see hooks.js.
Object.assign(hooks, {
  route,
  renderFlagged,
  refreshOverview,
  refreshTab,
  renderFields,
  refreshStats: () => {
    if (statsOn() && $("stats").open) refreshStats();
  },
});

// ---- Pages -----------------------------------------------------------------
// The full page and the preferences pane show one page at a time, chosen by
// the URL hash: #tabs (default), #rules, #settings.

const PAGES = ["tabs", "rules", "settings"];

function pageFromHash() {
  const h = location.hash.replace(/^#/, "");
  // One rule on a page of its own: #rule-<id> to edit it, #rule-new to make one.
  if (h.startsWith("rule-")) return "rule";
  if (h === "test") return "test";
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
    // The rule editor is part of Rules as far as the nav is concerned.
    const on =
      a.dataset.pageLink === page ||
      ((page === "rule" || page === "test") && a.dataset.pageLink === "rules");
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  onPageShown(page);
}

window.addEventListener("hashchange", route);

// @dev-only-start  (scripts/build.mjs removes everything down to @dev-only-end from release builds)
// Dev build only (see background): dev.json may list UI actions to replay,
// e.g. "uiActions": [{ "at": 3000, "click": "#tab-rules-list input" }] or
// [{ "at": 3000, "set": "#fuse-range", "value": "80" }] to drive a control
// that a bare click cannot work, like a slider, or
// [{ "at": 3000, "scroll": "#group-appearance h3:last-of-type" }] to bring a
// part of a long page into the capture.
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
          const selector = a.click ?? a.set ?? a.scroll;
          const el = document.querySelector(selector);
          if (!el) {
            console.log("[timed-tabs:ui] uiAction: no element for", selector);
            return;
          }
          if (a.scroll !== undefined) {
            el.scrollIntoView({ block: "start" });
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
/** Per-page setup when a page becomes visible. */
function onPageShown(page) {
  stopTabsPage();
  stopEditorPage(page === "rule");
  if (page === "tabs") {
    startTabsPage();
  } else if (page === "rules") {
    renderRules();
    applyRulesFilter();
  } else if (page === "test") {
    renderRuleTest();
  } else if (page === "rule") {
    startEditorPage(location.hash.replace(/^#rule-/, ""));
  } else if (page === "settings") {
    hooks.renderFields();
    // `#backup` was a page of its own once. It still opens the Backup pill,
    // then reads as the Settings page it now is.
    if (location.hash === "#backup") {
      showGroup("backup");
      history.replaceState(null, "", "#settings");
    }
    refreshPermissionWarning();
  }
}

// ---- Unsaved work ----------------------------------------------------------

window.addEventListener("beforeunload", (e) => {
  if (
    [...ruleDrafts.keys()].some(draftDirty) ||
    Object.keys(state.settingsDraft).length
  )
    e.preventDefault();
});
// ---- Storage watchers, and the hub every flag reaches ------------------------

watchRules((next) => {
  // Our own save arrives here too, after an extra async hop that outlives
  // the saving flag; what is in memory already matches it.
  if (state.rulesSaving || JSON.stringify(next) === JSON.stringify(state.rules))
    return;
  state.rules = next;
  if (!isPopup) renderRules();
  if (!isPopup && document.body.dataset.page === "rule") refreshEditorDirty();
  if (!isPopup && document.body.dataset.page === "test") renderRuleTestResult();
  if (isPopup) hooks.refreshTab();
});

/**
 * Settings saved by another instance (the full page while the popup is open,
 * or the reverse) arrive here. Anything a flag shows or hides follows at
 * once. A change this instance made itself is already applied, so it is
 * skipped rather than re-rendered under the user's cursor.
 */
watchSettings((next) => {
  if (JSON.stringify(next) === JSON.stringify(state.settings)) return;
  state.settings = next;
  for (const [key, value] of Object.entries(state.settingsDraft)) {
    if (JSON.stringify(value) === JSON.stringify(state.settings[key]))
      delete state.settingsDraft[key];
  }
  applyManagementState();
  hooks.renderFields();
  // `?group=` picks the Settings group to arrive on -- what the flags note's
  // "Change" uses to send the popup somewhere specific. After renderFields,
  // which otherwise restores the last group looked at.
  const group = params.get("group");
  if (!isPopup && PILLS.some((g) => g.id === group)) showGroup(group);
  renderSortControl();
  hooks.renderFlagged();
});

/** Every part of the UI a feature flag can show or hide. */
function renderFlagged() {
  renderFlagsNote();
  renderBetaBadge();
  if (!isPopup) {
    renderGroups();
    renderRules();
    renderStats();
    // A flag can add or take away a section of the rule editor and a column
    // of the rule test; redraw whichever is up.
    if (document.body.dataset.page === "rule")
      renderRuleEditor(location.hash.replace(/^#rule-/, ""));
    if (document.body.dataset.page === "test") renderRuleTestResult();
  }
  if (isPopup) renderTab();
}

watchGroups((next) => {
  if (
    state.groupsSaving ||
    JSON.stringify(next) === JSON.stringify(state.groups)
  )
    return;
  state.groups = next;
  if (!isPopup) {
    renderGroups();
    renderRules();
  }
  if (isPopup) hooks.refreshTab();
});

// ---- Wire up ---------------------------------------------------------------

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
  state.settings = await getSettings();
  state.rules = await getRules();
  state.groups = await getGroups();
  if (!isPopup) {
    renderGroups();
    const site = params.get("site");
    if (site) $("rules-filter").value = site;
    renderRules();
    showBackup();
    rememberFold($("overview"), "overview", true);
    rememberFold($("recent"), "recent", false);
    rememberFold($("stats"), "stats", false);
    rememberFold($("diag"), "diag", false);
    // The body slides rather than snapping: the summary click is taken over,
    // the details opens at once with its body still tucked, and the body
    // slides down; closing slides it up first and closes the details after.
    const diag = $("diag");
    const diagBody = $("diag-body");
    diagBody.hidden = !diag.open;
    diag.addEventListener("toggle", () => {
      if (diag.open) refreshDiag();
    });
    diag.querySelector("summary").addEventListener("click", (e) => {
      e.preventDefault();
      if (diag.open) {
        setRevealed(diagBody, false, true, () => {
          diag.open = false;
        });
      } else {
        diag.open = true;
        setRevealed(diagBody, true);
      }
    });
    // After the fold, so a section remembered open is refreshed on the way in
    // -- and one the flag has off stays hidden whatever the fold said.
    renderStats();
    route();
  }
  hooks.renderFields();
  renderSortControl();
  applyManagementState();
  refreshPermissionWarning();
  syncPermissionFields();
  if (isPopup) {
    await hooks.refreshTab();
    setInterval(updateReadout, 1000);
    setInterval(hooks.refreshTab, 5000);
    // A navigation in the current tab can change which rules apply.
    api.tabs.onUpdated?.addListener(
      (tabId, change) => {
        if (change.url && tabId === state.currentTab?.id) hooks.refreshTab();
      },
      { properties: ["url"] },
    );
  }
})();
