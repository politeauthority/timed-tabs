// Produces dist/<target>/ from src/ with a manifest adjusted for that browser.
// Usage: node scripts/build.mjs [firefox|chrome|dev]   (default: firefox and chrome)
//
// The "dev" target is a plain copy of src/ plus an optional dev.json taken
// from DEV_JSON (a path) so test profiles can be seeded without ever putting
// that file in src/, which the user's own profile loads directly.
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
// after the last stable and before the next one. See docs/developer/releasing.md.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const targets = process.argv[2] ? [process.argv[2]] : ["firefox", "chrome"];

for (const target of targets) {
  if (!["firefox", "chrome", "dev"].includes(target)) {
    console.error(`Unknown target "${target}". Use firefox, chrome or dev.`);
    process.exit(1);
  }
  const out = path.join(DIST, target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(SRC, out, { recursive: true });
  await rm(path.join(out, "dev.json"), { force: true });
  if (target === "dev" && process.env.DEV_JSON) {
    await cp(process.env.DEV_JSON, path.join(out, "dev.json"));
  }

  const manifest = JSON.parse(
    await readFile(path.join(SRC, "manifest.json"), "utf8"),
  );
  const channel = process.env.BUILD_CHANNEL ?? (target === "dev" ? "dev" : "");
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
        tag: process.env.BUILD_TAG ?? (target === "dev" ? "dev" : ""),
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

function adaptManifest(base, target, channel) {
  const m = structuredClone(base);
  if (target === "dev") {
    // A distinct id keeps the dev build's storage separate and is what the
    // background checks before reading dev.json.
    m.browser_specific_settings.gecko.id = "timed-tabs-dev@alixfullerton";
  }
  if (channel === "beta") {
    // Same id as the stable build: a beta replaces it and, once builds are
    // signed, beta testers update to the next stable. The name says beta
    // wherever the browser shows it.
    m.name = "Timed Tabs Beta";
    m.action.default_title = "Timed Tabs Beta";
  } else if (channel === "dev") {
    m.name = "Timed Tabs (dev)";
    m.action.default_title = "Timed Tabs (dev)";
  }
  if (target === "chrome") {
    // Chrome MV3 requires a service worker and has no dynamic theme API.
    m.background = { service_worker: "background/index.js", type: "module" };
    delete m.browser_specific_settings;
    m.permissions = m.permissions.filter((p) => p !== "theme");
  }
  return m;
}
