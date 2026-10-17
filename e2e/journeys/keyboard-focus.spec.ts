import type { Locator, Page } from "@playwright/test";
import { test, expect, assertHealthy, getSession, newUserContext, sessionsAvailable, rest, SUPABASE_URL, E2E_TITLE_MARKER } from "./fixtures";
import { fitJobTitle } from "../../scripts/lib/jobTextBounds.mjs";
import { expectGateSendsToCompleteProfile } from "./incompleteAccount";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";
import { defaultInboxTab } from "../../src/lib/inboxDefault";

/**
 * Journey — a keyboard user keeps their place (owner, 2026-09-12: "prevent,
 * don't chase"; audit of the same day found all four of the originals).
 *
 * The CLASS this guards: keyboard focus that is (a) invisible, (b) lost to
 * <body> when a screen swaps, (c) lost to <body> when a write re-renders the
 * control, (d) on a control with no name. Each leg runs over the app's OWN
 * inventory of that control kind on the real screen, against prod, so a new
 * offender of the same shape goes red without anyone writing a new test:
 *
 *   a. EVERY focusable on Complete Profile, and inside Post a Job's date
 *      calendar, paints a focus indicator (original: the DOB wheel's
 *      Month/Day/Year listboxes, `focus-visible:outline-none`; the wheel left
 *      the app with the birthday question, 8d44b5aab, 2026-10-14).
 *   b. Opening a thread from the inbox leaves focus INSIDE the thread
 *      (original: Messages swaps the list for the chat; focus fell to body).
 *   c. EVERY switch on Notification preferences keeps focus through a toggle
 *      and its save (original: the push master, remounted by a component
 *      declared inside the render body). Each is toggled back afterwards.
 *   d. EVERY switch, checkbox and button on the post-job form has an
 *      accessible name (reported: #require-photo-proof; it is named by its
 *      <label htmlFor>, and this leg proves that for every sibling too).
 *   e. EVERY file picker on the post-job form paints focus when its input
 *      is focused (original: PhotoUpload's ring hidden by an inline shadow).
 */

const rotation = rotationFor(3);

const focusDescription = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "body";
    return `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""}[role=${a.getAttribute("role") ?? ""} label=${a.getAttribute("aria-label") ?? ""}]`;
  });

/**
 * Focus every node of `focusables` (as it is on screen now) and list the ones
 * that paint nothing: no outline and no box-shadow while focused.
 *
 * HANDLES, NOT INDEXES: focusing a node can re-render its list (a calendar
 * pages, a wheel scroll-snaps), and a loop that keeps asking for `nth(i)`
 * waits out its timeout on a list that shrank (e2e-journeys 34927100318).
 * A handle that has left the document is skipped rather than waited for.
 */
async function unpaintedFocusables(page: Page, focusables: Locator): Promise<{ checked: number; unpainted: string[] }> {
  await expect(focusables.first()).toBeVisible({ timeout: 30_000 });
  const handles = await focusables.elementHandles();
  const unpainted: string[] = [];
  let checked = 0;
  for (const el of handles) {
    if (!(await el.evaluate((node) => (node as HTMLElement).isConnected && (node as HTMLElement).getClientRects().length > 0).catch(() => false))) continue;
    // The resting shadow, read before focus: a ring is a box-shadow that
    // CHANGES on focus, and a control with a resting shadow (a card button,
    // an input's inset) is not "painted" by the shadow it always wears.
    const resting = await el.evaluate((node) => getComputedStyle(node as HTMLElement).boxShadow);
    await el.focus();
    // Keyboard movement is what turns :focus-visible on; Tab away and back.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    // `transition` on rings (Input, Button): let it settle before reading.
    await page.waitForTimeout(400);
    const paint = await el.evaluate((node, restingShadow) => {
      const e = node as HTMLElement;
      if (document.activeElement !== e) return { skipped: true };
      const cs = getComputedStyle(e);
      const transparent = (c: string) => /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(c);
      const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && !transparent(cs.outlineColor);
      const shadow = cs.boxShadow !== "none" && cs.boxShadow !== restingShadow;
      return { skipped: false, outline, shadow, desc: `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}[${e.getAttribute("aria-label") ?? e.textContent?.trim().slice(0, 20)}] outline=${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} shadow=${cs.boxShadow}` };
    }, resting);
    if (paint.skipped) continue;
    checked++;
    if (!paint.outline && !paint.shadow) unpainted.push(paint.desc!);
  }
  return { checked, unpainted };
}

