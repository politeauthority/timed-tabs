// Produces dist/<target>/ from src/ with a manifest adjusted for that browser.
// Usage: node scripts/build.mjs [firefox|chrome|dev]   (default: firefox and chrome)
//
// The "dev" target is a plain copy of src/ plus an optional dev.json taken
// from DEV_JSON (a path) so test profiles can be seeded without ever putting
// that file in src/, which the user's own profile loads directly.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
