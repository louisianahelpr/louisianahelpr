/**
 * MEASURE HOW EVERY PAGE ARRIVES — layout shift, content waves, time to settle.
 *
 * Owner, 2026-09-23 (Q169): "the public browse page loads, jumps, more cards
 * appear, it loads again, and more jobs load; they don't all load together."
 * Wanted: one settled paint — a correctly sized placeholder, then ALL the
 * content at once, nothing shifting.
 *
 * Three numbers per route, from a cold load of THIS build against prod data:
 *
 *   cls      cumulative layout shift over the whole load (PerformanceObserver
 *            'layout-shift', installed before the app boots, buffered).
 *   waves    how many separate steps the page's repeated content (cards, rows,
 *            list items) arrived in. An item is a visible child of a parent
 *            that has at least one same-class sibling, at least 40px tall, with
 *            real text and no placeholder inside it — so a skeleton bone never
 *            counts and a real card always does. The count is sampled every
 *            50ms; a wave is a CHANGE in that count, and changes less than
 *            WAVE_MERGE_MS apart are one wave (a single React commit can land
 *            over two samples). 1 = everything arrived together.
 *   settled  ms from navigation start to the last layout shift, item-count
 *            change or visible placeholder.
 *
 * Found by what it IS, never by a list of files: routes come from src/App.tsx
 * (deriveRouteSet), placeholders by the same selector the loading-state audit
 * uses (PLACEHOLDER_SEL). No mock mode: every response is prod's.
 *
 *   BASE=http://127.0.0.1:4173 node scripts/audit/measure-page-settle.mjs
 *   ROUTES=/browse,/home   narrow       WIDTHS=375,1440
 *   THROTTLE=fast3g             Fast 3G network + 4x CPU (CDP)
 *   OUT=~/.lh-shots/cls/run.json
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRouteSet } from "./press-every-control.mjs";
import { mintAccounts, prodSelect } from "./pressProdSafety.mjs";
import { PLACEHOLDER_SEL } from "./measure-loading-states.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:4173";
const WIDTHS = (process.env.WIDTHS ?? "375,1440").split(",").map(Number);
const THROTTLE = process.env.THROTTLE ?? "";
export const WAVE_MERGE_MS = 200;
const QUIET_MS = Number(process.env.QUIET_MS ?? (THROTTLE ? 4000 : 2500));
const MAX_MS = Number(process.env.MAX_MS ?? (THROTTLE ? 40000 : 15000));

/** Installed before the app boots: CLS entries + a 50ms item-count timeline. */
export const SETTLE_INIT = (placeholderSel) => {
  const w = window;
  w.__settle = { shifts: [], counts: [], ph: [], moves: [] };
  // Where each item was last seen. A transform glide (a virtualizer's first
  // estimate being corrected) is not a layout shift to the CLS API, but the
  // eye sees a card move all the same.
  const lastTop = new WeakMap();
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        const srcs = (e.sources || []).map((s) => {
          // A text node names its parent element, so a font-swap shift says
          // WHICH text moved (a bare "#text" could not; 2026-09-24).
          const n = s.node && s.node.nodeType !== 1 ? s.node.parentElement : s.node;
          if (!n || n.nodeType !== 1) return "#text";
          const cls = (n.getAttribute("class") || "").split(/\s+/).slice(0, 3).join(".");
          return `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${cls ? "." + cls : ""} ${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)} h${Math.round(s.previousRect.height)}→${Math.round(s.currentRect.height)}`;
        });
        w.__settle.shifts.push({ t: Math.round(e.startTime), v: e.value, srcs });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch { w.__settle.noCls = true; }

  const countItems = () => {
    const root = document.getElementById("root");
    if (!root) return { n: 0, ph: false };
    let ph = false;
    for (const el of root.querySelectorAll(placeholderSel)) {
      // A pointer-events-none pulse is a decorative halo (the Post FAB's ring),
      // not something standing in for content.
      if (/\bpointer-events-none\b/.test(el.getAttribute("class") || "")) continue;
      const r = el.getBoundingClientRect();
      // 8px floor: a 6px "live" dot (animate-pulse) is a status light, not a placeholder.
      if (r.width > 8 && r.height > 8) { ph = true; break; }
    }
    let n = 0;
    for (const parent of root.querySelectorAll("*")) {
      if (parent.childElementCount < 2) continue;
      const byKey = new Map();
      for (const c of parent.children) {
        const k = c.tagName + "|" + (c.getAttribute("class") || "");
        byKey.set(k, (byKey.get(k) || 0) + 1);
      }
      for (const c of parent.children) {
        const k = c.tagName + "|" + (c.getAttribute("class") || "");
        if (byKey.get(k) < 2) continue;
        if (c.matches(placeholderSel) || c.querySelector(placeholderSel)) continue;
        if (c.getAttribute("aria-hidden") === "true" || c.closest('[aria-busy="true"]')) continue;
        // Page CONTENT only: the persistent chrome (the desktop rail, the tab
        // dock, the site nav and footer) mounting before the page is not the
        // page's list arriving in a second wave.
        if (c.closest('nav, aside, header, footer, [role="navigation"]')) continue;
        const r = c.getBoundingClientRect();
        if (r.height < 40 || r.width < 120) continue;
        if ((c.textContent || "").trim().length < 8) continue;
        // Mid-fade counts as not-yet-arrived: a staggered entry animation IS
        // cards appearing one after another, whatever the DOM says.
        let op = 1;
        for (let a = c; a && a !== document.body; a = a.parentElement) op *= Number(getComputedStyle(a).opacity);
        if (op < 0.9) continue;
        n++;
        const prev = lastTop.get(c);
        if (prev !== undefined && Math.abs(prev - r.top) > 2 && !w.__settleScrolled) {
          w.__settle.moves.push({ t: Math.round(performance.now()), dy: Math.round(r.top - prev) });
        }
        lastTop.set(c, r.top);
      }
    }
    return { n, ph };
  };
  const tick = () => {
    const { n, ph } = countItems();
    const t = Math.round(performance.now());
    const c = w.__settle.counts;
    if (!c.length || c[c.length - 1].n !== n) c.push({ t, n });
    if (ph) w.__settle.ph.push(t);
  };
  addEventListener("scroll", () => { w.__settleScrolled = true; }, { capture: true, passive: true });
  const start = () => { tick(); setInterval(tick, 50); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
};

/** Collapse a count timeline into waves (changes < WAVE_MERGE_MS apart are one). */
export function wavesOf(counts, mergeMs = WAVE_MERGE_MS) {
  const waves = [];
  let prev = 0;
  for (const { t, n } of counts) {
    if (n === prev) continue;
    const last = waves[waves.length - 1];
    if (last && t - last.end < mergeMs) { last.end = t; last.to = n; }
    else waves.push({ start: t, end: t, from: prev, to: n });
    prev = n;
  }
  // A wave that returns the count to where it was (a flicker) is still a wave.
  return waves;
}

async function measureOne(browser, { url, persona, session, width }) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 800 ? 812 : 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(SETTLE_INIT, PLACEHOLDER_SEL);
  if (session) {
    await ctx.addInitScript(([k, v, returning]) => {
      try {
        localStorage.setItem(k, v);
        // RETURNING=1: a device that has seen this account before (the
        // account's Senior Mode flag is cached, as it is after any visit).
        if (returning) localStorage.setItem("helpr_profile_senior_mode", "1");
        localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
      } catch { /* reported as signed-out, never a fake pass */ }
    }, [session.key, session.value, process.env.RETURNING === "1"]);
  }
  const page = await ctx.newPage();
  if (THROTTLE) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  const res = { url, persona, width, throttle: THROTTLE || "none" };
  Object.assign(res, await settlePage(page, BASE + url, { quietMs: QUIET_MS, maxMs: MAX_MS }));
  await ctx.close();
  return res;
}

