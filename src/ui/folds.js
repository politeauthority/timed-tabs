/**
 * Fold state for the page's <details> sections, remembered across opens in localStorage.
 */

export function foldGet(key, fallback) {
  try {
    const v = localStorage.getItem(`fold:${key}`);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export function foldSet(key, open) {
  try {
    localStorage.setItem(`fold:${key}`, open ? "1" : "0");
  } catch {
    // ignore
  }
}

/** Apply a remembered fold state to a <details> and keep it updated. */
export function rememberFold(details, key, fallbackOpen) {
  details.open = foldGet(key, fallbackOpen);
  details.addEventListener("toggle", () => foldSet(key, details.open));
}
