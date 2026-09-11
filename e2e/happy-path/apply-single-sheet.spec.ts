import { test, expect, FAKE_HELPER, installSupabaseMocks, mockTable, mockRpc } from "./fixtures";

// APPLYING HAPPENS ON ONE SURFACE, IN ONE STEP.
//
// This spec used to prove that the sheet did not JUMP when it stepped from
// detail to apply — it recorded the top edge, tapped Continue, and asserted
// the edge had not moved. That premise is gone: the owner collapsed the two
// steps into one on 2026-09-09 ("one sheet, one CTA, no step change, one less
// tap to apply"), so there is no Continue, no second step, and nothing left
// that could move.
//
// What it pins now is the shape that replaced it, all of which a screenshot
// diff would miss:
//
//   1. ONE SURFACE. Exactly one dialog, and no Continue/Back anywhere on it.
//   2. ONE STEP. The note field, the save-as-default-pitch checkbox and
//      "Apply Now" are on the SAME surface as the job's own title and
//      description — reachable without tapping anything.
//   3. NOTHING STEPS. Tapping around the sheet never swaps its body: the job
//      description is still there after the note field has been typed into.
//   4. THE CLOSE X IS REACHABLE and dismissing abandons the apply — no
//      resurrected standalone apply form on the bare feed.
//   5. NO DEAD BAND under the CTA on a short job: the sheet hugs its content.

const BASE_JOB = {
  id: "22222222-2222-4222-8222-222222222222",
  // Must not be FAKE_HELPER.id or the feed filters the card out as "your own job".
  customer_id: "33333333-3333-4333-8333-333333333333",
  title: "Smoke job: help me move a couch",
  description: "Need a hand moving a sofa from the truck into the apartment.",
  category: "moving",
  budget: 100,
  date_needed: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  start_time: "14:00",
  location: "New Orleans, LA",
  status: "open",
  // "escrow" — an open job that has been funded. NOT "paid": the
  // `jobs_payment_status_check` constraint has never admitted that value, so
  // this described a row prod could not hold. See fixturePaymentStatus.test.ts.
  payment_status: "escrow",
  // Older than the 20-minute free-tier "early access" delay, or the feed hides it.
  created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  updated_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  is_urgent: false,
  urgent_fee: 0,
  is_flexible_schedule: false,
  is_recurring: false,
  is_group_job: false,
  helpers_needed: 1,
  estimated_hours: 1,
  special_requirements: null,
  photos: [],
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  boosted_at: null,
  boost_expires_at: null,
  recurrence_interval: null,
  recurrence_end_date: null,
  parent_job_id: null,
  helper_id: null,
};

const POSTER_PROFILE = {
  user_id: BASE_JOB.customer_id,
  full_name: "Jane Poster",
  subscription_tier: "free",
  subscription_expires_at: null,
};

test("one sheet, one step: the apply form is on the job detail surface", async ({ helperPage: page }) => {
  await installSupabaseMocks(page, {
    user: FAKE_HELPER,
    rules: [
      mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
      mockRpc("get_safe_profiles", [POSTER_PROFILE]),
      mockTable("open_jobs_browse", [BASE_JOB]),
      mockTable("helper_availability", []),
      mockTable("applications", []),
      mockTable("user_blocks", []),
      mockTable("saved_jobs", []),
      mockTable("saved_searches", []),
      mockTable("reviews", []),
    ],
  });
  // The onboarding tour renders a modal over the feed and swallows the taps
  // that open the job detail sheet.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard");

  const card = page.getByText(BASE_JOB.title);
  await card.waitFor({ timeout: 20_000 });
  await card.click();

  const sheet = page.locator('[role="dialog"]').last();
  await sheet.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);

  // 1. ONE SURFACE, and no step machinery on it.
  expect(await page.locator('[role="dialog"],[role="alertdialog"]').count()).toBe(1);
  await expect(sheet.getByRole("button", { name: /^back$/i })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: /^continue\b/i })).toHaveCount(0);

  // 2. ONE STEP — the job AND the apply form, together, with no tap in
  //    between. This is the whole change: it used to take a Continue tap to
  //    reach any of the three below.
  await expect(sheet.getByText(BASE_JOB.description)).toBeVisible();
  const note = sheet.getByRole("textbox");
  await expect(note).toBeVisible();
  await expect(sheet.getByRole("checkbox", { name: /save as my default pitch/i })).toBeVisible();
  const applyNow = sheet.getByRole("button", { name: /^apply now$/i });
  await expect(applyNow).toBeVisible();

  // The CTA wears the real gloss. Asserting the CLASS passes on a flat
  // control (an inline `background` shorthand beats `.btn-grad-primary`), so
  // read the COMPUTED background-image and require a gradient.
  const cta = await applyNow.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(cta, `Apply Now background-image: ${cta}`).toMatch(/gradient\(/);

  // 3. NOTHING STEPS. Typing into the note must not swap the body out — the
  //    job is still on screen, which is the property the two-step version
  //    could not have.
  await note.fill("I have moved a lot of couches.");
  await page.waitForTimeout(300);
  await expect(sheet.getByText(BASE_JOB.description)).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^apply now$/i })).toBeVisible();
  expect(await page.locator('[role="dialog"],[role="alertdialog"]').count()).toBe(1);

  // 4. THE CLOSE X IS REACHABLE — on screen and hit-testable, not buried.
  const close = sheet.getByRole("button", { name: /^close$/i });
  await expect(close).toBeVisible();
  const closeBox = await close.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      onScreen: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
      ownsItsCentre: !!hit && (hit === el || el.contains(hit)),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
    };
  });
  expect(closeBox.onScreen, JSON.stringify(closeBox)).toBe(true);
  expect(closeBox.ownsItsCentre, JSON.stringify(closeBox)).toBe(true);
  expect(closeBox.w).toBeGreaterThanOrEqual(44);
  expect(closeBox.h).toBeGreaterThanOrEqual(44);
});

