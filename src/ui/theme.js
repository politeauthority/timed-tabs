/**
 * The browser theme, read into CSS variables so the popup and the page match the toolbar they sit under.
 */
import { api } from "../shared/browser.js";
import { isPopup } from "./state.js";

export async function applyBrowserTheme() {
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

export function cssColor(v) {
  if (!v) return null;
  if (Array.isArray(v))
    return v.length === 4 ? `rgba(${v.join(",")})` : `rgb(${v.join(",")})`;
  return String(v);
}

/** Rough luminance test on a CSS colour, via the canvas parser. */
export function isDark(color) {
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
