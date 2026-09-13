/**
 * The Backup pill on the Settings page: every setting and rule as one JSON document, to copy, download, paste or load.
 */
import { $ } from "./dom.js";
import { DEFAULTS, saveGroups, saveRules, saveSettings } from "../shared/settings.js";
import { api } from "../shared/browser.js";
import { compareVersions, getDisplayVersion } from "../shared/version.js";
import { exportText, parseBundle } from "../shared/backup.js";
import { hooks } from "./hooks.js";
import { state } from "./state.js";
import { toasts, write } from "./feedback.js";

export const backupText = $("backup-text");

/**
 * Fill the box with everything as it stands, stamped with the build writing
 * it. That stamp is also the restamp: a bundle loaded from an older Timed Tabs
 * is shown again here as this one's, so copying it back out carries this
 * version rather than the one it arrived with.
 *
 * Async only for the version, which is resolved once per page and cached.
 */
export async function showBackup() {
  const v = await getDisplayVersion().catch(() => null);
  // The lifetime count of tabs killed rides along; the rest of the tally does
  // not. A background that cannot be reached writes a zero, which a later
  // load can never lower anything with.
  const s = await api.runtime.sendMessage({ type: "timed-tabs:stats" }).catch(() => null);
  backupText.value = exportText(state.settings, state.rules, state.groups, v?.display ?? "", s);
}

/**
 * The outcome of a backup action. It has no row to sit on, so it goes to a
 * toast rather than the small line under the box, where a failure was easy to
 * miss.
 */
export function backupNote(text, level = "info") {
  toasts.show({ level, message: text, key: "backup" });
}

$("backup-refresh").addEventListener("click", showBackup);

$("backup-copy").addEventListener("click", async () => {
  await showBackup();
  try {
    await navigator.clipboard.writeText(backupText.value);
    backupNote("Copied.", "success");
  } catch {
    backupText.select();
    backupNote(
      "Could not access the clipboard. The text is selected; press Ctrl/Cmd+C.",
      "error",
    );
  }
});

$("backup-download").addEventListener("click", async () => {
  await showBackup();
  const blob = new Blob([backupText.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `timed-tabs-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  backupNote("Downloaded.", "success");
});

$("backup-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  backupText.value = await file.text();
  e.target.value = "";
  await applyBackup();
});

$("backup-apply").addEventListener("click", applyBackup);

// Two clicks within a few seconds, so a stray click cannot wipe everything.
export let resetArmed = null;

$("backup-reset").addEventListener("click", async () => {
  const b = $("backup-reset");
  if (!resetArmed) {
    b.textContent = "Click again to reset all settings and rules";
    b.classList.add("is-armed");
    resetArmed = setTimeout(() => {
      resetArmed = null;
      b.textContent = "Reset everything to defaults";
      b.classList.remove("is-armed");
    }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  b.textContent = "Reset everything to defaults";
  b.classList.remove("is-armed");
  await api.storage.sync.clear();
  await api.storage.local.clear();
  state.settings = { ...DEFAULTS };
  state.rules = [];
  state.groups = [];
  hooks.renderFields();
  hooks.renderFlagged();
  if ($("overview").open) hooks.refreshOverview();
  backupNote(
    "Reset. All settings are back to defaults and all rules are gone.",
    "warning",
  );
  showBackupSoon();
});

export async function applyBackup() {
  const here = (await getDisplayVersion().catch(() => null))?.display ?? "";
  let parsed;
  try {
    parsed = parseBundle(backupText.value, here);
  } catch (err) {
    backupNote(err.message, "error");
    return;
  }
  const loaded = { ...DEFAULTS, ...parsed.settings };
  const ok = await write(
    async () => {
      await saveSettings(loaded);
      await saveRules(parsed.rules);
      await saveGroups(parsed.groups ?? []);
    },
    {
      what: "the backup",
      key: "backup",
      note: "Some of it may have been applied; check your settings.",
    },
  );
  if (!ok) return;
  state.settings = loaded;
  state.rules = parsed.rules;
  state.groups = parsed.groups ?? [];
  // Not part of the write above: the tally is the background's, and a count
  // that fails to land is a number, not a setting the user is now looking at.
  if (parsed.stats.killed > 0) {
    await api.runtime
      .sendMessage({ type: "timed-tabs:stats-restore", killed: parsed.stats.killed })
      .catch(() => {});
    hooks.refreshStats();
  }
  hooks.renderFields();
  hooks.renderFlagged();
  if ($("overview").open) hooks.refreshOverview();
  const ruleCount = `${state.rules.length} rule${state.rules.length === 1 ? "" : "s"}`;
  // Worth saying only when the bundle came from somewhere else. A file this
  // build wrote itself, or one too old to carry a stamp, says nothing — and
  // one from a later build is left to `parseBundle`, whose warning says both
  // where it came from and why that matters.
  const from =
    parsed.version &&
    parsed.version !== here &&
    !(compareVersions(parsed.version, here) > 0)
      ? ` Written by Timed Tabs ${parsed.version}.`
      : "";
  backupNote(
    parsed.warnings.length
      ? `Loaded with ${ruleCount}.${from} ${parsed.warnings.join(" ")}`
      : `Loaded settings and ${ruleCount}.${from}`,
    parsed.warnings.length ? "warning" : "success",
  );
  // Fills the box again from what is now in force, which is what restamps the
  // bundle with this build.
  showBackupSoon();
}

export let backupTimer;

export function showBackupSoon() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(showBackup, 300);
}
