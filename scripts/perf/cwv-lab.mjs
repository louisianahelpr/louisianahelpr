#!/usr/bin/env node
/**
 * cwv-lab — the Core Web Vitals of every first screen, measured in the lab
 * the way Vercel Speed Insights measures them on real users (Q1157, Q1158).
 *
 * Owner, 2026-10-03: "all measurements from Vercel need to be great". Speed
 * Insights reports P75 of real users per route: LCP <= 2.5 s, CLS <= 0.1,
 * FCP <= 1.8 s, INP <= 200 ms, TTFB <= 0.8 s are GOOD. Real users are not on
 * an unthrottled Mac, so a route that paints in 500 ms here can be 5.5 s on a
 * phone; this measures under the same two device profiles Lighthouse uses:
 *
 *   mobile   375x812, DPR 2, touch; Slow 4G (562.5 ms RTT, 1.44 Mbps down,
 *            675 kbps up: DevTools' own preset, the old "Fast 3G") + 4x CPU,
 *            calibrated to the reference machine (calibratedCpuRate below)
 *   desktop  1440x900, DPR 1; 40 ms RTT, 10 Mbps, no CPU slowdown
 *            (Lighthouse's desktop profile)
 *
 * For every load it records, from observers installed BEFORE the app boots:
 *   ttfb   navigation responseStart
 *   fcp    first-contentful-paint
 *   lcp    the last largest-contentful-paint before any input, with the
 *          ELEMENT (tag, classes, text) and web-vitals' four-part breakdown
 *          (ttfb, resource load delay, resource load time, render delay)
 *   cls    web-vitals' definition: the worst 5 s session window of shifts
 *          without recent input, with every shift's sources
 *   marks  when the app's JS, the page chunk, the auth refresh and each
 *          Supabase read finished, so a late LCP names what it waited on
 *
 * Signed-in routes run as the shared poster test account (prod data, RLS,
 * never mocked); public routes as a guest. `--expired` hands the app a session
 * whose access token has already expired, as a returning visitor's has after
 * an hour away: supabase-js must refresh it before the first read.
 *
 *   node scripts/perf/cwv-lab.mjs                # dist/ over HTTP/2 + brotli (startDistServer)
 *   node scripts/perf/cwv-lab.mjs --base https://www.louisianahelpr.com   # prod
 *   --routes /,/home,/jobs   --profiles mobile,desktop   --browsers chromium,webkit
 *   --runs 3   --warm (a second load in the same context: HTTP cache warm)
 *   --return (a second load in the same context with the HTTP cache cleared:
 *            a returning visitor after a deploy; Chromium only)
 *   --expired  --persona customer|helper|admin   --label before   --out ~/.lh-shots/perf
 *   --dist <dir>   --viewport 1366x768   --scheme dark   --shots   --filmstrip
 *   --walk Posts,Jobs,@Earnings   (tap dock/rail destinations, or "@Text"
 *            anywhere, after the cold load; per-tap CLS and the session CLS
 *            Speed Insights would bill to the route on screen at page hide)
 *   --soft /jobs [--soft-sel <selector>]   (one tap, its shifts)
 *   --ihe    (ignoreHTTPSErrors instead of the SPKI allow-list, as the spec loads)
 *   --allow-reads <file>   (let STABLE RPC reads, the expired refresh and the
 *            payout-status read through the write block: READ ALLOWANCE below)
 *   --ready "<css>[!<text>]|..."   (first-real-content marks: READY_INIT)
 *
 * WebKit cannot be network- or CPU-throttled from Playwright (no CDP) and has
 * no layout-shift entries (Playwright WebKit 2026-10-03 lists event,
 * first-input, largest-contentful-paint, paint): its rows are unthrottled.
 * e2e/web-vitals/first-screens.spec.ts uses this file's exports as the CI
 * budget, so the audit table and the budget are one measurement.
 */
import { chromium, webkit } from "@playwright/test";
import { allowedRead, mockedRead } from "./readAllowance.mjs";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createSecureServer } from "node:http2";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";

/** The two device profiles (see the header). Exported for the budget spec. */
export const PROFILES = {
  mobile: {
    viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    network: { latency: 562.5, downloadThroughput: 180_000, uploadThroughput: 84_375 }, cpu: 4,
  },
  desktop: {
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false,
    network: { latency: 40, downloadThroughput: 1_250_000, uploadThroughput: 1_250_000 }, cpu: 1,
  },
};

/**
 * CPU CALIBRATION. `Emulation.setCPUThrottlingRate(4)` slows THIS machine by
 * 4x, so the same build reads slower on a slower runner. Before throttling,
 * the lab times a fixed loop in a blank page and scales the rate so the
 * throttled CPU matches the reference machine slowed 4x: the budgets were
 * measured on an Apple-silicon Mac where the loop takes REFERENCE_BENCH_MS
 * (2026-10-03, Playwright Chromium headless, idle machine, 21 runs
 * 74.8-75.4 ms; the same loop read 83 ms while a measurement ran beside it,
 * so the calibration also absorbs a busy machine). A runner twice as slow gets
 * rate 2, not 4. Clamped to [1, 8].
 */
