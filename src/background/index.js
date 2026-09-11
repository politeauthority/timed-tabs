/**
 * Background entry point. Wires settings, the tab tracker and the active
 * indicators together. Keep this file thin; logic lives in the modules.
 */
import { api, withTimeout } from "../shared/browser.js";
import { watchGroups, watchRules, watchSettings } from "../shared/settings.js";
import { featureOn } from "../shared/flags.js";
import { RULE_FIELDS, applicableRules, applyOverrides, effectiveSettings, wantedIndicatorIds } from "../shared/rules.js";
import { snoozeSeconds } from "../shared/time.js";
import { grantedOrigins, hasWebAccess } from "../shared/permissions.js";
import { createTabTracker } from "./tab-tracker.js";
import { createNotifier } from "./notify.js";
import { recordFor } from "../shared/recent.js";
import { emptyStats, record as recordStat, summarise } from "../shared/stats.js";
import { findIndicators } from "./indicators/index.js";
import { lastOutcome as faviconOutcome } from "./indicators/favicon.js";

const TICK_ALARM = "timed-tabs:tick";

/**
 * The master switch. Everything that touches a tab goes through here, so
 * turning it off leaves the browser exactly as if Timed Tabs were not
 * installed. Settings may not have loaded yet, and an older profile will not
 * have the key at all, so anything but an explicit false counts as on.
 */
function managing() {
  return Boolean(settings) && settings.tabManagement !== false;
}

const tracker = createTabTracker();
const notifier = createNotifier({
  // Evaluated per call, since IS_DEV_BUILD is declared further down.
  log: (msg) => IS_DEV_BUILD && console.log(`[timed-tabs] notify ${msg}`),
});
notifier.start();
let settings = null;
let rules = [];
let groups = [];
/** Site groups only take part while their feature flag is on; off, group rules match nothing. */
// featureOn, not flagOn: site groups also needs the beta-features switch, and
// the raw switch would have let it run with that master switch off.
const activeGroups = () => (featureOn(settings, "site-groups") ? groups : []);

/**
 * Settings, rules and groups changes, and anything that starts or stops
 * indicators, run one at a time. Two overlapping runs used to race on
 * `active`: one could start an indicator twice, or leave a running one
 * untracked so nothing ever stopped it.
 */
let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch((e) => console.warn("[timed-tabs]", String(e)));
  return next;
}
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
function recordExpired(tab, action) {
  return serial(() => recordExpiredNow(tab, action));
}
async function recordExpiredNow(tab, action) {
  // `recordFor` returns nothing for a tab from a private window: it is expired
  // and closed like any other, but a record of it would outlive the session
  // that promised not to keep one.
  const entry = recordFor(tab, action);
  if (!entry) return;
  const list = await loadRecent();
  list.unshift(entry);
  list.splice(RECENT_MAX);
  await api.storage.local.set({ [RECENT_KEY]: list });
  if (IS_DEV_BUILD) console.log(`[timed-tabs] recorded ${tab.url} icon=${list[0].favIconUrl ? "yes" : "no"}`);
}

/**
 * The tally. Counts only — see shared/stats.js for why that matters — kept in
 * storage.local beside the recently-expired list, and loaded the same lazy way
 * so a restarted service worker picks it up again without a startup read.
 *
 * Not in storage.sync on purpose. It is written whenever a tab expires, and
 * Chrome rations sync writes by the minute; a busy profile would spend that
 * allowance on a number nobody is waiting to see on another machine.
 */
const STATS_KEY = "stats";
let stats = null;
async function loadStats() {
  if (!stats) {
    const { [STATS_KEY]: stored } = await api.storage.local.get(STATS_KEY);
    stats = stored ?? emptyStats();
  }
  return stats;
}

/**
 * Count one event, and write only if it changed anything. `record` hands back
 * the object it was given when nothing moved, which is what keeps a tick that
 * reports the open-tab count from touching the disk on every pass.
 */
function bumpStats(event) {
  return serial(async () => {
    const before = await loadStats();
    const after = recordStat(before, event);
    if (after === before) return;
    stats = after;
    await api.storage.local.set({ [STATS_KEY]: after });
  });
}

const ready = tracker.seed();

