#!/usr/bin/env node
/**
 * inp-lab — Interaction to Next Paint for the screens people TYPE and TAP on,
 * measured in the lab the way Vercel Speed Insights measures real users.
 *
 * Owner, 2026-10-05 (Speed Insights, production, 7 days): INP POOR on
 * /post-job (1080 ms, desktop) and /complete-profile (560 ms), NEEDS
 * IMPROVEMENT on /login (312 ms) and /signup (320 ms). GOOD is <= 200 ms at
 * P75. cwv-lab.mjs measures loads (FCP/LCP/CLS); nothing measured a tap or a
 * keystroke, so a page could block the main thread for a second on every key
 * and every check stayed green.
 *
 * INP is the slowest interaction of the visit (web-vitals: the 98th
 * percentile, which under 50 interactions is the worst). Each interaction is
 * an Event Timing `interactionId`; its latency is the longest `duration` of
 * its events (input delay + processing + presentation delay). This installs
 * the observer before the app boots, drives each screen's SCENARIO (the
 * interactions a person makes there, typed key by key), and reports the worst
 * interaction with its target and its three phases, plus every long animation
 * frame (Chromium LoAF) with the scripts that ran in it, so a slow tap names
 * the code that made it slow.
 *
 * Profiles are cwv-lab's (mobile: 375, 4x CPU calibrated to the reference
 * machine; desktop: 1440, no CPU slowdown). Network throttling is irrelevant
 * to INP and is not applied (the scenario starts after the page settles).
 * WebKit cannot be CPU-throttled (no CDP) and has no LoAF: its rows are
 * unthrottled and have no script attribution.
 *
 *   node scripts/perf/inp-lab.mjs                      # dist/, every scenario, chromium mobile+desktop
 *   --routes /login,/post-job  --profiles mobile  --browsers chromium,webkit
 *   --runs 3  --dist <dir>  --label before  --out ~/.lh-shots/perf  --dump (list the controls, no scenario)
 *
 * Lab tool only so far: the CI budget built on these exports is still owed
 * (docs/OPEN.md, the INP item). It runs as a PERSON by default (asPerson):
 * webdriver reads false so Sentry Replay starts as it does for visitors, and
 * every telemetry request is answered locally. `--automated` turns that off;
 * `--verbose` lists every frame over 100 ms; `--steps N` truncates a scenario.
 */
import { chromium, webkit } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PROFILES, cpuBenchmarkMs, calibratedCpuRate, startDistServer, sessionInit, settle, CWV_INIT } from "./cwv-lab.mjs";

/** Speed Insights' GOOD band for INP (ms, P75). */
export const INP_GOOD = 200;