export const REFERENCE_BENCH_MS = 75;

/** Median of 5 timings of a fixed integer loop, in a blank page. */
export async function cpuBenchmarkMs(browser) {
  const page = await browser.newPage();
  try {
    await page.goto("about:blank");
    const runs = [];
    for (let i = 0; i < 5; i++) {
      runs.push(await page.evaluate(() => {
        const t = performance.now();
        let x = 0;
        for (let i = 0; i < 2e7; i++) x = (x * 31 + i) % 1000003;
        return performance.now() - t + (x < 0 ? 1 : 0);
      }));
    }
    return runs.sort((a, b) => a - b)[2];
  } finally {
    await page.close();
  }
}

/** The throttling rate that makes this machine behave like the reference one slowed `target`x. */
export function calibratedCpuRate(target, benchMs) {
  if (!(benchMs > 0) || target <= 1) return target;
  return Math.min(8, Math.max(1, Number(((target * REFERENCE_BENCH_MS) / benchMs).toFixed(2))));
}

/** Speed Insights' GOOD band (web.dev thresholds), ms except CLS. */
export const GOOD = { ttfb: 800, fcp: 1800, lcp: 2500, cls: 0.1 };

/**
 * Installed before the app boots. Records paint, LCP, layout shifts (with
 * sources) and keeps every resource timing entry. Plain ES5-ish so WebKit runs
 * it unchanged.
 */
