/**
 * Background entry point. Wires settings, the tab tracker and the active
 * indicators together. Keep this file thin; logic lives in the modules.
 */
import { api, withTimeout } from "../shared/browser.js";
import { watchRules, watchSettings } from "../shared/settings.js";
import { effectiveSettings } from "../shared/rules.js";
import { grantedOrigins, hasWebAccess } from "../shared/permissions.js";
import { createTabTracker } from "./tab-tracker.js";
import { findIndicators } from "./indicators/index.js";
import { lastOutcome as faviconOutcome } from "./indicators/favicon.js";

const TICK_ALARM = "timed-tabs:tick";

const tracker = createTabTracker();
let settings = null;
let rules = [];
let active = [];
const expired = new Set();
const diag = { ticks: 0, lastTick: null, lastError: null, lastSnapshot: [] };

/** Tabs closed by expiry, newest first, persisted in storage.local and pruned by retention. */
const RECENT_KEY = "recentExpired";
const RECENT_MAX = 200;
let recent = null;
async function loadRecent() {
  if (!recent) {
    const { [RECENT_KEY]: stored } = await api.storage.local.get(RECENT_KEY);
    recent = Array.isArray(stored) ? stored : [];
  }
  const keepMs = (settings?.recentRetentionSeconds ?? 86400) * 1000;
  const cutoff = Date.now() - keepMs;
  const kept = recent.filter((r) => r.expiredAt >= cutoff);
  if (kept.length !== recent.length) {
    recent = kept;
    await api.storage.local.set({ [RECENT_KEY]: recent });
  }
  return recent;
}
async function recordExpired(tab, action) {
  const list = await loadRecent();
  list.unshift({
    id: `${tab.id}-${Date.now()}`,
    tabId: tab.id,
    title: tab.title || tab.url || "",
    url: tab.url ?? "",
    favIconUrl: typeof tab.favIconUrl === "string" && !tab.favIconUrl.startsWith("data:") ? tab.favIconUrl : "",
    expiredAt: Date.now(),
    action,
  });
  list.splice(RECENT_MAX);
  await api.storage.local.set({ [RECENT_KEY]: list });
}

const ready = tracker.seed();

// Development hook. The dev build (scripts/build.mjs dev) stamps a "-dev@"
// extension id into the manifest; only that build reads dev.json, which can
// open extension pages and seed settings/rules for a test profile:
//   { "openUrls": ["ui/panel.html"], "settings": {...}, "rules": [...] }
// The id check (not the file's presence) is the gate, so the user's own
// profile, which loads src/, can never be seeded.
const IS_DEV_BUILD = typeof api.runtime.id === "string" && api.runtime.id.includes("-dev@");
if (IS_DEV_BUILD) {
  fetch(api.runtime.getURL("dev.json"), { cache: "no-store" })
    .then((r) => r.json())
    .then(async (dev) => {
      if (dev.settings) await api.storage.sync.set(dev.settings);
      if (dev.rules) await api.storage.local.set({ rules: dev.rules });
      for (const urls of dev.openWindows ?? []) await api.windows.create({ url: urls }).catch(() => {});
      await Promise.all((dev.openUrls ?? []).map((u) => api.tabs.create({ url: api.runtime.getURL(u) })));
      // "captureAfterMs": render the active tab via the browser (works even
      // when the window is not on screen) and log it as a data URL.
      if (dev.captureAfterMs) {
        setTimeout(async () => {
          try {
            const dataUrl = await api.tabs.captureVisibleTab(undefined, { format: "png" });
            // Chunked: long console lines get truncated on the way to stdout.
            const size = 2000;
            const n = Math.ceil(dataUrl.length / size);
            for (let i = 0; i < n; i++) console.log(`[timed-tabs] CAPTURE ${i + 1}/${n} ${dataUrl.slice(i * size, (i + 1) * size)}`);
          } catch (e) {
            console.log("[timed-tabs] CAPTURE failed " + String(e));
          }
        }, dev.captureAfterMs);
      }
    })
    .catch(() => {});
}

