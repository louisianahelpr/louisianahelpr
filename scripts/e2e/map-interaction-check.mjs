// Interactive verification for the browse-map preview: keyboard reachability
// of pins/clusters, focus handling into and out of the sheet, Escape, and
// whether anything interactive is trapped under the bottom dock.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8082";
const SESSION = process.env.LH_SESSION_FILE
  ? JSON.parse(readFileSync(process.env.LH_SESSION_FILE, "utf8"))
  : null;
const ROUTE = process.env.LH_ROUTE || "/dashboard";
const W = Number(process.env.W || 375);
const H = Number(process.env.H || 812);

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await ctx.addInitScript((sess) => {
  localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
  sessionStorage.setItem("helpr.browseView", "map");
  if (sess) localStorage.setItem(sess.key, sess.value);
}, SESSION);
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await page.goto(`${BASE}${ROUTE}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="browse-map-surface"]', { timeout: 30000 });
await page.waitForTimeout(6000);

const out = {};

// ── 0. Auto-frame must not park a pin under the dock ──────────────────────
out.autoFrameDockBand = await page.evaluate(() => {
  const dock = document.querySelector(".mobile-nav-frame") || document.querySelector("nav");
  const dr = dock?.getBoundingClientRect();
  if (!dr?.height) return "no dock";
  const inBand = [...document.querySelectorAll('.browse-map-pin[tabindex="0"], .browse-map-cluster')].filter((p) => {
    const r = p.getBoundingClientRect();
    return r.height && r.bottom > dr.top && r.top < dr.bottom;
  });
  return { dockTop: dr.top, count: inBand.length, names: inBand.map((p) => p.getAttribute("aria-label")?.slice(0, 30)) };
});

// ── 1. Keyboard: focus a pin and press Enter ──────────────────────────────
out.keyboard = await page.evaluate(() => {
  const pin = [...document.querySelectorAll(".browse-map-pin")].find(
    (el) => el.getAttribute("tabindex") === "0",
  );
  pin.focus();
  return {
    focusedIsPin: document.activeElement === pin,
    focusName: document.activeElement?.getAttribute("aria-label"),
    outline: getComputedStyle(pin, ":focus-visible").outlineWidth,
  };
});
await page.screenshot({ path: `/tmp/lh-map-shots/focus-ring-${W}.png` });
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
await page.screenshot({ path: `/tmp/lh-map-shots/kbd-open-${W}.png` });
out.afterEnter = await page.evaluate(() => ({
  sheetOpen: !!document.querySelector('[data-testid="browse-map-preview"]'),
  activeTestId: document.activeElement?.getAttribute("data-testid"),
  activeLabel: document.activeElement?.getAttribute("aria-label"),
}));

// ── 2. Tab order inside the sheet ─────────────────────────────────────────
await page.keyboard.press("Tab");
out.afterTab = await page.evaluate(() => ({
  tag: document.activeElement?.tagName,
  label: document.activeElement?.getAttribute("aria-label"),
  insideSheet: !!document.activeElement?.closest('[data-testid="browse-map-preview"]'),
}));

// ── 3. Escape closes and returns focus to the pin ─────────────────────────
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
out.afterEscape = await page.evaluate(() => ({
  sheetOpen: !!document.querySelector('[data-testid="browse-map-preview"]'),
  activeIsPin: !!document.activeElement?.closest(".browse-map-pin"),
  activeLabel: document.activeElement?.getAttribute("aria-label"),
}));

// ── 4. Cluster keyboard activation zooms ──────────────────────────────────
out.cluster = await page.evaluate(() => {
  const c = document.querySelector('.browse-map-cluster[tabindex="0"]');
  if (!c) return null;
  c.focus();
  return { focused: document.activeElement === c, name: c.getAttribute("aria-label"), role: c.getAttribute("role") };
});
if (out.cluster) {
  const before = await page.evaluate(() => document.querySelectorAll(".browse-map-cluster").length + ":" + document.querySelectorAll(".browse-map-pin").length);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => document.querySelectorAll(".browse-map-cluster").length + ":" + document.querySelectorAll(".browse-map-pin").length);
  out.clusterZoomed = { before, after, changed: before !== after };
}

// ── 5. Close button closes (pointer) ──────────────────────────────────────
await page.evaluate(() => {
  const p = [...document.querySelectorAll(".browse-map-pin")].find((el) => {
    const r = el.getBoundingClientRect();
    return el.getAttribute("tabindex") === "0" && r.width && r.y > 0 && r.bottom < innerHeight;
  });
  p?.click();
});
await page.waitForTimeout(1000);
out.beforeCloseClick = await page.locator('[data-testid="browse-map-preview"]').count();
await page.locator('[data-testid="browse-map-preview-close"]').click();
await page.waitForTimeout(600);
out.afterCloseClick = await page.locator('[data-testid="browse-map-preview"]').count();

// ── 6. Anything trapped under the bottom dock? ────────────────────────────
// Force the worst case: drag the map so pins land in the dock band, then
// hit-test that band.
await page.mouse.move(W / 2, H * 0.35);
await page.mouse.down();
await page.mouse.move(W / 2, H * 0.75, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(2000);
out.dockBand = await page.evaluate(() => {
  const dock = document.querySelector(".mobile-nav-frame") || document.querySelector("nav");
  if (!dock) return { dock: null };
  const dr = dock.getBoundingClientRect();
  if (!dr.height) return { dock: "zero-height" };
  const inBand = [...document.querySelectorAll('.browse-map-pin[tabindex="0"], .browse-map-cluster')].filter((p) => {
    const r = p.getBoundingClientRect();
    return r.height && r.bottom > dr.top && r.top < dr.bottom;
  });
  const results = inBand.map((p) => {
    const r = p.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      name: p.getAttribute("aria-label")?.slice(0, 40),
      reachable: top?.closest(".browse-map-pin, .browse-map-cluster") === p,
      blockedBy: top?.className?.toString?.().slice(0, 50),
    };
  });
  return { dockRect: { top: dr.top, bottom: dr.bottom, h: dr.height }, count: inBand.length, results: results.slice(0, 8) };
});

out.pageErrors = errs;
console.log(JSON.stringify(out, null, 2));
await page.screenshot({ path: `/tmp/lh-map-shots/interaction-${W}.png` });
await browser.close();