export const CWV_INIT = () => {
  const w = window;
  const cwv = (w.__cwv = { lcp: [], fcp: null, shifts: [], supported: [], inputAt: null });
  try { cwv.supported = PerformanceObserver.supportedEntryTypes.slice(); } catch { /* old engine */ }
  try { performance.setResourceTimingBufferSize(5000); } catch { /* not supported */ }
  const describe = (n) => {
    if (n && n.nodeType !== 1) n = n.parentElement;
    if (!n || n.nodeType !== 1) return null;
    const cls = (n.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 5).join(".");
    const text = (n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70);
    const r = n.getBoundingClientRect();
    return `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""} [${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}]`;
  };
  // web-vitals stops LCP at the first discrete input; so do we.
  for (const type of ["pointerdown", "keydown"]) {
    addEventListener(type, () => { if (cwv.inputAt == null) cwv.inputAt = performance.now(); }, { capture: true, passive: true });
  }
  const observe = (type, fn) => {
    try { new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch { /* unsupported here */ }
  };
  observe("paint", (e) => { if (e.name === "first-contentful-paint") cwv.fcp = e.startTime; });
  // React's first commit replaces index.html's #boot-loader: the moment the app itself first draws.
  const watchBoot = () => {
    if (!document.getElementById("boot-loader")) { cwv.appDrawn = performance.now(); return; }
    const mo = new MutationObserver(() => {
      if (!document.getElementById("boot-loader")) { cwv.appDrawn = performance.now(); mo.disconnect(); }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchBoot); else watchBoot();
  observe("largest-contentful-paint", (e) => {
    if (cwv.inputAt != null && e.startTime > cwv.inputAt) return;
    cwv.lcp.push({ t: e.startTime, renderTime: e.renderTime, loadTime: e.loadTime, size: e.size, url: e.url || "", el: describe(e.element) });
  });
  observe("layout-shift", (e) => {
    const srcs = (e.sources || []).map((s) => {
      const n = s.node && s.node.nodeType !== 1 ? s.node.parentElement : s.node;
      const p = n && n.previousElementSibling;
      return `${describe(n) || "#gone"} y ${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)} h ${Math.round(s.previousRect.height)}→${Math.round(s.currentRect.height)}${p ? ` ↑${describe(p)}` : ""}`;
    });
    cwv.shifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput, srcs });
  });
};

/**
 * `--ready "<css>[!<text>]|..."`: when each first-real-content mark first
 * matched and then painted (the next animation frame), for a screen whose LCP
 * is the boot splash (/admin: its splash is larger than anything the dashboard
 * paints, so LCP never moves past it). `!<text>` waits until the element's
 * text no longer contains <text> (a placeholder such as "—").
 */
export const READY_INIT = (specs) => {
  const w = window;
  const marks = (w.__cwvReady = specs.map((s) => ({ spec: s, t: null })));
  const check = () => {
    let left = 0;
    for (const m of marks) {
      if (m.t != null || m.pending) continue;
      const [sel, not] = m.spec.split("!");
      let el = null;
      try { el = document.querySelector(sel); } catch { m.t = -1; continue; }
      if (!el || (not && (el.textContent || "").includes(not))) { left++; continue; }
      m.pending = true;
      requestAnimationFrame(() => { m.t = performance.now(); m.pending = false; });
    }
    return left;
  };
  const start = () => {
    if (!check()) return;
    const mo = new MutationObserver(() => { if (!check()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
};

/** web-vitals' CLS: the largest session window (gap < 1 s, span < 5 s) of shifts without recent input. */
export function clsOf(shifts) {
  let best = 0, cur = 0, first = null, last = null, bestWin = [], win = [];
  for (const s of shifts) {
    if (s.input) continue;
    if (cur && s.t - last.t < 1000 && s.t - first.t < 5000) { cur += s.v; win.push(s); }
    else { cur = s.v; first = s; win = [s]; }
    last = s;
    if (cur > best) { best = cur; bestWin = win.slice(); }
  }
  return { cls: Number(best.toFixed(4)), window: bestWin };
}

/** Read everything CWV_INIT recorded plus timing, and break the LCP down. */
export async function readCwv(page) {
  const raw = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource").map((e) => ({
      name: e.name, type: e.initiatorType, start: e.startTime, reqStart: e.requestStart || e.startTime, end: e.responseEnd, size: e.transferSize || 0,
    }));
    return { cwv: window.__cwv, ready: window.__cwvReady ?? [], ttfb: nav ? nav.responseStart : null, dcl: nav ? nav.domContentLoadedEventEnd : null, load: nav ? nav.loadEventEnd : null, res, origin: location.origin };
  });
  const { cwv, res, origin } = raw;
  const last = cwv.lcp[cwv.lcp.length - 1] ?? null;
  const ttfb = raw.ttfb;
  const lcpRes = last?.url ? res.find((r) => r.name === last.url) : null;
  // web-vitals attribution: the four LCP sub-parts.
  let breakdown = null;
  if (last) {
    const t = ttfb ?? 0;
    const loadStart = lcpRes ? Math.max(t, lcpRes.reqStart) : t;
    const loadEnd = lcpRes ? Math.max(loadStart, lcpRes.end) : t;
    breakdown = { ttfb: Math.round(t), loadDelay: Math.round(loadStart - t), loadTime: Math.round(loadEnd - loadStart), renderDelay: Math.round(last.t - loadEnd) };
  }
  const short = (u) => {
    if (u.startsWith(origin)) return u.slice(origin.length).replace(/^\/assets\/([^-]+(?:-[^-]+)*?)-[A-Za-z0-9_-]{8}\.(js|css|webp|png|woff2)$/, "/assets/$1.$2");
    try {
      const x = new URL(u);
      const path = x.pathname.replace(/^\/(rest|auth|functions|storage)\/v1\//, "$1:");
      const sel = x.searchParams.get("select");
      return `${x.hostname.split(".")[0]}:${path}${x.searchParams.get("grant_type") ? "?" + x.searchParams.get("grant_type") : ""}${sel ? "?select=" + sel.slice(0, 24) : ""}`;
    } catch { return u.slice(0, 80); }
  };
  const js = res.filter((r) => r.name.startsWith(origin + "/assets/") && r.name.endsWith(".js"));
  const lcpT = last?.t ?? Infinity;
  const jsBeforeLcp = js.filter((r) => r.start < lcpT);
  const data = res
    .filter((r) => /\/(rest|auth|functions|storage)\/v1\//.test(r.name))
    .map((r) => ({ name: short(r.name), start: Math.round(r.start), end: Math.round(r.end) }))
    .sort((a, b) => a.start - b.start);
  const { cls, window } = clsOf(cwv.shifts);
  return {
    supported: cwv.supported,
    ttfb: ttfb == null ? null : Math.round(ttfb),
    fcp: cwv.fcp == null ? null : Math.round(cwv.fcp),
    lcp: last ? Math.round(last.t) : null,
    lcpEl: last?.el ?? null,
    lcpUrl: last?.url ? short(last.url) : null,
    lcpSize: last?.size ?? null,
    lcpCandidates: cwv.lcp.map((c) => `${Math.round(c.t)} ${c.size} ${c.el}`),
    breakdown,
    cls,
    clsWindow: window.map((s) => ({ t: Math.round(s.t), v: Number(s.v.toFixed(4)), srcs: s.srcs })),
    shiftsAll: cwv.shifts.filter((s) => s.v >= 0.001).map((s) => ({ t: Math.round(s.t), v: Number(s.v.toFixed(4)), input: s.input, srcs: s.srcs })),
    marks: {
      dcl: raw.dcl == null ? null : Math.round(raw.dcl),
      appDrawn: cwv.appDrawn == null ? null : Math.round(cwv.appDrawn),
      ready: raw.ready.map((r) => ({ spec: r.spec, t: r.t == null ? null : Math.round(r.t) })),
      jsBeforeLcp: jsBeforeLcp.map((r) => ({ name: short(r.name), start: Math.round(r.start), end: Math.round(r.end), kb: Math.round(r.size / 102.4) / 10 })).sort((a, b) => a.start - b.start),
      // Every JS file of the load (after LCP too): for a screen whose LCP is
      // the splash (--ready), what its first real content waited on.
      jsAll: js.map((r) => ({ name: short(r.name), start: Math.round(r.start), end: Math.round(r.end), kb: Math.round(r.size / 102.4) / 10 })).sort((a, b) => a.start - b.start),
      jsDone: jsBeforeLcp.length ? Math.round(Math.max(...jsBeforeLcp.map((r) => r.end))) : null,
      jsKBbeforeLcp: Math.round(jsBeforeLcp.reduce((a, r) => a + r.size, 0) / 1024),
      jsCountBeforeLcp: jsBeforeLcp.length,
      data: data.slice(0, 40),
    },
  };
}

/** Wait until no new LCP candidate, shift or request for `quietMs` (max `maxMs`). */
export async function settle(page, { quietMs = 3000, maxMs = 30000 } = {}) {
  const t0 = Date.now();
  let lastSig = "", lastChange = Date.now();
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(250);
    const sig = await page.evaluate(() => `${window.__cwv.lcp.length}|${window.__cwv.shifts.length}|${performance.getEntriesByType("resource").length}`).catch(() => lastSig);
    if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= quietMs) return Date.now() - t0;
  }
  return Date.now() - t0;
}

