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

/**
 * Pure: read a display version into the parts that order it — the dotted
 * numbers and whatever follows the first dash. Null for anything that is not
 * a version at all, which is how an unknown stays an unknown.
 */
function versionParts(v) {
  // A string or nothing. A bare number is not a version, and coercing one
  // would quietly turn 8 into the release 8.0.0.
  if (typeof v !== "string") return null;
  const m = /^v?(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(v.trim());
  return m ? { nums: m[1].split(".").map(Number), pre: m[2] ?? "" } : null;
}

/** Semver's rule for two pre-release tags: dot by dot, numbers before words. */
function comparePre(a, b) {
  const xs = a.split(".");
  const ys = b.split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
      continue;
    }
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Pure: order two display versions the way the release train does. Negative
 * when `a` came first, 0 when they are the same build, positive when `a` is
 * the later one — and **null when either cannot be read as a version**, since
 * an unknown is not a comparison and the caller should say nothing rather
 * than guess.
 *
 * A release beats its own pre-releases, so 0.8.0 is later than 0.8.0-beta.14
 * and later still than the 0.8.0-dev a source checkout reports.
 */
export function compareVersions(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return comparePre(x.pre, y.pre);
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
