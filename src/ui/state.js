/**
 * What the panel's sections share: the stored settings and rules, the site
 * groups, the tab the popup is looking at, and which of the three contexts
 * this is. One object, so a section reads and writes `state.rules` rather
 * than reaching into another module's `let`. Nothing here talks to the
 * browser; the modules that own each field load and save it.
 */
import { DEFAULTS } from "../shared/settings.js";

// The same file serves three contexts: the toolbar popup (default), the
// preferences pane (options.html sets data-context) and a full page
// (panel.html?view=page). Set the page context before anything renders.
if (new URLSearchParams(location.search).get("view") === "page") {
  document.body.dataset.context = "page";
}
export const context = document.body.dataset.context;
export const isPopup = context === "popup";
export const params = new URLSearchParams(location.search);

export const state = {
  settings: { ...DEFAULTS },
  settingsDraft: {},
  rules: [],
  groups: [],
  tabState: null,
  currentTab: null,
  rulesSaving: false,
  groupsSaving: false,
};

/** The stored settings with the page's unsaved changes on top. */
export const draftSettings = () => ({ ...state.settings, ...state.settingsDraft });
