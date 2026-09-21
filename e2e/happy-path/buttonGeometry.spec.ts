/**
 * Fixture tests for detectButtonGeometry().siblingMismatch.
 *
 * The detector is judged against DOM it is handed, not against the app, so
 * every exclusion added for a false positive has its measured case here next
 * to the one true positive the whole thing exists for: "Enter App" at 49.5px
 * stacked on a 60px "Sign Out" (/complete-profile, owner, 2026-09-12). Tighten
 * the detector all you like — this file says whether it still sees that.
 *
 * Runs under the happy-path project for its viewport, but uses setContent, so
 * it needs no preview server.
 */
import { test, expect } from "@playwright/test";
import { detectButtonGeometry } from "./buttonGeometry";

const BASE = `<style>
  button, a { display:inline-flex; align-items:center; justify-content:center;
    box-sizing:border-box; font:15px sans-serif; border:0; padding:0 16px;
    background:#2d6a4f; color:#fff; border-radius:10px; text-decoration:none; }
  .stack { display:flex; flex-direction:column; gap:8px; width:300px; }
  .row { display:flex; gap:8px; }
</style>`;

async function run(page: import("@playwright/test").Page, body: string) {
  await page.setContent(BASE + body);
  return page.evaluate(detectButtonGeometry, undefined);
}

