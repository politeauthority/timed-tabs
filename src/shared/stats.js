/**
 * The tally: how much Timed Tabs has actually done.
 *
 * Everything here is a number or a date. That is the whole privacy story and
 * it is worth saying plainly, because the "Recently expired" list next door is
 * the opposite — full URLs and titles, kept for a day. This holds no address,
 * no title, no favicon and nothing per-tab at all, so there is nothing in it
 * to leak, nothing to redact for a private window, and no reason to expire it.
 * A tab from a private window is counted like any other and leaves no trace
 * that it existed, exactly as `notify.js` counts one it may not name.
 *
 * Pure: storage and clocks belong to the caller, which is what lets the counts
 * be tested without a browser.
 */

/** Bumped only when the stored shape changes in a way `mergeStats` cannot absorb. */
export const STATS_VERSION = 1;

/** How many days of the per-day tally to keep. Enough for the chart, and then some. */
export const DAYS_KEPT = 30;

/** Days the chart draws, however many are stored. */
export const CHART_DAYS = 14;

/** A profile that has never had anything counted. */
export function emptyStats() {
  return {
    v: STATS_VERSION,
    /** Epoch ms of the first thing ever counted, so "per day" has a denominator. */
    since: null,
    closed: 0,
    discarded: 0,
    /**
     * Every tab ever closed, for good. Unlike `closed` it survives
     * **Clear statistics** and travels in a backup, so it is the one number
     * here that can outlive a profile. Never a window and never reset short
     * of "Reset everything".
     */
    killed: 0,
    reloaded: 0,
    snoozes: 0,
    snoozeSeconds: 0,
    resets: 0,
    peakTabs: 0,
    peakAt: null,
    /** "YYYY-MM-DD" -> tabs expired that day, pruned to DAYS_KEPT. */
    days: {},
  };
}

/** What an expiry counts towards, keyed by the action that was taken. */
const EXPIRY_KEYS = { close: "closed", discard: "discarded", reload: "reloaded" };

/** Local-date key for a moment. Local, not UTC: a day is the user's day. */
export function dayKey(now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `key` shifted by `delta` days, which is how a dense run of days is built. */
function shiftDay(key, delta) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + delta).getTime());
}

/**
 * `stats` with one event counted, or **`stats` itself when nothing changed**.
 *
 * That identity is the contract the background leans on: a tick reports the
 * open-tab count on every pass and almost never beats the record, so returning
 * the same object is what says "no need to write this to disk".
 *
 * Events:
 *   { type: "expired", action: "close" | "discard" | "reload" }
 *   { type: "snoozed", seconds }
 *   { type: "reset" }
 *   { type: "tabs", open }        // a high-water mark, not a running total
 */
export function record(stats, event, now = Date.now()) {
  const s = mergeStats(stats);

  if (event?.type === "tabs") {
    const open = Math.max(0, Math.floor(Number(event.open) || 0));
    if (open <= s.peakTabs) return stats;
    return { ...s, peakTabs: open, peakAt: now, since: s.since ?? now };
  }

  if (event?.type === "expired") {
    const key = EXPIRY_KEYS[event.action];
    // "none" is the default on-expiry action and does nothing to the tab, so
    // there is nothing to count: the tab simply sits there, marked expired.
    if (!key) return stats;
    const today = dayKey(now);
    return {
      ...s,
      since: s.since ?? now,
      [key]: s[key] + 1,
      killed: event.action === "close" ? s.killed + 1 : s.killed,
      days: pruneDays({ ...s.days, [today]: (s.days[today] ?? 0) + 1 }, now),
    };
  }

  if (event?.type === "snoozed") {
    const seconds = Math.max(0, Math.round(Number(event.seconds) || 0));
    return { ...s, since: s.since ?? now, snoozes: s.snoozes + 1, snoozeSeconds: s.snoozeSeconds + seconds };
  }

  if (event?.type === "reset") {
    return { ...s, since: s.since ?? now, resets: s.resets + 1 };
  }

  return stats;
}

