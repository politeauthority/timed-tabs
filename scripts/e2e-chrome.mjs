// Driving a headless Chrome for the end-to-end scenarios.
//
// Firefox hands the extension's console straight to stdout, so web-ext plus two
// prefs is the whole story there. Chrome has nothing of the sort: an MV3 service
// worker's console goes to the DevTools console and nowhere else, so the only way
// to read it from a script is to attach over the DevTools Protocol and collect
// Runtime.consoleAPICalled. That is what this file is.
//
// Two Chrome behaviours shape it:
//
//   --load-extension has been off by default since Chrome 137, so a build loaded
//   that way is silently ignored -- the browser starts, the extension is simply
//   not there. `Extensions.loadUnpacked` over CDP is the supported route now, and
//   it needs --enable-unsafe-extension-debugging to be allowed at all.
//
//   The service worker is lazy and short-lived, so attaching after the fact can
//   miss everything it said. Target.setAutoAttach with autoAttach goes on before
//   the extension is loaded, which is why loadUnpacked is called last.
//
// The log it returns is plain text in the same shape Firefox's stdout has, so the
// runner's matching, artifacts and CAPTURE decoding do not care which browser ran.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Where Chrome lives, unless CHROME says otherwise. */
const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function chromePath() {
  return process.env.CHROME || CANDIDATES.find((p) => existsSync(p)) || "google-chrome";
}

/**
 * Run `extDir` in a headless Chrome for `ms` after the extension first speaks,
 * and return everything it logged. Mirrors runFor() in e2e.mjs: the budget
 * starts at the first extension line so a slow browser start does not eat the
 * scenario, with a hard cap for a Chrome that never comes up.
 */
export async function runChrome({ extDir, ms, binary = chromePath(), hardCapMs = 90_000 }) {
  const profile = await mkdtemp(path.join(os.tmpdir(), "timed-tabs-e2e-"));
  const out = [];
  const say = (s) => out.push(s);

  // Port 0 lets Chrome choose; it writes the one it took to DevToolsActivePort.
  // Asking for a fixed port races every other Chrome on a shared runner.
  const child = spawn(
    binary,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      // Without this Extensions.loadUnpacked is refused outright.
      "--enable-unsafe-extension-debugging",
      "--remote-allow-origins=*",
      "about:blank",
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  // Chrome's own stderr is noisy on a headless mac (CVDisplayLink, GPU); keep it
  // in the log because a crash shows up there, but it is not what is matched.
  child.stderr.on("data", (d) => say(`[chrome] ${d}`.trimEnd()));
  child.stdout.on("data", (d) => say(`[chrome] ${d}`.trimEnd()));

  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  };

  try {
    const endpoint = await devtoolsEndpoint(profile, child, hardCapMs);
    if (!endpoint) {
      say("[e2e] Chrome never published a DevTools endpoint");
      return out.join("\n");
    }
    await collect({ endpoint, extDir, ms, hardCapMs, say });
  } catch (e) {
    say(`[e2e] chrome driver failed: ${e.message}`);
  } finally {
    stop();
    await sleep(200);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  return out.join("\n");
}

/** The ws:// URL Chrome wrote to DevToolsActivePort, once it exists. */
async function devtoolsEndpoint(profile, child, hardCapMs) {
  const file = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + hardCapMs;
  let gone = false;
  child.on("exit", () => (gone = true));
  while (Date.now() < deadline && !gone) {
    try {
      const [port, route] = (await readFile(file, "utf8")).split("\n");
      if (port && route) return `ws://127.0.0.1:${port.trim()}${route.trim()}`;
    } catch {
      // Not written yet.
    }
    await sleep(150);
  }
  return null;
}

/** Attach, load the extension, and gather its console until the budget runs out. */
function collect({ endpoint, extDir, ms, hardCapMs, say }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(endpoint);
    let id = 0;
    const pending = new Map();
    let started = false;
    let timer = setTimeout(finish, hardCapMs + ms);
    const t0 = Date.now();

    const send = (method, params, sessionId) =>
      new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, { res, rej });
        ws.send(JSON.stringify({ id: i, method, params, sessionId }));
      });

    function finish() {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Closing a closed socket is fine.
      }
      resolve();
    }

    ws.onerror = (e) => {
      say(`[e2e] devtools socket error: ${e.message ?? "unknown"}`);
      finish();
    };
    ws.onclose = () => finish();

    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        return m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
      // Every new target gets Runtime enabled: the service worker is the one that
      // matters, but a panel page opened by openUrls logs too, and on Firefox both
      // land in the same stream.
      if (m.method === "Target.attachedToTarget") {
        send("Runtime.enable", {}, m.params.sessionId).catch(() => {});
        return;
      }
      if (m.method === "Runtime.consoleAPICalled") {
        const text = (m.params.args ?? [])
          .map((a) => a.value ?? a.description ?? "")
          .join(" ")
          .trim();
        if (!text) return;
        say(text);
        // Same rule as Firefox: the clock starts when the extension first speaks.
        if (!started && text.includes("[timed-tabs]")) {
          started = true;
          clearTimeout(timer);
          timer = setTimeout(finish, ms);
          console.log(`  ⏱️  extension up after ${Math.round((Date.now() - t0) / 1000)}s; running ${ms / 1000}s`);
        }
      }
    };

    ws.onopen = async () => {
      try {
        // Before the extension exists, so its worker cannot start unwatched.
        await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
        const { id: extId } = await send("Extensions.loadUnpacked", { path: extDir });
        say(`[e2e] loaded ${extDir} as ${extId}`);
      } catch (e) {
        say(`[e2e] could not load the extension: ${e.message}`);
        finish();
      }
    };
  });
}
