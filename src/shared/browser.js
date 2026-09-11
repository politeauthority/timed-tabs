// Single import point for the WebExtension API so the rest of the code
// never has to care whether it is running in Firefox (`browser`) or
// Chrome (`chrome`, promise-based in MV3).
export const api = globalThis.browser ?? globalThis.chrome;

export const isFirefox = typeof globalThis.browser !== "undefined";

/**
 * True in a dev build (scripts/build.mjs dev or chrome-dev), which is the gate
 * on the dev hook and on the scenario log lines.
 *
 * Two independent marks, and either one is enough. Firefox installs a dev build
 * under a "-dev@" id, which is what docs/developer/security-notes.md records as
 * the guarantee. Chrome has no such id to look at — it derives one from the key
 * or the install path — so the manifest name carries it there instead;
 * scripts/manifest.js is what writes it.
 *
 * Neither can fire in the user's own profile. A plain `src/` load is named
 * `__MSG_extensionName__`, which resolves to "Timed Tabs", and carries the
 * real add-on id.
 */
export const isDevBuild =
  (typeof api?.runtime?.id === "string" && api.runtime.id.includes("-dev@")) ||
  Boolean(api?.runtime?.getManifest?.().name?.endsWith("(dev)"));

/** True when the dynamic theme API is available (Firefox only). */
export const hasThemeApi = Boolean(api?.theme?.update);

/** Resolve `promise`, or reject after `ms` so a stuck API call cannot wedge callers. */
export function withTimeout(promise, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