watchSettings(async (next) => {
  const previous = settings;
  settings = next;
  await ready;

  const wanted = findIndicators(settings.indicators);
  await Promise.all(active.filter((i) => !wanted.includes(i)).map((i) => i.stop()));
  await Promise.all(wanted.filter((i) => !active.includes(i)).map((i) => i.start({ api, tracker, settings })));
  for (const i of wanted) if (active.includes(i)) i.configure?.(settings);
  active = wanted;

  if (previous?.pauseWhileActive !== settings.pauseWhileActive) await applyPauseSetting();
  void previous;

  await api.alarms.clear(TICK_ALARM);
  api.alarms.create(TICK_ALARM, { periodInMinutes: Math.max(1, settings.tickSeconds) / 60 });
  await tick();
});

watchRules((next) => {
  rules = next;
  if (settings) applyPauseSetting().then(tick);
});

/** Settings that apply to one tab: globals, then matching rules, then per-tab overrides. */
function settingsFor(tab, tabState) {
  const url = tab.url ?? "";
  const ignoredIds = new Set(tabState?.ignoredRules ?? []);
  const active = tabState?.ignoreRules ? [] : rules.filter((r) => !ignoredIds.has(r.id));
  const eff = effectiveSettings(settings, active, url);
  // Everything that would match if nothing were ignored, for the UI.
  eff.allMatched = effectiveSettings(settings, rules, url).matched;
  eff.ignoredIds = ignoredIds;
  if (tabState?.resetOnActivate !== null && tabState?.resetOnActivate !== undefined) {
    eff.resetOnActivate = tabState.resetOnActivate;
  }
  if (tabState?.neverExpire) eff.neverExpire = true;
  return eff;
}

/** Pause or resume every window's active tab to match its effective setting. */
async function applyPauseSetting() {
  const activeTabs = await api.tabs.query({ active: true });
  await Promise.all(
    activeTabs.map(async (t) => {
      const eff = settingsFor(t, await tracker.track(t.id));
      await (eff.pauseWhileActive ? tracker.pause : tracker.resume)(t.id);
    }),
  );
}

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) tick();
});

api.tabs.onCreated.addListener(async (tab) => {
  const st = await tracker.track(tab.id);
  if (tab.active && settings && settingsFor(tab, st).pauseWhileActive) await tracker.pause(tab.id);
  tick();
});

api.tabs.onRemoved.addListener((tabId) => {
  expired.delete(tabId);
  tracker.forget(tabId);
});

api.tabs.onActivated.addListener(async ({ tabId, previousTabId }) => {
  if (!settings) return;
  const tab = await api.tabs.get(tabId).catch(() => ({ id: tabId }));
  const eff = settingsFor(tab, await tracker.track(tabId));
  if (eff.resetOnActivate) await tracker.reset(tabId);
  if (eff.pauseWhileActive) await tracker.pause(tabId);
  if (previousTabId !== undefined) await tracker.resume(previousTabId);
  tick();
});

// Rules match on URL, so a navigation can change a tab's effective settings:
// re-evaluate at once, let the new page expire on its own terms, and bring
// the active tab's pause state in line with the rules that now apply.
api.tabs.onUpdated.addListener(
  async (tabId, change, tab) => {
    if (!change.url || !settings) return;
    expired.delete(tabId);
    if (tab?.active) {
      const eff = settingsFor(tab, await tracker.track(tabId));
      await (eff.pauseWhileActive ? tracker.pause : tracker.resume)(tabId);
    }
    tick();
  },
  { properties: ["url"] },
);

api.tabs.onUpdated.addListener(
  (_tabId, change) => {
    if (change.status === "complete") tick();
  },
  { properties: ["status"] },
);

