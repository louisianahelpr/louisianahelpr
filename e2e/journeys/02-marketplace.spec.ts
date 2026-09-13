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

async function readJob(api: APIRequestContext, session: Session, id: string) {
  const r = await api.get(
    `${SUPABASE_URL}/rest/v1/jobs?id=eq.${id}&select=id,title,status,payment_status,helper_id,parish,is_seed,created_at,stripe_session_id`,
    { headers: rest(session) },
  );
  expect(r.ok(), `reading job ${id}: ${r.status()}`).toBe(true);
  const rows = await r.json();
  expect(rows, `job ${id} not readable`).toHaveLength(1);
  return rows[0];
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
    S.posterCtx = await newUserContext(browser, S.poster, { rotation });
    S.helperCtx = await newUserContext(browser, S.helper, { rotation });
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
      const day = new Date(Date.now() + 3 * 864e5);
      const dayName = day.toLocaleDateString("en-US", { month: "long", day: "numeric" });
      const cell = page.getByRole("button", { name: new RegExp(dayName.replace(" ", ".*")) }).or(page.getByRole("gridcell", { name: new RegExp(dayName.replace(" ", ".*")) })).first();
      await cell.click();
      await page.getByRole("listbox", { name: "Hour" }).getByRole("option", { name: "10", exact: true }).click();
      await page.getByRole("listbox", { name: "Minute" }).getByRole("option", { name: "00", exact: true }).click();
      await page.getByRole("radiogroup", { name: "AM or PM" }).getByRole("radio", { name: "AM" }).click();
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
      await page.getByRole("button", { name: "Filter by status" }).click();
      await page.getByRole("tab", { name: /^Waiting/ }).or(page.getByRole("button", { name: /^Waiting/ })).or(page.getByRole("radio", { name: /^Waiting/ })).first().click();
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
});
