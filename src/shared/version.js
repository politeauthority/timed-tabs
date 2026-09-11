/**
 * The version shown in the UI: the release version plus an optional build
 * tag. Firefox only accepts digits and dots in the manifest's `version`, so
 * a tag such as "beta.14" or "dev" travels in build.json, written by
 * scripts/build.mjs next to the manifest. A beta's manifest version is a
 * digits-only alias (0.7.0.14), so build.json also carries `semver`, the
 * version the release is named after (0.8.0), and `channel` ("beta", "dev"
 * or ""), which the UI turns into a badge. A plain source checkout has no
 * build.json and shows the manifest version alone.
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

/** Pure: what build.json plus the manifest version resolve to for display. */
export function describeBuild(manifestVersion, build = {}) {
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const semver = str(build.semver);
  const tag = str(build.tag);
  const channel = str(build.channel);
  return {
    version: manifestVersion,
    semver,
    tag,
    channel,
    commit: str(build.commit),
    display: formatVersion(semver || manifestVersion, tag),
  };
}

let cached = null;

/** Resolve the display version once per page; safe to call repeatedly. */
export async function getDisplayVersion() {
  if (cached) return cached;
  const version = api.runtime.getManifest().version;
  let build = {};
  try {
    const r = await fetch(api.runtime.getURL("build.json"), { cache: "no-store" });
    if (r.ok) build = await r.json();
  } catch {
    // No build.json: running straight from src/.
  }
  cached = describeBuild(version, build);
  return cached;
}
