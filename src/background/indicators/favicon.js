/**
 * Strategy: repaint every tab's favicon with the ramp colour.
 *
 * Works on all tabs in every browser, but only where a content script can
 * run: privileged pages (about:, addons.mozilla.org, PDF viewer, etc.) are
 * skipped. The content script is injected on demand so tabs that were open
 * before the extension loaded get it too.
 */
import { api } from "../../shared/browser.js";
import { hasWebAccess } from "../../shared/permissions.js";
import { rampColor, toHex } from "../../shared/color.js";
import { createInjector } from "./inject.js";

export const id = "favicon";
export const label = "Colour every tab's favicon";
export const description = "The tab's icon gets a coloured square, ring or dot. Works on every tab.";

/** tabId -> short human-readable outcome of the last attempt, for diagnostics. */
export const lastOutcome = new Map();

const injector = createInjector("content/favicon.js");
let scheme = "light";
let mediaQuery = null;
let lastTabs = [];
let style = "square";

export function supported() {
  return Boolean(api.scripting?.executeScript && api.tabs?.sendMessage);
}

export async function start({ settings } = {}) {
  style = settings?.faviconStyle ?? "square";
  const ok = await hasWebAccess();
  if (!ok) console.warn("[timed-tabs] favicon indicator: site access not granted; open the settings page to allow it");
  if (typeof globalThis.matchMedia === "function") {
    mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
    scheme = mediaQuery.matches ? "dark" : "light";
    mediaQuery.addEventListener("change", onSchemeChange);
  }
  api.tabs.onRemoved.addListener(onTabRemoved);
}

/** Called when settings change while running. */
export function configure(settings) {
  style = settings.faviconStyle ?? "square";
}

export async function update(tabs) {
  lastTabs = tabs;
  const textColor = scheme === "dark" ? "#ffffff" : "#15141a";
  await Promise.all(
    tabs.map(async (t) => {
      const msg = t.quiet
        ? { type: "timed-tabs:reset" }
        : {
            type: "timed-tabs:favicon",
            color: toHex(rampColor(t.progress, "vivid")),
            textColor,
            active: t.active,
            progress: t.progress,
            style: t.faviconStyle ?? style,
            flash: Boolean(t.flashing),
          };
      const r = await injector.send(t, msg);
      if (r.skipped) {
        if (r.skipped !== "unreachable") lastOutcome.set(t.tabId, `skipped: ${r.skipped}`);
      } else if (r.failed) lastOutcome.set(t.tabId, `failed: ${r.failed}`);
      else if (t.quiet)
        lastOutcome.set(t.tabId, t.hidden ? "quiet (not used here)" : t.exempt ? "quiet (timer off)" : "quiet (still green)");
      else lastOutcome.set(t.tabId, `${r.injectedNow ? "injected and " : ""}painted (${r.reply ?? "no reply"})`);
    }),
  );
}

export async function stop() {
  mediaQuery?.removeEventListener("change", onSchemeChange);
  mediaQuery = null;
  api.tabs.onRemoved.removeListener(onTabRemoved);
  await injector.broadcast({ type: "timed-tabs:reset" });
  injector.clear();
  lastTabs = [];
}

function onTabRemoved(tabId) {
  injector.forget(tabId);
  lastOutcome.delete(tabId);
}

function onSchemeChange(e) {
  scheme = e.matches ? "dark" : "light";
  update(lastTabs);
}
