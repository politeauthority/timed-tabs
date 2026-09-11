/**
 * Colour helpers for indicator strategies.
 *
 * Everything here is pure so it can be unit tested without a browser.
 * `progress` is always 0 (just opened) .. 1 (expired).
 */

/** Progress below this is the "green zone": fresh enough to leave alone. */
export const GREEN_END = 0.4;

export function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

/**
 * Colour stops for the green -> yellow -> red ramp, one set per scheme.
 * Chosen to sit comfortably as a tab background next to Firefox's default
 * light/dark chrome while keeping the default text colour readable.
 */
export const RAMPS = Object.freeze({
  light: [
    [0, [0xb6, 0xe3, 0xb0]], // green
    [0.5, [0xf6, 0xe3, 0x8f]], // yellow
    [1, [0xf4, 0x9c, 0x9c]], // red
  ],
  dark: [
    [0, [0x2f, 0x5e, 0x35]],
    [0.5, [0x6b, 0x5e, 0x1c]],
    [1, [0x73, 0x2a, 0x2a]],
  ],
});

/**
 * Saturated ramp for small marks (favicons, badges) that must stay visible
 * on both light and dark tab strips.
 */
export const VIVID_RAMP = Object.freeze([
  [0, [0x2e, 0xcc, 0x71]], // green
  [0.5, [0xf1, 0xc4, 0x0f]], // yellow
  [1, [0xe7, 0x4c, 0x3c]], // red
]);

/**
 * Colours for marks that are not counting down, and so have no place on the
 * ramp: a clock that is stopped, and a tab that will never expire. Both are
 * deliberately off the green -> red axis, so "not running" cannot be misread
 * as "plenty of time left".
 */
export const STATE_COLORS = Object.freeze({
  paused: [0x70, 0x7d, 0x91], // slate
  exempt: [0x4a, 0x9e, 0xda], // blue
});

/**
 * Firefox's built-in light/dark chrome colours (browser/themes/addons/{light,dark}).
 * A theme.update() replaces the whole window theme, so every key we do not
 * set would fall back to Firefox's light defaults. Keep these complete so
 * the only visible change is `tab_selected`. Only public theme keys are used;
 * builtin-only keys are rejected by the extension schema.
 */
export const BASE_THEMES = Object.freeze({
  light: {
    frame: "#f0f0f4",
    frame_inactive: "#ebebef",
    toolbar: "#f9f9fb",
    toolbar_text: "#15141a",
    bookmark_text: "#15141a",
    toolbar_top_separator: "transparent",
    toolbar_bottom_separator: "#cccccc",
    tab_selected: "#f9f9fb",
    tab_background_text: "#15141a",
    tab_text: "#15141a",
    tab_line: "transparent",
    icons: "#5b5b66",
    toolbar_field: "#ffffff",
    toolbar_field_text: "#15141a",
    toolbar_field_border: "transparent",
    toolbar_field_focus: "#ffffff",
    toolbar_field_text_focus: "#15141a",
    popup: "#ffffff",
    popup_text: "#15141a",
    popup_border: "#f0f0f4",
    popup_highlight: "#e0e0e6",
    popup_highlight_text: "#15141a",
    sidebar: "#ffffff",
    sidebar_text: "#15141a",
    sidebar_border: "#e0e0e6",
    ntp_background: "#f9f9fb",
    ntp_card_background: "#ffffff",
    ntp_text: "#15141a",
    button_background_hover: "rgba(207,207,216,0.66)",
    button_background_active: "#cfcfd8",
  },
  dark: {
    frame: "#1c1b22",
    frame_inactive: "#1c1b22",
    toolbar: "#2b2a33",
    toolbar_text: "#fbfbfe",
    bookmark_text: "#fbfbfe",
    toolbar_top_separator: "transparent",
    toolbar_bottom_separator: "#0c0c0d",
    tab_selected: "#42414d",
    tab_background_text: "#fbfbfe",
    tab_text: "#fbfbfe",
    tab_line: "transparent",
    icons: "#fbfbfe",
    toolbar_field: "#1c1b22",
    toolbar_field_text: "#fbfbfe",
    toolbar_field_border: "transparent",
    toolbar_field_focus: "#42414d",
    toolbar_field_text_focus: "#fbfbfe",
    popup: "#42414d",
    popup_text: "#fbfbfe",
    popup_border: "#52525e",
    popup_highlight: "#2b2a33",
    popup_highlight_text: "#fbfbfe",
    sidebar: "#38383d",
    sidebar_text: "#f9f9fa",
    sidebar_border: "rgba(255,255,255,0.1)",
    ntp_background: "#2b2a33",
    ntp_card_background: "#42414d",
    ntp_text: "#fbfbfe",
    button_background_hover: "#52525e",
    button_background_active: "#5b5b66",
  },
});

/** Linear interpolation between piecewise stops. Returns [r, g, b]. */
export function rampColor(progress, scheme = "light") {
  const stops = scheme === "vivid" ? VIVID_RAMP : (RAMPS[scheme] ?? RAMPS.light);
  const p = clamp01(progress);
  for (let i = 1; i < stops.length; i++) {
    const [p0, c0] = stops[i - 1];
    const [p1, c1] = stops[i];
    if (p <= p1) {
      const t = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
    }
  }
  return stops[stops.length - 1][1].slice();
}

/** Blend a colour towards a background to make it read as "dimmer". */
export function dim([r, g, b], [br, bg, bb], amount) {
  const t = clamp01(amount);
  return [r + (br - r) * t, g + (bg - g) * t, b + (bb - b) * t].map(Math.round);
}

export function toHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function clamp255(v) {
  return Math.min(255, Math.max(0, Math.round(v)));
}
