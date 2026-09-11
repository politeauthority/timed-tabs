/**
 * Strategy: an emoji at the front of the page title, so it appears between
 * the favicon and the title on every tab: 🟢 fresh, 🟡 half-way, 🟠 nearly
 * expired, 🔴 expired.
 *
 * Same reach as the favicon indicator (needs a content script). Note that
 * Firefox stores page titles in history, so history entries show the emoji.
 */
import { api } from "../../shared/browser.js";
import { createInjector } from "./inject.js";

export const id = "title-prefix";
export const label = "Coloured dot in the tab title";
export const description = "A 🟢 🟡 🟠 🔴 dot in front of the page title, on every tab. History entries show it too.";

const injector = createInjector("content/title.js");

export function supported() {
  return Boolean(api.scripting?.executeScript && api.tabs?.sendMessage);
}

export async function start() {
  api.tabs.onRemoved.addListener(injector.forget);
}

export async function update(tabs) {
  await Promise.all(
    tabs.map((t) =>
      injector.send(t, {
        type: "timed-tabs:title",
        prefix: t.exempt || t.quiet ? "" : emojiFor(t.progress),
        flash: Boolean(t.flashing),
      }),
    ),
  );
}

export async function stop() {
  api.tabs.onRemoved.removeListener(injector.forget);
  await injector.broadcast({ type: "timed-tabs:title-reset" });
  injector.clear();
}

export function emojiFor(progress) {
  if (progress >= 1) return "🔴";
  if (progress >= 0.75) return "🟠";
  if (progress >= 0.4) return "🟡";
  return "🟢";
}
