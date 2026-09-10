/**
 * Strategy: colour the active tab's background via the Firefox theme API.
 *
 * `browser.theme.update(windowId, theme)` recolours the tab strip for one
 * window. The selected tab uses `tab_selected`, inactive tabs fall back to
 * `frame`, which naturally keeps unfocused tabs dimmer. The colour ramps
 * green -> yellow -> red as the active tab approaches expiry, with separate
 * palettes for light and dark system themes.
 *
 * Because a theme update replaces the whole window theme, we start from the
 * complete copy of Firefox's default light/dark chrome colours and layer the
 * user's current theme colours (if Firefox reports any) on top. The built-in
 * "System theme (auto)" reports none, which is why the full base palette is
 * required: any key left unset would fall back to Firefox's light defaults.
 */
import { api, hasThemeApi } from "../../shared/browser.js";
import { BASE_THEMES, rampColor, toHex } from "../../shared/color.js";

export const id = "theme-tint";
export const label = "Tint the active tab (Firefox)";
export const description = "The background of the tab you are viewing takes the colour. Firefox only.";

const touchedWindows = new Set();
let baseColors = null;
let scheme = "light";
let mediaQuery = null;
let lastTabs = [];

export function supported() {
  return hasThemeApi && typeof globalThis.matchMedia === "function";
}

export async function start(_ctx) {
  mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
  scheme = mediaQuery.matches ? "dark" : "light";
  mediaQuery.addEventListener("change", onSchemeChange);

  // Snapshot the user's theme before we touch anything.
  const current = await api.theme.getCurrent().catch(() => ({}));
  baseColors = current?.colors && Object.keys(current.colors).length ? current.colors : null;
}

export async function update(tabs) {
  lastTabs = tabs;
  const byWindow = new Map();
  for (const t of tabs) if (t.active) byWindow.set(t.windowId, t);

  await Promise.all(
    [...byWindow.values()].map(async ({ windowId, progress, quiet }) => {
      if (quiet) {
        // Hand the window back to the browser's own theme.
        if (touchedWindows.delete(windowId)) await api.theme.reset(windowId).catch(() => {});
        return;
      }
      const colors = {
        ...BASE_THEMES[scheme],
        ...(baseColors ?? {}),
        tab_selected: toHex(rampColor(progress, scheme)),
      };
      touchedWindows.add(windowId);
      await api.theme.update(windowId, { colors }).catch(() => {});
    }),
  );
}

export async function stop() {
  mediaQuery?.removeEventListener("change", onSchemeChange);
  mediaQuery = null;
  await Promise.all([...touchedWindows].map((w) => api.theme.reset(w).catch(() => {})));
  touchedWindows.clear();
  lastTabs = [];
}

function onSchemeChange(e) {
  scheme = e.matches ? "dark" : "light";
  update(lastTabs);
}
