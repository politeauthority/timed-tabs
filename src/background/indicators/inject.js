/**
 * Shared "message the tab's content script, injecting it first if needed"
 * helper for indicators that live in the page (favicon, title prefix).
 *
 * Returns { reply } on success, or { skipped: reason } / { failed: message }.
 * Per-indicator maps let each caller remember what happened for diagnostics.
 */
import { api, withTimeout } from "../../shared/browser.js";

export function createInjector(scriptFile) {
  const injected = new Map(); // tabId -> url the script was confirmed for
  const unreachable = new Map(); // tabId -> url that refused injection

  async function send(tab, msg) {
    const { tabId, url, status, discarded } = tab;
    if (!url || !/^(https?|file|ftp):/.test(url)) return { skipped: "unsupported url" };
    if (status === "loading") return { skipped: "still loading" };
    if (discarded) return { skipped: "tab unloaded" };
    if (unreachable.get(tabId) === url) return { skipped: "unreachable" };
    try {
      const reply = await withTimeout(api.tabs.sendMessage(tabId, msg), 2000, "sendMessage");
      injected.set(tabId, url);
      return { reply };
    } catch {
      // No content script yet (pre-existing tab or navigation): inject it.
    }
    try {
      await withTimeout(api.scripting.executeScript({ target: { tabId }, files: [scriptFile] }), 5000, "executeScript");
      const reply = await withTimeout(api.tabs.sendMessage(tabId, msg), 2000, "sendMessage");
      injected.set(tabId, url);
      return { reply, injectedNow: true };
    } catch (e) {
      unreachable.set(tabId, url);
      return { failed: e?.message ?? String(e) };
    }
  }

  /** Message every tab we know has the script; used to undo on stop(). */
  async function broadcast(msg) {
    await Promise.all([...injected.keys()].map((tabId) => api.tabs.sendMessage(tabId, msg).catch(() => {})));
  }

  function forget(tabId) {
    injected.delete(tabId);
    unreachable.delete(tabId);
  }

  function clear() {
    injected.clear();
    unreachable.clear();
  }

  return { send, broadcast, forget, clear };
}
