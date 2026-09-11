/** Pure time formatting helpers, shared by UI and indicators. */

/** "1h 05m", "12m 30s", "45s", or "Expired" when nothing is left. */
export function formatRemaining(seconds) {
  if (seconds <= 0) return "Expired";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/**
 * "3d 4h", "6h 20m", "12m", "45s" — a total, rather than a countdown.
 *
 * Apart from `formatRemaining` because the jobs differ: a countdown always
 * wants its second-largest unit, so "1h 05m" keeps reading as time passing,
 * while a total that has run into days has no use for minutes and none at all
 * for "Expired".
 */
export function formatSpan(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** "30 min", "2 h", "45 s" for settings display. */
export function formatDuration(seconds) {
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** Split seconds into the largest unit that divides it evenly. */
export function toUnit(seconds) {
  if (seconds % 3600 === 0) return { value: seconds / 3600, unit: 3600 };
  if (seconds % 60 === 0) return { value: seconds / 60, unit: 60 };
  return { value: seconds, unit: 1 };
}

/**
 * How much time one press of Snooze grants: a share of the tab's own
 * lifetime, so a tab that lives five minutes gets a short reprieve and one
 * that lives all day gets a long one. Never less than a second.
 */
export function snoozeSeconds(lifetimeSeconds, percent) {
  const pct = Math.min(100, Math.max(1, Math.round(Number(percent) || 0) || 1));
  const lifetime = Math.max(0, Number(lifetimeSeconds) || 0);
  return Math.max(1, Math.round((lifetime * pct) / 100));
}
