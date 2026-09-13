/**
 * The Diagnostics fold on the Settings page: what the background is doing for each tab.
 */
import { $ } from "./dom.js";
import { api } from "../shared/browser.js";
import { getDisplayVersion } from "../shared/version.js";

export async function refreshDiag() {
  const d = await api.runtime
    .sendMessage({ type: "timed-tabs:diag" })
    .catch((e) => ({ error: String(e) }));
  const summary = $("diag-summary");
  if (!d || d.error) {
    summary.textContent = `Background not reachable: ${d?.error ?? "no reply"}`;
    return;
  }
  const v = await getDisplayVersion();
  summary.textContent = [
    `version: ${v.display}${v.commit ? ` (${v.commit})` : ""}`,
    `ticks: ${d.ticks}`,
    `last tick: ${d.lastTick ? new Date(d.lastTick).toLocaleTimeString() : "never"}`,
    `last error: ${d.lastError ?? "none"}`,
    `active indicators: ${d.activeIndicators.join(", ") || "none"}`,
    `site access granted: ${d.hasHostPermission} (origins: ${(d.origins ?? []).join(", ") || "none"})`,
    `notifications: ${d.notifications ? `setting ${d.notifications.enabled ? "on" : "off"}, permission ${d.notifications.available ? "granted" : "not granted"}, click handler ${d.notifications.listening ? "armed" : "not armed"}` : "unknown"}`,
    `lifetime: ${d.settings?.tabLifetimeSeconds}s, tick every ${d.settings?.tickSeconds}s`,
  ].join("\n");
  document.querySelector("#diag-tabs tbody").replaceChildren(
    ...d.lastSnapshot.map((t) => {
      const tr = document.createElement("tr");
      const state = t.discarded ? "unloaded" : t.status;
      const cells = [
        t.tabId,
        t.active ? "yes" : "",
        state,
        t.progress.toFixed(2),
        t.favicon,
        t.iconAdopted ? "yes" : "no",
        t.url,
      ];
      for (const v of cells) {
        const td = document.createElement("td");
        td.textContent = String(v ?? "");
        td.title = String(v ?? "");
        tr.append(td);
      }
      return tr;
    }),
  );
}

$("diag-refresh").addEventListener("click", refreshDiag);

$("diag-tick").addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "timed-tabs:tick" }).catch(() => {});
  refreshDiag();
});
