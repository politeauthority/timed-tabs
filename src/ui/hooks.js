/**
 * The few functions sections call across the seams: redraw everything a
 * flag governs, refresh the open-tabs list, refresh the popup's tab, redraw
 * the settings fields. Filled in by panel.js once every module is loaded,
 * so a section can call `hooks.refreshTab()` without importing the popup,
 * and no two modules have to import each other.
 */
export const hooks = {
  route: () => {},
  renderFlagged: () => {},
  refreshOverview: () => {},
  refreshTab: () => {},
  renderFields: () => {},
  refreshStats: () => {},
};
