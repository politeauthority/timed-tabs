/**
 * Getting to the full page from the popup, and the title link home.
 */
import { $ } from "./dom.js";
import { api } from "../shared/browser.js";
import { isPopup } from "./state.js";

export async function openPageView(hash = "", extraParams = {}) {
  const base = api.runtime.getURL("ui/panel.html");
  const q = new URLSearchParams({ view: "page", ...extraParams });
  const url = `${base}?${q}${hash}`;
  const [existing] = await api.tabs.query({ url: `${base}*` }).catch(() => []);
  if (existing) {
    await api.tabs.update(existing.id, { active: true, url });
    await api.windows
      .update(existing.windowId, { focused: true })
      .catch(() => {});
  } else {
    await api.tabs.create({ url });
  }
  if (isPopup) window.close();
}

$("open-page").addEventListener("click", () => openPageView("#tabs"));

// The popup has no pages of its own, so its title opens the full page instead.
$("home-link").addEventListener("click", (e) => {
  if (!isPopup) return;
  e.preventDefault();
  openPageView("#tabs");
});
