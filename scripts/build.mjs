// Produces dist/<target>/ from src/ with a manifest adjusted for that browser.
// Usage: node scripts/build.mjs [firefox|chrome|dev|chrome-dev]
//        (default: firefox and chrome)
//
// A dev target ("dev" for Firefox, "chrome-dev" for Chrome) is a plain copy of
// src/ plus an optional dev.json taken from DEV_JSON (a path) so test profiles
// can be seeded without ever putting that file in src/, which the user's own
// profile loads directly. The two exist so the same scenario can be run in
// either browser; which manifest each one gets lives in scripts/manifest.js.
//
// Every target gets a build.json ({ version, semver, tag, channel, commit,
// builtAt }). The UI shows `semver` (or the manifest version) plus `tag`, so
// BUILD_TAG=rc1 shows as 0.4.4-rc1 while the manifest keeps the digits-only
// version Firefox requires. The dev target is tagged "dev" unless BUILD_TAG
// says otherwise.
//
// Channels. BUILD_CHANNEL=beta marks a beta build: the manifest name and
// toolbar title say so, and the UI shows a badge. Betas are built by
// .github/workflows/beta-release.yaml, which also sets
//   MANIFEST_VERSION  the digits-only version the browser sees (0.7.0.14)
//   BUILD_SEMVER      the version the release is named after (0.8.0)
//   BUILD_TAG         the prerelease part (beta.14)
// so the UI reads 0.8.0-beta.14 while Firefox sees 0.7.0.14, which sorts
// after the last stable and before the next one. See docs/developer/ci/releasing.md.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { TARGETS, TARGET_NAMES, adaptManifest } from "./manifest.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const targets = process.argv[2] ? [process.argv[2]] : ["firefox", "chrome"];

for (const target of targets) {
  if (!TARGETS[target]) {
    console.error(`Unknown target "${target}". Use ${TARGET_NAMES.join(", ")}.`);
    process.exit(1);
  }
  const isDev = TARGETS[target].dev;
  const out = path.join(DIST, target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(SRC, out, { recursive: true });
  await rm(path.join(out, "dev.json"), { force: true });
  // Release builds carry none of the dev hook: the blocks between the
  // @dev-only markers only ever run under the dev id, but a reviewer should
  // not have to read them to know that.
  if (!isDev) await stripDevOnly(out, ["background/index.js", "ui/panel.js"]);
  if (isDev && process.env.DEV_JSON) {
    await cp(process.env.DEV_JSON, path.join(out, "dev.json"));
  }

  const manifest = JSON.parse(
    await readFile(path.join(SRC, "manifest.json"), "utf8"),
  );
  const channel = process.env.BUILD_CHANNEL ?? (isDev ? "dev" : "");
  if (channel && !["beta", "dev"].includes(channel)) {
    console.error(`Unknown BUILD_CHANNEL "${channel}". Use beta or dev, or leave it unset.`);
    process.exit(1);
  }
  const manifestVersion = process.env.MANIFEST_VERSION || manifest.version;
  if (!/^\d+(\.\d+){0,3}$/.test(manifestVersion)) {
    console.error(`MANIFEST_VERSION "${manifestVersion}" must be one to four dot-separated integers.`);
    process.exit(1);
  }
  await writeFile(
    path.join(out, "manifest.json"),
    JSON.stringify(adaptManifest({ ...manifest, version: manifestVersion }, target, channel), null, 2) + "\n",
  );
  await writeFile(
    path.join(out, "build.json"),
    JSON.stringify(
      {
        version: manifestVersion,
        semver: process.env.BUILD_SEMVER ?? "",
        tag: process.env.BUILD_TAG ?? (isDev ? "dev" : ""),
        channel,
        commit: gitShortSha(),
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`built ${target} -> ${path.relative(ROOT, out)}`);
}

async function stripDevOnly(out, files) {
  const re = /^[ \t]*\/\/ @dev-only-start[^\n]*\n[\s\S]*?^[ \t]*\/\/ @dev-only-end[^\n]*\n/gm;
  for (const f of files) {
    const p = path.join(out, f);
    const src = await readFile(p, "utf8");
    const stripped = src.replace(re, "");
    if (stripped === src) throw new Error(`${f}: no @dev-only block found to strip`);
    if (/dev\.json/.test(stripped)) throw new Error(`${f}: still mentions dev.json after stripping`);
    await writeFile(p, stripped);
  }
}

function gitShortSha() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}
