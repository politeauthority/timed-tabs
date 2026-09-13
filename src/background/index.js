/**
 * Background entry point. Wires settings, the tab tracker and the active
 * indicators together. Keep this file thin; logic lives in the modules.
 */
import { api, isDevBuild, withTimeout } from "../shared/browser.js";
import { leadReached } from "../shared/lead.js";
import { watchGroups, watchRules, watchSettings } from "../shared/settings.js";
import { featureOn } from "../shared/flags.js";
import { RULE_FIELDS, applicableRules, applyOverrides, effectiveSettings, managesTab, wantedIndicatorIds } from "../shared/rules.js";
import { snoozeSeconds } from "../shared/time.js";
import { grantedOrigins, hasWebAccess } from "../shared/permissions.js";
import { createTabTracker } from "./tab-tracker.js";
import { createNotifier } from "./notify.js";
import { recordFor, recordsExpiry, withinExpiredGrace } from "../shared/recent.js";
import { clearStats, emptyStats, record as recordStat, restoreKilled, summarise } from "../shared/stats.js";
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
  // Evaluated per call, since isDevBuild is declared further down.
  log: (msg) => isDevBuild && console.log(`[timed-tabs] notify ${msg}`),
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
 * A queue that runs its `fn`s one at a time. Overlapping runs used to race:
 * two could start an indicator twice, or leave a running one untracked so
 * nothing ever stopped it, and two could read the same list out of storage
 * and write back two different edits of it.
 *
 * Every queue costs whatever is waiting on it the time of everything already
 * queued, so work goes on the queue that guards what it touches and no wider.
 */
function queue() {
  let chain = Promise.resolve();
  return function run(fn) {
    const next = chain.then(fn, fn);
    chain = next.catch((e) => console.warn("[timed-tabs]", String(e)));
    return next;
  };
}

/** Settings, rules and groups changes, and anything that starts or stops indicators. */
const serial = queue();

/**
 * Every read-modify-write of the lists in storage.local -- the recently-expired
 * list and the tally -- so that two edits of one list cannot cross. It must
 * stay a separate queue from `serial`: a settings change runs on `serial` and
 * waits there for the tick it starts, that tick can expire a tab, and closing
 * a tab waits for its record to be written. On one shared queue that record
 * waits behind the settings change that is waiting for it, and the deadlock
 * leaves the tab open, the tick half-run and every later tick refused.
 */
const serialStore = queue();
let active = [];
/**
 * Tabs whose time is already up, against the action that was taken and the
 * moment it was. Not a bare set, twice over: "already dealt with" is only true
 * of the action that dealt with it, so a tab that ran out under "Leave it
 * open" must expire again the moment the action becomes "Close it"; and the
 * stamp is what lets the window list hold an expired tab for a while and then
 * let it go. In memory on purpose: a background that restarts has forgotten
 * every clock anyway, and the tick works the tabs out again from scratch.
 */
const expired = new Map();
/**
 * Tabs "Only manage tabs a rule matches" is holding back, so the tick can see
 * the moment a rule takes one in and start its clock from there.
 */
const dormant = new Set();
const diag = { ticks: 0, lastTick: null, lastError: null, lastSnapshot: [] };

/** Tabs that expired, closed or not, newest first, persisted in storage.local and pruned by retention. */
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
/**
 * The recent list, each row told whether the tab it names is still open.
 *
 * The stored `action` is not enough to say so. A tab we closed is gone; a tab
 * merely left to expire may have been closed by the user since, or reloaded
 * onto something else. Tab ids also start over when the browser does, so an id
 * on its own could point at a stranger -- the address has to match it before a
 * row offers to take you there.
 */
async function liveRecent() {
  const [list, tabs] = await Promise.all([loadRecent(), api.tabs.query({})]);
  const urlById = new Map(tabs.map((t) => [t.id, t.url ?? ""]));
  return list.map((r) => ({ ...r, open: Boolean(r.url) && urlById.get(r.tabId) === r.url }));
}

