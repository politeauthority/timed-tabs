// Produces dist/<target>/ from src/ with a manifest adjusted for that browser.
// Usage: node scripts/build.mjs [firefox|chrome]   (default: both)
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const targets = process.argv[2] ? [process.argv[2]] : ["firefox", "chrome"];

for (const target of targets) {
  if (!["firefox", "chrome"].includes(target)) {
    console.error(`Unknown target "${target}". Use firefox or chrome.`);
    process.exit(1);
  }
  const out = path.join(DIST, target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(SRC, out, { recursive: true });

  const manifest = JSON.parse(await readFile(path.join(SRC, "manifest.json"), "utf8"));
  await writeFile(
    path.join(out, "manifest.json"),
    JSON.stringify(adaptManifest(manifest, target), null, 2) + "\n",
  );
  console.log(`built ${target} -> ${path.relative(ROOT, out)}`);
}

function adaptManifest(base, target) {
  const m = structuredClone(base);
  if (target === "chrome") {
    // Chrome MV3 requires a service worker and has no dynamic theme API.
    m.background = { service_worker: "background/index.js", type: "module" };
    delete m.browser_specific_settings;
    m.permissions = m.permissions.filter((p) => p !== "theme");
  }
  return m;
}
