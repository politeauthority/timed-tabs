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
 *
 * A tab closed in a private window is still counted, because the user asked to
 * be told when tabs close, but it is never named: the operating system keeps a
 * notification history, and a click that reopened the page would put it back in
 * an ordinary window. It appears as "a private tab" and nothing can be restored
 * from it.
 */
import { api as defaultApi } from "../shared/browser.js";
import { isPrivateTab } from "../shared/recent.js";

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
    // The permission is optional and may have been granted since load, in
    // which case the namespace appeared after start() ran.
    if (enabled) start();
  }

  /** Record a tab we just closed. Cheap and synchronous; the send is batched. */
  function tabClosed(tab) {
    if (!enabled || !available()) return;
    const isPrivate = isPrivateTab(tab);
    pending.push({
      title: isPrivate ? "" : tab?.title || tab?.url || "Untitled tab",
      url: isPrivate ? "" : (tab?.url ?? ""),
      private: isPrivate,
    });
    timer ??= setTimeout(flush, flushMs);
  }

  async function flush() {
    timer = null;
    const batch = pending;
    pending = [];
    if (!batch.length || !enabled || !available()) return;
    const id = `timed-tabs:closed:${++seq}`;
    // Private tabs contribute no url, so a click can never reopen one.
    targets.set(id, batch.filter((t) => !t.private).map((t) => t.url));
    try {
      await api.notifications.create(id, {
        type: "basic",
        // Chrome requires an iconUrl and will not take an SVG, so this is the
        // raster mark from scripts/icons.mjs rather than icons/icon.svg.
        iconUrl: api.runtime?.getURL?.("icons/icon-96.png"),
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
    // Every tab in the batch was private: there is nothing to put back.
    if (!urls.length) {
      api.notifications?.clear?.(id);
      return;
    }
    const [only] = urls;
    // One tab: put it straight back. Several: the Tabs page lists them all.
    const opened = urls.length === 1 && only ? api.tabs.create({ url: only }) : Promise.reject();
    opened.catch(() => api.tabs.create({ url: api.runtime.getURL(RECENT_PAGE) }).catch(() => {}));
    api.notifications?.clear?.(id);
  }

  function onClosed(id) {
    targets.delete(id);
  }

  let listening = false;
  function start() {
    if (listening || !api.notifications?.onClicked) return;
    api.notifications.onClicked.addListener(onClicked);
    api.notifications.onClosed?.addListener(onClosed);
    listening = true;
  }

  function stop() {
    api.notifications?.onClicked?.removeListener?.(onClicked);
    api.notifications?.onClosed?.removeListener?.(onClosed);
    listening = false;
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
  const titles = batch.map((t) => (t.private ? "A private tab" : truncate(t.title)));
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
