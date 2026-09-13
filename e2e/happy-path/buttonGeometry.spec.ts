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

  test("a parent that sizes its buttons on purpose is not a defeated class", async ({ page }) => {
    await page.setContent(BASE + `<style>.p button{height:44px}</style>
      <div class="p [&_button]:h-11"><button class="h-14" style="width:44px">Bell</button></div>`);
    const r = await page.evaluate(detectButtonGeometry, undefined);
    expect(r.requestedNotRendered).toEqual([]);
  });
});
