/**
 * Ordering for the open-tabs list. Pure, so it stays unit-testable: the panel
 * hands it the rows the background reported and renders whatever comes back.
 *
 * Tabs that cannot expire -- pinned, or with the timer off -- have no time
 * left to compare, so every time-based order sinks them to the bottom and
 * leaves them in tab order among themselves. Ties fall back to tab order too,
 * so rows do not shuffle between ticks when two tabs read the same.
 */

/** The orders offered, in the order they are listed. The first is the default. */
export const TAB_SORTS = [
  { id: "tab-order", label: "Tab order" },
  { id: "time-left", label: "Time left" },
  { id: "percent-left", label: "Percent left" },
];

export const DEFAULT_TAB_SORT = TAB_SORTS[0].id;

export function sortTabs(tabs, mode) {
  const list = [...(tabs ?? [])];
  if (mode === "time-left") return list.sort(byValue(secondsLeft));
  if (mode === "percent-left") return list.sort(byValue(fractionLeft));
  return list.sort(byIndex);
}

/** True when a tab has no running clock, so no time worth comparing. */
function isExempt(tab) {
  return Boolean(tab.pinned || (tab.effective?.neverExpire ?? tab.neverExpire));
}

function byIndex(a, b) {
  return (a.index ?? 0) - (b.index ?? 0);
}

function byValue(value) {
  return (a, b) => {
    const ax = isExempt(a);
    const bx = isExempt(b);
    if (ax !== bx) return ax ? 1 : -1;
    if (ax) return byIndex(a, b);
    return value(a) - value(b) || byIndex(a, b);
  };
}

function secondsLeft(tab) {
  return Math.max(0, Number(tab.remainingSeconds) || 0);
}

/** Share of its own lifetime a tab still has, so short and long tabs compare. */
function fractionLeft(tab) {
  const lifetime = Number(tab.lifetimeSeconds) || 0;
  if (!(lifetime > 0)) return 0;
  return secondsLeft(tab) / lifetime;
}
