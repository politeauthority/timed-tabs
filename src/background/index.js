/**
 * Background entry point. Wires settings, the tab tracker and the active
 * indicators together. Keep this file thin; logic lives in the modules.
 */
import { api, withTimeout } from "../shared/browser.js";
import { watchSettings } from "../shared/settings.js";
import { grantedOrigins, hasWebAccess } from "../shared/permissions.js";
import { GREEN_END } from "../shared/color.js";
import { createTabTracker } from "./tab-tracker.js";
import { findIndicators } from "./indicators/index.js";
import { lastOutcome as faviconOutcome } from "./indicators/favicon.js";

const TICK_ALARM = "timed-tabs:tick";

const tracker = createTabTracker();
let settings = null;
let active = [];
const expired = new Set();
const diag = { ticks: 0, lastTick: null, lastError: null, lastSnapshot: [] };

const ready = tracker.seed();

// Development hook: an untracked src/dev.json such as
//   { "openUrls": ["ui/panel.html"], "settings": { "tabLifetimeSeconds": 60 } }
// makes the background open those extension pages and apply those settings on
// every (re)load, since web-ext's --start-url fires before the add-on exists
// and storage cannot be seeded from outside. Never packaged.
fetch(api.runtime.getURL("dev.json"))
  .then((r) => r.json())
  .then(async (dev) => {
    if (dev.settings) await api.storage.sync.set(dev.settings);
    await Promise.all((dev.openUrls ?? []).map((u) => api.tabs.create({ url: api.runtime.getURL(u) })));
  })
  .catch(() => {});

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

  await api.alarms.clear(TICK_ALARM);
  api.alarms.create(TICK_ALARM, { periodInMinutes: Math.max(1, settings.tickSeconds) / 60 });
  await tick();
});

/** Pause every window's active tab, or resume them all, to match the setting. */
async function applyPauseSetting() {
  const activeTabs = await api.tabs.query({ active: true });
  const op = settings.pauseWhileActive ? tracker.pause : tracker.resume;
  await Promise.all(activeTabs.map((t) => op(t.id)));
}

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) tick();
});

api.tabs.onCreated.addListener(async (tab) => {
  await tracker.track(tab.id);
  if (tab.active && settings?.pauseWhileActive) await tracker.pause(tab.id);
  tick();
});

api.tabs.onRemoved.addListener((tabId) => {
  expired.delete(tabId);
  tracker.forget(tabId);
});

api.tabs.onActivated.addListener(async ({ tabId, previousTabId }) => {
  if (!settings) return;
  const s = await tracker.track(tabId);
  if (s.resetOnActivate ?? settings.resetOnActivate) await tracker.reset(tabId);
  if (settings.pauseWhileActive) {
    await tracker.pause(tabId);
    if (previousTabId !== undefined) await tracker.resume(previousTabId);
  }
  tick();
});

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
    default:
      return undefined;
  }
});

api.runtime.onSuspend?.addListener(() => Promise.all(active.map((i) => i.stop())));

/** Everything the popup needs to describe one tab's timer. */
async function tabState(tabId) {
  if (!settings) return null;
  const now = Date.now();
  const s = await tracker.track(tabId, now);
  const lifetime = tracker.lifetimeFor(tabId, settings.tabLifetimeSeconds);
  const elapsed = tracker.elapsedSeconds(tabId, now);
  return {
    tabId,
    elapsedSeconds: elapsed,
    lifetimeSeconds: lifetime,
    remainingSeconds: Math.max(0, lifetime - elapsed),
    progress: tracker.progressFor(tabId, settings.tabLifetimeSeconds, now),
    paused: s.pausedAt !== null,
    extraSeconds: s.extraSeconds,
    neverExpire: s.neverExpire,
    resetOnActivate: s.resetOnActivate,
  };
}

/** Timer state for every tab, grouped by window, for the overview list. */
async function allTabs() {
  if (!settings) return [];
  const [tabs, windows] = await Promise.all([api.tabs.query({}), api.windows.getAll()]);
  const byWindow = new Map(windows.map((w) => [w.id, { windowId: w.id, focused: w.focused, tabs: [] }]));
  for (const tab of tabs) {
    const state = await tabState(tab.id);
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
    case "snooze":
      await tracker.snooze(tabId, Number(value) || settings.tabLifetimeSeconds);
      expired.delete(tabId);
      break;
    case "neverExpire":
      await tracker.setNeverExpire(tabId, value);
      expired.delete(tabId);
      break;
    case "resetOnActivate":
      await tracker.setResetOnActivate(tabId, value);
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
      const exempt = tab.pinned || s.neverExpire;
      const progress = exempt ? 0 : tracker.progressFor(tab.id, settings.tabLifetimeSeconds, now);
      const remainingSeconds = Math.max(
        0,
        tracker.lifetimeFor(tab.id, settings.tabLifetimeSeconds) - tracker.elapsedSeconds(tab.id, now),
      );
      // quiet: the user asked for no visible change while a tab is still green.
      const quiet = settings.hideWhileGreen && (exempt || progress < GREEN_END);
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
      if (progress >= 1 && !tab.active && !exempt) await expire(tab);
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

async function expire(tab) {
  if (expired.has(tab.id)) return;
  expired.add(tab.id);
  try {
    if (settings.onExpire === "close") await api.tabs.remove(tab.id);
    else if (settings.onExpire === "discard") await api.tabs.discard(tab.id);
  } catch {
    // Tab may already be gone or not discardable; ignore.
  }
}
