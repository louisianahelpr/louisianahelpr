#!/usr/bin/env node
/**
 * measure-load — cold-load timing per entry route on a slow phone (Q178).
 *
 * Serves the BUILT app (`vite preview`, so run `npx vite build` first) and
 * loads each route in a fresh Chromium context: 375x812, cold cache, service
 * workers blocked, network throttled (1.6 Mbps down / 750 kbps up / 150 ms RTT)
 * and CPU slowed 4x. For every run it records the time from navigation start
 * to the route's own content and the request waterfall ahead of it.
 *
 *   node scripts/perf/measure-load.mjs [--runs 3] [--port 4378] [--out DIR] [--label before]
 *                                      [--dist dist] [--server gzip|preview] [--only /,/browse]
 *
 * Output: DIR/<label>.json (per run + medians) and a printed table. DIR defaults
 * to ~/.lh-shots/q178. Real backend (prod Supabase) — the /browse cards are
 * real rows, so that number carries network variance the others do not.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { extname } from "node:path";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const RUNS = Number(arg("runs", "3"));
const PORT = Number(arg("port", "4378"));
const OUT = arg("out", join(homedir(), ".lh-shots", "q178"));
const LABEL = arg("label", "run");
const ONLY = arg("only", "");
// "gzip" (default): a static server over dist/ that gzips like the real CDN
// does (Vercel serves brotli; `vite preview` serves NOTHING compressed, which
// inflates every JS byte ~3.5x and makes bandwidth look worse than prod).
// "preview": `vite preview`, the setup the 2026-09-23 lead measurement used.
const SERVER = arg("server", "gzip");
const DIST_DIR = resolve(arg("dist", "dist"));
const BASE = `http://localhost:${PORT}`;

// What "the page is here" means per route: the real page's element, never its
// skeleton (LoginRouteSkeleton renders a real "Log In" h1, so /login waits for
// the email field that only the real page has).
const ROUTES = [
  { path: "/", name: "landing H1", selector: "h1", text: "Louisiana" },
  { path: "/browse", name: "browse first card", selector: "div.group.cursor-pointer.bg-card" },
  { path: "/login", name: "login form", selector: 'input[type="email"]' },
  { path: "/signup", name: "signup form", selector: 'input[type="email"], input[name="email"], input[autocomplete="email"]' },
].filter((r) => !ONLY || ONLY.split(",").includes(r.path));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".webp": "image/webp" };
function startGzipServer() {
  const DIST = DIST_DIR;
  const cache = new Map();
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    let file = join(DIST, p);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    const type = TYPES[extname(file)] || "application/octet-stream";
    let body = cache.get(file);
    if (!body) {
      const raw = readFileSync(file);
      body = /text|javascript|json|svg|manifest/.test(type) ? { gz: true, data: gzipSync(raw, { level: 9 }) } : { gz: false, data: raw };
      cache.set(file, body);
    }
    const headers = { "content-type": type, "content-length": body.data.length };
    if (body.gz) headers["content-encoding"] = "gzip";
    res.writeHead(200, headers);
    res.end(body.data);
  });
  return new Promise((ok) => server.listen(PORT, () => ok({ kill: () => server.close() })));
}

async function startPreview() {
  if (SERVER === "gzip") return startGzipServer();
  const proc = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort", "--outDir", DIST_DIR], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE + "/");
      if (r.ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`vite preview did not come up on ${PORT}`);
}

async function measureOnce(browser, route) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // Record the first performance.now() at which the route's element exists.
  await page.addInitScript(
    ({ selector, text }) => {
      const hit = () => {
        for (const el of document.querySelectorAll(selector)) {
          if (!text || (el.textContent || "").includes(text)) return true;
        }
        return false;
      };
      const mark = () => {
        if (window.__q178 == null && hit()) window.__q178 = performance.now();
      };
      new MutationObserver(mark).observe(document, { childList: true, subtree: true, characterData: true });
    },
    { selector: route.selector, text: route.text || "" },
  );

  const t0 = Date.now();
  await page.goto(BASE + route.path, { waitUntil: "commit" });
  await page.waitForFunction(() => window.__q178 != null, null, { timeout: 60_000, polling: 100 });
  const ms = Math.round(await page.evaluate(() => window.__q178));
  const entries = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((e) => ({
      name: e.name.replace(location.origin, ""),
      start: Math.round(e.startTime),
      end: Math.round(e.responseEnd),
      bytes: e.transferSize || e.encodedBodySize || 0,
    })),
  );
  const fcp = await page.evaluate(() => Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1));
  const before = entries.filter((e) => e.start < ms);
  const js = before.filter((e) => e.name.includes("/assets/") && e.name.endsWith(".js"));
  // Distinct start "rounds": JS request start times clustered within 60 ms.
  const starts = [...new Set(js.map((e) => e.start))].sort((a, b) => a - b);
  let rounds = 0;
  let last = -Infinity;
  for (const s of starts) {
    if (s - last > 60) rounds++;
    last = s;
  }
  await context.close();
  return {
    ms,
    fcp,
    wall: Date.now() - t0,
    requestsBefore: before.length,
    jsBefore: js.length,
    jsKB: Math.round(js.reduce((a, e) => a + e.bytes, 0) / 1024),
    rounds,
    waterfall: entries.sort((a, b) => a.start - b.start),
  };
}

const REPO = resolve(new URL("../..", import.meta.url).pathname);
const { acquireBrowserLock, releaseBrowserLock } = await import(pathToFileURL(resolve(REPO, "e2e/browserLock.ts")).href);
await acquireBrowserLock();
process.on("exit", () => releaseBrowserLock());

const preview = await startPreview();
const browser = await chromium.launch();
const results = {};
try {
  for (const route of ROUTES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await measureOnce(browser, route));
    results[route.path] = {
      signal: route.name,
      medianMs: median(runs.map((r) => r.ms)),
      runsMs: runs.map((r) => r.ms),
      medianFcp: median(runs.map((r) => r.fcp)),
      medianRequestsBefore: median(runs.map((r) => r.requestsBefore)),
      medianJsBefore: median(runs.map((r) => r.jsBefore)),
      medianJsKB: median(runs.map((r) => r.jsKB)),
      medianRounds: median(runs.map((r) => r.rounds)),
      waterfall: runs[0].waterfall,
    };
    const r = results[route.path];
    console.log(
      `${route.path.padEnd(8)} ${r.signal.padEnd(18)} median ${String(r.medianMs).padStart(5)} ms  runs ${r.runsMs.join("/")}  fcp ${r.medianFcp}  reqs-before ${r.medianRequestsBefore}  js ${r.medianJsBefore} (${r.medianJsKB} KB)  js-rounds ${r.medianRounds}`,
    );
  }
} finally {
  await browser.close();
  preview.kill();
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(results, null, 2));
console.log(`wrote ${join(OUT, `${LABEL}.json`)}`);
