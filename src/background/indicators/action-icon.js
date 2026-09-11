/**
 * Strategy: the toolbar button itself becomes the timer.
 *
 * The button's icon is repainted per tab with a ring that drains from twelve
 * and ramps green -> yellow -> red, so the button shows the state of the tab
 * you are looking at without reading a number off the badge.
 *
 * This is the only indicator with no reach problem: it needs no content
 * script, no permissions and no theme API, so it works on `about:` pages,
 * the add-ons store and anywhere else the favicon and title indicators
 * cannot go.
 *
 * Repaints are cached by state, not by tab. The ring is quantised to
 * `BUCKETS` steps, which is finer than the eye can follow on a 16px circle,
 * so a window full of tabs shares a handful of images; and a tab whose
 * bucket has not changed is not pushed to the browser at all.
 *
 * Behind the `primary-icon-interactive` flag the same indicator paints a
 * different mark: a clock face that empties rather than a ring that drains,
 * with a look of its own for a tab that never expires, a colour of its own for
 * a stopped clock, and only for the tab in front of you. See `iconKey`.
 */
import { api, isDevBuild } from "../../shared/browser.js";
import { STATE_COLORS, rampColor, toHex } from "../../shared/color.js";
import { IDENTITY_PROGRESS, dialShapes, faceShapes, paintShapes } from "../../shared/icon-art.js";
import { featureOn } from "../../shared/flags.js";

export const id = "action-icon";
// Named for the button rather than the artwork, because the artwork is what
// the flag changes: a ring by default, a clock face while the interactive
// clock is on. One entry turns the indicator on and off either way, so a label
// naming one of the two marks is wrong half the time. When the flag is folded
// in, this goes back to naming the mark it is left with.
export const label = "Timer on the toolbar button";
export const description =
  "The Timed Tabs button empties as the tab you are on runs out of time: a ring that drains, or a clock face with the Interactive toolbar clock beta on. Works on pages the other indicators cannot reach.";

/** The flag that swaps the draining ring for the interactive clock. */
const FLAG = "primary-icon-interactive";

/** The sizes Firefox and Chrome pick between for the toolbar button. */
const SIZES = [16, 32];

/** Distinct ring positions. One step is under half a pixel on a 16px dial. */
const BUCKETS = 60;

const action = () => api.action ?? api.browserAction;

const cache = new Map();
/** The icon key last pushed for a tab, so unchanged tabs cost nothing. */
const painted = new Map();

/** True while the flag is on: the clock face, following the active tab. */
let interactive = false;
/** Set when the mark changes, so the next paint starts from a clean toolbar. */
let pendingReset = false;

export function supported() {
  return Boolean(action()?.setIcon) && Boolean(makeCanvas(SIZES[0]));
}

export async function start(ctx) {
  cache.clear();
  painted.clear();
  interactive = featureOn(ctx?.settings, FLAG);
}

/**
 * The flag can be turned on or off while the indicator is running, and the
 * two marks share neither artwork nor which tabs they paint. Clearing the
 * caches repaints every tab; `pendingReset` puts back the icons the other
 * mode painted, which nothing else would ever come back to.
 */
export function configure(settings) {
  const next = featureOn(settings, FLAG);
  if (next === interactive) return;
  interactive = next;
  pendingReset = true;
  cache.clear();
  painted.clear();
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
  if (pendingReset) {
    pendingReset = false;
    await resetIcons();
  }
  // The interactive mark is the state of the tab you are looking at, so only
  // the active tab of each window carries one.
  //
  // The ring paints every tab, which is work nobody can see: a toolbar button
  // belongs to a tab and the window only ever shows the active tab's, so a
  // window of sixty tabs is sixty `setIcon` calls a tick for fifty-nine
  // pictures no one can reach. Following the active tab would be safe --
  // `tabs.onActivated` ticks, so a switch repaints in the same turn rather
  // than on the next timer -- but it changes the mark every user already has,
  // so it waits behind `primary-icon-interactive` with the rest of the clock.
  // Paired with the key each one is to carry, so a tab the mark is withheld
  // from drops out here and is cleared by the loop below like any other tab
  // that has stopped carrying one.
  const targets = (interactive ? tabs.filter((t) => t.active) : tabs)
    .map((t) => ({ tab: t, key: iconKey(t, blinkOn, interactive) }))
    .filter(({ key }) => key !== null);
  const live = new Set(targets.map(({ tab }) => tab.tabId));
  for (const tabId of painted.keys()) {
    if (live.has(tabId)) continue;
    painted.delete(tabId);
    // A tab that has stopped being the active one keeps its icon until it is
    // taken off; a tab missing from the whole list has closed and needs nothing.
    if (interactive && tabs.some((t) => t.tabId === tabId)) void clearIcon(tabId);
  }

  await Promise.all(
    targets.map(async ({ tab: t, key }) => {
      if (painted.get(t.tabId) === key) return;
      try {
        await a.setIcon({ tabId: t.tabId, imageData: iconFor(key) });
        painted.set(t.tabId, key);
        devLogPaint(t.tabId, key);
      } catch {
        // Tab may have closed mid-update.
        painted.delete(t.tabId);
      }
    }),
  );
}

