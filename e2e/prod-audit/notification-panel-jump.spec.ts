/**
 * Q51 — the notification panel's edge never jumps when a row leaves.
 *
 * f40193ae7 fixed it: a row leaving the Unread tab used to keep its box until
 * its 200ms exit ended, then vanish in ONE frame, so the panel (content-sized
 * below its max height) snapped up by a whole row. Measured then on prod,
 * poster-e2e, per-rAF panel bottom, 375x812: Chromium largest one-frame move
 * 100.4px -> 13.1px, WebKit 100.4 -> 13.4. It was measured once, by hand
 * (~/.lh-shots/notif-panel-jump/measure.mjs); nothing failed if it came back.
 *
 * This is that measurement as a check, in Chromium AND WebKit:
 *   1. the poster gets three unread "Test from Helpr" rows of its own
 *      (create-notification, template "test": no link, so a tap marks the row
 *      read and KEEPS the panel open, and the row leaves the Unread tab);
 *   2. open the bell, pick Unread, and require a SHORT list (the panel is
 *      content-sized, not at max height; at max height the scroll area absorbs
 *      the change and the check would be vacuous). The panel's notification
 *      reads are narrowed on the wire to the rows this spec created, because
 *      the shared poster's own backlog fills the panel;
 *   3. tap one row and sample the panel's bottom edge every animation frame,
 *      stepping a paused fake clock one frame at a time (see sampleEdge);
 *   4. assert the row really left AND the edge really moved (a no-op cannot
 *      pass), and that no single frame moved it more than MAX_FRAME_PX.
 * Writes: three notifications on the shared poster account, marked read and
 * deleted again in afterAll (own-row UPDATE and DELETE, as notifications.spec
 * does).
 */
// Shown able to fail: a fade-only exit keeps the row's box until it is removed
// in one frame, the pre-f40193ae7 geometry (~100px at 375).
// @mutate src/components/NotificationPanel.tsx | const collapseExit = reducedMotion | const collapseExit = true
// Q931: on the desktop website the panel's WIDTH followed its content, so the
// last unread row leaving moved its left edge (445px with a row -> 233px).
// @mutate src/components/NotificationPanel.tsx |  [.web-desktop_&]:w-[28rem]"> | ">
import { test, expect, webkit, type Browser, type Page } from "../prodTest";
import { newUserContext, sessionFor, SUPABASE_URL, ANON, rest, type Session } from "./harness";

/** ~40px per the Q51 spec: a third of the pre-fix jump, 3x the fixed one. */
export const MAX_FRAME_PX = 40;
/** One frame of the page's fake clock (60 Hz). */
const FRAME_MS = 16;
const TITLE = "Test from Helpr";

let poster: Session;
const created: string[] = [];

test.beforeAll(async ({ request }) => {
  poster = await sessionFor(request, "poster");
});

test.afterAll(async ({ request }) => {
  for (const id of created) {
    await request.patch(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${id}`, { headers: rest(poster), data: { read: true } });
    await request.delete(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${id}`, { headers: rest(poster) });
  }
});