/** Installed before the app boots: every Event Timing entry with an interactionId, and every LoAF. */
export const INP_INIT = () => {
  const w = window;
  const inp = (w.__inp = { events: [], loafs: [], supported: [] });
  try { inp.supported = PerformanceObserver.supportedEntryTypes.slice(); } catch { /* old engine */ }
  const describe = (n) => {
    if (!n || n.nodeType !== 1) return null;
    const label = n.getAttribute("aria-label") || n.getAttribute("name") || n.getAttribute("placeholder") || (n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${label ? ` "${label}"` : ""}`;
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.interactionId) continue;
        inp.events.push({
          id: e.interactionId, name: e.name, start: e.startTime, duration: e.duration,
          delay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart,
          presentation: e.startTime + e.duration - e.processingEnd, target: describe(e.target),
        });
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  } catch { /* no Event Timing */ }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        inp.loafs.push({
          start: e.startTime, duration: e.duration, blocking: e.blockingDuration,
          scripts: (e.scripts || []).map((s) => ({
            d: Math.round(s.duration), inv: s.invoker, fn: s.sourceFunctionName, src: (s.sourceURL || "").replace(location.origin, ""), pos: s.sourceCharPosition,
            forced: Math.round(s.forcedStyleAndLayoutDuration || 0),
          })),
        });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch { /* no LoAF (WebKit) */ }
};

/** The worst interaction (= INP under 50 interactions) and the full list, from what INP_INIT recorded. */
export async function readInp(page) {
  const raw = await page.evaluate(() => window.__inp);
  const byId = new Map();
  for (const e of raw.events) {
    const cur = byId.get(e.id);
    if (!cur || e.duration > cur.duration) byId.set(e.id, e);
  }
  const interactions = [...byId.values()].sort((a, b) => b.duration - a.duration);
  const worst = interactions[0] ?? null;
  const near = (e) => raw.loafs.filter((l) => l.start < e.start + e.duration && l.start + l.duration > e.start - 50 - e.delay);
  const fmtLoaf = (l) => ({ d: Math.round(l.duration), scripts: l.scripts.filter((x) => x.d >= 5).sort((a, b) => b.d - a.d).slice(0, 6) });
  return {
    supported: raw.supported.includes("event"),
    count: byId.size,
    inp: worst ? Math.round(worst.duration) : 0,
    worst: worst && { ...worst, delay: Math.round(worst.delay), processing: Math.round(worst.processing), presentation: Math.round(worst.presentation) },
    top: interactions.slice(0, 5).map((e) => `@${Math.round(e.start)} ${Math.round(e.duration)}ms ${e.name} ${e.target ?? ""} (d${Math.round(e.delay)} p${Math.round(e.processing)} r${Math.round(e.presentation)})`),
    loafsNear: interactions.slice(0, 3).flatMap((e) => near(e).map(fmtLoaf)),
    longFrames: raw.loafs.filter((l) => l.duration >= 100).map((l) => ({ at: Math.round(l.start), ...fmtLoaf(l) })),
  };
}

// ---------------------------------------------------------------------------
// The scenarios: what a person does on each screen. Each step is a plain
// object so the CI spec and the CLI drive the same thing. Never a submit: the
// lab never signs anyone in, creates an account, posts a job or pays.
// ---------------------------------------------------------------------------
/**
 * @typedef {{ tap: string } | { type: string, text: string } | { press: string } | { wait: number }} Step
 * `tap`/`type` take a Playwright selector; a step whose control is missing is
 * recorded as skipped (the spec fails on a skipped step: a scenario that
 * stopped finding its controls measures nothing).
 */
export const SCENARIOS = {
  "/login": {
    session: null,
    from: "/",
    arrive: "a[href='/login']",
    steps: [
      { type: "#email", text: "someone.typing@example.com" },
      { type: "#password", text: "not-a-real-pass" },
      { tap: "button[aria-label='Show password']" },
    ],
  },
  "/signup": {
    session: null,
    from: "/",
    arrive: "a[href='/signup']",
    steps: [
      { type: "#email", text: "someone.typing@example.com" },
      { type: "#password", text: "Not-a-real-pass-1" },
      { tap: "button[aria-label='Show password']" },
      { tap: "#policies" },
      { tap: "#age-confirm" },
      { tap: "#marketing-consent" },
    ],
  },
  "/post-job": {
    session: "poster",
    from: "/home",
    arrive: "button[aria-label='Post a new job']:visible, button:has-text('Post a Job'):visible",
    steps: [
      { tap: "button:has-text('Start Fresh')" },
      { tap: "button[aria-label='Cleaning']" },
      { type: "#title", text: "Rake the front yard" },
      { type: "#description", text: "Leaves on the lawn and the driveway, bags are in the shed." },
      // Three phone photos, and the taps that land while they are prepared.
      { upload: "input[type=file][aria-label='Add a photo (optional)']", photos: 3 },
      { tap: "button[role=radio]:has-text('Repeats')", now: true },
      { tap: "button[role=radio]:has-text('One-Time')", now: true },
      { wait: 1500 },
      { type: "#streetAddress", text: "222 Saint Louis St" },
      { tap: "[role=option] >> nth=0" },
      { type: "#zipCode", text: "70802", clear: true },
      { tap: "#date" },
      { tap: "button[aria-label='Go to the Next Month']" },
      { tap: "button[aria-label*=' 15th, ']" },
      { type: "input[aria-label='Start time']", text: "1030A" },
      { type: "#budget", text: "60" },
      { tap: "button:has-text('$50')" },
      { tap: "button:has-text('$75')" },
      { tap: "#flexible" },
      { tap: "#flexible" },
      // Review: the form's own submit renders the checkout step in place (no
      // write: the job is inserted only from the checkout step's Pay button,
      // which the lab never presses).
      { tap: "form button[type=submit]" },
      { wait: 2500 },
    ],
  },
  "/complete-profile": {
    session: "incomplete-e2e",
    steps: [
      { type: "#firstName", text: "Seed" },
      { type: "#lastName", text: "Fixture" },
      { type: "#phone", text: "2255550100" },
      { type: "#zipCode", text: "70801" },
      { type: "#bio", text: " Typing a longer intro here." },
      { tap: "#dob" },
      { press: "Escape" },
      { tap: "#accept-policies" },
      // The required profile photo: choose, frame, use.
      { upload: "#avatar" },
      { wait: 1500 },
      { type: "[role=dialog] input[aria-label='Zoom']", keys: ["ArrowRight", "ArrowRight", "ArrowRight"] },
      { tap: "[role=dialog] button:has-text('Use Photo')" , now: true },
      { tap: "#bio", now: true },
      { tap: "#firstName", now: true },
      { wait: 2000 },
    ],
  },
};

/** Run one scenario on a page that has settled. Returns the steps it could not find. */
export async function runScenario(page, steps) {
  const skipped = [];
  for (const [i, s] of steps.entries()) {
    if ("wait" in s) { await page.waitForTimeout(s.wait); continue; }
    if ("press" in s) { await page.keyboard.press(s.press); await page.waitForTimeout(250); continue; }
    if ("upload" in s) {
      // Phone photos made in the page; the steps marked `now` that follow land
      // while the app is still preparing them, as a person keeps filling the
      // form after choosing photos.
      const photo = await phonePhoto(page);
      await page.locator(s.upload).first().setInputFiles(
        Array.from({ length: s.photos ?? 1 }, (_, k) => ({ name: `IMG_${4000 + k}.jpg`, mimeType: "image/jpeg", buffer: photo })),
      );
      await page.waitForTimeout(50);
      continue;
    }
    const sel = s.tap ?? s.type;
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible().catch(() => false))) { skipped.push(`#${i} ${sel}`); continue; }
    try {
      if ("tap" in s) await loc.click({ timeout: 10_000 });
      else {
        // A field the app pre-filled (the profile's city, a picked address) is
        // cleared first, with the keyboard, as a person would.
        await loc.click({ timeout: 10_000 });
        if (s.clear) { await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.press("Backspace"); }
        if (s.keys) for (const k of s.keys) { await page.keyboard.press(k); await page.waitForTimeout(60); }
        else await page.keyboard.type(s.text, { delay: 60 });
      }
    } catch (err) {
      skipped.push(`#${i} ${sel} (${String(err?.message ?? err).split("\n")[0]})`);
      continue;
    }
    // Let the interaction's frame present before the next one starts (a
    // `now` step is the next tap of a person who does not wait).
    await page.waitForTimeout(s.now ? 80 : 250);
  }
  await page.waitForTimeout(500);
  return skipped;
}

/**
 * The tap that brings a person to the screen (the landing's Log In, the dock's
 * Post a Job). Speed Insights bills a visit's INP to the route on screen when
 * the tab is hidden, so the tap that RENDERS a screen counts against it.
 */
export async function arrive(page, selector, route) {
  await page.locator(selector).first().click({ timeout: 10_000 });
  await page.waitForURL((u) => new URL(u).pathname === route, { timeout: 30_000 });
  await settle(page, { quietMs: 1500, maxMs: 20_000 });
}

/**
 * Run the page the way it runs for a PERSON, not a robot. The app switches
 * work off in an automated browser (src/lib/automatedBrowser.ts: Sentry
 * Session Replay never starts when navigator.webdriver is true), so a lab that
 * leaves webdriver on measures an app no visitor gets. This reports webdriver
 * false and answers every telemetry request locally (Sentry, PostHog, Vercel
 * Analytics and Speed Insights), so the lab never sends a replay, an event or
 * a page view to prod's dashboards.
 */
export const TELEMETRY = [/\.sentry\.io\//, /\.posthog\.com\//, /\/_vercel\/(insights|speed-insights)\/(view|event|vitals)/];
export async function asPerson(ctx) {
  await ctx.addInitScript(() => {
    try { Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true }); } catch { /* engine refused */ }
  });
  await ctx.route((url) => TELEMETRY.some((re) => re.test(url.href)), (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
}

let photoCache = null;
/** A 4032x3024 JPEG with a phone photo's detail (gradient plus grain), made once per process. */
async function phonePhoto(page) {
  if (photoCache) return photoCache;
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 4032;
    c.height = 3024;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 4032, 3024);
    grad.addColorStop(0, "#6b8e4e");
    grad.addColorStop(0.5, "#c9b27c");
    grad.addColorStop(1, "#3d5a80");
    g.fillStyle = grad;
    g.fillRect(0, 0, 4032, 3024);
    for (let i = 0; i < 60000; i++) {
      g.fillStyle = "rgba(" + ((i * 37) % 255) + "," + ((i * 91) % 255) + "," + ((i * 53) % 255) + ",0.35)";
      g.fillRect((i * 7919) % 4032, (i * 104729) % 3024, 3 + (i % 9), 3 + (i % 7));
    }
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let out = "";
    for (let i = 0; i < buf.length; i += 0x8000) out += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(out);
  });
  photoCache = Buffer.from(b64, "base64");
  return photoCache;
}