const guestTitle = scenarioTitle({ journey: "keyboard", persona: "new", state: "approved", rotation, outcome: "smooth" });
// Shown able to fail on the class's original defect, moved to the controls a
// keyboard user meets now: `focus-visible:outline-none` with NOTHING in its
// place (the DOB wheel, audit 2026-09-12). Stripping the Input's replacement
// ring leaves every Complete Profile text field focused with nothing painted,
// and stripping the calendar day's leaves every day of Post a Job's calendar
// the same way; "focused with nothing painted" is what catches each.
// @mutate src/components/ui/input.tsx | "focus-visible:ring-2 focus-visible:ring-[hsl(var(--olivewood)/0.25)] focus-visible:ring-offset-0", | "focus-visible:ring-0",
// @mutate src/components/ui/calendar.tsx | "h-11 w-11 p-0 font-sans font-medium text-[hsl(var(--ink-deep))] aria-selected:opacity-100 rounded-full" | "focus-visible:ring-0 h-11 w-11 p-0 font-sans font-medium text-[hsl(var(--ink-deep))] aria-selected:opacity-100 rounded-full"

test(guestTitle, async ({ browser, request, journey }) => {
  test.skip(filteredOut(guestTitle), "SCENARIO pins another scenario");
  // A new account that has not finished its profile lands on Complete
  // Profile: the `incomplete` seed account (./incompleteAccount.ts).
  const incomplete = await getSession(request, "incomplete");
  await expectGateSendsToCompleteProfile(request, incomplete);
  const ctx = await newUserContext(browser, incomplete, { rotation });
  const page = journey.track("incomplete", await ctx.newPage());

  await test.step("a. every focusable on Complete Profile shows focus", async () => {
    // Complete Profile asks no birthday since 8d44b5aab (owner, 2026-10-14),
    // so the DOB wheel this leg walked is gone from every screen (nightly-red
    // #2436, e2e-journeys 38749234414 / 38882683467: "#dob element(s) not
    // found"). The class is unchanged: a keyboard stop with nothing painted.
    // The form the incomplete account lands on is walked whole, from the
    // screen's own inventory.
    await page.goto("/complete-profile");
    await expect(page.locator("#firstName")).toBeVisible({ timeout: 60_000 });
    const focusables = page.locator(
      'main [tabindex="0"], main button:not([disabled]):not([tabindex="-1"]), main input:not([disabled]):not([tabindex="-1"]):not([type=hidden]), main textarea:not([disabled]), main select:not([disabled]):not([tabindex="-1"]), main [role="checkbox"]:not([tabindex="-1"])',
    );
    const invisible = await unpaintedFocusables(page, focusables);
    expect(invisible.checked, "Complete Profile has no keyboard stops at all").toBeGreaterThan(3);
    await journey.milestone(page, "complete-profile-focus");
    expect(invisible.unpainted, "focused with nothing painted").toEqual([]);
    await assertHealthy(page, "/complete-profile");
  });
  await ctx.close();
});