test.describe("detectButtonGeometry — sibling mismatch", () => {
  test("catches the /complete-profile repro: 49.5px primary stacked on 60px secondary", async ({ page }) => {
    const r = await run(page, `<div class="stack">
      <button style="height:49.5px">Enter App</button>
      <button style="height:60px">Sign Out</button>
    </div>`);
    expect(r.siblingMismatch).toEqual(['"Enter App" 49.5px vs "Sign Out" 60.0px (stacked)']);
  });

  test("catches a same-row pair of unequal height", async ({ page }) => {
    const r = await run(page, `<div class="row">
      <button style="height:44px;width:140px">Cancel</button>
      <button style="height:56px;width:140px">Confirm</button>
    </div>`);
    expect(r.siblingMismatch).toHaveLength(1);
  });

  test("equal siblings are clean", async ({ page }) => {
    const r = await run(page, `<div class="stack">
      <button style="height:56px">Enter App</button>
      <button style="height:56px">Sign Out</button>
    </div>`);
    expect(r.siblingMismatch).toEqual([]);
  });

  test("a filled primary over bare text buttons is not a mismatch (/payment-success)", async ({ page }) => {
    const r = await run(page, `<div class="stack">
      <button style="height:60px">Open My Posts</button>
      <button style="height:56px;background:transparent;color:#333">Contact Support</button>
    </div>`);
    expect(r.siblingMismatch).toEqual([]);
  });

  test("stacked rows whose text wraps to more lines are content, not a defect (/help)", async ({ page }) => {
    const r = await run(page, `<div class="stack">
      <button style="padding:12px 16px">Getting started</button>
      <button style="padding:12px 16px;width:120px;white-space:normal">Apply, get hired, and grow your income</button>
    </div>`);
    expect(r.siblingMismatch).toEqual([]);
  });

  test("a same-row pair still has to match even when text wraps (admin stat tiles)", async ({ page }) => {
    const r = await run(page, `<div class="row" style="align-items:flex-start">
      <button style="width:140px;height:151px;white-space:normal">1 New Users (last 7d) +0% vs prior</button>
      <button style="width:140px;height:137px">0 Active Jobs</button>
    </div>`);
    expect(r.siblingMismatch).toHaveLength(1);
  });

  test("stacked cards over 96px are content rows, not buttons (/admin jobs list)", async ({ page }) => {
    const r = await run(page, `<div class="stack">
      <button style="height:158px">Deep clean a two-bedroom</button>
      <button style="height:132px">Touch-up paint in a hallway</button>
    </div>`);
    expect(r.siblingMismatch).toEqual([]);
  });

  test("catches AtAGlance tiles two-up at 375: 58px row over a 70.3px row (/user/:id)", async ({ page }) => {
    const r = await run(page, `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:320px">
      <button style="height:58px;flex-direction:column">5.0<br>1 review</button>
      <button style="height:58px;flex-direction:column">4<br>Jobs posted</button>
      <button style="height:70.3px;flex-direction:column">16<br>Jobs completed</button>
      <button style="height:70.3px;flex-direction:column">42%<br>32 of 77 jobs cancelled</button>
    </div>`);
    expect(r.siblingMismatch.some((m) => m.includes('"5.0 1 review" 58.0px vs "16 Jobs completed" 70.3px'))).toBe(true);
  });

  test("the schedule strip's day cards differ by job count on purpose and are exempt", async ({ page }) => {
    const r = await run(page, `<ul aria-label="Upcoming 7 days" class="row" style="list-style:none;align-items:flex-start">
      <li><button style="width:112px;height:60.4px">0 jobs Sun</button></li>
      <li><button style="width:112px;height:139.9px">13 jobs Wed</button></li>
    </ul>`);
    expect(r.siblingMismatch).toEqual([]);
  });

  test("a parent that sizes its buttons on purpose is not a defeated class", async ({ page }) => {
    await page.setContent(BASE + `<style>.p button{height:44px}</style>
      <div class="p [&_button]:h-11"><button class="h-14" style="width:44px">Bell</button></div>`);
    const r = await page.evaluate(detectButtonGeometry, undefined);
    expect(r.requestedNotRendered).toEqual([]);
  });

  /**
   * #1597: a11y-webkit-prod was red on `"3" asks h-7 (28px), renders 29.6px`.
   * The JobTracking step dot is `w-7 h-7` plus `.step-current-pulse`, which
   * index.css animates scale(1) -> scale(1.06) forever; getBoundingClientRect()
   * is the VISUAL box, so 28px measured up to 29.68px mid-pulse. Because WebKit
   * and Chromium sample an infinite animation at different phases, only one
   * engine ever reported it. The geometry answer must come from layout.
   */
  test("a scale animation on the control is not a defeated height class", async ({ page }) => {
    // `animation-delay: -0.8s` pins the pulse at its 50% keyframe from the very
    // first frame, so the visual box is at its biggest with no timing race.
    await page.setContent(BASE + `<style>
      @keyframes pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
      .pulsing { animation: pulse 1.6s linear -0.8s infinite; transform-origin: center; }
    </style>
    <div><button class="h-7 pulsing" style="height:28px;width:28px;padding:0">3</button></div>`);
    expect(await page.evaluate(() => document.querySelector("button")!.getBoundingClientRect().height))
      .toBeGreaterThan(29); // the visual box really is inflated — the check has to ignore it
    expect((await page.evaluate(detectButtonGeometry, undefined)).requestedNotRendered).toEqual([]);

    // A frozen scale is the same measurement trap without the animation.
    await page.setContent(BASE + `<div><button class="h-7"
      style="height:28px;width:28px;padding:0;transform:scale(1.06)">3</button></div>`);
    expect((await page.evaluate(detectButtonGeometry, undefined)).requestedNotRendered).toEqual([]);
  });

  test("a border under box-sizing:border-box is not extra height (MobileNav's FAB)", async ({ page }) => {
    // THE REGRESSION THIS EXISTS FOR. `getComputedStyle().height` resolves
    // differently per box-sizing, and adding padding+border back
    // unconditionally double-counts under `border-box` — which Tailwind's
    // preflight sets globally, so it is the common case, not the edge one.
    //
    // Measured on the real app at 375 before the fix: MobileNav's "Post a new
    // job" is `w-14 h-14` with an inline 1px border and reported
    // `{rect: 56, computedHeight: "56px", boxSizing: "border-box"}` — correct
    // at 56px, reported as 58px. That turned the pre-push changed-screen gate
    // red for EVERY push, on a button that was fine, and two separate lanes
    // pushed with --no-verify because of it.
    await page.setContent(BASE + `<div><button class="h-14"
      style="box-sizing:border-box;height:56px;width:56px;padding:0;border:1px solid #000">+</button></div>`);
    expect(await page.evaluate(() => {
      const el = document.querySelector("button")!;
      return { rect: el.getBoundingClientRect().height, box: getComputedStyle(el).boxSizing };
    })).toEqual({ rect: 56, box: "border-box" });
    expect((await page.evaluate(detectButtonGeometry, undefined)).requestedNotRendered).toEqual([]);

    // And the other branch still works: under content-box the same declared
    // height really does render 58px, and h-14 (56px) really is defeated.
    await page.setContent(BASE + `<div><button class="h-14"
      style="box-sizing:content-box;height:56px;width:56px;padding:0;border:1px solid #000">+</button></div>`);
    expect((await page.evaluate(detectButtonGeometry, undefined)).requestedNotRendered)
      .toEqual(['"+" asks h-14 (56px), renders 58.0px']);
  });

  test("still catches a height class the cascade really did defeat", async ({ page }) => {
    // 60px, not 44px: at 44px this would be `heightHeldAtFloor` (the HIG floor
    // doing its job), which is deliberately not a requestedNotRendered finding.
    await page.setContent(BASE + `<style>button{height:60px!important}</style>
      <div><button class="h-7" style="width:28px;padding:0">3</button></div>`);
    const r = await page.evaluate(detectButtonGeometry, undefined);
    expect(r.requestedNotRendered).toEqual(['"3" asks h-7 (28px), renders 60.0px']);
  });
});

// The detector's equality tolerance is the whole thing: widen it and the
// /complete-profile repro (49.5px on 60px) stops being a mismatch, so the one
// true positive this file exists for goes silent while the exclusion cases
// stay green. That asymmetry is exactly what a fixture suite is for.
// @mutate e2e/happy-path/buttonGeometry.ts | Math.abs(a.height - b.height) <= 1 | Math.abs(a.height - b.height) <= 100
