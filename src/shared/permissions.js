import { api } from "./browser.js";

/** Origin patterns that each mean "every website". Firefox stores the grant in different shapes. */
const WEB_PATTERNS = ["<all_urls>", "*://*/*"];
const SCHEME_PATTERNS = ["http://*/*", "https://*/*"];

/** What we ask for when requesting; websites only, not local files. */
export const WEB_ORIGINS = { origins: ["*://*/*"] };

/** True when the extension may run content scripts on ordinary websites. */
export async function hasWebAccess() {
  try {
    const { origins = [] } = await api.permissions.getAll();
    if (origins.some((o) => WEB_PATTERNS.includes(o))) return true;
    if (SCHEME_PATTERNS.every((p) => origins.includes(p))) return true;
    // Fall back to the API's own subsumption check.
    return await api.permissions.contains(WEB_ORIGINS);
  } catch {
    return true; // Can't tell; don't nag.
  }
}

export async function grantedOrigins() {
  try {
    return (await api.permissions.getAll()).origins ?? [];
  } catch {
    return [];
  }
}
