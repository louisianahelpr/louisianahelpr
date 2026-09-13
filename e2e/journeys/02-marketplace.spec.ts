import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import {
  test,
  expect,
  assertHealthy,
  announceUncovered,
  getSession,
  newUserContext,
  payOnStripeCheckout,
  rest,
  sessionsAvailable,
  stripeModeFromCheckoutUrl,
  E2E_TITLE_MARKER,
  PNG_1PX,
  SUPABASE_URL,
  type Session,
} from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journeys 2–6 — the marketplace, as ONE serial chain on ONE job, because each
 * journey's starting state is the previous journey's outcome (you cannot hire
 * on a job nobody applied to). Every step is driven through the UI of the
 * account that would do it, in its own browser context.
 *
 *   J2 post (UI, photos) → My Posts → funded → Browse for the helper
 *   J3 apply with a message → poster sees applicant + notification → messages
 *      both ways with an attachment → react
 *   J4 hire → funded on both sides (Stripe TEST mode only; skipped on live)
 *   J5 start → before/after photos → complete → revision → resubmit →
 *      release → review both ways → tip
 *   J6 dispute open → withdraw
 *
 * BLAST RADIUS is prod-lifecycle's, kept deliberately:
 *   - ZIP 99999 (no parish) is entered, so `parish` stays null and the helper fan-out trigger
 *     returns on its first line;
 *   - the title carries E2E_TITLE_MARKER, so prod-lifecycle-sweeper.mjs
 *     unwinds anything a failed run strands (it runs before and after in CI,
 *     and in this file's afterAll);
 *   - the poster is a @mailinator seed account, so the job is is_seed.
 * ONE harness concession, identical to prod-lifecycle's and asserted: the
 * job's created_at is aged past the 20-minute free-tier early-access window
 * over REST, so the helper can see and apply to it now rather than in 20 min.
 *
 * PRICING MODES: the product has exactly one (`jobs.pricing_mode` CHECK allows
 * only 'set_price'; BudgetSection.tsx: "No pricing-mode picker"). The journey
 * posts that one and asserts no mode picker is offered.
 */

const rotation = rotationFor(1);
const RUN = `${Date.now().toString(36).slice(-6)}`;
// Title max is 32 characters in the form: marker (19) + " J " + run id.
const TITLE = `${E2E_TITLE_MARKER} J ${RUN}`;

type Shared = {
  poster: Session;
  helper: Session;
  posterCtx: BrowserContext;
  helperCtx: BrowserContext;
  posterPage: Page;
  helperPage: Page;
  jobId?: string;
  funded: boolean;
  fileDir: string;
};
const S = {} as Shared;

const ZONE = "America/Chicago";
/** A start slot `minutesAhead` from now in Louisiana time, rounded up to the form's 5-minute grid. */
function slotAhead(minutesAhead: number) {
  const t = new Date(Math.ceil((Date.now() + minutesAhead * 60_000) / 300_000) * 300_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
      .formatToParts(t)
      .map((p) => [p.type, p.value]),
  );
  return { at: t, monthDay: `${parts.month} ${parts.day}`, hour: parts.hour, minute: parts.minute, ampm: parts.dayPeriod as "AM" | "PM" };
}
const SLOT = slotAhead(100);

/** True if the locator becomes visible within `ms` (isVisible's timeout option does not wait). */
async function appears(locator: ReturnType<Page["locator"]>, ms: number) {
  return locator.first().waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);
}

async function readJob(api: APIRequestContext, session: Session, id: string) {
  const r = await api.get(
    `${SUPABASE_URL}/rest/v1/jobs?id=eq.${id}&select=id,title,status,payment_status,helper_id,parish,is_seed,created_at,stripe_session_id,helper_completed_at`,
    { headers: rest(session) },
  );
  expect(r.ok(), `reading job ${id}: ${r.status()}`).toBe(true);
  const rows = await r.json();
  expect(rows, `job ${id} not readable`).toHaveLength(1);
  return rows[0];
}


/** My Posts / My Jobs status tabs: a group of buttons behind a disclosure on phones. */
async function openStatusTab(page: Page, name: "Needs You" | "Scheduled" | "Waiting" | "Done" | "Cancelled") {
  const group = page.getByRole("group", { name: "Filter by status" });
  const show = page.getByRole("button", { name: /^Show status filters$|^Filter by status$/ });
  await expect(group.or(show).first(), "the status filter never rendered").toBeVisible({ timeout: 30_000 });
  if (!(await group.isVisible())) await show.first().click();
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
  await expect(group.getByRole("button", { name: new RegExp(`^${name}\\b`) })).toHaveAttribute("aria-pressed", "true");
}

function title(journey: string, outcome: "smooth" | "revision" | "disputed", persona: "poster-only" | "helper-only" | "both" = "both") {
  return scenarioTitle({ journey, persona, state: "approved", rotation, jobType: "set-price", outcome });
}