/**
 * True in a dev build (scripts/build.mjs dev or chrome-dev), which is the gate
 * on the hook below and on a few log lines.
 *
 * Two independent marks, and either one is enough. Firefox installs a dev build
 * under a "-dev@" id, which is what docs/developer/security-notes.md records as
 * the guarantee. Chrome has no such id to look at — it derives one from the key
 * or the install path — so the manifest name carries it there instead;
 * scripts/manifest.js is what writes it.
 *
 * Neither can fire in the user's own profile. A plain `src/` load is named
 * `__MSG_extensionName__`, which resolves to "Timed Tabs", and carries the
 * real add-on id.
 */
const IS_DEV_BUILD =
  (typeof api.runtime.id === "string" && api.runtime.id.includes("-dev@")) ||
  api.runtime.getManifest().name.endsWith("(dev)");
// @dev-only-start  (scripts/build.mjs removes everything down to @dev-only-end from release builds)
// Development hook. Only the dev build reads dev.json, which can open extension
// pages and seed settings/rules for a test profile:
//   { "openUrls": ["ui/panel.html"], "settings": {...}, "rules": [...] }
// The id check (not the file's presence) is the gate, so the user's own
// profile, which loads src/, can never be seeded.
if (IS_DEV_BUILD) {
  fetch(api.runtime.getURL("dev.json"), { cache: "no-store" })
    .then((r) => r.json())
    .then(async (dev) => {
      if (dev.settings) await api.storage.sync.set(dev.settings);
      if (dev.rules) await api.storage.local.set({ rules: dev.rules });
      if (dev.groups) await api.storage.local.set({ siteGroups: dev.groups });
      // A tally to start from, so a scenario can check what the panel makes of
      // one without having to live through a fortnight first. The in-memory
      // copy is set too: the first tick may already have loaded and cached an
      // empty one, and a write alone would be overwritten by the next bump.
      if (dev.stats) {
        stats = dev.stats;
        await api.storage.local.set({ [STATS_KEY]: stats });
      }
      for (const urls of dev.openWindows ?? []) await api.windows.create({ url: urls }).catch(() => {});
      await Promise.all((dev.openUrls ?? []).map((u) => api.tabs.create({ url: api.runtime.getURL(u) })));
      // "navigate": [{ "at": ms, "from": url, "to": url }] sends the tab that is
      // on `from` to `to`, so a scenario can check rules re-evaluate on navigation.
      // From `at` on, it waits (up to 30s) for a tab to have finished loading
      // `from`, so a slow page on a busy machine does not turn into a miss.
      for (const n of dev.navigate ?? []) {
        setTimeout(async () => {
          const deadline = Date.now() + 30_000;
          let tab = null;
          while (!tab && Date.now() < deadline) {
            const found = await api.tabs.query({ url: n.from, status: "complete" }).catch(() => []);
            tab = found[0] ?? null;
            if (!tab) await new Promise((r) => setTimeout(r, 500));
          }
          if (!tab) return console.log(`[timed-tabs] navigate: no tab on ${n.from}`);
          await api.tabs.update(tab.id, { url: n.to }).catch(() => {});
          console.log(`[timed-tabs] navigated ${tab.id} ${n.to}`);
        }, n.at ?? 0);
      }
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
// @dev-only-end

watchSettings((next) => serial(async () => {
  const previous = settings;
  settings = next;
  await ready;
  notifier.configure(settings);

  if (!managing()) {
    await standDown();
    return;
  }
  // Coming back on, every tab gets a fresh clock: time spent switched off is
  // not time the tab was sitting unread, and nothing should expire the moment
  // the switch flips.
  if (previous && previous.tabManagement === false) await restartAllClocks();

  await syncIndicators();

  if (previous?.pauseWhileActive !== settings.pauseWhileActive) await applyPauseSetting();

  await api.alarms.clear(TICK_ALARM);
  api.alarms.create(TICK_ALARM, { periodInMinutes: Math.max(1, settings.tickSeconds) / 60 });
  await tick();
}));

/**
 * Put the browser back how we found it: stop every indicator, which is what
 * takes the favicon, title and theme marks back off, and stop the clock that
 * would otherwise expire something while we are meant to be idle.
 */
async function standDown() {
  await Promise.all(active.map((i) => i.stop().catch(() => {})));
  active = [];
  expired.clear();
  await api.alarms.clear(TICK_ALARM);
}

/** Start every tab's lifetime again from now, dropping any snooze with it. */
async function restartAllClocks() {
  const now = Date.now();
  const tabs = await api.tabs.query({});
  // A fresh clock for every tab, and a running one for every tab not on
  // screen: reset keeps a paused tab paused, and a tab that was active when
  // the switch went off would otherwise stay paused for good.
  await Promise.all(tabs.map(async (t) => {
    await tracker.reset(t.id, now);
    if (!t.active) await tracker.resume(t.id, now);
  }));
  await applyPauseSetting();
  expired.clear();
}

watchRules((next) => serial(async () => {
  rules = next;
  if (!managing()) return;
  await ready;
  await syncIndicators();
  await applyPauseSetting();
  await tick();
}));

// A group edit can change which tabs a rule matches, exactly like a rule edit.
watchGroups((next) => serial(async () => {
  groups = next;
  if (!settings) return;
  await ready;
  await applyPauseSetting();
  await tick();
}));

/**
 * Start every indicator any tab could need (globals and every enabled rule)
 * and stop the rest. Which of them paint a given tab is decided per tab in tick().
 */
async function syncIndicators() {
  const wanted = findIndicators(wantedIndicatorIds(settings, rules, tracker.allOverrides(), activeGroups()));
  await Promise.all(active.filter((i) => !wanted.includes(i)).map((i) => i.stop()));
  await Promise.all(wanted.filter((i) => !active.includes(i)).map((i) => i.start({ api, tracker, settings })));
  for (const i of wanted) if (active.includes(i)) i.configure?.(settings);
  active = wanted;
}

/** Settings that apply to one tab: globals, then matching rules, then per-tab timer choices. */
function settingsFor(tab, tabState) {
  const url = tab.url ?? "";
  const ignoredIds = new Set(tabState?.ignoredRules ?? []);
  const groupsInForce = activeGroups();
  // Match every rule once; the UI wants all of them, the settings only the
  // ones this tab has not switched off.
  const allMatched = applicableRules(rules, url, groupsInForce);
  const active = tabState?.ignoreRules ? [] : allMatched.filter((r) => !ignoredIds.has(r.id));
  const eff = effectiveSettings(settings, active, url, groupsInForce);
  eff.allMatched = allMatched;
  eff.ignoredIds = ignoredIds;
  if (tabState?.resetOnActivate !== null && tabState?.resetOnActivate !== undefined) {
    eff.resetOnActivate = tabState.resetOnActivate;
  }
  if (tabState?.neverExpire) eff.neverExpire = true;
  applyOverrides(eff, tabState?.overrides);
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
  if (!managing()) return;
  const st = await tracker.track(tab.id);
  if (tab.active && settingsFor(tab, st).pauseWhileActive) await tracker.pause(tab.id);
  tick();
});

api.tabs.onRemoved.addListener((tabId) => {
  expired.delete(tabId);
  tracker.forget(tabId);
});

api.tabs.onActivated.addListener(async ({ tabId, previousTabId }) => {
  if (!managing()) return;
  const tab = await api.tabs.get(tabId).catch(() => ({ id: tabId }));
  const eff = settingsFor(tab, await tracker.track(tabId));
  if (eff.resetOnActivate) {
    await tracker.reset(tabId);
    expired.delete(tabId); // a new life can expire again
  }
  if (eff.pauseWhileActive) await tracker.pause(tabId);
  if (previousTabId !== undefined) await tracker.resume(previousTabId);
  tick();
});

// Rules match on URL, so a navigation can change a tab's effective settings:
// re-evaluate at once, let the new page expire on its own terms, and bring
// the active tab's pause state in line with the rules that now apply.
// One listener without a filter: the `properties` filter is Firefox-only and
// Chrome rejects it, which would abort this whole module.
api.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (!managing()) return;
  if (change.url) {
    expired.delete(tabId);
    if (tab?.active) {
      const eff = settingsFor(tab, await tracker.track(tabId));
      await (eff.pauseWhileActive ? tracker.pause : tracker.resume)(tabId);
    }
    tick();
  } else if (change.status === "complete") {
    tick();
  }
});