test("a short job leaves no dead band under the CTA", async ({ helperPage: page }) => {
  // The two-step sheet reserved the apply step's height on the detail step
  // (`min-h-[min(68dvh,600px)]`), which the owner flagged three times as a
  // screenful of blank space under Continue. With one step there is nothing
  // to reserve: the sheet hugs its content.
  await installSupabaseMocks(page, {
    user: FAKE_HELPER,
    rules: [
      mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
      mockRpc("get_safe_profiles", [POSTER_PROFILE]),
      mockTable("open_jobs_browse", [{ ...BASE_JOB, description: "Short one." }]),
      mockTable("helper_availability", []),
      mockTable("applications", []),
      mockTable("user_blocks", []),
      mockTable("saved_jobs", []),
      mockTable("saved_searches", []),
      mockTable("reviews", []),
    ],
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  // TALL viewport on purpose. The single sheet carries the whole apply form,
  // so at 375x812 even a one-line job legitimately reaches the `max-h-[86dvh]`
  // ceiling — a height that is EARNED, not reserved, and measuring there
  // cannot tell the two apart. Give it 1400px and the question becomes the
  // one that matters: with room to spare, does the box hug?
  await page.setViewportSize({ width: 375, height: 1400 });
  await page.goto("/dashboard");

  const card = page.getByText(BASE_JOB.title);
  await card.waitFor({ timeout: 20_000 });
  await card.click();
  const sheet = page.locator('[role="dialog"]').last();
  await sheet.getByRole("button", { name: /^apply now$/i }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);

  const gap = await sheet.evaluate((el) => {
    const dlg = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const btn = [...el.querySelectorAll("button")].find(
      (b) => /^apply now$/i.test((b.textContent || "").trim()),
    );
    if (!btn) return { error: "no Apply Now" } as const;
    // Measure to the ACTION ROW's bottom, not the button's. The row carries a
    // deliberate `-mb-4 pb-4` so its opaque surface runs to the sheet's own
    // padding edge and scrolled content passes UNDER it rather than through
    // it — that 16px is paint, not dead space, and measuring the button
    // instead reports it as a phantom gap.
    const row = btn.closest(".sheet-sticky-actions") ?? btn;
    const r = row.getBoundingClientRect();
    return {
      // Anything below the action row that is not the sheet's bottom padding.
      // The reserved-height version measured ~430px here.
      dead: +(dlg.bottom - parseFloat(cs.paddingBottom) - r.bottom).toFixed(1),
      // The sheet must HUG: with 1400px to play with it must not have grown
      // to fill the viewport.
      sheetHeight: +dlg.height.toFixed(1),
      vh: window.innerHeight,
      scrolls: el.scrollHeight > el.clientHeight + 1,
    };
  });
  expect(gap, JSON.stringify(gap)).not.toHaveProperty("error");
  const g = gap as { dead: number; sheetHeight: number; vh: number; scrolls: boolean };
  expect(g.dead, JSON.stringify(gap)).toBeLessThanOrEqual(4);
  // Given room, the sheet sizes to its content instead of stretching to the
  // 86dvh ceiling — and therefore does not scroll at all.
  expect(g.sheetHeight, JSON.stringify(gap)).toBeLessThan(g.vh * 0.86 - 1);
  expect(g.scrolls, JSON.stringify(gap)).toBe(false);
});

test("dismissing the sheet abandons the apply", async ({ helperPage: page }) => {
  // The pending-apply id outlives the sheet unless the close handler clears
  // it, and the standalone deep-link sheet renders on exactly that id — so a
  // stale one pops the apply form straight back up over the bare feed.
  await installSupabaseMocks(page, {
    user: FAKE_HELPER,
    rules: [
      mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
      mockRpc("get_safe_profiles", [POSTER_PROFILE]),
      mockTable("open_jobs_browse", [BASE_JOB]),
      mockTable("helper_availability", []),
      mockTable("applications", []),
      mockTable("user_blocks", []),
      mockTable("saved_jobs", []),
      mockTable("saved_searches", []),
      mockTable("reviews", []),
    ],
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard");

  const card = page.getByText(BASE_JOB.title);
  await card.waitFor({ timeout: 20_000 });
  await card.click();
  const sheet = page.locator('[role="dialog"]').last();
  await sheet.getByRole("button", { name: /^apply now$/i }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);

  // Type into the note first: abandoning has to survive a half-written pitch,
  // which is the state the stale-id bug was actually reachable from.
  await sheet.getByRole("textbox").fill("half a pitch");
  await sheet.getByRole("button", { name: /^close$/i }).click();
  await page.waitForTimeout(800);

  // Nothing is left on screen — no sheet, and crucially no resurrected
  // standalone apply form.
  expect(await page.locator('[role="dialog"],[role="alertdialog"]').count()).toBe(0);
  await expect(page.getByRole("button", { name: /^apply now$/i })).toHaveCount(0);
});
