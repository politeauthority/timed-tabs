/**
 * The toast model: the list of short messages a UI page is currently showing,
 * with no DOM in sight so it can be reasoned about and unit-tested. The
 * drawing lives in `src/ui/toasts.js`; this file only decides what is on the
 * pile and when each entry is due to go.
 *
 * Three rules shape it.
 *
 * - A success, a note or a warning goes away on its own. An error stays until
 *   it is dismissed: a save that did not land is the one thing the user must
 *   not miss while looking away.
 * - A toast may carry a `key`. Raising the same key again takes over the toast
 *   already showing instead of stacking another one under it, which is what
 *   keeps a slider dragged through ten values down to a single "Saved".
 * - The pile is capped. Over the cap the oldest toast that would have gone by
 *   itself is dropped first, so a run of successes can never push an error off
 *   the screen before it has been read.
 *
 * Nothing here runs a timer. The store works out when the next toast is due
 * (`nextExpiryAt`) and drops what is past it when asked (`expire`); the
 * renderer owns the single timeout that drives that, and can `pause` the whole
 * pile while a pointer rests on it.
 */

/** How long each level survives, in ms. 0 means it stays until dismissed. */
export const TOAST_LIFETIMES = Object.freeze({
  success: 3500,
  info: 5000,
  warning: 7000,
  error: 0,
});

/** The level anything unrecognised is treated as. */
export const DEFAULT_LEVEL = "info";

/** How many toasts may be on the pile at once. */
export const MAX_TOASTS = 4;

/** A level this build knows, or `DEFAULT_LEVEL` for anything else. */
export function normaliseLevel(level) {
  return Object.hasOwn(TOAST_LIFETIMES, level) ? level : DEFAULT_LEVEL;
}

/** How long a level lives, in ms; 0 for the levels that never go by themselves. */
export function lifetimeOf(level) {
  return TOAST_LIFETIMES[normaliseLevel(level)];
}

/** True when a level waits to be dismissed rather than timing out. */
export function isSticky(level) {
  return lifetimeOf(level) === 0;
}

/**
 * A pile of toasts.
 *
 * `now` is injectable so tests can drive the clock, `max` so a narrow context
 * can show fewer, and `onChange` fires after anything that alters the list.
 */
export function createToastStore({
  now = () => Date.now(),
  max = MAX_TOASTS,
  onChange = () => {},
} = {}) {
  /** @type {{id: string, level: string, message: string, detail: string, key: string|null, addedAt: number, expiresAt: number|null, remaining: number|null}[]} */
  let toasts = [];
  let seq = 0;
  let paused = false;

  const changed = () => onChange(list());
  const list = () => toasts.map((t) => ({ ...t }));

  /** When a toast raised now would be due, or null if its level never is. */
  function dueAt(level, at) {
    const life = lifetimeOf(level);
    return life === 0 ? null : at + life;
  }

  /**
   * Put a message on the pile and return its id, or null for an empty one.
   * A `key` that is already showing is taken over: same id and same place in
   * the pile, new text, new deadline.
   */
  function add({ level, message, detail = "", key = null } = {}) {
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) return null;
    const at = now();
    const lvl = normaliseLevel(level);
    const fields = {
      level: lvl,
      message: text,
      detail: typeof detail === "string" ? detail.trim() : "",
      key: key || null,
      addedAt: at,
      // A pause holds the whole pile, a new toast included, so it does not
      // start counting down under a pointer that is still resting on it.
      expiresAt: paused ? null : dueAt(lvl, at),
      remaining: paused ? lifetimeOf(lvl) || null : null,
    };

    const existing = fields.key
      ? toasts.find((t) => t.key === fields.key)
      : null;
    const id = existing ? existing.id : `t${++seq}`;
    if (existing) Object.assign(existing, fields);
    else toasts.push({ id, ...fields });

    trim(id);
    changed();
    return id;
  }

  /** Bring the pile back to `max`, keeping the toast just raised and errors longest. */
  function trim(keepId) {
    while (toasts.length > max) {
      const droppable = toasts.filter((t) => t.id !== keepId);
      if (droppable.length === 0) break;
      const victim =
        droppable.find((t) => !isSticky(t.level)) ?? droppable[0];
      toasts = toasts.filter((t) => t !== victim);
    }
  }

  /** Take one toast off the pile. Returns whether it was there. */
  function dismiss(id) {
    const before = toasts.length;
    toasts = toasts.filter((t) => t.id !== id);
    if (toasts.length === before) return false;
    changed();
    return true;
  }

  /** Take everything off, errors included. */
  function clear() {
    if (toasts.length === 0) return false;
    toasts = [];
    changed();
    return true;
  }

  /** Drop everything already due. Does nothing while paused. */
  function expire(at = now()) {
    if (paused) return false;
    const before = toasts.length;
    toasts = toasts.filter((t) => t.expiresAt === null || t.expiresAt > at);
    if (toasts.length === before) return false;
    changed();
    return true;
  }

  /** When the next toast falls due, or null if nothing is counting down. */
  function nextExpiryAt() {
    const times = toasts
      .map((t) => t.expiresAt)
      .filter((v) => typeof v === "number");
    return times.length ? Math.min(...times) : null;
  }

  /** Hold every countdown where it is, keeping what each toast has left. */
  function pause() {
    if (paused) return;
    paused = true;
    const at = now();
    for (const t of toasts) {
      if (t.expiresAt === null) continue;
      t.remaining = Math.max(0, t.expiresAt - at);
      t.expiresAt = null;
    }
  }

  /** Start the countdowns again from where they were held. */
  function resume() {
    if (!paused) return;
    paused = false;
    const at = now();
    for (const t of toasts) {
      if (t.remaining === null) continue;
      t.expiresAt = at + t.remaining;
      t.remaining = null;
    }
  }

  return {
    add,
    dismiss,
    clear,
    expire,
    list,
    nextExpiryAt,
    pause,
    resume,
    get paused() {
      return paused;
    },
    get size() {
      return toasts.length;
    },
  };
}