/** The persisted session the app reads at boot; `expired` back-dates the access token. */
export function sessionInit({ key, value, expired }) {
  let v = value;
  if (v && expired) {
    const s = JSON.parse(v);
    s.expires_at = Math.floor(Date.now() / 1000) - 60;
    v = JSON.stringify(s);
  }
  return [({ k, v }) => {
    try {
      if (v && !sessionStorage.getItem("__cwv_seeded")) { localStorage.setItem(k, v); sessionStorage.setItem("__cwv_seeded", "1"); }
      localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
    } catch { /* storage blocked: the row reads signed-out */ }
  }, { k: key, v }];
}

/**
 * STRICT WRITE BLOCK (CLAUDE.md: a browser holding a test session against
 * prod blocks every non-GET request to Supabase, edge functions included, and
 * to Stripe, and proves the block fired). Installed on the context, so every
 * page in it is covered. Aborted before the request leaves the browser; each
 * one is recorded with the wall time it was issued (`at`, ms after `clock()`),
 * so a run can say which write it would have made and when. HEAD and OPTIONS
 * (CORS preflight) carry no body and pass. NOTE what this costs a measurement:
 * supabase.rpc() reads are POSTs and the auth token refresh is a POST, so a
 * first screen whose data comes from an RPC never receives it here, and an
 * --expired session is never refreshed.
 *
 * `--allow-reads <file>` (READ ALLOWANCE, Q1170/Q1172/Q1173): lets through
 * ONLY the POSTs that are reads of the test account's own data, so a
 * signed-in screen is measured with its data rather than its error state:
 *   - POST /rest/v1/rpc/<fn> for an <fn> named in <file>, a comma list of the
 *     public functions prod's pg_proc marks STABLE or IMMUTABLE (Postgres
 *     refuses a write inside them), generated read-only right before the run;
 *   - with --expired, POST /auth/v1/token?grant_type=refresh_token (the
 *     session refresh the measurement is about; it touches only the test
 *     account's own session);
 *   - POST /functions/v1/stripe-connect whose JSON body is {action: "status"}
 *     (the payout-status read the Profile landing makes; it re-syncs only the
 *     test account's own cached gate from Stripe).
 * MOCKED READS (readAllowance.mjs mockedRead): stripe-payouts' list read is
 * answered IN THE BROWSER with fixed test data (LAB_STRIPE_PAYOUTS) and never
 * sent: server side it reads Stripe's live balance, so Money is measured with
 * a payout screen, not its error state, and nothing reaches prod or Stripe.
 * Every other non-GET is still aborted, the probe (an RPC no list names) must
 * still be blocked, and each allowed request is recorded on its row.
 */
const WRITE_BLOCK_HOSTS = /(^|\.)supabase\.co$|(^|\.)stripe\.com$/;
async function installWriteBlock(ctx, clock = () => 0, reads = null, allowed = []) {
  const blocked = [];
  await ctx.route(
    (url) => WRITE_BLOCK_HOSTS.test(url.hostname),
    (route) => {
      const req = route.request();
      const m = req.method();
      if (m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();
      const mock = mockedRead(reads, m, req.url(), req.postData());
      if (mock) {
        allowed.push({ read: mock.read, at: clock() });
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(mock.body) });
      }
      const read = allowedRead(reads, m, req.url(), req.postData());
      if (read) { allowed.push({ read, at: clock() }); return route.continue(); }
      const u = new URL(req.url());
      blocked.push({ method: m, path: `${u.hostname.split(".")[0]}:${u.pathname}${u.searchParams.get("grant_type") ? "?grant_type=" + u.searchParams.get("grant_type") : ""}`, at: clock() });
      return route.abort("blockedbyclient");
    },
  );
  return blocked;
}

/**
 * Proves the block is live in `ctx` before any measurement: a POST to the
 * Supabase REST root from a blank page must fail in the browser AND show up in
 * `blocked`. Throws otherwise, so no run measures with writes reaching prod.
 */