function recordExpired(tab, action) {
  return serialStore(() => recordExpiredNow(tab, action));
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
  if (isDevBuild) console.log(`[timed-tabs] recorded ${tab.url} icon=${list[0].favIconUrl ? "yes" : "no"}`);
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
  return serialStore(async () => {
    const before = await loadStats();
    const after = recordStat(before, event);
    if (after === before) return;
    stats = after;
    await api.storage.local.set({ [STATS_KEY]: after });
  });
}

const ready = tracker.seed();

// @dev-only-start  (scripts/build.mjs removes everything down to @dev-only-end from release builds)
// Development hook. Only the dev build reads dev.json, which can open extension
// pages and seed settings/rules for a test profile:
//   { "openUrls": ["ui/panel.html"], "settings": {...}, "rules": [...] }
// The id check (not the file's presence) is the gate, so the user's own
// profile, which loads src/, can never be seeded.
if (isDevBuild) {
  fetch(api.runtime.getURL("dev.json"), { cache: "no-store" })
    .then((r) => r.json())
    .then(async (dev) => {
      if (dev.settings) await api.storage.sync.set(dev.settings);
      // Rules and groups in one write, so they land as one change rather than
      // two: between two, a tab could be looked at with the rules in and the
      // groups not, and a group rule is inert without its group.
      const local = {};
      if (dev.rules) local.rules = dev.rules;
      if (dev.groups) local.siteGroups = dev.groups;
      if (Object.keys(local).length) await api.storage.local.set(local);
      // A tally to start from, so a scenario can check what the panel makes of
      // one without having to live through a fortnight first. The in-memory
      // copy is set too: the first tick may already have loaded and cached an
      // empty one, and a write alone would be overwritten by the next bump.
      if (dev.stats) {
        stats = dev.stats;
        await api.storage.local.set({ [STATS_KEY]: stats });
      }
      // A resolved set() means the write landed, not that this background has
      // taken it in: that happens three hops later, when onChanged fires, the
      // watcher reads the area back, and the queued handler assigns it. Open a
      // window before then and its tabs get their first look from the old
      // state -- on a loaded Chrome that was a `square` logged for a tab whose
      // rule says `dot`, one line before the right answer. So wait for the
      // module's own variables to show the seed, then drain the queue so the
      // handlers those changes started have finished too. Bounded: a seed that
      // never shows up is logged and the scenario goes on, rather than hanging.
      // Key order must not count: Chrome hands an object back from storage
      // with its keys sorted, so the rule that went in as {id, description,
      // pattern, ...} comes out as {description, id, match, ...}, and a plain
      // JSON.stringify comparison never matched -- every Chrome scenario sat
      // out the full ten seconds and the navigation one ran out of window.
      const canon = (v) =>
        Array.isArray(v) ? v.map(canon)
        : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
        : v;
      const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
      // A setting that is itself an object -- featureFlags -- comes back filled
      // in with every flag the build knows, so the seed's {a: true} is absorbed
      // once each key it names reads back, not when the whole object matches.
      const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
      const holds = (have, want) =>
        plain(want) && plain(have) ? Object.entries(want).every(([k, v]) => same(have[k], v)) : same(have, want);
      const absorbed = () =>
        Object.entries(dev.settings ?? {}).every(([k, v]) => holds(settings?.[k], v)) &&
        (!dev.rules || same(rules, dev.rules)) &&
        (!dev.groups || same(groups, dev.groups));
      const deadline = Date.now() + 10_000;
      while (!absorbed() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      if (!absorbed()) console.log("[timed-tabs] dev: seed not absorbed after 10s; opening windows anyway");
      await serial(async () => {});
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
  dormant.clear();
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
  // "Only manage tabs a rule matches" narrows the master switch to the pages
  // the user has written a rule for: a tab no rule speaks for is left alone
  // as completely as the switch leaves every tab. Read off the rules in
  // force, not the ones that merely match, so a tab that has switched its
  // rules off has switched itself out with them.
  eff.unmanaged = !managesTab(settings, active);
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
  dormant.delete(tabId);
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
      return liveRecent();
    case "timed-tabs:recent-remove": {
      // One entry by id, or every entry in a grouped row by its ids.
      const ids = new Set(Array.isArray(msg.ids) ? msg.ids : [msg.id]);
      return serialStore(async () => {
        const list = await loadRecent();
        recent = list.filter((r) => !ids.has(r.id));
        await api.storage.local.set({ [RECENT_KEY]: recent });
        return "ok";
      });
    }
    case "timed-tabs:stats":
      return loadStats().then((s) => summarise(s));
    case "timed-tabs:stats-clear":
      // Everything but the lifetime count of tabs killed, which a clear keeps.
      return serialStore(async () => {
        stats = clearStats(await loadStats());
        await api.storage.local.set({ [STATS_KEY]: stats });
        return "ok";
      });
    case "timed-tabs:stats-restore":
      // A backup being loaded. The count only ever goes up, and an unchanged
      // one costs no write, on the same contract as `bumpStats`.
      return serialStore(async () => {
        const before = await loadStats();
        const after = restoreKilled(before, msg.killed);
        if (after !== before) {
          stats = after;
          await api.storage.local.set({ [STATS_KEY]: after });
        }
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
  if (isDevBuild) console.log(`[timed-tabs] tabState ${tabId} lifetime=${eff.tabLifetimeSeconds} ignored=${JSON.stringify(s.ignoredRules)} all=${s.ignoreRules}`);
  const lifetime = tracker.lifetimeFor(tabId, eff.tabLifetimeSeconds);
  const elapsed = tracker.elapsedSeconds(tabId, now);
  return {
    tabId,
    elapsedSeconds: elapsed,
    lifetimeSeconds: lifetime,
    remainingSeconds: Math.max(0, lifetime - elapsed),
    progress: tracker.progressFor(tabId, eff.tabLifetimeSeconds, now),
    paused: s.pausedAt !== null,
    unmanaged: eff.unmanaged,
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

/**
 * Timer state for every tab, grouped by window, for the overview list.
 *
 * A tab that expired more than its grace ago is counted in its window's
 * `total` but left out of `tabs`: it is still open, and "Recently expired"
 * has it, but the window list is for tabs there is still time to do
 * something about. The panel shows both numbers, so a short list under a
 * larger count reads as tabs held back rather than tabs lost.
 */
async function allTabs() {
  if (!settings) return [];
  const now = Date.now();
  const [tabs, windows, lastFocused] = await Promise.all([
    api.tabs.query({}),
    api.windows.getAll(),
    api.windows.getLastFocused().catch(() => null),
  ]);
  // "Active" is the window the user last worked in, even if another app has focus now.
  const activeId = lastFocused?.id ?? windows.find((w) => w.focused)?.id;
  const blank = (id, focused) => ({ windowId: id, focused, tabs: [], total: 0 });
  const byWindow = new Map(windows.map((w) => [w.id, blank(w.id, w.id === activeId)]));
  for (const tab of tabs) {
    const group = byWindow.get(tab.windowId) ?? blank(tab.windowId, false);
    byWindow.set(tab.windowId, group);
    group.total += 1;
    const expiredAt = expired.get(tab.id)?.at ?? null;
    if (!withinExpiredGrace(expiredAt, now)) continue;
    const state = await tabState(tab.id, tab);
    group.tabs.push({
      ...state,
      expiredAt,
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
      // A tab a rule has just taken in starts its life from this moment: time
      // spent on a page nothing was watching is not time the tab sat unread,
      // and nothing should expire the instant a rule is written. The other
      // direction needs nothing; a held-back tab's clock is never read.
      // A tab that falls out of rule coverage drops its expiry with the rest
      // of its clock. It would otherwise stay held back from the window list
      // for an expiry that no longer means anything -- the row beside it says
      // "no rule", and a tab nothing is watching is not one to hide.
      if (eff.unmanaged) {
        dormant.add(tab.id);
        expired.delete(tab.id);
      }
      else if (dormant.delete(tab.id)) {
        await tracker.reset(tab.id, now);
        expired.delete(tab.id);
      }
      // A tab held back by "only manage tabs a rule matches" is exempt like a
      // pinned one: no clock read, nothing expired, and every mark withheld.
      const exempt = tab.pinned || eff.neverExpire || eff.unmanaged;
      const progress = exempt ? 0 : tracker.progressFor(tab.id, eff.tabLifetimeSeconds, now);
      const remainingSeconds = Math.max(
        0,
        tracker.lifetimeFor(tab.id, eff.tabLifetimeSeconds) - tracker.elapsedSeconds(tab.id, now),
      );
      // quiet: show nothing for this tab. Always for tabs that cannot expire
      // (pinned, timer off), and while still green if the user asked for that.
      // Appearance comes from the tab's effective settings, so rules can
      // change how (and whether) a tab is painted.
      // The lead is measured back from expiry, against this tab's own
      // lifetime as its rules and snoozes have left it (see shared/lead.js).
      const quiet = exempt || (eff.hideWhileGreen && !leadReached(eff.quietStart, progress, remainingSeconds));
      const flashing =
        eff.flashBeforeExpiry && !quiet && remainingSeconds > 0 && leadReached(eff.flashLead, progress, remainingSeconds);
      if (isDevBuild) devLogLook(tab, eff, quiet);
      snapshot.push({
        exempt,
        // Not "nothing to show yet" but "nothing here at all": the toolbar
        // button has a mark of its own to say so.
        unmanaged: eff.unmanaged,
        quiet,
        flashing,
        // A stopped clock: the tab you are on while the clock pauses on the
        // active tab, or one a rule has parked. Indicators that can say so
        // show it rather than leaving a frozen timer looking like a slow one.
        paused: s.pausedAt !== null,
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
  if (expired.get(tab.id)?.action === onExpire || expiring.has(tab.id)) return;
  expiring.add(tab.id);
  if (isDevBuild) console.log(`[timed-tabs] expired ${tab.id} ${tab.url} action=${onExpire}`);
  try {
    // Written down whatever we then do with the tab, because the list is where
    // an expired tab goes once its window has let it go -- a tab left open is
    // as worth finding again as one we closed. The favicon indicator may have
    // replaced the icon with its own painting, so ask the page's content
    // script for the original; unreachable pages get a fallback.
    if (recordsExpiry(onExpire)) {
      const originalIcon = await withTimeout(
        api.tabs.sendMessage(tab.id, { type: "timed-tabs:original-icon" }),
        1500,
        "original-icon",
      ).catch(() => "");
      await recordExpired({ ...tab, originalIcon }, onExpire).catch(() => {});
    }
    if (onExpire === "close") {
      await api.tabs.remove(tab.id);
      // Past this line the tab is gone, which is the only thing worth
      // asserting: deciding to close one and closing it are two events, and
      // every bug here has lived in the gap between them.
      if (isDevBuild) console.log(`[timed-tabs] closed ${tab.id} ${tab.url}`);
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
    // Done, and not to be done again until the clock restarts or the action
    // changes under it. A reload has just restarted the clock; the others
    // record what was done, and when, so the tab is left alone while the
    // answer holds and its window keeps it listed for the grace.
    if (onExpire !== "reload") expired.set(tab.id, { action: onExpire, at: Date.now() });
  } catch {
    // Tab may already be gone or not discardable: try again next tick.
  } finally {
    expiring.delete(tab.id);
  }
}