const authedTitle = scenarioTitle({ journey: "keyboard", persona: "helper-only", state: "approved", rotation, outcome: "smooth" });
test(authedTitle, async ({ browser, request, journey }) => {
  test.skip(filteredOut(authedTitle), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  // Leg c round-trips prod once per switch, twice (toggle + restore); on the
  // slow rotation that alone is several minutes.
  test.setTimeout(rotation.network === "slow" ? 20 * 60_000 : 10 * 60_000);
  const helper = await getSession(request, "helper");
  const ctx = await newUserContext(browser, helper, { rotation });
  const page = journey.track("helper", await ctx.newPage());

  await test.step("b. opening a thread keeps focus inside the thread", async () => {
    // The leg seeds its OWN thread. It used to open whatever thread the helper
    // inbox already held, and went red every night once the 2026-10-01 seed
    // wipe left that inbox empty (nightly-red #1719, run 36923486825: "the
    // helper inbox has no threads to open"; prod read the same day: 0 messages
    // to or from the helper before the run). A direct offer is the smallest
    // thread the live policy admits: can_send_message_to_in_job lets the
    // poster reach offered_to_helper_id while the offer is pending. Unfunded
    // on purpose, never visited on /posts or /jobs (UNFUNDED-DRAFT-OK), and
    // cancelled in teardown with no strike, as notifications.spec.ts does.
    const poster = await getSession(request, "poster");
    const posterHeaders = rest(poster);
    const title = fitJobTitle(`${E2E_TITLE_MARKER} KF ${Date.now().toString(36).slice(-6)}`);
    const created = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: {
        customer_id: poster.user.id,
        is_seed: true,
        title,
        description: "Keyboard-focus thread probe: two shelves, studs marked, anchors on site.",
        category: "handyman",
        location: "4412 Highland Rd, Baton Rouge, LA 70808",
        parish: null,
        date_needed: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
        budget: 25,
        status: "open",
        payment_status: "unpaid",
        pricing_mode: "set_price",
        offered_to_helper_id: helper.user.id,
        direct_offer_status: "pending",
        direct_offer_expires_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
      },
    });
    expect(created.ok(), `thread-probe job insert failed: ${created.status()} ${await created.text()}`).toBe(true);
    const jobId = ((await created.json()) as Array<{ id: string }>)[0].id;
    journey.cleanup("cancel the thread-probe job", () =>
      request.post(`${SUPABASE_URL}/rest/v1/rpc/poster_cancel_job`, { headers: posterHeaders, data: { p_job_id: jobId, p_reason: "E2E keyboard-focus probe teardown" } }),
    );
    const sent = await request.post(`${SUPABASE_URL}/rest/v1/messages?select=id`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: { job_id: jobId, sender_id: poster.user.id, receiver_id: helper.user.id, content: `${E2E_TITLE_MARKER} keyboard-focus thread probe` },
    });
    expect(sent.ok(), `thread-probe message insert failed: ${sent.status()} ${await sent.text()}`).toBe(true);
    const msgId = ((await sent.json()) as Array<{ id: string }>)[0].id;
    journey.cleanup("delete the thread-probe message", () =>
      request.delete(`${SUPABASE_URL}/rest/v1/messages?id=eq.${msgId}`, { headers: posterHeaders }),
    );

    await page.goto("/messages");
    // The inbox lands on the Active tab (owner 2026-09-19, lib/inboxDefault),
    // which keeps only threads whose job is live (accepted onwards). The
    // seeded thread's job is a still-"open" direct offer, so it is only ever
    // listed under All: switch to All before looking for the row. On a phone
    // the strip is folded behind the "Filter conversations" chevron.
    if (defaultInboxTab(0) !== "all") {
      const allTab = page.getByRole("tab", { name: /^All/ }).or(page.getByRole("button", { name: /^All/ })).first();
      const chevron = page.locator('button[aria-expanded="false"][aria-label="Filter conversations"]');
      await expect(allTab.or(chevron).first(), "the inbox never rendered its tab strip").toBeVisible({ timeout: 60_000 });
      if (!(await allTab.isVisible()) && (await chevron.count())) await chevron.first().click();
      await allTab.click();
    }
    const row = page.locator("button.flex-1.min-w-0.text-left").filter({ hasText: title }).first();
    await expect(row, "the seeded thread never reached the helper inbox").toBeVisible({ timeout: 60_000 });
    await row.focus();
    // Opening a thread clears its message notifications (useMessagesData's
    // mark-read PATCH) when the counterparty has written. On the slow row that
    // write is held, and step c's goto left before it was sent (run
    // 36298505707: "the slow row held these writes"). Wait for it when it fires.
    const markRead = page
      .waitForRequest(
        (r) => r.method() === "PATCH" && r.url().includes("/rest/v1/notifications?") && r.url().includes("type=eq.message"),
        { timeout: 30_000 },
      )
      .catch(() => null);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Back to conversations" })).toBeVisible({ timeout: 30_000 });
    const markReadReq = await markRead;
    if (markReadReq) await markReadReq.response();
    await expect.poll(() => focusDescription(page), { timeout: 5_000 }).not.toBe("body");
    const inside = await page.evaluate(() => !!document.activeElement?.closest("main, [role=main], #root"));
    expect(inside, "focus left the app root").toBe(true);
    await journey.milestone(page, "thread-open-focus");
    await assertHealthy(page, "/messages thread");
  });

  await test.step("c. every notification switch keeps focus through a toggle", async () => {
    await page.goto("/profile?tab=notifications");
    const switches = page.getByRole("switch");
    await expect(switches.first()).toBeVisible({ timeout: 60_000 });
    // Wait for the real controls (the skeleton pills carry no role).
    await expect(page.getByRole("switch", { name: "Push notifications master toggle" })).toBeEnabled({ timeout: 30_000 });
    const saving = page.getByLabel("Saving");
    // One toggle = one prod round-trip; wait for its spinner, not a fixed sleep
    // (on the "slow" rotation every call is 3-8s, and there are ~24 switches).
    const settle = async () => {
      await saving.first().waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
      await expect(saving).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(150);
    };
    const n = await switches.count();
    const lost: string[] = [];
    for (let i = 0; i < n; i++) {
      const sw = switches.nth(i);
      if (!(await sw.isEnabled())) continue;
      const name = (await sw.getAttribute("aria-label")) ?? `switch #${i}`;
      const was = (await sw.getAttribute("aria-checked")) === "true";
      await sw.focus();
      await page.keyboard.press("Space");
      // Focus must survive BOTH renders (optimistic value, then the spinner).
      await settle();
      if ((await focusDescription(page)) === "body") lost.push(name);
      // Put it back exactly as found (a dropped write already reverted it).
      for (let tries = 0; tries < 3 && ((await sw.getAttribute("aria-checked")) === "true") !== was; tries++) {
        await sw.focus();
        await page.keyboard.press("Space");
        await settle();
      }
      expect((await sw.getAttribute("aria-checked")) === "true", `could not restore "${name}"`).toBe(was);
    }
    await journey.milestone(page, "notification-switch-focus");
    expect(lost, "focus dropped to body after toggling").toEqual([]);
    await assertHealthy(page, "/profile?tab=notifications");
  });

  await test.step("d. every control on the post-job form is named", async () => {
    await page.goto("/post-job");
    await page.getByRole("button", { name: /start fresh/i }).first().click({ timeout: 60_000 });
    await expect(page.locator("#require-photo-proof")).toBeVisible({ timeout: 30_000 });
    const controls = page.getByRole("switch").or(page.getByRole("checkbox")).or(page.getByRole("button"));
    const n = await controls.count();
    const unnamed: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = controls.nth(i);
      if (!(await c.isVisible())) continue;
      const snap = await c.ariaSnapshot();
      // "- switch" with no quoted name, vs `- switch "Require before & after photos"`.
      if (!/^- \w+ "/.test(snap.trim())) unnamed.push(`${(await c.getAttribute("id")) ?? "?"}: ${snap.trim().slice(0, 60)}`);
    }
    await journey.milestone(page, "post-job-names");
    expect(unnamed, "controls with no accessible name").toEqual([]);
    await assertHealthy(page, "/post-job form");
  });

  await test.step("e. every file picker on the post-job form paints focus", async () => {
    // Same class as (a), second shape: PhotoUpload's "+" chip declared
    // `focus-within:ring-2` and ALSO an inline boxShadow — the ring is a
    // box-shadow, so the inline style won and nothing showed (dbed7befd).
    const pickers = page.locator("label:has(> input[type=file]), label:has(input[type=file])");
    const n = await pickers.count();
    expect(n, "the post-job form has file pickers; none were found").toBeGreaterThan(0);
    const unpainted: string[] = [];
    for (let i = 0; i < n; i++) {
      const label = pickers.nth(i);
      if (!(await label.isVisible())) continue;
      const input = label.locator("input[type=file]").first();
      await input.focus();
      // `transition-all` on the chip: let the outline settle before reading it.
      await page.waitForTimeout(400);
      const paint = await label.evaluate((el) => {
        const cs = getComputedStyle(el);
        const transparent = (c: string) => /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(c);
        const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && !transparent(cs.outlineColor);
        // A ring is a box-shadow that changes on focus; compare against the resting value.
        const focusedShadow = cs.boxShadow;
        (document.activeElement as HTMLElement | null)?.blur();
        const restingShadow = getComputedStyle(el).boxShadow;
        return { outline, shadowChanged: focusedShadow !== restingShadow, desc: `${el.textContent?.trim().slice(0, 30) || "+"} outline=${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` };
      });
      if (!paint.outline && !paint.shadowChanged) unpainted.push(paint.desc);
    }
    // Leave focus on the first picker for the milestone shot.
    await pickers.first().locator("input[type=file]").focus();
    await pickers.first().scrollIntoViewIfNeeded();
    await journey.milestone(page, "post-job-file-picker-focus");
    expect(unpainted, "file picker focused with nothing painted").toEqual([]);
  });

  await test.step("f. Post a Job's date calendar: every stop paints focus, and Tab never changes the day", async () => {
    // The date picker a keyboard user meets now (the DOB wheel went with the
    // birthday question, 8d44b5aab). Same two originals as the wheel's: a stop
    // with nothing painted, and Tab moving the chosen value (2026-09-12: two
    // presses moved the wheel's year 2008 -> 1906).
    const calendar = page.getByRole("group", { name: /Date Needed|Start Date/ });
    await expect(calendar.locator("td[data-day]").first(), "the Date Needed calendar never mounted (lazy chunk)").toBeAttached({ timeout: 30_000 });
    const chosen = () => calendar.locator('td[aria-selected="true"]').evaluateAll((tds) => tds.map((td) => td.getAttribute("data-day")));
    const before = await chosen();
    const stops = calendar.locator('button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]');
    const { checked, unpainted } = await unpaintedFocusables(page, stops);
    expect(checked, "the Date Needed calendar has no keyboard stops at all").toBeGreaterThan(0);
    await stops.first().focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+Tab");
    await journey.milestone(page, "post-job-calendar-focus");
    expect(unpainted, "calendar stop focused with nothing painted").toEqual([]);
    expect(await chosen(), "Tab moved the calendar's chosen day").toEqual(before);
  });
  await ctx.close();
});
