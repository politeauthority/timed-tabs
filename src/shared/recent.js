/**
 * Pure helpers for the "Recently expired" list. Storage and rendering live in
 * background/index.js and ui/panel.js.
 */

/**
 * How long a tab that has run out of time keeps its place in the window list.
 *
 * An expired tab that was not closed sits in its window with a dead clock, and
 * a profile with a few of them is mostly dead rows -- which is the state the
 * list is least useful in, since the tabs still running are the ones you can
 * still do something about. A minute is long enough to see what has just
 * gone and press Restart on it; the `expiredGraceSeconds` setting lengthens
 * it, up to an hour. After that the tab is still open and still yours; it is
 * simply listed under "Recently expired" instead.
 */
export const EXPIRED_GRACE_SECONDS = 60;

/**
 * Whether a tab still belongs in its window's list, given when it expired.
 * A tab that has not expired carries no stamp and always belongs.
 */
export function withinExpiredGrace(expiredAt, now = Date.now(), graceSeconds = EXPIRED_GRACE_SECONDS) {
  if (!expiredAt) return true;
  return now - expiredAt < graceSeconds * 1000;
}

/**
 * Whether an expiry is worth writing down.
 *
 * Everything but a reload. A reloaded tab never stopped being a live tab --
 * its clock restarts and it goes on running -- so a row saying it expired
 * would be written once a lifetime, for ever, and say nothing.
 */
export function recordsExpiry(action) {
  return action !== "reload";
}

/**
 * A tab whose address and title must not outlive its window.
 *
 * Browsers do not run extensions in private windows unless the user allows it,
 * but once allowed, a private tab arrives at expiry looking like any other. It
 * is expired and closed the same way; what must not happen is a record of it
 * being written to disk, or its title being read out in a desktop notification
 * that the operating system keeps in its own history. Both outlive the private
 * session, which is the one thing the session promised.
 */
export function isPrivateTab(tab) {
  return tab?.incognito === true;
}

/**
 * The icon to remember for a closed tab. Our favicon indicator swaps the tab's
 * icon for a painted data: URL, so that one is never kept. Prefer what the
 * content script reported as the page's own icon, then the browser's plain
 * icon, then the conventional /favicon.ico for web pages.
 */
export function iconForRecord({ url, favIconUrl, originalIcon } = {}) {
  const plain = (v) => (typeof v === "string" && v && !v.startsWith("data:") ? v : "");
  const chosen = plain(originalIcon) || plain(favIconUrl);
  if (chosen) return chosen;
  try {
    const u = new URL(url ?? "");
    if (/^https?:$/.test(u.protocol)) return new URL("/favicon.ico", u).href;
  } catch {
    // Not a web address: nothing sensible to guess.
  }
  return "";
}

/**
 * Collapse entries with the same URL into one row: the newest entry's details,
 * how many times it was closed, and every entry id so a row can be removed
 * whole. Input is newest first and the output keeps that order.
 */
export function groupRecent(list) {
  const groups = new Map();
  for (const item of list ?? []) {
    const key = item.url || item.id;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      g.ids.push(item.id);
      if (!g.favIconUrl && item.favIconUrl) g.favIconUrl = item.favIconUrl;
    } else {
      groups.set(key, { ...item, count: 1, ids: [item.id] });
    }
  }
  return [...groups.values()];
}

/**
 * The row to remember for a tab we just closed, or `null` when there must not
 * be one.
 *
 * The decision lives here, next to the predicate it depends on, so that "a
 * private tab is never written down" is a pure function with a test rather
 * than a line of the background script nothing exercises.
 */
export function recordFor(tab, action, now = Date.now()) {
  if (isPrivateTab(tab)) return null;
  return {
    id: `${tab.id}-${now}`,
    tabId: tab.id,
    title: tab.title || tab.url || "",
    url: tab.url ?? "",
    favIconUrl: iconForRecord({
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      originalIcon: tab.originalIcon,
    }),
    expiredAt: now,
    action,
  };
}