test.describe.serial("marketplace chain", () => {
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);

  test.beforeAll(async ({ browser, request }) => {
    S.poster = await getSession(request, "poster");
    S.helper = await getSession(request, "helper");
    expect(S.poster.user.id).not.toBe(S.helper.user.id);
    S.posterCtx = await newUserContext(browser, S.poster, { rotation, timezoneId: ZONE });
    S.helperCtx = await newUserContext(browser, S.helper, { rotation, timezoneId: ZONE });
    S.posterPage = await S.posterCtx.newPage();
    S.helperPage = await S.helperCtx.newPage();
    S.fileDir = mkdtempSync(join(tmpdir(), "lh-journey-"));
    writeFileSync(join(S.fileDir, "job-photo.png"), PNG_1PX);
    writeFileSync(join(S.fileDir, "attachment.png"), PNG_1PX);
    S.funded = false;
  });

  test.afterAll(async ({ request }) => {
    // Unwind with the same sweeper CI runs (poster-only token, never service-role).
    if (S.jobId) {
      try {
        const job = await readJob(request, S.poster, S.jobId);
        if (!["released", "payout_pending", "refunded"].includes(job.payment_status) && job.status !== "cancelled") {
          if (job.payment_status !== "unpaid") {
            await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
              headers: rest(S.poster),
              data: { action: "cancel_escrow", jobId: S.jobId },
            });
          } else {
            await request.post(`${SUPABASE_URL}/rest/v1/rpc/poster_cancel_job`, {
              headers: rest(S.poster),
              data: { p_job_id: S.jobId, p_reason: "E2E journey teardown" },
            });
          }
        }
      } catch (err) {
        // Not silent: announced. The CI sweeper runs after the suite as the backstop.
        announceUncovered("Journey job not unwound", `${S.jobId}: ${String(err).slice(0, 200)}`);
      }
    }
    await S.posterCtx?.close();
    await S.helperCtx?.close();
  });

  const j2 = title("post", "smooth", "poster-only");
  test(j2, async ({ request, journey }) => {
    test.skip(filteredOut(j2), "SCENARIO pins another scenario");
    const page = journey.track("poster", S.posterPage);
    journey.track("helper", S.helperPage);

    await test.step("poster opens Post a Job and starts fresh", async () => {
      await page.goto("/post-job");
      await page.getByRole("button", { name: /Start Fresh/ }).click();
      await expect(page.getByRole("heading", { name: "Job Details", level: 1 })).toBeVisible({ timeout: 30_000 });
      await assertHealthy(page, "post-job form");
      expect(await page.getByText(/pricing mode|accept bids|open to offers/i).count(), "a pricing-mode picker reappeared; add each mode to this journey").toBe(0);
    });

    await test.step("fills details with a photo", async () => {
      await page.getByRole("button", { name: "Cleaning", exact: true }).click();
      await page.getByRole("textbox", { name: "Job title *" }).fill(TITLE);
      await page.getByRole("textbox", { name: "Description *" }).fill(
        "Automated journey test. Not a real job; created and removed by the test suite. Please ignore.",
      );
      await page.locator("input[type=file][accept='image/*']").first().setInputFiles(join(S.fileDir, "job-photo.png"));
      await expect(page.getByRole("button", { name: "Remove photo" }).first(), "the chosen photo never appeared in the form").toBeVisible({ timeout: 30_000 });
      await journey.milestone(page, "post-details-photo");
    });

    await test.step("fills logistics with a parish-less ZIP and a date", async () => {
      await page.getByRole("combobox", { name: "Street address" }).fill("100 Audit Way");
      await page.keyboard.press("Escape");
      await page.getByRole("combobox", { name: "City" }).fill("Baton Rouge");
      await page.keyboard.press("Escape");
      // ZIP is required, and a Louisiana ZIP derives a parish, which fires the
      // helper fan-out. 99999 resolves to no parish (get_parish_for_zip -> null),
      // so the job is posted with parish null, the same guard prod-lifecycle uses.
      journey.allowReport(/ZIP 99999 resolved to no Louisiana parish/, "deliberate: keeps parish null so no real helper is notified");
      await page.getByRole("textbox", { name: "ZIP code" }).fill("99999");
      await page.getByRole("button", { name: /Date needed/ }).click();
      // Soon, not days out: the day-of confirm opens inside 24h and the
      // tracker's actions unlock at T-2h, so J5 can walk the whole job now.
      const slot = SLOT;
      const cell = page.getByRole("button", { name: new RegExp(slot.monthDay.replace(" ", ".*")) }).or(page.getByRole("gridcell", { name: new RegExp(slot.monthDay.replace(" ", ".*")) })).first();
      await cell.click();
      await page.getByRole("listbox", { name: "Hour" }).getByRole("option", { name: slot.hour, exact: true }).click();
      await page.getByRole("listbox", { name: "Minute" }).getByRole("option", { name: slot.minute, exact: true }).click();
      await page.getByRole("radiogroup", { name: "AM or PM" }).getByRole("radio", { name: slot.ampm }).click();
      await assertHealthy(page, "logistics");
    });

    await test.step("sets a budget and reviews", async () => {
      await page.getByRole("textbox", { name: "Job budget in dollars" }).fill("25");
      const review = page.getByRole("button", { name: /Review & Pay/ });
      await expect(review, "the submit button never became Review & Pay").toBeEnabled({ timeout: 20_000 });
      await journey.milestone(page, "post-form-complete");
      await review.click();
      await expect(page.getByText(/Payment breakdown/i)).toBeVisible({ timeout: 30_000 });
      await assertHealthy(page, "checkout step");
      await journey.milestone(page, "post-checkout-step");
    });

    await test.step("continues to payment; the job exists with parish null", async () => {
      await page.getByRole("checkbox", { name: /reviewed all details/i }).click();
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/functions/v1/create-payment") && r.request().method() === "POST", { timeout: 60_000 }),
        page.getByRole("button", { name: /Continue to Payment|Post Job/i }).click(),
      ]);
      const body = await resp.json().catch(() => ({}));
      const jobs = await request.get(
        `${SUPABASE_URL}/rest/v1/jobs?customer_id=eq.${S.poster.user.id}&title=eq.${encodeURIComponent(TITLE)}&select=id`,
        { headers: rest(S.poster) },
      );
      const rows = (await jobs.json()) as Array<{ id: string }>;
      expect(rows, "the posted job was not created exactly once").toHaveLength(1);
      S.jobId = rows[0].id;
      const job = await readJob(request, S.poster, S.jobId);
      expect(job.parish, "parish must stay null or the helper fan-out fires").toBeNull();
      expect(job.is_seed).toBe(true);

      const url = String((body as { url?: string }).url ?? page.url());
      const mode = stripeModeFromCheckoutUrl(url);
      if (mode !== "test") {
        announceUncovered("Journey funding SKIPPED", `Stripe mode is ${mode}; J2 Browse visibility, J4 and J5 money legs cannot run without charging a real card.`);
        test.info().annotations.push({ type: "uncovered", description: `Stripe ${mode} mode: funding skipped` });
        return;
      }
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
      await journey.milestone(page, "stripe-checkout");
      await payOnStripeCheckout(page);
      await expect
        .poll(async () => (await readJob(request, S.poster, S.jobId!)).payment_status, { timeout: 90_000, message: "the webhook never funded the job" })
        .toBe("escrow");
      S.funded = true;
      await assertHealthy(page, "return from Stripe", { settleMs: 30_000 });
      await journey.milestone(page, "payment-return");
    });

    await test.step("poster sees the job in My Posts", async () => {
      await page.goto("/my-posts");
      // A just-posted, funded, unapplied job is in the "Waiting" bucket; My Posts
      // opens on "Needs You" (activityConstants.defaultStatusFilterFor).
      await openStatusTab(page, "Waiting");
      await expect(page.getByText(TITLE).first(), "the new job is missing from My Posts > Waiting").toBeVisible({ timeout: 60_000 });
      await assertHealthy(page, "my posts");
      await journey.milestone(page, "my-posts");
    });

    await test.step("helper finds it in Browse", async () => {
      test.skip(!S.funded, "unfunded jobs are not in Browse by design (payment_status gate)");
      // Harness concession (prod-lifecycle's): age past the 20-min early-access window.
      const aged = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${S.jobId}`, {
        headers: rest(S.poster, { Prefer: "return=representation" }),
        data: { created_at: new Date(Date.now() - 25 * 60_000).toISOString() },
      });
      expect(await aged.json(), "ageing the job matched zero rows").toHaveLength(1);
      const hp = S.helperPage;
      await hp.goto("/dashboard");
      await hp.getByRole("button", { name: "Search jobs" }).first().click();
      await hp.getByRole("searchbox", { name: "Search jobs" }).fill(RUN);
      await expect(hp.getByRole("button", { name: new RegExp(`View .*${RUN}`) }), "the helper cannot find the funded job in Browse").toBeVisible({ timeout: 60_000 });
      await assertHealthy(hp, "helper browse finds job");
      await journey.milestone(hp, "helper-browse-finds-job");
    });
  });

  const j3 = title("apply", "smooth");
  test(j3, async ({ request, journey }) => {
    test.skip(filteredOut(j3), "SCENARIO pins another scenario");
    test.skip(!S.jobId, "J2 did not create a job");
    test.skip(!S.funded, "unfunded jobs cannot be found or applied to (Stripe not in test mode); announced in J2");
    const hp = journey.track("helper", S.helperPage);
    const pp = journey.track("poster", S.posterPage);
    const NOTE = `Journey note ${RUN}: I can do this one.`;

    await test.step("helper opens the job and applies with a note", async () => {
      await hp.goto("/dashboard");
      await hp.getByRole("button", { name: "Search jobs" }).first().click();
      await hp.getByRole("searchbox", { name: "Search jobs" }).fill(RUN);
      await hp.getByRole("button", { name: new RegExp(`View .*${RUN}`) }).click();
      const dialog = hp.getByRole("dialog").first();
      await expect(dialog.getByRole("button", { name: "Apply Now" })).toBeVisible({ timeout: 30_000 });
      await dialog.getByRole("textbox").first().fill(NOTE);
      await journey.milestone(hp, "apply-dialog-filled");
      await dialog.getByRole("button", { name: "Apply Now" }).click();
      await expect
        .poll(
          async () => {
            const r = await request.get(
              `${SUPABASE_URL}/rest/v1/applications?job_id=eq.${S.jobId}&helper_id=eq.${S.helper.user.id}&select=id,status,message`,
              { headers: rest(S.helper) },
            );
            return ((await r.json()) as Array<{ status: string; message: string }>)[0]?.status ?? "none";
          },
          { timeout: 30_000, message: "the application row never appeared" },
        )
        .toBe("pending");
      await expect(hp.getByText(/applied|application sent|you're in/i).first(), "no visible confirmation after applying").toBeVisible({ timeout: 30_000 });
      await assertHealthy(hp, "after apply");
      await journey.milestone(hp, "applied");
    });

    await test.step("helper sees the application in My Jobs", async () => {
      await hp.goto("/my-jobs");
      await openStatusTab(hp, "Waiting");
      await expect(hp.getByText(TITLE).first(), "the applied job is missing from the helper's My Jobs").toBeVisible({ timeout: 30_000 });
      await assertHealthy(hp, "helper my jobs");
      await journey.milestone(hp, "helper-my-jobs-applied");
    });

    await test.step("poster gets a notification for the application", async () => {
      await pp.goto("/dashboard");
      await pp.getByRole("button", { name: "Notifications" }).first().click();
      await expect(pp.getByText(new RegExp(`(applied|application).*${RUN}|${RUN}.*(applied|application)`, "i")).first(), "no notification about the application").toBeVisible({ timeout: 60_000 });
      await assertHealthy(pp, "notifications");
      await journey.milestone(pp, "poster-notification");
      await pp.keyboard.press("Escape");
    });

    await test.step("poster sees the applicant with the note", async () => {
      await pp.goto("/my-posts");
      await openStatusTab(pp, "Needs You");
      await expect(pp.getByText(TITLE).first(), "the job with an applicant is not in My Posts > Needs You").toBeVisible({ timeout: 60_000 });
      await pp.getByText(TITLE).first().click();
      await pp.getByRole("button", { name: "Applicants (1)" }).first().click();
      const panel = pp.getByRole("region", { name: new RegExp(`Applicants for`) }).or(pp.getByRole("dialog")).first();
      await expect(panel.getByRole("button", { name: /^Select / }).first(), "no Hire button for the applicant").toBeVisible({ timeout: 30_000 });
      await expect(panel.getByText(NOTE).first(), "the applicant's note is not shown to the poster").toBeVisible();
      await assertHealthy(pp, "applicants panel");
      await journey.milestone(pp, "applicants-panel");
    });
  });

  const j4 = title("hire-and-message", "smooth");
  test(j4, async ({ request, journey }) => {
    test.skip(filteredOut(j4), "SCENARIO pins another scenario");
    test.skip(!S.jobId || !S.funded, "needs J2's funded job and J3's application");
    const hp = journey.track("helper", S.helperPage);
    const pp = journey.track("poster", S.posterPage);

    await test.step("poster hires the applicant", async () => {
      const panel = pp.getByRole("region", { name: /Applicants for/ }).or(pp.getByRole("dialog")).first();
      if (!(await panel.getByRole("button", { name: /^Select / }).first().isVisible().catch(() => false))) {
        await pp.goto("/my-posts");
        await openStatusTab(pp, "Needs You");
        await pp.getByText(TITLE).first().click();
        await pp.getByRole("button", { name: "Applicants (1)" }).first().click();
      }
      await panel.getByRole("button", { name: /^Select / }).first().click();
      // Hiring is an OFFER with a response deadline; the helper then accepts.
      await expect(pp.getByRole("heading", { name: "Set a Response Deadline" })).toBeVisible({ timeout: 20_000 });
      await pp.getByPlaceholder(/Say something to/).fill(`Offer for ${RUN}: see you Tuesday.`);
      await journey.milestone(pp, "offer-sheet");
      await pp.getByRole("button", { name: "Send Offer" }).click();
      await expect(pp.getByRole("heading", { name: "Set a Response Deadline" })).toBeHidden({ timeout: 20_000 });
      await assertHealthy(pp, "offer sent");
      await journey.milestone(pp, "offer-sent");
    });

    await test.step("helper accepts the offer", async () => {
      await hp.goto("/my-jobs");
      await openStatusTab(hp, "Needs You");
      await expect(hp.getByText(TITLE).first(), "the offer is not in the helper's Needs You").toBeVisible({ timeout: 60_000 });
      await hp.getByText(TITLE).first().click();
      await journey.milestone(hp, "helper-sees-offer");
      await hp.getByRole("button", { name: /^Accept/ }).first().click();
      const confirm = hp.getByRole("alertdialog").or(hp.getByRole("dialog")).getByRole("button", { name: /accept|confirm|yes/i }).last();
      if (await appears(confirm, 5_000)) await confirm.click();
      await expect
        .poll(async () => (await readJob(request, S.poster, S.jobId!)).helper_id, { timeout: 30_000, message: "hire never set helper_id" })
        .toBe(S.helper.user.id);
      await assertHealthy(hp, "after accepting");
      await journey.milestone(hp, "offer-accepted");
    });

    await test.step("the job shows as funded and hired on both sides", async () => {
      const job = await readJob(request, S.poster, S.jobId!);
      expect(job.payment_status).toBe("escrow");
      await pp.goto("/my-posts");
      await openStatusTab(pp, "Scheduled");
      await expect(pp.getByText(TITLE).first(), "the hired job is not in the poster's Scheduled tab").toBeVisible({ timeout: 30_000 });
      await pp.getByText(TITLE).first().click();
      const posterMoney = await pp.getByText(/held|funded|secured|escrow|protected|paid/i).filter({ visible: true }).count();
      test.info().annotations.push({ type: "funded-indicator", description: `poster Scheduled card money copy matches: ${posterMoney}` });
      await journey.milestone(pp, "poster-scheduled-funded");
      await hp.goto("/my-jobs");
      await openStatusTab(hp, "Scheduled");
      await expect(hp.getByText(TITLE).first(), "the hired job is not in the helper's Scheduled tab").toBeVisible({ timeout: 30_000 });
      await hp.getByText(TITLE).first().click();
      const helperMoney = await hp.getByText(/held|funded|secured|escrow|protected|guaranteed/i).filter({ visible: true }).count();
      test.info().annotations.push({ type: "funded-indicator", description: `helper Scheduled card money copy matches: ${helperMoney}` });
      await assertHealthy(hp, "helper scheduled");
      await journey.milestone(hp, "helper-scheduled-funded");
    });

    await test.step("poster messages the helper with an attachment", async () => {
      await pp.goto("/my-posts");
      await openStatusTab(pp, "Scheduled");
      await pp.getByText(TITLE).first().click();
      await pp.getByRole("button", { name: "Message Helpr" }).first().click();
      await expect(pp).toHaveURL(/\/messages/, { timeout: 30_000 });
      const box = pp.getByRole("textbox", { name: "Type a message" });
      await expect(box).toBeVisible({ timeout: 30_000 });
      await pp.locator("input[type=file]").first().setInputFiles(join(S.fileDir, "attachment.png"));
      await expect(pp.getByRole("button", { name: "Remove attachment" })).toBeVisible({ timeout: 20_000 });
      await box.fill(`Poster hello ${RUN}`);
      await box.press("Enter");
      await expect(pp.getByText(`Poster hello ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
      await expect(pp.locator("img[src*='message-attachments'], img[alt*='attachment' i]").first(), "the attachment did not render in the thread").toBeVisible({ timeout: 30_000 });
      await assertHealthy(pp, "poster thread");
      await journey.milestone(pp, "poster-message-attachment");
    });

    await test.step("helper receives it, replies, and reacts", async () => {
      await hp.goto("/messages");
      await hp.getByText(new RegExp(`Poster hello ${RUN}|${RUN}`)).first().click();
      await expect(hp.getByText(`Poster hello ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
      const box = hp.getByRole("textbox", { name: "Type a message" });
      await box.fill(`Helper reply ${RUN}`);
      await box.press("Enter");
      await expect(hp.getByText(`Helper reply ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
      const bubble = hp.locator("[data-msg-id]").filter({ hasText: `Poster hello ${RUN}` }).first().locator(":scope > div").first();
      // Long-press opens the message action sheet (useLongPress).
      const bb = (await bubble.boundingBox())!;
      await hp.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await hp.mouse.down();
      await hp.waitForTimeout(900);
      await journey.milestone(hp, "message-long-press-held");
      await hp.mouse.up();
      await journey.milestone(hp, "message-action-sheet");
      await hp.getByRole("button", { name: /^React with / }).first().click();
      await expect(hp.getByRole("button", { name: /^Remove your .* reaction/ }).first(), "the reaction did not stick on the message").toBeVisible({ timeout: 20_000 });
      await assertHealthy(hp, "helper thread");
      await journey.milestone(hp, "helper-reply-react");
    });

    await test.step("poster sees the reply and the reaction", async () => {
      await expect(pp.getByText(`Helper reply ${RUN}`).first(), "the helper's reply never reached the poster").toBeVisible({ timeout: 60_000 });
      await expect(pp.getByRole("button", { name: /^React with |reaction/ }).first(), "the helper's reaction is not shown to the poster").toBeVisible({ timeout: 60_000 });
      await journey.milestone(pp, "poster-sees-reply");
    });

    await test.step("poster pins the conversation (swipe right)", async () => {
      await pp.goto("/messages");
      const title = pp.getByText(TITLE).first();
      await expect(title, "the job conversation is missing from the poster's inbox").toBeVisible({ timeout: 30_000 });
      // The swipeable row: innermost element holding both the job title and its Pin/Unpin trail.
      const row = pp.locator("div").filter({ has: title }).filter({ has: pp.getByText(/^(Pin|Unpin)$/) }).last();
      await expect(row.getByText("Pin", { exact: true }), "the conversation started out pinned").toHaveCount(1);
      const box = (await title.boundingBox())!;
      await pp.mouse.move(box.x + 10, box.y + box.height / 2);
      await pp.mouse.down();
      await pp.mouse.move(box.x + 180, box.y + box.height / 2, { steps: 15 });
      await pp.mouse.up();
      await expect(row.getByText("Unpin", { exact: true }), "a right swipe past the threshold did not pin the conversation").toHaveCount(1, { timeout: 10_000 });
      await expect(pp.getByRole("heading", { name: /Hide This Conversation/ }), "the pin swipe opened the archive dialog").toHaveCount(0);
      await assertHealthy(pp, "inbox after pin");
      await journey.milestone(pp, "pinned");
      // Pins are per-device (src/lib/pinnedConversations); swipe back so the shared account is left as found.
      const b2 = (await title.boundingBox())!;
      await pp.mouse.move(b2.x + 10, b2.y + b2.height / 2);
      await pp.mouse.down();
      await pp.mouse.move(b2.x + 180, b2.y + b2.height / 2, { steps: 15 });
      await pp.mouse.up();
      await expect(row.getByText("Pin", { exact: true })).toHaveCount(1, { timeout: 10_000 });
    });
  });

  /** The in-app location rationale; this journey's helper always says Not Now. */
  async function declineLocation(page: Page) {
    const notNow = page.getByRole("button", { name: "Not Now" });
    for (let i = 0; i < 3 && (await page.getByRole("button", { name: "Share Location" }).isVisible().catch(() => false)); i++) {
      await notNow.first().click();
      await page.waitForTimeout(500);
    }
  }

  /** Open this run's card on a tab and return it. */
  async function card(page: Page, path: "/my-posts" | "/my-jobs", tab: "Needs You" | "Scheduled" | "Waiting" | "Done", reload = true) {
    if (reload) await page.goto(path);
    await page.waitForTimeout(1_500);
    await declineLocation(page);
    const heading = page.getByRole("heading", { name: TITLE, level: 2 });
    // The expected tab first; the job's bucket is recorded when it is elsewhere,
    // because which tab a job sits in is itself something a user relies on.
    const order = [tab, ...(["Needs You", "Scheduled", "Waiting", "Done"] as const).filter((t) => t !== tab)];
    let found = "";
    for (const t of order) {
      await openStatusTab(page, t);
      if (await appears(heading, t === tab ? 15_000 : 5_000)) {
        found = t;
        break;
      }
    }
    expect(found, `${TITLE} is on no ${path} tab`).not.toBe("");
    if (found !== tab) test.info().annotations.push({ type: "bucket", description: `${path}: expected ${tab}, found ${found}` });
    const c = page.locator("div.liquid-glass").filter({ has: heading }).last();
    if (!(await c.getByRole("group", { name: /Job progress/ }).isVisible().catch(() => false))) await heading.click();
    return c;
  }

  /** Press a visible control by name, then prove the screen is not an error. */
  async function press(page: Page, scope: ReturnType<Page["locator"]>, name: RegExp, where: string) {
    const btn = scope.getByRole("button", { name }).first();
    await expect(btn, `${where}: no "${name}" control`).toBeVisible({ timeout: 45_000 });
    await btn.click();
    await page.waitForTimeout(1_000);
    await declineLocation(page);
    await assertHealthy(page, where);
  }

  const j5 = title("do-the-job", "revision");
  test(j5, async ({ request, journey }) => {
    test.setTimeout(12 * 60_000);
    test.skip(filteredOut(j5), "SCENARIO pins another scenario");
    test.skip(!S.jobId || !S.funded, "needs J4's hired, funded job");
    const hp = journey.track("helper", S.helperPage);
    const pp = journey.track("poster", S.posterPage);

    await test.step("day-of confirm, where the app asks for it", async () => {
      // Inside T-2h the tracker skips the day-before "Still on?" and offers
      // "I'm On My Way" directly; the journey follows whichever the app shows.
      const c = await card(hp, "/my-jobs", "Scheduled");
      const stillOn = c.getByRole("button", { name: /I'm Still On/ });
      const onWay = c.getByRole("button", { name: /I'm On My Way/ });
      await expect(stillOn.or(onWay).first(), "the helper card offers neither Still On nor On My Way").toBeVisible({ timeout: 45_000 });
      if (await stillOn.isVisible()) {
        await stillOn.click();
        const yes = hp.getByRole("button", { name: /Yes, I Confirm/ });
        if (await appears(yes, 5_000)) await yes.click();
        const pc = await card(pp, "/my-posts", "Needs You");
        await press(pp, pc, /Confirm This Job/, "poster confirm");
      } else {
        test.info().annotations.push({ type: "path", description: "inside T-2h: no day-of confirm step offered" });
      }
      await journey.milestone(hp, "helper-ready-to-go");
    });

    await test.step("helper heads over and arrives; poster confirms arrival", async () => {
      let c = await card(hp, "/my-jobs", "Scheduled", false);
      await press(hp, c, /I'm On My Way/, "on my way");
      // The location rationale: this helper declines, so arrival goes down the
      // poster-confirms branch (the one a phone without GPS takes).
      if (await appears(hp.getByRole("button", { name: "Share Location" }), 8_000)) {
        await journey.milestone(hp, "location-rationale");
        await declineLocation(hp);
      }
      await journey.milestone(hp, "on-my-way");
      c = await card(hp, "/my-jobs", "Scheduled", false);
      await press(hp, c, /I've Arrived/, "arrived");
      await journey.milestone(hp, "arrived-no-gps");
      c = await card(pp, "/my-posts", "Needs You");
      await press(pp, c, /Confirm They Arrived/, "poster confirms arrival");
      await journey.milestone(pp, "poster-confirmed-arrival");
    });

    await test.step("helper works the job: before photo, start, after photo, request payout", async () => {
      // The card shows ONE next thing at a time; follow it the way a helper does.
      // Harness concession (prod-lifecycle's): the payout request unlocks 30 min
      // after arrival, so both arrival stamps are backdated rather than waited on.
      for (const [who, col] of [[S.helper, "helper_arrived_at"], [S.poster, "poster_confirmed_arrival_at"]] as const) {
        const r = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${S.jobId}`, {
          headers: rest(who, { Prefer: "return=representation" }),
          data: { [col]: new Date(Date.now() - 40 * 60_000).toISOString() },
        });
        expect(r.ok(), `backdating ${col}: ${r.status()} ${await r.text()}`).toBe(true);
      }
      const seen: string[] = [];
      for (let i = 0; i < 8; i++) {
        const c = await card(hp, "/my-jobs", "Needs You");
        const before = c.getByText("Add a before photo", { exact: true });
        const after = c.getByText("Add an after photo", { exact: true });
        const start = c.getByRole("button", { name: /^Start Working$/ });
        const payout = c.getByRole("button", { name: /^Request My Payout$/ });
        await expect(before.or(after).or(start).or(payout).first(), `helper card offers no next step (so far: ${seen.join(" > ")})`).toBeVisible({ timeout: 45_000 });
        if (await before.isVisible() || await after.isVisible()) {
          const label = (await before.isVisible()) ? "Before" : "After";
          seen.push(`${label} photo`);
          await c.getByRole("button", { name: /^Add Photo$/ }).click();
          const dialog = hp.getByRole("dialog").filter({ hasText: `${label} photos` });
          await expect(dialog).toBeVisible();
          await dialog.locator('input[type="file"]').setInputFiles(join(S.fileDir, "job-photo.png"));
          await dialog.getByRole("button", { name: "Upload" }).click();
          await expect(dialog, `${label} photo dialog never closed`).toBeHidden({ timeout: 45_000 });
          await expect(
            c.getByText(label === "Before" ? "Add a before photo" : "Add an after photo", { exact: true }),
            `the ${label.toLowerCase()} photo ask is still on the card 30s after the upload dialog closed`,
          ).toBeHidden({ timeout: 30_000 });
          await assertHealthy(hp, `${label} photo`);
          await journey.milestone(hp, `${label.toLowerCase()}-photo-uploaded`);
        } else if (await start.isVisible()) {
          seen.push("Start Working");
          await start.click();
          // Start Working asks for location while it saves; decline, then let the save land.
          await hp.getByRole("button", { name: "Share Location" }).waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
          await declineLocation(hp);
          await expect(c.getByText(/Saving your update/), "Start Working never finished saving").toBeHidden({ timeout: 45_000 });
          await expect(c.getByRole("button", { name: /^Start Working$/ }), "Start Working did not advance the tracker").toBeHidden({ timeout: 45_000 });
          await assertHealthy(hp, "start working");
          await journey.milestone(hp, "working");
        } else {
          seen.push("Request My Payout");
          const payoutButtons = await c.getByRole("button", { name: /Request (My )?Payout/ }).count();
          test.info().annotations.push({ type: "payout-cta-count", description: String(payoutButtons) });
          await payout.click();
          const yes = hp.getByRole("button", { name: "Yes, I'm Done" });
          await expect(yes, "Request My Payout opened no confirmation").toBeVisible({ timeout: 15_000 });
          await journey.milestone(hp, "request-payout-confirm");
          await yes.click();
          await expect(yes).toBeHidden({ timeout: 30_000 });
          break;
        }
      }
      test.info().annotations.push({ type: "helper-path", description: seen.join(" > ") });
      await expect.poll(async () => Boolean((await readJob(request, S.poster, S.jobId!)).helper_completed_at), { timeout: 30_000, message: `completion never recorded (path: ${seen.join(" > ")})` }).toBe(true);
      await expect(hp.getByText(/Waiting for the poster to approve|Marked Complete/).first()).toBeVisible({ timeout: 45_000 });
      await journey.milestone(hp, "submitted");
    });

    await test.step("poster requests a revision", async () => {
      const c = await card(pp, "/my-posts", "Needs You");
      await press(pp, c, /Request Revision/, "request revision");
      await pp.getByRole("textbox", { name: /Describe what needs to be redone|Revision request details/ }).first().fill(`Journey ${RUN}: please redo the corner.`);
      await journey.milestone(pp, "revision-sheet");
      await pp.getByRole("dialog").getByRole("button", { name: /Request Revision|Send/ }).last().click();
      await expect.poll(async () => (await readJob(request, S.poster, S.jobId!)).status, { timeout: 30_000 }).toBe("revision_requested");
      await journey.milestone(pp, "revision-requested");
    });

    await test.step("helper sees the note and resubmits", async () => {
      const c = await card(hp, "/my-jobs", "Needs You");
      await expect(c.getByText(`Journey ${RUN}: please redo the corner.`), "the helper never sees the revision note").toBeVisible({ timeout: 45_000 });
      await press(hp, c, /I'll Fix It/, "acknowledge revision");
      const c2 = await card(hp, "/my-jobs", "Needs You", false);
      await press(hp, c2, /Mark Fixed/, "mark fixed");
      const yes = hp.getByRole("dialog").getByRole("button", { name: /Mark Fixed|Yes|Confirm/ }).last();
      if (await appears(yes, 5_000)) await yes.click();
      await journey.milestone(hp, "resubmitted");
    });

    await test.step("poster approves and releases the payment", async () => {
      const c = await card(pp, "/my-posts", "Needs You");
      await press(pp, c, /Approve & release payment|Release Payment|Approve/, "approve");
      const confirm = pp.getByRole("dialog").filter({ hasText: /Release the payment\?/ });
      if (await appears(confirm, 5_000)) {
        await journey.milestone(pp, "release-confirm");
        await confirm.getByRole("button", { name: /Release|Approve|Yes/ }).last().click();
      }
      await expect
        .poll(async () => (await readJob(request, S.poster, S.jobId!)).payment_status, { timeout: 90_000, message: "release never settled" })
        .toMatch(/^(payout_pending|released)$/);
      await assertHealthy(pp, "after release");
      await journey.milestone(pp, "released");
    });

    await test.step("poster reviews the helper and tips", async () => {
      const c = await card(pp, "/my-posts", "Done");
      const review = pp.getByRole("dialog").filter({ hasText: "How Did It Go?" });
      if (!(await review.isVisible().catch(() => false))) await press(pp, c, /^Review$/, "poster review");
      await expect(review).toBeVisible({ timeout: 30_000 });
      await review.getByRole("radio", { name: /5/ }).or(review.getByRole("button", { name: /5 stars?/i })).first().click();
      await review.getByRole("textbox").first().fill(`Journey ${RUN}: great work.`);
      await journey.milestone(pp, "poster-review");
      await review.getByRole("button", { name: /Submit|Post Review|Send/ }).last().click();
      await expect(review).toBeHidden({ timeout: 30_000 });
      const c2 = await card(pp, "/my-posts", "Done");
      await expect(c2.getByRole("button", { name: /Reviewed/ }).or(c2.getByText("Reviewed")).first()).toBeVisible({ timeout: 30_000 });
      await press(pp, c2, /^Tip$/, "tip");
      await journey.milestone(pp, "tip-sheet");
    });

    await test.step("helper reviews the poster", async () => {
      const c = await card(hp, "/my-jobs", "Done");
      await press(hp, c, /Leave a review for the poster|Review Poster/, "helper review");
      const review = hp.getByRole("dialog").filter({ hasText: "How Did It Go?" });
      await expect(review).toBeVisible({ timeout: 30_000 });
      await review.getByRole("radio", { name: /5/ }).or(review.getByRole("button", { name: /5 stars?/i })).first().click();
      await review.getByRole("textbox").first().fill(`Journey ${RUN}: clear instructions.`);
      await review.getByRole("button", { name: /Submit|Post Review|Send/ }).last().click();
      await expect(review).toBeHidden({ timeout: 30_000 });
      await journey.milestone(hp, "helper-review");
    });
  });
});