/**
 * **Clear statistics**: everything back to nothing, except the lifetime count of
 * tabs killed, which a clear is not meant to touch. It is a life story, and the
 * button is for starting the chart and the tiles afresh, not for forgetting it.
 */
export function clearStats(stats) {
  return { ...emptyStats(), killed: mergeStats(stats).killed };
}

/**
 * A lifetime count arriving from a backup. It only ever goes up: a backup
 * loaded into a profile that has already killed more tabs than the file says
 * would otherwise turn the clock back, and a total that can shrink is not a
 * total. Returns `stats` itself when nothing changes, on the same contract as
 * `record`.
 */
export function restoreKilled(stats, killed) {
  const s = mergeStats(stats);
  const n = Number.isFinite(killed) && killed > 0 ? Math.floor(killed) : 0;
  if (n <= s.killed) return stats;
  return { ...s, killed: n };
}

/** Days within DAYS_KEPT of today, oldest ones dropped. */
function pruneDays(days, now) {
  const oldest = shiftDay(dayKey(now), -(DAYS_KEPT - 1));
  const out = {};
  // Keys sort lexicographically because the format is fixed-width and
  // big-endian, which is the reason for choosing it.
  for (const [key, count] of Object.entries(days)) if (key >= oldest) out[key] = count;
  return out;
}

/**
 * Stored stats made safe to use: every key present, every count a
 * non-negative integer, every day key a real date. A value of the wrong type
 * falls back rather than throwing, on the same principle as `mergeFlags` —
 * a tally is not worth losing a page over, and it is not worth trusting
 * either, since it comes off disk.
 */
export function mergeStats(stored) {
  const base = emptyStats();
  if (!stored || typeof stored !== "object") return base;

  const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const stamp = (v) => (Number.isFinite(v) && v > 0 ? v : null);

  const days = {};
  if (stored.days && typeof stored.days === "object") {
    for (const [key, value] of Object.entries(stored.days)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && count(value) > 0) days[key] = count(value);
    }
  }

  return {
    ...base,
    since: stamp(stored.since),
    closed: count(stored.closed),
    discarded: count(stored.discarded),
    killed: count(stored.killed),
    reloaded: count(stored.reloaded),
    snoozes: count(stored.snoozes),
    snoozeSeconds: count(stored.snoozeSeconds),
    resets: count(stored.resets),
    peakTabs: count(stored.peakTabs),
    peakAt: stamp(stored.peakAt),
    days,
  };
}

/**
 * Everything the panel draws, worked out here rather than in the rendering, so
 * that what the numbers mean has a test and the panel only has to lay them out.
 *
 * `days` comes back dense and oldest-first — every day in the window, zeros
 * included — because a chart with the quiet days missing would be a lie about
 * which days were busy.
 */
export function summarise(stats, now = Date.now()) {
  const s = mergeStats(stats);
  const expired = s.closed + s.discarded + s.reloaded;

  const today = dayKey(now);
  const days = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const date = shiftDay(today, -i);
    days.push({ date, count: s.days[date] ?? 0 });
  }

  // The busiest day of everything still stored, which may be older than the
  // chart shows. Ties go to the earlier day: the first time you hit a number
  // is the one worth remembering.
  let busiest = null;
  for (const [date, count] of Object.entries(s.days).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!busiest || count > busiest.count) busiest = { date, count };
  }

  return {
    ...s,
    expired,
    days,
    busiest,
    daysTracked: daysSince(s.since, now),
    perDay: perDay(expired, s.since, now),
    /** True before anything at all has happened, which the panel says in words. */
    empty: expired === 0 && s.snoozes === 0 && s.resets === 0 && s.peakTabs === 0 && s.killed === 0,
  };
}

/** Whole days from `since` to now, counted inclusively so today is day one. */
function daysSince(since, now) {
  if (!since) return 0;
  const start = new Date(since);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function perDay(expired, since, now) {
  const days = daysSince(since, now);
  return days ? expired / days : 0;
}