/** Every visible control on the page (for writing a scenario). */
export async function dumpControls(page) {
  return page.$$eval("input, textarea, select, button, [role=button], [role=radio], [role=checkbox], [role=tab], [role=switch], [role=combobox], a[href]", (els) =>
    els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => {
      const attrs = ["type", "name", "id", "aria-label", "placeholder", "role", "data-testid", "href"].map((a) => e.getAttribute(a) ? `${a}=${e.getAttribute(a)}` : null).filter(Boolean).join(" ");
      return `${e.tagName.toLowerCase()} ${attrs} "${(e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)}"`;
    }));
}

/** A session blob for `role` from scripts/test-signin-link.mjs (local .env, service role). */
export function mintSession(role) {
  const out = execFileSync("node", ["scripts/test-signin-link.mjs", role, "--session", "--json"], { encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf("{")));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  const flag = (name) => args.includes(`--${name}`);
  const dist = resolve(opt("dist", "dist"));
  const routes = opt("routes", Object.keys(SCENARIOS).join(",")).split(",");
  const profiles = opt("profiles", "mobile,desktop").split(",");
  const browsers = opt("browsers", "chromium").split(",");
  const runs = Number(opt("runs", "3"));
  const label = opt("label", "run");
  const outDir = opt("out", join(homedir(), ".lh-shots", "perf"));
  const port = Number(opt("port", "4395"));
  const server = await startDistServer(dist, port);
  const base = `https://127.0.0.1:${port}`;
  const sessions = new Map();
  const results = [];
  try {
    for (const bName of browsers) {
      const browser = await (bName === "webkit" ? webkit : chromium).launch();
      const rate = bName === "chromium" ? calibratedCpuRate(PROFILES.mobile.cpu, await cpuBenchmarkMs(browser)) : 1;
      for (const pName of profiles) {
        const profile = PROFILES[pName];
        for (const route of routes) {
          const sc = SCENARIOS[route];
          if (sc.session && !sessions.has(sc.session)) sessions.set(sc.session, mintSession(sc.session));
          const sess = sc.session ? sessions.get(sc.session) : null;
          const rows = [];
          for (let i = 0; i < (flag("dump") ? 1 : runs); i++) {
            const ctx = await browser.newContext({
              viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobile: bName === "chromium" && profile.isMobile,
              hasTouch: profile.hasTouch, colorScheme: "light", serviceWorkers: "block", ignoreHTTPSErrors: true,
            });
            await ctx.addInitScript(CWV_INIT);
            await ctx.addInitScript(INP_INIT);
            if (!flag("automated")) await asPerson(ctx);
            if (sess) await ctx.addInitScript(...sessionInit({ key: sess.key, value: sess.value }));
            const page = await ctx.newPage();
            await page.goto(base + (sc.from ?? route), { waitUntil: "domcontentloaded", timeout: 60_000 });
            await settle(page, { quietMs: 2500, maxMs: 30_000 });
            if (bName === "chromium" && profile.cpu > 1) {
              const cdp = await ctx.newCDPSession(page);
              await cdp.send("Emulation.setCPUThrottlingRate", { rate });
            }
            if (sc.arrive) await arrive(page, sc.arrive, route);
            const landed = new URL(page.url()).pathname;
            if (flag("dump")) {
              await runScenario(page, sc.steps.slice(0, Number(opt("steps", "999"))));
              console.log(`\n== ${route} (landed ${landed}) ${pName}`);
              for (const c of await dumpControls(page)) console.log("  " + c);
              await ctx.close();
              continue;
            }
            const skipped = await runScenario(page, sc.steps);
            const r = await readInp(page);
            rows.push({ ...r, landed, skipped });
            console.log(`[inp] ${label} ${bName} ${pName} ${route} run${i + 1}: INP ${r.inp} ms (${r.count} interactions) landed ${landed}${skipped.length ? ` SKIPPED ${skipped.join(", ")}` : ""}`);
            for (const t of r.top) console.log(`        ${t}`);
            const fmtS = (l) => l.scripts.map((s) => `${s.d}ms ${s.inv} ${s.fn || ""}@${s.src}:${s.pos}${s.forced ? ` forced-layout ${s.forced}` : ""}`).join(" | ");
            for (const l of r.loafsNear) console.log(`        LoAF ${l.d}ms ${fmtS(l)}`);
            if (flag("verbose")) for (const l of r.longFrames) console.log(`        long frame @${l.at} ${l.d}ms ${fmtS(l)}`);
            await ctx.close();
          }
          if (rows.length) {
            const sorted = rows.map((r) => r.inp).sort((a, b) => a - b);
            results.push({ browser: bName, profile: pName, route, median: sorted[Math.floor(sorted.length / 2)], runs: sorted, worst: rows.map((r) => r.top[0]) });
          }
        }
      }
      await browser.close();
    }
  } finally {
    server.close();
  }
  if (results.length) {
    console.log("\nmedian INP (ms):");
    for (const r of results) console.log(`  ${r.browser.padEnd(8)} ${r.profile.padEnd(7)} ${r.route.padEnd(18)} ${String(r.median).padStart(5)}  [${r.runs.join(", ")}]`);
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `inp-${label}.json`);
    writeFileSync(file, JSON.stringify(results, null, 2));
    console.log(`\nwrote ${file}`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
