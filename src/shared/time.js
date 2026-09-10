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
