/**
 * Shared "message the tab's content script, injecting it first if needed"
 * helper for indicators that live in the page (favicon, title prefix).
 *
 * Returns { reply } on success, or { skipped: reason } / { failed: message }.
 * Per-indicator maps let each caller remember what happened for diagnostics.
 *
 * A reply of undefined means some other content script answered the
 * runtime.onMessage call and this one is not in the page yet, so it is
 * injected; each script replies with a value of its own to its own messages.
 * A message that only undoes (opts.undo) is not worth injecting a script for.
 */
import { api, withTimeout } from "../../shared/browser.js";

export function createInjector(scriptFile) {
  const injected = new Map(); // tabId -> url the script was confirmed for
  const unreachable = new Map(); // tabId -> { url, until } after a failed injection
  // A page that refused once gets another chance after this long: a busy main
  // thread at first paint is not a permanent condition.
  const RETRY_MS = 60_000;

  async function send(tab, msg, opts = {}) {
    const { tabId, url, status, discarded } = tab;
    if (!url || !/^(https?|file|ftp):/.test(url)) return { skipped: "unsupported url" };
    if (status === "loading") return { skipped: "still loading" };
    if (discarded) return { skipped: "tab unloaded" };
    const blocked = unreachable.get(tabId);
    if (blocked && blocked.url === url && Date.now() < blocked.until) return { skipped: "unreachable" };
    if (opts.undo && injected.get(tabId) !== url) return { skipped: "nothing to undo" };
    try {
      const reply = await withTimeout(api.tabs.sendMessage(tabId, msg), 2000, "sendMessage");
      if (reply === undefined) throw new Error("another script answered; this one is not in the page");
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
      unreachable.set(tabId, { url, until: Date.now() + RETRY_MS });
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