/**
 * Load `fullUrl` in a page whose context already carries SETTLE_INIT, wait
 * until nothing has shifted, arrived or shimmered for `quietMs` (at most
 * `maxMs`), and return the numbers. Shared by this script and
 * e2e/prod-audit/page-settle.spec.ts, so the CI budget and the audit table
 * are one measurement.
 */
export async function settlePage(page, fullUrl, { quietMs = 2500, maxMs = 15000 } = {}) {
  const res = {};
  const QUIET_MS = quietMs, MAX_MS = maxMs;
  try {
    await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: MAX_MS });
    const t0 = Date.now();
    let lastSig = "", lastChange = Date.now();
    while (Date.now() - t0 < MAX_MS) {
      await page.waitForTimeout(250);
      const sig = await page.evaluate(() => {
        const s = window.__settle;
        const phNow = s.ph.length && performance.now() - s.ph[s.ph.length - 1] < 120;
        return `${s.shifts.length}|${s.counts.length}|${phNow}`;
      });
      if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
      else if (Date.now() - lastChange >= QUIET_MS && !sig.endsWith("true")) break;
    }
    const s = await page.evaluate(() => window.__settle);
    res.landedOn = new URL(page.url()).pathname + new URL(page.url()).search;
    res.cls = s.noCls ? null : Number(s.shifts.reduce((a, e) => a + e.v, 0).toFixed(4));
    const waves = wavesOf(s.counts);
    res.waves = waves.length;
    res.waveDetail = waves;
    res.items = s.counts.length ? s.counts[s.counts.length - 1].n : 0;
    res.settledMs = Math.max(
      s.shifts.length ? s.shifts[s.shifts.length - 1].t : 0,
      s.counts.length ? s.counts[s.counts.length - 1].t : 0,
      s.ph.length ? s.ph[s.ph.length - 1] : 0,
      s.moves.length ? s.moves[s.moves.length - 1].t : 0,
    );
    res.movedItems = s.moves.length;
    res.maxMovePx = s.moves.reduce((a, m) => Math.max(a, Math.abs(m.dy)), 0);
    res.moves = s.moves.slice(0, 8);
    res.shifts = s.shifts.filter((e) => e.v > 0.001).slice(0, 12);
  } catch (e) {
    res.error = String(e).slice(0, 200);
  }
  return res;
}

