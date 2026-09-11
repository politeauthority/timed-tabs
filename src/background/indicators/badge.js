/**
 * Strategy: remaining time on the toolbar button's badge.
 *
 * Badge text and colour are set per tab, so the button always reflects the
 * tab you are looking at. Works in every browser with an action API.
 */
import { api } from "../../shared/browser.js";
import { rampColor, toHex } from "../../shared/color.js";

export const id = "badge";
export const label = "Minutes left on the toolbar button";
export const description = "The Timed Tabs toolbar button shows the minutes left for the current tab.";

const action = () => api.action ?? api.browserAction;
const touched = new Set();

export function supported() {
  return Boolean(action()?.setBadgeText);
}

export async function start() {
  await action().setBadgeTextColor?.({ color: "#15141a" }).catch?.(() => {});
}

let blinkTimer = null;
let blinkOn = true;
let lastTabs = [];

export async function update(tabs) {
  lastTabs = tabs;
  const anyFlashing = tabs.some((t) => t.flashing);
  if (anyFlashing && !blinkTimer) {
    blinkTimer = setInterval(() => {
      blinkOn = !blinkOn;
      paint(lastTabs);
    }, 700);
  } else if (!anyFlashing && blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
    blinkOn = true;
  }
  await paint(tabs);
}

async function paint(tabs) {
  const a = action();
  await Promise.all(
    tabs.map(async (t) => {
      touched.add(t.tabId);
      const text = t.flashing && !blinkOn ? "!" : badgeText(t);
      try {
        await a.setBadgeText({ tabId: t.tabId, text });
        if (text) await a.setBadgeBackgroundColor({ tabId: t.tabId, color: toHex(rampColor(t.progress, "vivid")) });
      } catch {
        // Tab may have closed mid-update.
      }
    }),
  );
}

export async function stop() {
  if (blinkTimer) clearInterval(blinkTimer);
  blinkTimer = null;
  blinkOn = true;
  const a = action();
  await Promise.all([...touched].map((tabId) => a.setBadgeText({ tabId, text: "" }).catch(() => {})));
  touched.clear();
}

/** "12m", "45s", "!" when expired, or nothing for exempt tabs. */
export function badgeText(t) {
  if (t.exempt || t.quiet) return "";
  const s = Math.max(0, Math.round(t.remainingSeconds ?? 0));
  if (s <= 0) return "!";
  if (s >= 3600) return `${Math.floor(s / 3600)}h`;
  if (s >= 60) return `${Math.ceil(s / 60)}m`;
  return `${s}s`;
}