async function probeWriteBlock(ctx, blocked, supabaseUrl = "https://fncmgoasalhdgfwzhsqa.supabase.co") {
  const page = await ctx.newPage();
  try {
    const before = blocked.length;
    const outcome = await page.evaluate(async (u) => {
      try { await fetch(`${u}/rest/v1/rpc/__cwv_write_block_probe`, { method: "POST", body: "{}" }); return "reached"; }
      catch { return "failed"; }
    }, supabaseUrl);
    if (outcome !== "failed" || blocked.length !== before + 1) {
      throw new Error(`write block NOT live: probe POST ${outcome}, blocked ${before} -> ${blocked.length}`);
    }
    blocked.splice(before, 1);
  } finally {
    await page.close();
  }
}

/**
 * Apply the profile's network and CPU throttling to `page` (Chromium only; no
 * CDP in WebKit). `cpuRate` is the calibrated rate (calibratedCpuRate) when the
 * caller measured one, else the profile's nominal rate.
 */
export async function applyThrottle(ctx, page, profile, browserName, cpuRate = profile.cpu) {
  if (browserName !== "chromium") return false;
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, ...profile.network });
  if (profile.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  return true;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".webp": "image/webp" };

/**
 * A throwaway self-signed certificate for 127.0.0.1 (openssl; cached under
 * ~/.lh-shots) and its SPKI hash. Chromium launched with
 * --ignore-certificate-errors-spki-list=<hash> treats it as VALID, so it keeps
 * the HTTP cache (a page with an ignored certificate error caches nothing,
 * which would make every "warm" load cold).
 */