api.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case "timed-tabs:diag":
      return Promise.all([hasWebAccess(), grantedOrigins()]).then(([hasHostPermission, origins]) => ({
        ...diag,
        settings,
        activeIndicators: active.map((i) => i.id),
        hasHostPermission,
        origins,
        notifications: notifier.status(),
      }));
    case "timed-tabs:notify-test":
      return notifier.test();
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
    case "timed-tabs:recent-remove": {
      // One entry by id, or every entry in a grouped row by its ids.
      const ids = new Set(Array.isArray(msg.ids) ? msg.ids : [msg.id]);
      return serial(async () => {
        const list = await loadRecent();
        recent = list.filter((r) => !ids.has(r.id));
        await api.storage.local.set({ [RECENT_KEY]: recent });
        return "ok";
      });
    }
    case "timed-tabs:stats":
      return loadStats().then((s) => summarise(s));
    case "timed-tabs:stats-clear":
      stats = emptyStats();
      return api.storage.local.set({ [STATS_KEY]: stats }).then(() => "ok");
    case "timed-tabs:recent-clear":
      recent = [];
      return api.storage.local.set({ [RECENT_KEY]: [] }).then(() => "ok");
    case "timed-tabs:recent-reopen":
      return api.tabs.create({ url: msg.url }).then((t) => t.id);
    default:
      return undefined;
  }
});

