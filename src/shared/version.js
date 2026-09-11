/**
 * The version shown in the UI: the release version plus an optional build
 * tag. Firefox only accepts digits and dots in the manifest's `version`, so
 * a tag such as "beta.14" or "dev" travels in build.json, written by
 * scripts/build.mjs next to the manifest. A beta's manifest version is a
 * digits-only alias (0.7.0.14), so build.json also carries `semver`, the
 * version the release is named after (0.8.0), and `channel` ("beta", "dev"
 * or ""), which the UI turns into a badge.
 *
 * A checkout loaded straight from `src/` has no build.json at all. That is the
 * one case nothing can stamp, since release-please owns the manifest version
 * and Firefox will not take a suffix there, so it is inferred instead: no
 * build.json means source, which shows as "0.0.1-dev" and wears the dev badge.
 * A built target always has a build.json, even when its tag is empty, so a
 * real release is never mistaken for one of these.
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

/**
 * Pure: what build.json plus the manifest version resolve to for display.
 * Pass null or nothing for `build` to say there was no build.json, which means
 * the extension is running from a source checkout and is tagged "dev".
 */
export function describeBuild(manifestVersion, build) {
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const fromSource = build === null || build === undefined;
  const src = fromSource ? {} : build;
  const semver = str(src.semver);
  const tag = fromSource ? "dev" : str(src.tag);
  const channel = fromSource ? "dev" : str(src.channel);
  return {
    version: manifestVersion,
    semver,
    tag,
    channel,
    commit: str(src.commit),
    display: formatVersion(semver || manifestVersion, tag),
  };
}

let cached = null;

/** Resolve the display version once per page; safe to call repeatedly. */
export async function getDisplayVersion() {
  if (cached) return cached;
  const version = api.runtime.getManifest().version;
  // Stays null when there is no build.json, which is what marks a source load.
  let build = null;
  try {
    const r = await fetch(api.runtime.getURL("build.json"), { cache: "no-store" });
    if (r.ok) build = await r.json();
  } catch {
    // No build.json: running straight from src/.
  }
  cached = describeBuild(version, build);
  return cached;
}