api.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case "timed-tabs:diag":
      return Promise.all([hasWebAccess(), grantedOrigins()]).then(([hasHostPermission, origins]) => ({
        ...diag,
        settings,
        activeIndicators: active.map((i) => i.id),
        hasHostPermission,
        origins,
      }));
    case "timed-tabs:tick":
      return tick().then(() => "ok");
    case "timed-tabs:tab-state":
      return tabState(msg.tabId);
    case "timed-tabs:tab-action":
      return tabAction(msg).then(() => tabState(msg.tabId));
    case "timed-tabs:all-tabs":
      return allTabs();
    case "timed-tabs:recent":
      return loadRecent().then((list) => list.slice());
    case "timed-tabs:recent-remove":
      return loadRecent().then(async (list) => {
        recent = list.filter((r) => r.id !== msg.id);
        await api.storage.local.set({ [RECENT_KEY]: recent });
        return "ok";
      });
    case "timed-tabs:recent-clear":
      recent = [];
      return api.storage.local.set({ [RECENT_KEY]: [] }).then(() => "ok");
    case "timed-tabs:recent-reopen":
      return api.tabs.create({ url: msg.url }).then((t) => t.id);
    default:
      return undefined;
  }
});

api.runtime.onSuspend?.addListener(() => Promise.all(active.map((i) => i.stop())));

/** Everything the popup needs to describe one tab's timer. */
async function tabState(tabId, tab) {
  if (!settings) return null;
  const now = Date.now();
  const s = await tracker.track(tabId, now);
  tab ??= await api.tabs.get(tabId).catch(() => ({ id: tabId }));
  const eff = settingsFor(tab, s);
  if (IS_DEV_BUILD) console.log(`[timed-tabs] tabState ${tabId} lifetime=${eff.tabLifetimeSeconds} ignored=${JSON.stringify(s.ignoredRules)} all=${s.ignoreRules}`);
  const lifetime = tracker.lifetimeFor(tabId, eff.tabLifetimeSeconds);
  const elapsed = tracker.elapsedSeconds(tabId, now);
  return {
    tabId,
    elapsedSeconds: elapsed,
    lifetimeSeconds: lifetime,
    remainingSeconds: Math.max(0, lifetime - elapsed),
    progress: tracker.progressFor(tabId, eff.tabLifetimeSeconds, now),
    paused: s.pausedAt !== null,
    extraSeconds: s.extraSeconds,
    neverExpire: s.neverExpire,
    resetOnActivate: s.resetOnActivate,
    ignoreRules: s.ignoreRules,
    ignoredRules: s.ignoredRules ?? [],
    effective: {
      tabLifetimeSeconds: eff.tabLifetimeSeconds,
      onExpire: eff.onExpire,
      resetOnActivate: eff.resetOnActivate,
      pauseWhileActive: eff.pauseWhileActive,
      neverExpire: eff.neverExpire,
    },
    rules: eff.allMatched.map((r) => ({
      id: r.id,
      description: r.description ?? "",
      pattern: r.pattern,
      priority: r.priority,
      set: r.set,
      ignored: s.ignoreRules || eff.ignoredIds.has(r.id),
    })),
  };
}

/** Timer state for every tab, grouped by window, for the overview list. */
async function allTabs() {
  if (!settings) return [];
  const [tabs, windows, lastFocused] = await Promise.all([
    api.tabs.query({}),
    api.windows.getAll(),
    api.windows.getLastFocused().catch(() => null),
  ]);
  // "Active" is the window the user last worked in, even if another app has focus now.
  const activeId = lastFocused?.id ?? windows.find((w) => w.focused)?.id;
  const byWindow = new Map(windows.map((w) => [w.id, { windowId: w.id, focused: w.id === activeId, tabs: [] }]));
  for (const tab of tabs) {
    const state = await tabState(tab.id, tab);
    const group = byWindow.get(tab.windowId) ?? { windowId: tab.windowId, focused: false, tabs: [] };
    byWindow.set(tab.windowId, group);
    group.tabs.push({
      ...state,
      title: tab.title || tab.url || "",
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      active: tab.active,
      pinned: tab.pinned,
      discarded: Boolean(tab.discarded),
      index: tab.index,
    });
  }
  const groups = [...byWindow.values()];
  for (const g of groups) g.tabs.sort((a, b) => a.index - b.index);
  groups.sort((a, b) => Number(b.focused) - Number(a.focused));
  return groups;
}