// The notifications permission is optional and can be granted (or taken
// away in about:addons) at any time; the notifier's listeners follow it.
api.permissions?.onAdded?.addListener(() => notifier.configure(settings));
api.permissions?.onRemoved?.addListener(() => notifier.configure(settings));

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
    overrides: { ...(s.overrides ?? {}) },
    folds: { ...(s.folds ?? {}) },
    effective: Object.fromEntries(RULE_FIELDS.map((k) => [k, eff[k]])),
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
  if (!managing()) return;
  switch (action) {
    case "reset":
      await tracker.reset(tabId);
      bumpStats({ type: "reset" });
      expired.delete(tabId);
      break;
    case "snooze": {
      // No value means "the usual amount", which is a share of this tab's own
      // lifetime -- the one its rules give it, not the global default.
      const tab = await api.tabs.get(tabId).catch(() => ({ id: tabId }));
      const eff = settingsFor(tab, await tracker.track(tabId));
      const seconds = Number(value) || snoozeSeconds(eff.tabLifetimeSeconds, settings.snoozePercent);
      await tracker.snooze(tabId, seconds);
      bumpStats({ type: "snoozed", seconds });
      expired.delete(tabId);
      break;
    }
    // Dragging the fuse in the mini UI: `value` is the share of its life the
    // tab should have used, so the clock lands wherever it was let go.
    case "progress": {
      const tab = await api.tabs.get(tabId).catch(() => ({ id: tabId }));
      const eff = settingsFor(tab, await tracker.track(tabId));
      const pct = Math.min(100, Math.max(0, Number(value) || 0));
      const lifetime = tracker.lifetimeFor(tabId, eff.tabLifetimeSeconds);
      await tracker.setElapsed(tabId, (lifetime * pct) / 100);
      // Anything short of the far end puts the tab back in the running.
      if (pct < 100) expired.delete(tabId);
      break;
    }
    // One row of the popup's Page settings: `value` is { key, value }, and a
    // null value hands the setting back to the rules and the globals.
    case "override":
      if (!RULE_FIELDS.includes(value?.key)) break;
      await tracker.setOverride(tabId, value.key, value.value);
      expired.delete(tabId);
      await serial(syncIndicators);
      await applyPauseSetting();
      break;
    case "fold":
      if (["settings", "rules"].includes(value?.section)) await tracker.setFold(tabId, value.section, value.open);
      break;
    case "clearOverrides":
      await tracker.clearOverrides(tabId);
      expired.delete(tabId);
      await syncIndicators();
      await applyPauseSetting();
      break;
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

/** Dev build only: log a tab's effective appearance whenever it changes. */
const lastLook = new Map();
function devLogLook(tab, eff, quiet) {
  const line = `ind=${(eff.indicators ?? []).join("+")} style=${eff.faviconStyle} quiet=${quiet} flash=${eff.flashBeforeExpiry}`;
  if (lastLook.get(tab.id) === line) return;
  lastLook.set(tab.id, line);
  console.log(`[timed-tabs] look ${tab.id} ${tab.url} ${line}`);
}

let ticking = false;
let tickAgain = false;
async function tick() {
  if (!managing()) return;
  // A tick that lands mid-tick (a navigation during a slow indicator update)
  // runs once the current one finishes rather than being dropped.
  if (ticking) {
    tickAgain = true;
    return;
  }
  ticking = true;
  try {
    const now = Date.now();
    diag.ticks += 1;
    diag.lastTick = now;
    const tabs = await api.tabs.query({});
    // The tick already has every tab; the record costs a comparison, and a
    // write only on the rare pass that beats it.
    bumpStats({ type: "tabs", open: tabs.length });
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
      // quiet: show nothing for this tab. Always for tabs that cannot expire
      // (pinned, timer off), and while still green if the user asked for that.
      // Appearance comes from the tab's effective settings, so rules can
      // change how (and whether) a tab is painted.
      const quietUntil = Math.min(0.99, Math.max(0.01, (eff.quietUntilPercent ?? 40) / 100));
      const quiet = exempt || (eff.hideWhileGreen && progress < quietUntil);
      const flashing =
        eff.flashBeforeExpiry && !quiet && remainingSeconds > 0 && remainingSeconds <= eff.flashLeadSeconds;
      if (IS_DEV_BUILD) devLogLook(tab, eff, quiet);
      snapshot.push({
        exempt,
        quiet,
        flashing,
        indicators: eff.indicators ?? [],
        faviconStyle: eff.faviconStyle,
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
    // An indicator a tab does not use still sees the tab, marked quiet, so it
    // undoes anything it painted before the tab's settings changed.
    const viewFor = (i) => snapshot.map((t) => (t.indicators.includes(i.id) ? t : { ...t, quiet: true, hidden: true }));
    await Promise.all(
      active.map((i) =>
        withTimeout(i.update(viewFor(i)), 10_000, `${i.id}.update`).catch((e) =>
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
    if (tickAgain) {
      tickAgain = false;
      void tick();
    }
  }
}

const expiring = new Set();
async function expire(tab, onExpire) {
  if (expired.has(tab.id) || expiring.has(tab.id)) return;
  expiring.add(tab.id);
  if (IS_DEV_BUILD) console.log(`[timed-tabs] expired ${tab.id} ${tab.url} action=${onExpire}`);
  try {
    if (onExpire === "close") {
      // Only tabs we actually close are worth listing. The favicon indicator
      // may have replaced the icon with its own painting, so ask the page's
      // content script for the original; unreachable pages get a fallback.
      const originalIcon = await withTimeout(
        api.tabs.sendMessage(tab.id, { type: "timed-tabs:original-icon" }),
        1500,
        "original-icon",
      ).catch(() => "");
      await recordExpired({ ...tab, originalIcon }, "close").catch(() => {});
      await api.tabs.remove(tab.id);
      // Only once the tab is actually gone, and only for close: unloading and
      // reloading leave the tab where it was.
      notifier.tabClosed(tab);
    }
    else if (onExpire === "discard") await api.tabs.discard(tab.id);
    else if (onExpire === "reload") {
      // Refresh the page and start the clock again, so it keeps refreshing every lifetime.
      await api.tabs.reload(tab.id);
      await tracker.reset(tab.id);
    }
    // Counted here rather than above, so the tally only ever holds things that
    // really happened: a tab that could not be closed is retried next tick and
    // must not be counted twice, nor once for an attempt that failed.
    bumpStats({ type: "expired", action: onExpire });
    // Done, and not to be done again until the clock restarts. A reload has
    // just restarted it; the others are marked so the tab is left alone.
    if (onExpire !== "reload") expired.add(tab.id);
  } catch {
    // Tab may already be gone or not discardable: try again next tick.
  } finally {
    expiring.delete(tab.id);
  }
}
