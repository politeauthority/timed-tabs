// Single import point for the WebExtension API so the rest of the code
// never has to care whether it is running in Firefox (`browser`) or
// Chrome (`chrome`, promise-based in MV3).
export const api = globalThis.browser ?? globalThis.chrome;

export const isFirefox = typeof globalThis.browser !== "undefined";

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