/** Seeds `n` unread rows and returns THIS call's ids (the route filter uses only these). */
async function seedUnread(request: import("@playwright/test").APIRequestContext, n: number): Promise<string[]> {
  const since = new Date(Date.now() - 1000).toISOString();
  for (let i = 0; i < n; i++) {
    const r = await request.post(`${SUPABASE_URL}/functions/v1/create-notification`, {
      headers: { apikey: ANON, Authorization: `Bearer ${poster.access_token}`, "Content-Type": "application/json" },
      data: { user_id: poster.user.id, template: "test", title: "IGNORED", message: "IGNORED" },
    });
    expect(r.ok(), `seed notification: ${r.status()} ${await r.text()}`).toBe(true);
  }
  const rows = (await request
    .get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${poster.user.id}&title=eq.${encodeURIComponent(TITLE)}&created_at=gte.${encodeURIComponent(since)}&select=id`, { headers: rest(poster) })
    .then((x) => x.json())) as { id: string }[];
  const mine = rows.map((r) => r.id).filter((id) => !created.includes(id));
  created.push(...mine);
  expect(mine.length, "the seeded notifications did not land").toBeGreaterThanOrEqual(n);
  return mine;
}

/**
 * The panel's bottom edge, one sample per FAKE frame, after `act` runs.
 *
 * Frames are stepped by Playwright's clock, not taken from the runner: on CI,
 * WebKit dropped 74-338ms of frames exactly where the exit began (runs
 * 36290267474, 36298506930, 36361548155), and Framer Motion drives the height
 * collapse from requestAnimationFrame, so a dropped stretch made the ANIMATION
 * itself take one big step, which no sampler can tell from the bug. With time
 * paused and advanced FRAME_MS at a time, every sample is exactly one frame of
 * the app's own animation, in both engines, whatever the runner's frame rate.
 * Real time still runs between steps, so the mark-read request completes.
 */
async function sampleEdge(page: Page, act: () => Promise<void>, frames: number): Promise<number[]> {
  const edge = () => page.evaluate(() => document.querySelector('[role="dialog"][aria-labelledby]')?.getBoundingClientRect().bottom ?? NaN);
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 50);
  const out = [await edge()];
  await act();
  for (let i = 0; i < frames; i++) {
    await page.clock.runFor(FRAME_MS);
    out.push(await edge());
  }
  await page.clock.resume();
  return out;
}

for (const engine of ["chromium", "webkit"] as const) {
  test(`notification panel: a leaving row never moves the panel edge > ${MAX_FRAME_PX}px in one frame (${engine})`, async ({ request, browser: defaultBrowser }) => {
    test.setTimeout(3 * 60_000);
    const mine = await seedUnread(request, 3);
    const browser: Browser = engine === "chromium" ? defaultBrowser : await webkit.launch();
    try {
      const ctx = await newUserContext(browser, poster);
      // The shared poster carries hundreds of real unread notifications, so its
      // list overflows the panel and no jump could happen (first CI run: 4936px
      // in 451px). Narrow the panel's OWN reads to the rows this spec created:
      // real rows, the real backend, only an id filter added on the wire.
      // Only THIS test's rows: an earlier engine's leftovers made WebKit's
      // list overflow (531px in 484px, run 36213595709).
      const ids = mine.join(",");
      await ctx.route(/\/rest\/v1\/notifications\?/, (route) => {
        const req = route.request();
        if (req.method() !== "GET" && req.method() !== "HEAD") return route.continue();
        return route.continue({ url: `${req.url()}&id=in.(${ids})` });
      });
      const page = await ctx.newPage();
      // Fake timers (Date, performance.now, requestAnimationFrame) from the first
      // script, so Framer Motion's frame loop runs on them; time flows normally
      // until sampleEdge pauses it.
      await page.clock.install();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/home");
      await page.getByRole("button", { name: "Notifications" }).first().click();
      const panel = page.locator('[role="dialog"][aria-labelledby]');
      await expect(panel).toBeVisible({ timeout: 20_000 });
      await panel.getByRole("radio", { name: /Unread/ }).click();
      const rows = panel.getByRole("button").filter({ hasText: TITLE });
      await expect(rows.first()).toBeVisible({ timeout: 20_000 });

      // A short list: the panel is content-sized, so its edge follows the list.
      const scroller = panel.locator(".overscroll-contain").first();
      const [sh, ch] = await scroller.evaluate((el) => [el.scrollHeight, el.clientHeight]);
      expect(sh, `the poster's Unread list fills the panel (${sh}px in ${ch}px), so this run cannot see a jump; mark its old notifications read`).toBeLessThanOrEqual(ch + 1);

      await page.waitForTimeout(800); // entry animations done
      const before = await rows.count();
      // 250 fake frames = 4s of app time: the mark-read round trip, then the 200ms exit.
      const edge = await sampleEdge(page, () => rows.last().dispatchEvent("click"), 250);
      await expect(rows, "the tapped row did not leave the Unread list").toHaveCount(before - 1, { timeout: 10_000 });

      const steps = edge.slice(1).map((y, i) => Math.abs(y - edge[i]));
      const largest = Math.max(...steps);
      const travel = Math.abs(edge[edge.length - 1] - edge[0]);
      const moving = steps.filter((dy) => dy > 0.5);
      const measure = `${engine} 375: fake frames=${steps.length} largest one-frame move=${largest.toFixed(1)}px total travel=${travel.toFixed(1)}px over ${moving.length} moving frames`;
      test.info().annotations.push({ type: "measure", description: measure });
      console.log(`[notification-panel-jump] ${measure}`);
      // Only the frames that moved, so a failure explains itself in the log.
      console.log(`[notification-panel-jump] ${engine} moving steps: ${moving.map((dy) => dy.toFixed(1)).join(" ")}`);
      await page.screenshot({ path: test.info().outputPath(`panel-after-${engine}.png`) });
      expect(edge.every(Number.isFinite), "the panel closed while sampling").toBe(true);
      expect(travel, "the panel edge never moved: nothing was measured").toBeGreaterThan(20);
      expect(largest, `the panel edge jumped ${largest.toFixed(1)}px in one frame (${engine})`).toBeLessThanOrEqual(MAX_FRAME_PX);
      await ctx.close();
    } finally {
      if (engine !== "chromium") await browser.close();
    }
  });
}

/**
 * Q931, the desktop half: when the last unread row leaves, the panel keeps its
 * width and left edge. Shrink-to-fit made the desktop panel as wide as its
 * content, so a live row arriving or leaving moved its left edge (measured on
 * prod at 1440, 2026-10-07: 330px empty, 445px with a row, 233px "Nothing
 * unread"). Chromium is enough: this is layout, not an engine quirk.
 */
test("notification panel at 1440: the last unread row leaving keeps the panel's width and left edge (Q931)", async ({ request, browser }) => {
  test.setTimeout(2 * 60_000);
  const mine = await seedUnread(request, 1);
  const ctx = await newUserContext(browser, poster);
  const ids = mine.join(",");
  await ctx.route(/\/rest\/v1\/notifications\?/, (route) => {
    const req = route.request();
    if (req.method() !== "GET" && req.method() !== "HEAD") return route.continue();
    return route.continue({ url: `${req.url()}&id=in.(${ids})` });
  });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/home");
  await page.getByRole("button", { name: "Notifications" }).first().click();
  const panel = page.locator('[role="dialog"][aria-labelledby]');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await panel.getByRole("radio", { name: /Unread/ }).click();
  const rows = panel.getByRole("button").filter({ hasText: TITLE });
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  const box = () => panel.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, width: r.width }; });
  const withRow = await box();
  await rows.first().dispatchEvent("click");
  await expect(rows, "the tapped row did not leave the Unread list").toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(800);
  const empty = await box();
  const measure = `1440: with a row left=${withRow.left.toFixed(1)} width=${withRow.width.toFixed(1)}; empty left=${empty.left.toFixed(1)} width=${empty.width.toFixed(1)}`;
  test.info().annotations.push({ type: "measure", description: measure });
  console.log(`[notification-panel-jump] ${measure}`);
  expect(Math.abs(empty.width - withRow.width), `the panel changed width when its last row left (${measure})`).toBeLessThanOrEqual(1);
  expect(Math.abs(empty.left - withRow.left), `the panel's left edge moved when its last row left (${measure})`).toBeLessThanOrEqual(1);
  await ctx.close();
});