async function main() {
  const personas = (process.env.PERSONAS ?? "anon,customer").split(",");
  const { sessions, unavailable } = await mintAccounts(personas.filter((p) => p !== "anon"));
  for (const [p, why] of Object.entries(unavailable)) console.warn(`persona ${p} unavailable: ${why}`);
  const poster = sessions.customer;
  let seedJobId = "test";
  if (poster) {
    const rows = await prodSelect(poster, "jobs?select=id&order=created_at.desc&limit=1").catch(() => []);
    if (rows?.[0]?.id) seedJobId = rows[0].id;
  }
  const only = process.env.ROUTES ? process.env.ROUTES.split(",") : null;
  const routeSet = deriveRouteSet({ seedJobId, helperId: sessions.helper?.userId ?? poster?.userId ?? "test", customerId: poster?.userId ?? "test", adminViews: [] })
    .filter((r) => !r.redirect);
  const targets = [];
  for (const r of routeSet) {
    if (only && !only.includes(r.url)) continue;
    // Public routes as a guest; protected routes as the poster account.
    const persona = r.personas.includes("customer") && r.personas.includes("helper") ? "customer" : r.personas.includes("admin") ? null : "anon";
    if (!persona || (persona !== "anon" && !sessions[persona]) || !personas.includes(persona)) continue;
    for (const width of WIDTHS) targets.push({ url: r.url, persona, session: sessions[persona], width });
  }
  const browser = await chromium.launch();
  const results = [];
  for (const t of targets) {
    const r = await measureOne(browser, t);
    results.push(r);
    console.log(`${r.persona.padEnd(8)} ${String(r.width).padEnd(5)} ${r.url.padEnd(40)} cls=${String(r.cls).padEnd(7)} waves=${String(r.waves).padEnd(3)} items=${String(r.items).padEnd(4)} moved=${r.movedItems}/${r.maxMovePx}px settled=${r.settledMs}ms ${r.landedOn !== r.url ? "→" + r.landedOn : ""} ${r.error ?? ""}`);
  }
  await browser.close();
  const out = process.env.OUT ?? resolve(process.env.HOME, ".lh-shots/cls", `settle-${THROTTLE || "none"}-${Date.now()}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ base: BASE, throttle: THROTTLE || "none", at: new Date().toISOString(), results }, null, 2));
  console.log(`\n${results.length} measurements → ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
