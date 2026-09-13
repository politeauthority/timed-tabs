/**
 * When indicators start to show on a tab that keeps quiet while fresh: a
 * "lead", measured back from expiry. It is either an amount of time
 * ("600s": show once ten minutes are left) or a share of the tab's own
 * lifetime ("40%": show once two fifths of it are left). Stored as one short
 * string so a rule can override it like any other setting.
 *
 * A lead longer than the tab's lifetime means show from the start: the
 * lifetime is the ceiling, and rules can raise or lower it per site, so the
 * clamp happens where the tab is looked at, not where the value is saved.
 *
 * Pure, so vitest can cover it without a browser.
 */

/** `{ percent }` or `{ seconds }` for a stored lead, or null when it is not one. */
export function parseLead(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d+)(%|s)$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "%") return n >= 1 && n <= 99 ? { percent: n } : null;
  return n >= 1 ? { seconds: n } : null;
}

/** The stored form of a parsed lead. */
export function formatLead(lead) {
  return "percent" in lead ? `${lead.percent}%` : `${lead.seconds}s`;
}

/**
 * Whether a tab this far along should be showing yet. `progress` is the
 * share of the lifetime gone (0..1), `remainingSeconds` what is left; the
 * two are the same clock, but seconds already account for a snooze and a
 * rule's lifetime, which is what a time lead is measured against.
 */
export function leadReached(value, progress, remainingSeconds) {
  const lead = parseLead(value);
  if (!lead) return true;
  if ("percent" in lead) return progress >= 1 - lead.percent / 100;
  return remainingSeconds <= lead.seconds;
}

/**
 * Seconds of lead a tab with this lifetime actually gets: an amount is
 * capped at the lifetime, a share is taken of it.
 */
export function leadSeconds(value, lifetimeSeconds) {
  const lead = parseLead(value);
  if (!lead) return lifetimeSeconds;
  if ("percent" in lead) return Math.round((lifetimeSeconds * lead.percent) / 100);
  return Math.min(lead.seconds, lifetimeSeconds);
}

/**
 * The lead an older build stored as `quietUntilPercent`, the share of the
 * lifetime that had to pass first: the same moment, counted from the other
 * end.
 */
export function leadFromElapsedPercent(elapsedPercent) {
  const p = Math.round(Number(elapsedPercent));
  if (!Number.isFinite(p) || p < 0 || p > 100) return null;
  return `${Math.min(99, Math.max(1, 100 - p))}%`;
}
