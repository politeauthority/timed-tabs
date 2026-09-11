/**
 * Strategy: the toolbar button itself becomes the timer.
 *
 * The button's icon is repainted per tab with a ring that drains clockwise
 * from twelve and ramps green -> yellow -> red, so the button shows the state
 * of the tab you are looking at without reading a number off the badge.
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
 */
import { api } from "../../shared/browser.js";
import { rampColor, toHex } from "../../shared/color.js";
import { IDENTITY_PROGRESS, dialShapes, paintShapes } from "../../shared/icon-art.js";

export const id = "action-icon";
export const label = "Timer ring on the toolbar button";
export const description =
  "The Timed Tabs button draws a ring that empties as the tab you are on runs out of time. Works on pages the other indicators cannot reach.";

/** The sizes Firefox and Chrome pick between for the toolbar button. */
const SIZES = [16, 32];

/** Distinct ring positions. One step is under half a pixel on a 16px dial. */
const BUCKETS = 60;

const action = () => api.action ?? api.browserAction;

const cache = new Map();
/** The icon key last pushed for a tab, so unchanged tabs cost nothing. */
const painted = new Map();

export function supported() {
  return Boolean(action()?.setIcon) && Boolean(makeCanvas(SIZES[0]));
}

export async function start() {
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
  const live = new Set(tabs.map((t) => t.tabId));
  for (const tabId of painted.keys()) if (!live.has(tabId)) painted.delete(tabId);

  await Promise.all(
    tabs.map(async (t) => {
      const key = iconKey(t, blinkOn);
      if (painted.get(t.tabId) === key) return;
      try {
        await a.setIcon({ tabId: t.tabId, imageData: iconFor(key) });
        painted.set(t.tabId, key);
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
  const a = action();
  const resting = iconFor(iconKey({ quiet: true }));
  await Promise.all(
    // Every tab, not just the ones this instance remembers painting: on Chrome
    // the service worker restarts and forgets, but the icons stay.
    [...new Set([...painted.keys(), ...(await api.tabs.query({}).catch(() => [])).map((t) => t.id)])].map(async (tabId) => {
      // Firefox drops a per-tab icon when handed null. A browser that will
      // not gets the resting mark instead, which is the packaged icon redrawn.
      try {
        await a.setIcon({ tabId, imageData: null });
      } catch {
        try {
          await a.setIcon({ tabId, imageData: resting });
        } catch {
          // Tab has gone; nothing to put back.
        }
      }
    }),
  );
  painted.clear();
  cache.clear();
}

/**
 * The state of one tab as a cache key: which mark, at which ring position.
 * A tab with no timer running gets the resting mark, so the button matches
 * the packaged icon rather than going blank.
 */
export function iconKey(tab, lit = true) {
  if (tab.exempt || tab.quiet) return `idle:${Math.round(IDENTITY_PROGRESS * BUCKETS)}`;
  const progress = Math.min(1, Math.max(0, tab.progress ?? 0));
  if (progress >= 1) return "expired";
  const bucket = Math.round(progress * BUCKETS);
  return `${tab.flashing && !lit ? "flash" : "running"}:${bucket}`;
}

/** ImageData for every size a key needs, painted once and kept. */
function iconFor(key) {
  const hit = cache.get(key);
  if (hit) return hit;

  const [name, bucket] = key.split(":");
  const progress = name === "expired" ? 1 : Number(bucket) / BUCKETS;
  const state = name === "expired" ? "expired" : name === "flash" ? "flash" : "running";
  // The resting mark keeps the fresh green whatever its ring says.
  const color = toHex(rampColor(name === "idle" ? 0 : progress, "vivid"));

  const images = {};
  for (const size of SIZES) {
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    paintShapes(ctx, dialShapes({ progress, size, state }), size, color);
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
