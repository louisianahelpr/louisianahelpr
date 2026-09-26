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
 *   3. tap one row and sample the panel's bottom edge every animation frame;
 *   4. assert the row really left AND the edge really moved (a no-op cannot
 *      pass), and that no single frame moved it more than MAX_FRAME_PX.
 * Writes: three notifications on the shared poster account, marked read and
 * deleted again in afterAll (own-row UPDATE and DELETE, as notifications.spec
 * does).
 */
// Shown able to fail: a fade-only exit keeps the row's box until it is removed
// in one frame, the pre-f40193ae7 geometry (~100px at 375).
// @mutate src/components/NotificationPanel.tsx | const collapseExit = reducedMotion | const collapseExit = true
import { test, expect, webkit, type Browser, type Page } from "../prodTest";
import { newUserContext, sessionFor, SUPABASE_URL, ANON, rest, type Session } from "./harness";

/** ~40px per the Q51 spec: a third of the pre-fix jump, 3x the fixed one. */
export const MAX_FRAME_PX = 40;
/** A step spanning more than ~3 frames at 60 Hz is a dropped-frame gap, not "one frame". */
export const MAX_STEP_MS = 50;
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

/** Per-frame bottom edge of the open panel while `act` runs, for `ms`. */
type Sample = { y: number; t: number };
/** Per-frame bottom edge of the open panel, with each frame's timestamp, while `act` runs, for `ms`. */
async function sampleEdge(page: Page, act: () => Promise<void>, ms: number): Promise<Sample[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __edge: { y: number; t: number }[]; __edgeOn: boolean };
    w.__edge = [];
    w.__edgeOn = true;
    const tick = () => {
      const el = document.querySelector('[role="dialog"][aria-labelledby]');
      if (el) w.__edge.push({ y: el.getBoundingClientRect().bottom, t: performance.now() });
      if (w.__edgeOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const w = window as unknown as { __edge: { y: number; t: number }[]; __edgeOn: boolean };
    w.__edgeOn = false;
    return w.__edge;
  });
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
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/home");
      await page.getByRole("button", { name: "Notifications" }).first().click();
      const panel = page.locator('[role="dialog"][aria-labelledby]');
      await expect(panel).toBeVisible({ timeout: 20_000 });
      await panel.getByRole("radio", { name: /Unread/ }).click();
      const rows = panel.getByRole("button").filter({ hasText: TITLE });
      await expect(rows.first()).toBeVisible({ timeout: 20_000 });
      const before = await rows.count();

      // A short list: the panel is content-sized, so its edge follows the list.
      const scroller = panel.locator(".overscroll-contain").first();
      const [sh, ch] = await scroller.evaluate((el) => [el.scrollHeight, el.clientHeight]);
      expect(sh, `the poster's Unread list fills the panel (${sh}px in ${ch}px), so this run cannot see a jump; mark its old notifications read`).toBeLessThanOrEqual(ch + 1);

      await page.waitForTimeout(800); // entry animations done
      const edge = await sampleEdge(page, () => rows.last().click(), 1200);
      await expect(rows, "the tapped row did not leave the Unread list").toHaveCount(before - 1, { timeout: 5_000 });

      // A step is a move between two consecutive frames, with the time it
      // spanned. A JUMP is a big move inside a normal frame interval; a big move
      // across a long gap (a dropped-frame stretch on a loaded runner) cannot be
      // told from a smooth slide, so it is not passed: it fails as "cannot judge".
      const steps = edge.slice(1).map((s, i) => ({ dy: Math.abs(s.y - edge[i].y), dt: s.t - edge[i].t }));
      const largest = steps.reduce((a, b) => (b.dy > a.dy ? b : a), { dy: 0, dt: 0 });
      const travel = Math.abs(edge[edge.length - 1].y - edge[0].y);
      const measure = `${engine} 375: frames=${edge.length} largest one-frame move=${largest.dy.toFixed(1)}px over ${largest.dt.toFixed(0)}ms total travel=${travel.toFixed(1)}px`;
      test.info().annotations.push({ type: "measure", description: measure });
      console.log(`[notification-panel-jump] ${measure}`);
      // The whole series, so a failure explains itself in the log (y px @ ms since the previous frame).
      console.log(`[notification-panel-jump] ${engine} series: ${edge.map((e, i) => `${e.y.toFixed(0)}@${i ? (e.t - edge[i - 1].t).toFixed(0) : 0}`).join(" ")}`);
      await page.screenshot({ path: test.info().outputPath(`panel-after-${engine}.png`) });
      expect(edge.length, "too few frames sampled to judge").toBeGreaterThan(10);
      expect(travel, "the panel edge never moved: nothing was measured").toBeGreaterThan(20);
      const jumps = steps.filter((s) => s.dy > MAX_FRAME_PX && s.dt <= MAX_STEP_MS);
      const unjudgeable = steps.filter((s) => s.dy > MAX_FRAME_PX && s.dt > MAX_STEP_MS);
      expect(jumps.map((s) => `${s.dy.toFixed(1)}px in ${s.dt.toFixed(0)}ms`), `the panel edge jumped in one frame (${engine})`).toEqual([]);
      expect(
        unjudgeable.map((s) => `${s.dy.toFixed(1)}px across a ${s.dt.toFixed(0)}ms gap`),
        `frames were dropped exactly where the panel moved, so this run cannot tell a jump from a slide (${engine}); re-run`,
      ).toEqual([]);
      await ctx.close();
    } finally {
      if (engine !== "chromium") await browser.close();
    }
  });
}
