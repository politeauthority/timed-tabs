/**
 * Desktop notifications for tabs Timed Tabs closed.
 *
 * Only closing is announced. "Unload" leaves the tab in the strip and
 * "reload" puts a live page back in it, so neither is something the user
 * lost and neither is worth a toast.
 *
 * One tick can close several tabs at once, so closures are buffered for a
 * moment and sent as a single notification instead of a burst of them.
 * Clicking it reopens the tab when exactly one was closed, and otherwise
 * opens the Tabs page, where "Recently expired" lists them all.
 *
 * `notifications` is an optional permission: until the user turns the setting
 * on and grants it, Firefox does not expose the namespace at all, so every
 * entry point feature-detects rather than assuming it is there.
 */
import { api as defaultApi } from "../shared/browser.js";

/** Tabs closed within this long of each other share one notification. */
const FLUSH_MS = 500;
/** Titles listed by name in a batch notification before it says "and N more". */
const MAX_NAMED = 4;
/** Longest tab title shown; longer ones are cut with an ellipsis. */
const MAX_TITLE_CHARS = 60;

const RECENT_PAGE = "ui/panel.html?view=page#tabs";

export function createNotifier({ api = defaultApi, flushMs = FLUSH_MS } = {}) {
  let enabled = false;
  let pending = [];
  let timer = null;
  let seq = 0;
  /** Notification id -> the urls it was raised for, so a click can act on them. */
  const targets = new Map();

  /** False until the user grants the optional permission. */
  const available = () => Boolean(api.notifications?.create);

  function configure(settings) {
    enabled = Boolean(settings?.notifyOnExpire);
    if (!enabled) discardPending();
  }

  /** Record a tab we just closed. Cheap and synchronous; the send is batched. */
  function tabClosed(tab) {
    if (!enabled || !available()) return;
    pending.push({ title: tab?.title || tab?.url || "Untitled tab", url: tab?.url ?? "" });
    timer ??= setTimeout(flush, flushMs);
  }

  async function flush() {
    timer = null;
    const batch = pending;
    pending = [];
    if (!batch.length || !enabled || !available()) return;
    const id = `timed-tabs:closed:${++seq}`;
    targets.set(id, batch.map((t) => t.url));
    try {
      await api.notifications.create(id, {
        type: "basic",
        // Chrome requires an iconUrl and will not take an SVG; it gets no
        // notification until the raster icons land. Firefox is happy without.
        iconUrl: api.runtime?.getURL?.("icons/icon.svg"),
        ...describe(batch),
      });
    } catch (e) {
      targets.delete(id);
      console.warn("[timed-tabs] notification failed", String(e));
    }
  }

  function onClicked(id) {
    const urls = targets.get(id);
    if (!urls) return;
    targets.delete(id);
    const [only] = urls;
    // One tab: put it straight back. Several: the Tabs page lists them all.
    const opened = urls.length === 1 && only ? api.tabs.create({ url: only }) : Promise.reject();
    opened.catch(() => api.tabs.create({ url: api.runtime.getURL(RECENT_PAGE) }).catch(() => {}));
    api.notifications?.clear?.(id);
  }

  function onClosed(id) {
    targets.delete(id);
  }

  function start() {
    api.notifications?.onClicked?.addListener(onClicked);
    api.notifications?.onClosed?.addListener(onClosed);
  }

  function stop() {
    api.notifications?.onClicked?.removeListener?.(onClicked);
    api.notifications?.onClosed?.removeListener?.(onClosed);
    discardPending();
  }

  function discardPending() {
    pending = [];
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return { configure, tabClosed, start, stop, flush };
}

/** Notification title and message for one batch of closed tabs. */
export function describe(batch) {
  const titles = batch.map((t) => truncate(t.title));
  if (titles.length === 1) return { title: "Tab closed", message: titles[0] };
  const named = titles.slice(0, MAX_NAMED);
  const rest = titles.length - named.length;
  return {
    title: `${titles.length} tabs closed`,
    message: rest > 0 ? `${named.join(", ")}, and ${rest} more` : named.join(", "),
  };
}

function truncate(text) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > MAX_TITLE_CHARS ? `${clean.slice(0, MAX_TITLE_CHARS - 1)}…` : clean;
}
