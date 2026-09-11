/**
 * Tracks each tab's timer.
 *
 * Per-tab state: { openedAt, pausedAt, extraSeconds, neverExpire, resetOnActivate }
 *  - openedAt        epoch ms the clock started (shifted forward after pauses)
 *  - pausedAt        epoch ms the clock stopped, or null while running
 *  - extraSeconds    snooze: extra lifetime granted to this tab
 *  - neverExpire     user opted this tab out of expiry
 *  - resetOnActivate per-tab override of the global setting, or null
 *  - ignoreRules     skip all URL rules for this tab (lasts as long as the tab)
 *  - ignoredRules    ids of individual rules skipped for this tab
 *  - overrides       per-tab settings laid over globals and rules, until close
 *
 * State is persisted per tab with `sessions.setTabValue` on Firefox
 * (survives extension reloads and, via session restore, browser restarts).
 * Elsewhere `storage.session` is used, which only survives extension reloads.
 */
import { api } from "../shared/browser.js";

const KEY = "timedTabs";

function fresh(now) {
  return {
    openedAt: now,
    pausedAt: null,
    extraSeconds: 0,
    neverExpire: false,
    resetOnActivate: null,
    ignoreRules: false,
    ignoredRules: [],
    overrides: {},
  };
}

export function createTabTracker() {
  /** @type {Map<number, object>} */
  const state = new Map();
  const store = makeStore();

  async function seed() {
    const tabs = await api.tabs.query({});
    await Promise.all(tabs.map((tab) => track(tab.id)));
  }

  async function track(tabId, now = Date.now()) {
    if (state.has(tabId)) return state.get(tabId);
    const stored = await store.get(tabId);
    const s = stored && typeof stored.openedAt === "number" ? { ...fresh(now), ...stored } : fresh(now);
    state.set(tabId, s);
    if (!stored) await store.set(tabId, s);
    return s;
  }

  async function mutate(tabId, fn, now = Date.now()) {
    const s = await track(tabId, now);
    fn(s, now);
    await store.set(tabId, s);
    return s;
  }

  const reset = (tabId, now) =>
    mutate(
      tabId,
      (s, t) => {
        s.openedAt = t;
        if (s.pausedAt !== null) s.pausedAt = t;
        s.extraSeconds = 0;
      },
      now,
    );

  const pause = (tabId, now) =>
    mutate(
      tabId,
      (s, t) => {
        if (s.pausedAt === null) s.pausedAt = t;
      },
      now,
    );

  const resume = (tabId, now) =>
    mutate(
      tabId,
      (s, t) => {
        if (s.pausedAt !== null) {
          s.openedAt += t - s.pausedAt;
          s.pausedAt = null;
        }
      },
      now,
    );

  const snooze = (tabId, seconds, now) =>
    mutate(
      tabId,
      (s) => {
        s.extraSeconds += seconds;
      },
      now,
    );

  /**
   * Put the tab's clock at `seconds` elapsed. Shifting `openedAt` rather than
   * touching `extraSeconds` keeps "snoozed" meaning snoozed, and works the
   * same whether the clock is running or paused.
   */
  const setElapsed = (tabId, seconds, now) =>
    mutate(
      tabId,
      (s, t) => {
        s.openedAt = (s.pausedAt ?? t) - Math.max(0, seconds) * 1000;
      },
      now,
    );

  /**
   * Set or clear one per-tab override. `null` or `undefined` removes the key,
   * which is how a row hands the setting back to the rules and the globals.
   */
  const setOverride = (tabId, key, value, now) =>
    mutate(
      tabId,
      (s) => {
        s.overrides ??= {};
        if (value === null || value === undefined) delete s.overrides[key];
        else s.overrides[key] = value;
      },
      now,
    );

  /** Drop every per-tab override, putting the tab back on rules and globals. */
  const clearOverrides = (tabId, now) =>
    mutate(
      tabId,
      (s) => {
        s.overrides = {};
      },
      now,
    );

  /** Every tab's overrides, for working out which indicators to run. */
  function allOverrides() {
    return [...state.values()].map((s) => s.overrides ?? {});
  }

  const setNeverExpire = (tabId, value, now) =>
    mutate(
      tabId,
      (s) => {
        s.neverExpire = Boolean(value);
      },
      now,
    );

  const setResetOnActivate = (tabId, value, now) =>
    mutate(
      tabId,
      (s) => {
        s.resetOnActivate = value === null ? null : Boolean(value);
      },
      now,
    );

  const setIgnoreRules = (tabId, value, now) =>
    mutate(
      tabId,
      (s) => {
        s.ignoreRules = Boolean(value);
      },
      now,
    );

  const setRuleIgnored = (tabId, ruleId, ignored, now) =>
    mutate(
      tabId,
      (s) => {
        const set = new Set(s.ignoredRules ?? []);
        if (ignored) set.add(ruleId);
        else set.delete(ruleId);
        s.ignoredRules = [...set];
      },
      now,
    );

  async function forget(tabId) {
    state.delete(tabId);
    await store.remove(tabId);
  }

  function get(tabId) {
    return state.get(tabId) ?? null;
  }

  function elapsedSeconds(tabId, now = Date.now()) {
    const s = state.get(tabId);
    if (!s) return 0;
    return ((s.pausedAt ?? now) - s.openedAt) / 1000;
  }

  function lifetimeFor(tabId, lifetimeSeconds) {
    return lifetimeSeconds + (state.get(tabId)?.extraSeconds ?? 0);
  }

  function progressFor(tabId, lifetimeSeconds, now = Date.now()) {
    const life = lifetimeFor(tabId, lifetimeSeconds);
    if (!(life > 0)) return 0;
    return Math.min(1, Math.max(0, elapsedSeconds(tabId, now) / life));
  }

  return {
    seed,
    track,
    reset,
    pause,
    resume,
    snooze,
    setElapsed,
    setOverride,
    clearOverrides,
    allOverrides,
    setNeverExpire,
    setResetOnActivate,
    setIgnoreRules,
    setRuleIgnored,
    forget,
    get,
    elapsedSeconds,
    lifetimeFor,
    progressFor,
  };
}

function makeStore() {
  if (api.sessions?.setTabValue) {
    return {
      get: (tabId) => api.sessions.getTabValue(tabId, KEY).catch(() => undefined),
      set: (tabId, s) => api.sessions.setTabValue(tabId, KEY, s).catch(() => {}),
      remove: (tabId) => api.sessions.removeTabValue(tabId, KEY).catch(() => {}),
    };
  }
  const area = api.storage.session ?? api.storage.local;
  const k = (tabId) => `${KEY}:${tabId}`;
  return {
    get: async (tabId) => (await area.get(k(tabId)))[k(tabId)],
    set: (tabId, s) => area.set({ [k(tabId)]: s }),
    remove: (tabId) => area.remove(k(tabId)),
  };
}
