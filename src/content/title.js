/**
 * Content script for the "title-prefix" indicator: keeps an emoji at the
 * front of document.title and re-applies it when the page changes its own
 * title (SPAs, unread counters, ...). Restores the original on reset.
 */
(() => {
  if (globalThis.__timedTabsTitle) return;
  globalThis.__timedTabsTitle = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const MARKS = ["🟢", "🟡", "🟠", "🔴"];
  const prefixRe = new RegExp(`^(?:${MARKS.join("|")})\\s`);

  let prefix = "";
  let applying = false;
  let observer = null;

  api.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "timed-tabs:title") {
      prefix = msg.prefix || "";
      apply();
      watch();
      return Promise.resolve("ok");
    }
    if (msg.type === "timed-tabs:title-reset") {
      prefix = "";
      observer?.disconnect();
      observer = null;
      apply();
      return Promise.resolve("ok");
    }
  });

  function stripped() {
    return document.title.replace(prefixRe, "");
  }

  function apply() {
    const want = prefix ? `${prefix} ${stripped()}` : stripped();
    if (document.title === want) return;
    applying = true;
    document.title = want;
    applying = false;
  }

  function watch() {
    if (observer) return;
    const titleEl = document.querySelector("title") ?? document.head;
    if (!titleEl) return;
    observer = new MutationObserver(() => {
      if (!applying) apply();
    });
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }
})();
