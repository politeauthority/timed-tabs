/**
 * Saying whether a write worked: the toasts, and the one place a storage error is turned into words.
 *
 * An outcome with no natural home on the page goes to a toast: a success
 * fades, a failure stays until it is dismissed. A rule card or a per-tab
 * control keeps its "Saved" tick instead, since that sits on the thing that
 * changed, which a message at the bottom of the window cannot do.
 */
import { isPopup } from "./state.js";
import { mountToasts } from "./toasts.js";

// The popup is 320px wide and only as tall as its content, so a pile deep
// enough for the full page would cover most of it.
export const toasts = mountToasts(document.body, isPopup ? { max: 2 } : {});

/** What a rejected write left behind, in a form worth showing a user. */
export function reasonFor(err) {
  const text = err?.message ?? String(err ?? "");
  return text.replace(/^Error:\s*/, "").trim();
}

/**
 * Run a write and say whether it landed. Returns true on success; on failure
 * it reports and answers false, so the caller can put back what is really in
 * storage rather than leaving a value on screen that was never stored.
 *
 * `note` is what the toast can promise about the damage. One `set` either
 * happened or did not, so the default is safe; a caller writing in several
 * steps has to say something less certain.
 */
export async function write(run, { what, key = null, note = "Nothing was changed." }) {
  try {
    await run();
    return true;
  } catch (err) {
    console.warn(`[timed-tabs] could not save ${what}:`, err);
    const reason = reasonFor(err);
    toasts.error(
      `Could not save ${what}`,
      [reason, note].filter(Boolean).join(" "),
      key ? `save:${key}` : null,
    );
    return false;
  }
}