export async function stop() {
  if (blinkTimer) clearInterval(blinkTimer);
  blinkTimer = null;
  blinkOn = true;
  pendingReset = false;
  await resetIcons();
  painted.clear();
  cache.clear();
}

/** Take the painted icon off every tab, leaving the packaged one. */
async function resetIcons() {
  const tabIds = new Set([
    // Every tab, not just the ones this instance remembers painting: on Chrome
    // the service worker restarts and forgets, but the icons stay.
    ...painted.keys(),
    ...(await api.tabs.query({}).catch(() => [])).map((t) => t.id),
  ]);
  await Promise.all([...tabIds].map((tabId) => clearIcon(tabId)));
}

/**
 * Dev build only: what was pushed to which tab's button. Only a change is ever
 * pushed, so the line is already one per change rather than one per tick --
 * which makes it the record of what the toolbar actually shows, the one thing
 * no screenshot can prove (the button is browser chrome, and `captureVisibleTab`
 * photographs the page).
 */
function devLogPaint(tabId, key) {
  if (isDevBuild) console.log(`[timed-tabs] painted ${tabId} ${key}`);
}

async function clearIcon(tabId) {
  const a = action();
  devLogPaint(tabId, "none");
  // Firefox drops a per-tab icon when handed null. A browser that will not
  // gets the resting mark instead, which is the packaged icon redrawn.
  try {
    await a.setIcon({ tabId, imageData: null });
  } catch {
    try {
      await a.setIcon({ tabId, imageData: iconFor(iconKey({ quiet: true })) });
    } catch {
      // Tab has gone; nothing to put back.
    }
  }
}

/**
 * The state of one tab as a cache key: which mark, at which fill. A tab with
 * no timer running gets the resting mark, so the button matches the packaged
 * icon rather than going blank.
 *
 * The interactive clock keys apart two states the ring has no way to show. A
 * tab that can never expire is `exempt` rather than resting, because "nothing
 * is draining" is worth saying; a stopped clock is `paused` at the fill it
 * stopped at, which is the state the active tab is in whenever the clock is
 * set to pause on the tab you are using. `paused` keys apart for the colour
 * alone -- it draws the running face, frozen where its progress left it.
 */
export function iconKey(tab, lit = true, live = false) {
  const prefix = live ? "face-" : "";
  if (live && tab.exempt) return "face-exempt";
  // Null means no mark at all: the icon comes off and the button falls back to
  // the packaged one. The clock has to say nothing rather than say the wrong
  // thing -- a quiet tab is one this indicator is not painting (still fresh
  // with "leave fresh tabs alone" on, or a rule has taken the toolbar off the
  // page), and the resting mark is a *filled face at 75%*, which is not a
  // resting look at all but a reading, and a false one: a tab with a sliver
  // left showed three quarters full.
  //
  // The ring keeps the resting mark, because there it is the packaged icon
  // redrawn and reads as one. Only the face has to be withheld.
  if (live && tab.quiet) return null;
  if (tab.exempt || tab.quiet) return `${prefix}idle:${Math.round(IDENTITY_PROGRESS * BUCKETS)}`;
  const progress = Math.min(1, Math.max(0, tab.progress ?? 0));
  if (progress >= 1) return `${prefix}expired`;
  const bucket = Math.round(progress * BUCKETS);
  if (tab.flashing && !lit) return `${prefix}flash:${bucket}`;
  if (live && tab.paused) return `face-paused:${bucket}`;
  return `${prefix}running:${bucket}`;
}

/**
 * What a cache key means: which artwork, how full, and in what colour.
 * Pure, so the states a key can name are checkable without a canvas.
 */
export function specFor(key) {
  const [name, bucket] = key.split(":");
  const live = name.startsWith("face-");
  const state = live ? name.slice("face-".length) : name;
  const progress = state === "expired" ? 1 : Number(bucket ?? 0) / BUCKETS;
  // The resting mark keeps the fresh green whatever its fill says.
  const color =
    state === "paused" ? STATE_COLORS.paused
    : state === "exempt" ? STATE_COLORS.exempt
    : rampColor(state === "idle" ? 0 : progress, "vivid");
  return { live, state, progress, color: toHex(color) };
}

/** ImageData for every size a key needs, painted once and kept. */
function iconFor(key) {
  const hit = cache.get(key);
  if (hit) return hit;

  const { live, state, progress, color } = specFor(key);
  // Both marks draw a resting tab as an ordinary running one, and the clock
  // draws a stopped one the same way: only the fill and the colour say it is
  // not counting down.
  const art = state === "idle" || state === "paused" ? "running" : state;

  const images = {};
  for (const size of SIZES) {
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    const shapes = live
      ? faceShapes({ progress, size, state: art })
      : dialShapes({ progress, size, state: art });
    paintShapes(ctx, shapes, size, color);
    images[size] = ctx.getImageData(0, 0, size, size);
  }
  cache.set(key, images);
  return images;
}

/** OffscreenCanvas in an MV3 worker, a real one in an MV2 background page. */
function makeCanvas(size) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(size, size);
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}
