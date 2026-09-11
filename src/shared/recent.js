/**
 * Pure helpers for the "Recently expired" list. Storage and rendering live in
 * background/index.js and ui/panel.js.
 */

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