export function localCert() {
  const dir = join(homedir(), ".lh-shots", "lh-cwv-cert");
  const key = join(dir, "key.pem"), crt = join(dir, "cert.pem");
  if (!existsSync(crt)) {
    mkdirSync(dir, { recursive: true });
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "30", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  }
  const cert = readFileSync(crt);
  const spki = createHash("sha256").update(new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" })).digest("base64");
  return { key: readFileSync(key), cert, spki };
}

/**
 * dist/ the way Vercel serves it: HTTP/2 over TLS (every chunk multiplexed on
 * one connection; HTTP/1.1's six-connection queue made 26 chunks cost five
 * round trips that prod never pays), brotli for a client that accepts it,
 * hashed assets immutable, HTML revalidated.
 */
export function startDistServer(distDir, port, tls = localCert()) {
  const cache = new Map();
  const load = (file) => {
    let body = cache.get(file);
    if (!body) {
      const raw = readFileSync(file);
      const text = /text|javascript|json|svg|manifest/.test(TYPES[extname(file)] || "");
      body = {
        raw,
        gz: text ? gzipSync(raw, { level: 9 }) : null,
        br: text ? brotliCompressSync(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }) : null,
      };
      cache.set(file, body);
    }
    return body;
  };
  // Compress everything BEFORE the first request: brotli at quality 11 takes
  // ~1 s on the 388 KB shared chunk, and a CDN never makes a visitor wait for
  // that. Lazily, it landed inside the first cold load (desktop /home read
  // LCP 2828 ms instead of the ~1.3 s the same build paints in).
  for (const f of readdirSync(join(distDir, "assets"))) if (/\.(js|css)$/.test(f)) load(join(distDir, "assets", f));
  load(join(distDir, "index.html"));
  const server = createSecureServer({ key: tls.key, cert: tls.cert, allowHTTP1: true }, (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "https://x").pathname);
    let file = join(distDir, p);
    if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(distDir, "index.html");
    const type = TYPES[extname(file)] || "application/octet-stream";
    const body = load(file);
    const accept = String(req.headers["accept-encoding"] || "");
    const enc = body.br && /\bbr\b/.test(accept) ? "br" : body.gz && /\bgzip\b/.test(accept) ? "gzip" : null;
    const data = enc ? body[enc === "br" ? "br" : "gz"] : body.raw;
    const headers = {
      "content-type": type,
      "content-length": data.length,
      "cache-control": /^\/(assets|fonts)\//.test(p) ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
    };
    if (enc) headers["content-encoding"] = enc;
    res.writeHead(200, headers);
    res.end(data);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

async function main() {
  const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
  };
  const flag = (name) => process.argv.includes(`--${name}`);
  const routes = arg("routes", "/,/home,/jobs,/posts,/messages,/profile").split(",");
  const profiles = arg("profiles", "mobile,desktop").split(",");
  const browsers = arg("browsers", "chromium").split(",");
  const runs = Number(arg("runs", "2"));
  const persona = arg("persona", "customer");
  const label = arg("label", "run");
  const out = resolve(arg("out", join(homedir(), ".lh-shots", "perf")));
  const port = Number(arg("port", "4391"));
  let base = arg("base", "");
  const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));

  const { acquireBrowserLock, releaseBrowserLock } = await import(pathToFileURL(resolve(repo, "e2e/browserLock.ts")).href);
  await acquireBrowserLock();
  process.on("exit", () => releaseBrowserLock());

  let server = null;
  const tls = localCert();
  if (!base) {
    server = await startDistServer(resolve(repo, arg("dist", "dist")), port, tls);
    base = `https://127.0.0.1:${port}`;
  }
  const { mintAccounts } = await import(pathToFileURL(resolve(repo, "scripts/audit/pressProdSafety.mjs")).href);
  const { sessions, unavailable } = await mintAccounts([persona]);
  if (unavailable[persona]) throw new Error(`no ${persona} session: ${unavailable[persona]}`);
  const session = sessions[persona];
  // --allow-reads <file>: the READ ALLOWANCE (installWriteBlock).
  const readsFile = arg("allow-reads", "");
  const reads = readsFile
    ? { rpcs: new Set(readFileSync(readsFile, "utf8").split(/[\s,]+/).filter(Boolean)), refresh: flag("expired") }
    : null;
  if (reads && reads.rpcs.size < 20) throw new Error(`--allow-reads ${readsFile}: ${reads.rpcs.size} names, expected the STABLE/IMMUTABLE function list`);
  if (reads) console.log(`read allowance: ${reads.rpcs.size} STABLE/IMMUTABLE RPCs from ${readsFile}${reads.refresh ? ", the expired session's refresh" : ""}, stripe-connect status, stripe-payouts list MOCKED (test data, never sent)`);
  const PUBLIC = new Set(["/", "/browse", "/login", "/signup", "/about", "/terms", "/privacy", "/help", "/how-it-works"]);

  mkdirSync(out, { recursive: true });
  const rows = [];
  for (const browserName of browsers) {
    const browser = browserName === "webkit"
      ? await webkit.launch()
      : await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${tls.spki}`] });
    // Calibrate once per browser (Chromium only: WebKit is never throttled).
    const bench = browserName === "chromium" ? await cpuBenchmarkMs(browser) : null;
    if (bench) console.log(`cpu benchmark ${bench.toFixed(1)} ms (reference ${REFERENCE_BENCH_MS}); mobile rate ${calibratedCpuRate(PROFILES.mobile.cpu, bench)}x`);
    try {
      for (const profileName of profiles) {
        const vp = arg("viewport", "");
        const profile = vp
          ? { ...PROFILES[profileName], viewport: { width: Number(vp.split("x")[0]), height: Number(vp.split("x")[1]) } }
          : PROFILES[profileName];
        for (const route of routes) {
          const signedIn = !PUBLIC.has(route) || flag("signed-in-public");
          for (let run = 0; run < runs; run++) {
            const ctx = await browser.newContext({
              viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor,
              isMobile: browserName === "webkit" ? undefined : profile.isMobile, hasTouch: profile.hasTouch,
              colorScheme: arg("scheme", "light"), serviceWorkers: "block",
              // WebKit has no SPKI allow-list; its rows are unthrottled anyway.
              // --ihe: the way the Playwright spec loads (ignoreHTTPSErrors).
              ignoreHTTPSErrors: browserName === "webkit" || flag("ihe"),
            });
            // Strict write block on EVERY context (signed in or not), proven live first.
            let navWallNow = Date.now();
            const allowed = [];
            const blocked = await installWriteBlock(ctx, () => Date.now() - navWallNow, reads, allowed);
            await probeWriteBlock(ctx, blocked);
            await ctx.addInitScript(CWV_INIT);
            const ready = arg("ready", "");
            if (ready) await ctx.addInitScript(READY_INIT, ready.split("|"));
            if (signedIn) await ctx.addInitScript(...sessionInit({ key: session.key, value: session.value, expired: flag("expired") }));
            // --return: a second load in the same context with the HTTP cache
            // CLEARED but site storage kept, as a returning visitor's first load
            // after a deploy (every chunk hash changed; localStorage, IndexedDB
            // and the learned first-screen reads of Q1171 survive).
            const loads = flag("warm") ? ["cold", "warm"] : flag("return") ? ["cold", "return"] : ["cold"];
            for (const kind of loads) {
              const page = await ctx.newPage();
              if (kind === "return") {
                const c = await ctx.newCDPSession(page);
                await c.send("Network.clearBrowserCache");
                // --drop-idb: also the persisted React Query cache (IndexedDB,
                // 24 h maxAge), as a visitor back after more than a day.
                if (flag("drop-idb")) await c.send("Storage.clearDataForOrigin", { origin: base, storageTypes: "indexeddb" });
                await c.detach();
              }
              const throttled = await applyThrottle(ctx, page, profile, browserName, calibratedCpuRate(profile.cpu, bench));
              // --filmstrip: every painted frame (CDP screencast), saved at
              // 250 ms steps, so a number always comes with what it looked like.
              const frames = [];
              let cast = null;
              if (flag("filmstrip") && browserName === "chromium" && run === 0) {
                cast = await ctx.newCDPSession(page);
                cast.on("Page.screencastFrame", (f) => {
                  frames.push({ wall: f.metadata.timestamp * 1000, data: f.data });
                  cast.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
                });
                await cast.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
              }
              const navWall = Date.now();
              navWallNow = navWall;
              const blockedFrom = blocked.length;
              const allowedFrom = allowed.length;
              const t0 = Date.now();
              let error = null;
              try {
                await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 60_000 });
                await settle(page, { quietMs: throttled && profile.cpu > 1 ? 5000 : 3000, maxMs: throttled && profile.cpu > 1 ? 45_000 : 20_000 });
              } catch (e) { error = String(e).slice(0, 160); }
              let m = error ? {} : await readCwv(page);
              // --soft /jobs: after the cold load settles, CLICK the visible nav
              // link to that route (a real input, so the 500 ms recent-input
              // exclusion applies as it does for a person) and measure only the
              // shifts that follow. Speed Insights reports CLS for the whole tab
              // at page-hide, against the route showing THEN: a jump on a page
              // reached by a tap is billed to that page.
              const soft = arg("soft", "");
              if (!error && soft && kind === "cold") {
                const before = await page.evaluate(() => window.__cwv.shifts.length);
                // The dock and the desktop rail navigate with <button>s, not
                // links: --soft-sel names the control when there is no <a>.
                const sel = arg("soft-sel", "");
                const link = sel ? page.locator(sel).first() : page.locator(`a[href="${soft}"]:visible`).first();
                await link.click({ timeout: 10_000 }).catch((e) => { error = `soft click: ${String(e).slice(0, 120)}`; });
                if (!error) await settle(page, { quietMs: 3000, maxMs: 30_000 });
                const after = await page.evaluate((n) => window.__cwv.shifts.slice(n), before);
                const { cls, window: win } = clsOf(after);
                m = { ...m, softTo: soft, softCls: cls, softWindow: win.map((x) => ({ t: Math.round(x.t), v: Number(x.v.toFixed(4)), srcs: x.srcs })), softShiftsAll: after.filter((x) => x.v >= 0.001).map((x) => ({ t: Math.round(x.t), v: Number(x.v.toFixed(4)), input: x.input, srcs: x.srcs.slice(0, 3) })) };
              }
              // --walk Posts,Jobs,Messages,Profile: after the cold load, tap
              // each primary-nav destination in turn (the dock at phone width,
              // the right rail on the desktop website) and measure the shifts
              // each tap leads to. A person's session is a walk, and Speed
              // Insights bills the session's worst window to the route that is
              // showing when the tab is hidden.
              const walk = arg("walk", "");
              if (!error && walk && kind === "cold") {
                m.walk = [];
                for (const label of walk.split(",")) {
                  const before = await page.evaluate(() => window.__cwv.shifts.length);
                  const nav = profile.viewport.width < 900 ? 'nav[aria-label="Bottom navigation"]' : 'nav[aria-label="Primary"]';
                  // "@Text" taps a control anywhere on the page by its visible
                  // text (a profile tab, a filter), not a nav destination.
                  const ctl = label.startsWith("@")
                    ? page.locator(`button:visible, a:visible, [role="tab"]:visible`).filter({ hasText: label.slice(1) }).first()
                    : page.locator(`${nav} [aria-label="${label}"], ${nav} button:has-text("${label}")`).first();
                  let hopError = null;
                  await ctl.click({ timeout: 10_000 }).catch((e) => { hopError = String(e).slice(0, 120); });
                  if (!hopError) await settle(page, { quietMs: 3000, maxMs: 30_000 });
                  const after = await page.evaluate((n) => window.__cwv.shifts.slice(n), before);
                  const { cls, window: win } = clsOf(after);
                  m.walk.push({ label, at: new URL(page.url()).pathname + new URL(page.url()).search, cls, hopError, window: win.map((x) => ({ t: Math.round(x.t), v: Number(x.v.toFixed(4)), srcs: x.srcs.slice(0, 3) })) });
                }
                // What Speed Insights would report for this tab if it were
                // hidden now: the worst window of the WHOLE session, billed to
                // the route on screen at that moment.
                const all = await page.evaluate(() => window.__cwv.shifts);
                m.sessionCls = clsOf(all).cls;
                m.sessionRoute = new URL(page.url()).pathname;
              }
              const landed = new URL(page.url()).pathname;
              if (cast) {
                await cast.send("Page.stopScreencast").catch(() => {});
                const dir = join(out, `${label}-film-${browserName}-${profileName}-${kind}${route.replace(/\//g, "_") || "_root"}`);
                mkdirSync(dir, { recursive: true });
                let next = 0;
                for (let i = 0; i < frames.length; i++) {
                  const at = Math.round(frames[i].wall - navWall);
                  const last = i === frames.length - 1;
                  if (at >= next || last) {
                    writeFileSync(join(dir, `${String(Math.max(0, at)).padStart(6, "0")}ms.jpg`), Buffer.from(frames[i].data, "base64"));
                    next = at + 250;
                  }
                }
              }
              if (flag("shots") && run === 0) {
                await page.screenshot({ path: join(out, `${label}-${browserName}-${profileName}-${kind}${route.replace(/\//g, "_") || "_root"}.png`) }).catch(() => {});
              }
              rows.push({ browser: browserName, profile: profileName, route, landed, kind, run, signedIn, expired: flag("expired"), throttled, wallMs: Date.now() - t0, error, ...m, blocked: blocked.slice(blockedFrom), allowedReads: allowed.slice(allowedFrom) });
              const r = rows[rows.length - 1];
              console.log(`${browserName.padEnd(8)} ${profileName.padEnd(7)} ${kind.padEnd(4)} ${route.padEnd(10)} ttfb=${String(r.ttfb).padStart(4)} fcp=${String(r.fcp).padStart(5)} lcp=${String(r.lcp).padStart(5)} cls=${String(r.cls).padEnd(6)} ${landed !== route ? "→" + landed + " " : ""}${error ?? ""}`);
              console.log(`    lcpEl: ${r.lcpEl}  breakdown: ${JSON.stringify(r.breakdown)}  appDrawn=${r.marks?.appDrawn} jsDone=${r.marks?.jsDone} js=${r.marks?.jsCountBeforeLcp}/${r.marks?.jsKBbeforeLcp}KB`);
              if (r.marks?.ready?.length) console.log(`    READY ${r.marks.ready.map((x) => `${x.spec}=${x.t}`).join("  ")}`);
              if (r.allowedReads.length) console.log(`    ALLOWED ${r.allowedReads.length} reads: ${[...new Set(r.allowedReads.map((x) => x.read))].join("  ")}`);
              if (r.blocked.length) console.log(`    BLOCKED ${r.blocked.length} non-GET: ${r.blocked.slice(0, 8).map((x) => `${x.method} ${x.path}@${x.at}`).join("  ")}`);
              if (r.marks?.data?.length) console.log(`    data: ${r.marks.data.slice(0, 12).map((d) => `${d.name}@${d.start}-${d.end}`).join("  ")}`);
              for (const s of r.clsWindow ?? []) console.log(`    shift t=${s.t} v=${s.v} ${s.srcs.slice(0, 2).join(" | ")}`);
              if (r.sessionRoute) console.log(`    SESSION CLS ${r.sessionCls} (billed to ${r.sessionRoute} at page hide)`);
              for (const h of r.walk ?? []) {
                console.log(`    WALK ${h.label} → ${h.at}: cls=${h.cls}${h.hopError ? " ERR " + h.hopError : ""}`);
                for (const s of h.window) console.log(`      shift t=${s.t} v=${s.v} ${s.srcs.join(" | ")}`);
              }
              if (r.softTo) {
                console.log(`    SOFT → ${r.softTo}: cls=${r.softCls}`);
                for (const s of r.softShiftsAll ?? []) console.log(`      shift t=${s.t} v=${s.v}${s.input ? " (input)" : ""} ${s.srcs.join(" | ")}`);
              }
              await page.close();
            }
            await ctx.close();
          }
        }
      }
    } finally {
      await browser.close();
    }
  }
  if (server) server.close();
  // Medians per browser/profile/route/kind.
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.browser}|${r.profile}|${r.route}|${r.kind}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const summary = [...groups.entries()].map(([k, rs]) => {
    const [browserName, profileName, route, kind] = k.split("|");
    return {
      browser: browserName, profile: profileName, route, kind, n: rs.length,
      ttfb: median(rs.map((r) => r.ttfb)), fcp: median(rs.map((r) => r.fcp)), lcp: median(rs.map((r) => r.lcp)),
      cls: rs.reduce((a, r) => Math.max(a, r.cls ?? 0), 0), lcpEl: rs[rs.length - 1].lcpEl, errors: rs.filter((r) => r.error).length,
      ready: (rs[0].marks?.ready ?? []).map((x, i) => ({ spec: x.spec, t: median(rs.map((r) => r.marks?.ready?.[i]?.t ?? null)) })),
    };
  });
  console.log(`\n${"browser".padEnd(8)} ${"profile".padEnd(7)} ${"load".padEnd(4)} ${"route".padEnd(10)} ${"TTFB".padStart(5)} ${"FCP".padStart(6)} ${"LCP".padStart(6)} ${"CLSmax".padStart(7)}  LCP element`);
  for (const s of summary) {
    console.log(`${s.browser.padEnd(8)} ${s.profile.padEnd(7)} ${s.kind.padEnd(4)} ${s.route.padEnd(10)} ${String(s.ttfb).padStart(5)} ${String(s.fcp).padStart(6)} ${String(s.lcp).padStart(6)} ${String(s.cls).padStart(7)}  ${(s.lcpEl ?? "").slice(0, 90)}`);
    for (const x of s.ready) console.log(`    ready ${x.spec}: ${x.t} ms (median)`);
  }
  const file = join(out, `${label}.json`);
  writeFileSync(file, JSON.stringify({ base, at: new Date().toISOString(), argv: process.argv.slice(2), summary, rows }, null, 2));
  console.log(`\nwrote ${file}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