async function tabAction({ tabId, action, value }) {
  switch (action) {
    case "reset":
      await tracker.reset(tabId);
      expired.delete(tabId);
      break;
    case "snooze": {
      const tab = await api.tabs.get(tabId).catch(() => ({ id: tabId }));
      const eff = settingsFor(tab, await tracker.track(tabId));
      await tracker.snooze(tabId, Number(value) || eff.tabLifetimeSeconds);
      expired.delete(tabId);
      break;
    }
    case "neverExpire":
      await tracker.setNeverExpire(tabId, value);
      expired.delete(tabId);
      break;
    case "resetOnActivate":
      await tracker.setResetOnActivate(tabId, value);
      break;
    case "ignoreRules":
      await tracker.setIgnoreRules(tabId, value);
      expired.delete(tabId);
      await applyPauseSetting();
      break;
    case "ignoreRule":
      await tracker.setRuleIgnored(tabId, value.ruleId, value.ignored);
      expired.delete(tabId);
      await applyPauseSetting();
      break;
    case "close":
      expired.delete(tabId);
      await api.tabs.remove(tabId).catch(() => {});
      break;
    case "focus": {
      const tab = await api.tabs.update(tabId, { active: true });
      await api.windows.update(tab.windowId, { focused: true }).catch(() => {});
      break;
    }
  }
  await tick();
}

let ticking = false;
async function tick() {
  if (!settings || ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    diag.ticks += 1;
    diag.lastTick = now;
    const tabs = await api.tabs.query({});
    const snapshot = [];
    for (const tab of tabs) {
      const s = await tracker.track(tab.id, now);
      const eff = settingsFor(tab, s);
      const exempt = tab.pinned || eff.neverExpire;
      const progress = exempt ? 0 : tracker.progressFor(tab.id, eff.tabLifetimeSeconds, now);
      const remainingSeconds = Math.max(
        0,
        tracker.lifetimeFor(tab.id, eff.tabLifetimeSeconds) - tracker.elapsedSeconds(tab.id, now),
      );
      // quiet: the user asked for no visible change while a tab is still green.
      // quiet: show nothing for this tab. Always for tabs that cannot expire
      // (pinned, timer off), and while still green if the user asked for that.
      const quietUntil = Math.min(0.99, Math.max(0.01, (settings.quietUntilPercent ?? 40) / 100));
      const quiet = exempt || (settings.hideWhileGreen && progress < quietUntil);
      snapshot.push({
        exempt,
        quiet,
        remainingSeconds,
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        status: tab.status,
        discarded: Boolean(tab.discarded),
        iconAdopted: typeof tab.favIconUrl === "string" && tab.favIconUrl.startsWith("data:image/png"),
        active: tab.active,
        progress,
      });
      if (progress >= 1 && !tab.active && !exempt) await expire(tab, eff.onExpire);
    }
    await Promise.all(
      active.map((i) =>
        withTimeout(i.update(snapshot), 10_000, `${i.id}.update`).catch((e) =>
          console.warn("[timed-tabs]", String(e)),
        ),
      ),
    );
    diag.lastSnapshot = snapshot.map((t) => ({ ...t, favicon: faviconOutcome.get(t.tabId) ?? "" }));
  } catch (e) {
    diag.lastError = String(e);
    console.warn("[timed-tabs] tick failed", String(e));
  } finally {
    ticking = false;
  }
}

async function expire(tab, onExpire) {
  if (expired.has(tab.id)) return;
  expired.add(tab.id);
  try {
    if (onExpire === "close") {
      // Only tabs we actually close are worth listing; the site's own icon, not our painted one.
      const icon = tab.favIconUrl && !tab.favIconUrl.startsWith("data:") ? tab.favIconUrl : "";
      await recordExpired({ ...tab, favIconUrl: icon }, "close").catch(() => {});
      await api.tabs.remove(tab.id);
    }
    else if (onExpire === "discard") await api.tabs.discard(tab.id);
    else if (onExpire === "reload") {
      // Refresh the page and start the clock again, so it keeps refreshing every lifetime.
      await api.tabs.reload(tab.id);
      await tracker.reset(tab.id);
      expired.delete(tab.id);
    }
  } catch {
    // Tab may already be gone or not discardable; ignore.
  }
}
