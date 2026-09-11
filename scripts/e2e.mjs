// End-to-end scenarios in a real, headless Firefox.
//
// Each tests/e2e/scenarios/<name>.json is
//   { "runSeconds": 25, "dev": { ...dev.json... }, "expect": [regex...], "expectNot": [regex...] }
// The dev object is written into a dev build (see the dev hook in
// background/index.js), web-ext runs that build headless, and the log it
// printed is matched against the expectations. `runSeconds` counts from the
// extension's first log line, not from launch, so a slow Firefox start on a
// busy runner does not eat into the scenario; launch itself is capped at 90s. Screenshots the
// scenario captured, and the raw log, land in e2e-artifacts/<name>.*.
//
// Alongside those it writes e2e-artifacts/results.json, one record per scenario
// with every expectation and whether it matched. CI renders that into the run
// summary; nothing else reads it, so the console output below stays the source
// of truth for a human running this locally.
//
// Usage: npm run e2e [-- name ...]   FIREFOX=/path/to/firefox to pick a binary.
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SCENARIOS = path.join(ROOT, "tests", "e2e", "scenarios");
const OUT = path.join(ROOT, "e2e-artifacts");
const PREFS = [
  "devtools.console.stdout.content=true",
  "devtools.console.stdout.chrome=true",
  "termsofuse.bypassNotification=true",
  "browser.aboutwelcome.enabled=false",
];

const only = process.argv.slice(2);
const names = (await readdir(SCENARIOS))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .filter((n) => !only.length || only.includes(n));
if (!names.length) {
  console.error("No scenarios found.");
  process.exit(2);
}
await mkdir(OUT, { recursive: true });

let failed = 0;
const results = [];
for (const name of names) {
  const scenario = JSON.parse(await readFile(path.join(SCENARIOS, `${name}.json`), "utf8"));
  const seconds = scenario.runSeconds ?? 25;
  const startedAt = Date.now();
  const checks = [];
  console.log(`\n=== ${name} (${seconds}s)`);
  const devJson = path.join(OUT, `${name}.dev.json`);
  await writeFile(devJson, JSON.stringify(scenario.dev, null, 2));
  await run("node", ["scripts/build.mjs", "dev"], { DEV_JSON: devJson });

  const args = ["web-ext", "run", "--source-dir", "dist/dev", "--verbose", "--args=-headless", "--no-input"];
  if (process.env.FIREFOX) args.push("--firefox", process.env.FIREFOX);
  for (const p of PREFS) args.push("--pref", p);
  const log = await runFor("npx", args, seconds * 1000, { MOZ_HEADLESS: "1" });
  await writeFile(path.join(OUT, `${name}.log`), log);

  const capture = decodeCapture(log);
  if (capture) await writeFile(path.join(OUT, `${name}.png`), capture);

  let ok = true;
  for (const re of scenario.expect ?? []) {
    const hit = new RegExp(re).test(log);
    console.log(`  ${hit ? "ok  " : "MISS"} expect    ${re}`);
    checks.push({ kind: "expect", pattern: re, ok: hit });
    ok &&= hit;
  }
  for (const re of scenario.expectNot ?? []) {
    const hit = new RegExp(re).test(log);
    console.log(`  ${hit ? "SEEN" : "ok  "} expectNot ${re}`);
    checks.push({ kind: "expectNot", pattern: re, ok: !hit });
    ok &&= !hit;
  }
  if (!ok) {
    failed += 1;
    console.log(`  FAIL ${name}: see e2e-artifacts/${name}.log`);
    const lines = log.match(/\[timed-tabs\][^"\n]*/g) ?? [];
    for (const l of lines.filter((l) => !l.includes("CAPTURE")).slice(-25)) console.log(`    ${l.slice(0, 160)}`);
  } else console.log(`  PASS ${name}${capture ? " (screenshot saved)" : ""}`);

  results.push({
    name,
    ok,
    seconds: Math.round((Date.now() - startedAt) / 1000),
    budget: seconds,
    checks,
    artifacts: [`${name}.log`, ...(capture ? [`${name}.png`] : [])],
  });
}
console.log(`\n${names.length - failed}/${names.length} scenarios passed`);
await writeFile(path.join(OUT, "results.json"), JSON.stringify({ scenarios: results }, null, 2));
process.exit(failed ? 1 : 0);

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", (e) => reject(new Error(`${cmd} could not start: ${e.message}`)));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
  });
}

/**
 * Run a command until `ms` after its output first mentions the extension,
 * then stop it and everything it started. A hard cap covers a Firefox that
 * never comes up.
 */
function runFor(cmd, args, ms, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, detached: true, env: { ...process.env, ...env } });
    let out = "";
    let started = false;
    let timer = null;
    const stop = () => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    };
    const onData = (d) => {
      out += d;
      if (!started && out.includes("[timed-tabs]")) {
        started = true;
        clearTimeout(timer);
        timer = setTimeout(stop, ms);
        console.log(`  extension up after ${Math.round((Date.now() - t0) / 1000)}s; running ${ms / 1000}s`);
      }
    };
    const t0 = Date.now();
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    timer = setTimeout(stop, 90_000 + ms);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(out + `\n[e2e] ${cmd} could not start: ${e.message}\n`);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      // Stopped by us is the normal end; anything else is worth seeing in the log.
      if (signal !== "SIGTERM" && code !== 0) out += `\n[e2e] ${cmd} exited with ${code ?? signal}\n`;
      resolve(out);
    });
  });
}

/** The PNG the dev hook logged in chunks, or null. */
function decodeCapture(log) {
  const chunks = [...log.matchAll(/CAPTURE (\d+)\/(\d+) ([^"\s]+)/g)].sort((a, b) => Number(a[1]) - Number(b[1]));
  if (!chunks.length) return null;
  const data = chunks.map((m) => m[3]).join("").replace(/^data:image\/png;base64,/, "");
  return Buffer.from(data, "base64");
}
