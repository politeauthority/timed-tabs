import { api } from "./browser.js";

/**
 * All user-configurable settings live here with their defaults.
 * Anything added to DEFAULTS is automatically persisted and, via FIELDS,
 * rendered on the settings page. Keep the shape flat and JSON-serialisable.
 */
export const DEFAULTS = Object.freeze({
  /** Seconds a tab may stay open before it is considered expired. */
  tabLifetimeSeconds: 30 * 60,
  /** Switching to a tab restarts its timer. */
  resetOnActivate: false,
  /** The active tab's clock does not run; time only counts in the background. */
  pauseWhileActive: false,
  /** Show nothing at all while a tab is still in the green zone. */
  hideWhileGreen: false,
  /** Which indicator strategies signal remaining time. See background/indicators. */
  indicators: ["favicon", "theme-tint"],
  /** How the favicon indicator draws its colour: "square" | "ring" | "dot". */
  faviconStyle: "square",
  /** What to do when a tab expires: "none" | "close" | "discard". */
  onExpire: "none",
  /** Seconds between indicator refreshes. */
  tickSeconds: 5,
});

/**
 * How each setting is presented. `type` is one of:
 * duration (seconds), toggle, choice ({ value, label }[]), indicators.
 */
export const FIELDS = [
  {
    key: "tabLifetimeSeconds",
    type: "duration",
    label: "Tab lifetime",
    help: "How long a tab may sit before it counts as expired.",
  },
  {
    key: "resetOnActivate",
    type: "toggle",
    label: "Restart the timer when you switch to a tab",
  },
  {
    key: "pauseWhileActive",
    type: "toggle",
    label: "Only count time while a tab is in the background",
  },
  {
    key: "onExpire",
    type: "choice",
    label: "When a tab expires",
    options: [
      { value: "none", label: "Leave it open" },
      { value: "discard", label: "Unload it" },
      { value: "close", label: "Close it" },
    ],
  },
  {
    key: "indicators",
    type: "indicators",
    label: "Show remaining time with",
  },
  {
    key: "hideWhileGreen",
    type: "toggle",
    label: "Leave fresh tabs alone",
    help: "Show nothing until a tab has used 40% of its lifetime.",
  },
  {
    key: "faviconStyle",
    type: "choice",
    label: "Favicon colour style",
    options: [
      { value: "square", label: "Square behind the icon" },
      { value: "ring", label: "Ring around the icon" },
      { value: "dot", label: "Dot in the corner" },
    ],
    showWhen: (s) => s.indicators.includes("favicon"),
  },
  {
    key: "tickSeconds",
    type: "duration",
    label: "Refresh every",
    min: 1,
  },
];

const STORAGE_AREA = "sync";

export async function getSettings() {
  const stored = await api.storage[STORAGE_AREA].get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(partial) {
  await api.storage[STORAGE_AREA].set(partial);
}

/** Calls `fn(settings)` now and again whenever settings change. */
export function watchSettings(fn) {
  getSettings().then(fn);
  api.storage.onChanged.addListener((_changes, area) => {
    if (area === STORAGE_AREA) getSettings().then(fn);
  });
}
