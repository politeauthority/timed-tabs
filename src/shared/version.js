/**
 * The version shown in the UI: the manifest version plus an optional build
 * tag. Firefox only accepts digits and dots in the manifest's `version`, so
 * a tag such as "rc1" or "nightly" travels in build.json, written by
 * scripts/build.mjs next to the manifest (BUILD_TAG env). A plain source
 * checkout has no build.json and shows the manifest version alone.
 */
import { api } from "./browser.js";

/** Pure: "0.4.4" + "beta2" -> "0.4.4-beta2"; empty or missing tag -> "0.4.4". */
export function formatVersion(version, tag) {
  const v = String(version ?? "").trim();
  const t = String(tag ?? "")
    .trim()
    .replace(/^-+/, "");
  return t ? `${v}-${t}` : v;
}

let cached = null;

/** Resolve the display version once per page; safe to call repeatedly. */
export async function getDisplayVersion() {
  if (cached) return cached;
  const version = api.runtime.getManifest().version;
  let tag = "";
  let commit = "";
  try {
    const r = await fetch(api.runtime.getURL("build.json"), { cache: "no-store" });
    if (r.ok) {
      const b = await r.json();
      tag = typeof b.tag === "string" ? b.tag : "";
      commit = typeof b.commit === "string" ? b.commit : "";
    }
  } catch {
    // No build.json: running straight from src/.
  }
  cached = { version, tag, commit, display: formatVersion(version, tag) };
  return cached;
}
