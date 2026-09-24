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
  ANON,
  E2E_TITLE_MARKER,
  PNG_1PX,
  SUPABASE_URL,
  type Session,
} from "./fixtures";
// The teardown's third disposition, shared with scripts/e2e/settle-stranded-escrow.mjs.
import { isSettleForwardRefusal, settleJobForward } from "../../scripts/e2e/settleForward.mjs";
import { isoDayIn } from "../calendarPicker";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";
import { ZONE, fillJobDetails, fillLogistics, fillBudget, slotAhead } from "./postJobForm";

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
 *
 * ── Shown able to fail ────────────────────────────────────────────────────
 * THE MUTATION HAS TO KILL IN J2, BEFORE THE STRIPE LEG, and that is a
 * constraint the rest of this file's shape imposes. `describe.serial` means a
 * kill in J2 SKIPS J3-J5, so the mutated half of a scoring funds nothing and
 * strands nothing; a mutation that only bit later would fund a real test-mode
 * escrow on every scoring, and `vacuity:all` runs weekly.
 *
 * So: the MIME allowlist on the post-job photo picker
 * (`useJobMediaUpload.handleImageSelect`). Dropping `image/png` from it makes
 * `safeFiles` empty for this journey's 1×1 PNG, and the only trace is a toast —
 * `imageFiles` never grows, no preview is created, and "the chosen photo never
 * appeared in the form" fails 30 seconds later, in the second step, with no job
 * row written and no card charged.
 *
 * It is also the right thing to pin here rather than anywhere else: that
 * allowlist is the whole gate between a poster's photo and a silent refusal,
 * and this journey is the ONLY check in the repo that drives a real image file
 * through the real picker, through compression, into storage and back out onto
 * a card. A type quietly dropped from that Set would refuse a large share of
 * what people attach, with nothing in CI to say so.
 */
// @mutate src/pages/postjob/useJobMediaUpload.ts | new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]) | new Set(["image/jpeg", "image/webp", "image/gif"])

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

/** ZONE, slotAhead and pickStartTime live in ./postJobForm (shared with e2e/slow-network, Q68). */
/*
 * 100 MINUTES — THE ONE NUMBER THE WHOLE CHAIN CAN LIVE WITH — AND THE BUCKET
 * IS DERIVED FROM IT RATHER THAN PINNED BESIDE IT.
 *
 * Three days of red on this file were all one mistake in two directions:
 * treating the slot as a free choice and the tab names as constants.
 *
 *  - `slotAhead` takes MINUTES, so `slotAhead(100)` posts for TODAY, and the
 *    owner's 2026-09-19 reorder (`bucketFor` / `appliedActivityBucket`, via
 *    `jobIsLive`) files a job whose day has ARRIVED under "Needs You" on both
 *    sides. The Waiting/Scheduled assertions were asserting the pre-reorder
 *    rule, and J2 went red on "the new job is missing from My Posts > Waiting".
 *  - Moving the slot out to two days, then to one, satisfied those assertions
 *    and broke J5 instead, because the helper's ladder is LOCKED until two
 *    hours before the start: `JobTracking`'s `isLocked` is
 *    `Date.now() < startAt - 2h` whenever `jobs.start_time` exists. At 24h out
 *    the card renders "I'm On My Way" DISABLED under the caption "Actions
 *    unlock at 9:40 PM on Sep 22" — visible, so `toBeVisible` passed, and the
 *    click that followed timed out after 20s against a disabled button.
 *
 * There is no slot that is both "a day still ahead of you" (Waiting/Scheduled)
 * and "startable now" (T-2h): the two windows do not overlap, and no amount of
 * moving the date makes them. The journey's subject is the DAY-OF LADDER — on
 * the way, arrived, working, complete — so the slot is chosen to satisfy the
 * ladder, and the bucket each tab assertion expects is derived from the slot's
 * own day with the same rule the app uses (`jobIsLive`: the job's day, in the
 * job's zone, is today). 100 < 120, so the ladder is unlocked from the instant
 * the job is posted, whatever hour the suite runs at.
 *
 * And the day-of "I'm Still On" prompt is NOT part of that ladder here:
 * `helperDayOfConfirmation` counts an accept that itself happened inside the
 * 24h window as the day-before answer ("don't ask the same question twice"),
 * and in this chain J4 accepts minutes after J2 posts. So the helper's card
 * correctly offers no Still On at any slot this chain can use — see the
 * day-of step for what is asserted instead.
 */
const SLOT = slotAhead(100);

/**
 * Is this run's job happening TODAY in the job's own zone?
 *
 * The same question `jobIsLive` (src/pages/activity/activityFilters.ts) asks,
 * computed from this spec's own slot and the clock rather than read out of the
 * app — so the tab a job is expected on moves with the calendar instead of
 * being a literal that goes stale at midnight. Called, not captured: a run
 * that starts at 23:59 must not keep yesterday's answer.
 */
const liveToday = () => SLOT.isoDay === isoDayIn(new Date(), ZONE);
/** My Posts / My Jobs tab for this run's job before it is booked, and after. */
const waitingTab = () => (liveToday() ? "Needs You" : "Waiting") as "Needs You" | "Waiting";
const scheduledTab = () => (liveToday() ? "Needs You" : "Scheduled") as "Needs You" | "Scheduled";


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
            const cancelled = await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
              headers: rest(S.poster),
              data: { action: "cancel_escrow", jobId: S.jobId },
            });
            /* THE ANSWER IS READ. It was not, and that is the whole defect:
               a run that died after J4 left the job `accepted`/`escrow` with a
               Helpr on it, `cancel_escrow` CORRECTLY answered 409 `useCancelJob`
               (its door is an allowlist of `status = 'open'` with no helper),
               and nothing looked. Measured 2026-09-22: SIXTEEN such rows sat in
               escrow, the oldest from 2026-09-15, none with a
               `helper_completed_at` for `auto-release-payment` to find — while
               every nightly log said the job had been unwound. */
            if (!cancelled.ok()) {
              const body = await cancelled.text();
              if (isSettleForwardRefusal(cancelled.status(), body)) {
                /* HIRED AND FUNDED — settle it FORWARD, never cancel it.
                   `poster_cancel_job` here would record a `cancel_with_helper`
                   STRIKE against poster-e2e, and three of those restrict the
                   account for 7 days and break every nightly journey that signs
                   in as it. So the job is walked the rest of the way down the
                   product's own path (arrival → confirm → proof → Done →
                   release) and lands in `payout_pending` like a successful
                   run's. No strike is recorded on any leg. */
                const out = await settleJobForward({
                  base: SUPABASE_URL,
                  anon: ANON,
                  posterToken: S.poster.access_token,
                  helperToken: S.helper.access_token,
                  posterId: S.poster.user.id,
                  helperId: S.helper.user.id,
                  jobId: S.jobId,
                  log: (line: string) => test.info().annotations.push({ type: "settle-forward", description: line.trim() }),
                });
                if (!out.settled) {
                  announceUncovered(
                    "Journey job left in escrow",
                    `${S.jobId}: cancel_escrow refused it (hired and funded) and settling it forward did not ` +
                      `finish — ${out.reason}. It is still ${out.status}/${out.paymentStatus}.`,
                  );
                }
              } else {
                announceUncovered(
                  "Journey job not unwound",
                  `${S.jobId}: cancel_escrow answered ${cancelled.status()} ${body.slice(0, 200)}`,
                );
              }
            }
          } else {
            const cancelledJob = await request.post(`${SUPABASE_URL}/rest/v1/rpc/poster_cancel_job`, {
              headers: rest(S.poster),
              data: { p_job_id: S.jobId, p_reason: "E2E journey teardown" },
            });
            // Same rule as above: a refusal that nobody reads is a row nobody
            // finds. This path is the UNFUNDED one, so no strike is at stake.
            if (!cancelledJob.ok()) {
              announceUncovered(
                "Journey job not unwound",
                `${S.jobId}: poster_cancel_job answered ${cancelledJob.status()} ${(await cancelledJob.text()).slice(0, 200)}`,
              );
            }
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
      await fillJobDetails(page, TITLE, join(S.fileDir, "job-photo.png"));
      await journey.milestone(page, "post-details-photo");
    });

    await test.step("fills logistics with a parish-less ZIP and a date", async () => {
      // Soon, not days out: the tracker's actions unlock at T-2h, so a slot
      // inside that window is the only one J5 can walk. See the SLOT comment
      // for why the bucket assertions derive from this rather than fix it.
      await fillLogistics(page, SLOT, journey.allowReport);
      await assertHealthy(page, "logistics");
    });

    await test.step("sets a budget and reviews", async () => {
      const review = await fillBudget(page);
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
      // A just-posted, funded, unapplied job is "Waiting" — nothing is on the
      // poster's desk — UNLESS its day has arrived, which since the 2026-09-19
      // reorder makes it the most live thing on the screen and files it under
      // "Needs You". My Posts opens on "Needs You"
      // (activityConstants.defaultStatusFilterFor). See the SLOT comment.
      const tab = waitingTab();
      await openStatusTab(page, tab);
      await expect(page.getByText(TITLE).first(), `the new job is missing from My Posts > ${tab}`).toBeVisible({ timeout: 60_000 });
      await assertHealthy(page, "my posts");
      await journey.milestone(page, "my-posts");
    });

    await test.step("helper finds it in Browse", async () => {
      test.skip(!S.funded, "unfunded jobs are not in Browse by design (payment_status gate)");
      // Harness concession (prod-lifecycle's): age past the 20-min early-access window.
      // `select=id` is required with return=representation on jobs: bare
      // representation is RETURNING *, and 20260915045110 took authenticated's
      // table-level SELECT off jobs, so `*` 42501s the whole write.
      const aged = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${S.jobId}&select=id`, {
        headers: rest(S.poster, { Prefer: "return=representation" }),
        data: { created_at: new Date(Date.now() - 25 * 60_000).toISOString() },
      });
      expect(await aged.json(), "ageing the job matched zero rows").toHaveLength(1);
      const hp = S.helperPage;
      await hp.goto("/dashboard");
      // Browse renders its toolbar (search included) with the feed, not over the
      // skeleton; on the `slow` row (every backend call held 3-8s) it was still
      // skeleton at the old 20s click timeout (run 35957628804).
      await hp.getByRole("button", { name: "Search jobs" }).first().click({ timeout: 60_000 });
      // The Browse search field is an ARIA combobox now, not a searchbox:
      // `useComboboxKeyboard`'s comboboxProps sets role="combobox" on the input
      // for the recent-searches popup, which overrides type="search"'s implicit
      // role. getByRole("searchbox") matched nothing and the journey read a
      // working field as a missing one (nightly red, 2026-09-15).
      await hp.getByRole("combobox", { name: "Search jobs" }).fill(RUN);
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
      await hp.getByRole("button", { name: "Search jobs" }).first().click({ timeout: 60_000 });
      await hp.getByRole("combobox", { name: "Search jobs" }).fill(RUN);
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
      // Booked and confirmed is "Scheduled" on both sides — unless the day has
      // arrived, in which case both sides file it under "Needs You" (see the
      // SLOT comment). One derivation, both cards: the poster's `bucketFor`
      // and the helper's `appliedActivityBucket` ask `jobIsLive` the same way.
      const tab = scheduledTab();
      await pp.goto("/my-posts");
      await openStatusTab(pp, tab);
      await expect(pp.getByText(TITLE).first(), `the hired job is not in the poster's ${tab} tab`).toBeVisible({ timeout: 30_000 });
      await pp.getByText(TITLE).first().click();
      const posterMoney = await pp.getByText(/held|funded|secured|escrow|protected|paid/i).filter({ visible: true }).count();
      test.info().annotations.push({ type: "funded-indicator", description: `poster ${tab} card money copy matches: ${posterMoney}` });
      await journey.milestone(pp, "poster-scheduled-funded");
      await hp.goto("/my-jobs");
      await openStatusTab(hp, tab);
      await expect(hp.getByText(TITLE).first(), `the hired job is not in the helper's ${tab} tab`).toBeVisible({ timeout: 30_000 });
      await hp.getByText(TITLE).first().click();
      const helperMoney = await hp.getByText(/held|funded|secured|escrow|protected|guaranteed/i).filter({ visible: true }).count();
      test.info().annotations.push({ type: "funded-indicator", description: `helper ${tab} card money copy matches: ${helperMoney}` });
      await assertHealthy(hp, "helper scheduled");
      await journey.milestone(hp, "helper-scheduled-funded");
    });

    await test.step("poster messages the helper with an attachment", async () => {
      await pp.goto("/my-posts");
      await openStatusTab(pp, scheduledTab());
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
      // 60s, not 30s. This is the FIRST paint of a whole screen against prod —
      // `/rest/v1/messages` for every thread on the account, then pins,
      // archives, blocks and five RPCs on top — and it is the only assertion
      // in this file that waits for one. The 30s it had was under-provisioned
      // against this suite's own convention (60s wherever a step waits for the
      // backend to catch up) and measurably so: in run 35691377627 the base
      // `/rest/v1/messages` query alone took 43.8s and the list painted at
      // ~05:43:04, about a second after the 30s budget expired. The assertion
      // is unchanged — the thread must still be listed; only the budget now
      // matches what the screen actually costs. If prod was slow the journey
      // fixture says so in a `prod-latency` annotation.
      await expect(title, "the job conversation is missing from the poster's inbox").toBeVisible({ timeout: 60_000 });
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
    /* VISIBLE IS NOT PRESSABLE, and on this card the difference is a whole
       product rule. Every step of the helper's ladder renders DISABLED until
       two hours before the start (`JobTracking`'s `isLocked`), and the poster's
       arrival box renders disabled until the helper has marked themselves
       there (`posterConfirmationRung`'s `enabled`). Without this line
       `btn.click()` swallowed both as a bare `locator.click: Timeout 20000ms`
       naming no control and no rule — which is how a 24h-out slot read as a
       broken tracker for a day. Same wait, named. */
    await expect(btn, `${where}: "${name}" is on the card but DISABLED (a lock or an unmet gate, not a missing control)`).toBeEnabled({ timeout: 45_000 });
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
      /* THE APP DOES NOT ASK IT TWICE, and this journey is the case where it
         has already been answered.

         `HelperTrackerPanel`'s `gateActive` withholds the ladder and portals
         "I'm Still On" into the row only while `helperDayOfConfirmation` is
         null — and that helper counts an accept that itself landed inside the
         job day's 24h window AS the day-before answer ("don't ask the same
         question twice", JobConfirmation). J4 accepts minutes after J2 posts,
         so on every slot this chain can use the answer is already in and the
         row opens straight at "I'm On My Way".

         Both branches are kept because which one runs is a product rule, not a
         constant, and the branch that runs is recorded either way. What is
         asserted unconditionally is the thing that actually went wrong: the
         control the row offers must be PRESSABLE, not merely painted. A
         24h-out slot rendered "I'm On My Way" disabled under "Actions unlock
         at 9:40 PM on Sep 22" and this assertion passed on it. */
      const c = await card(hp, "/my-jobs", scheduledTab());
      const stillOn = c.getByRole("button", { name: /I'm Still On/ }).first();
      const onWay = c.getByRole("button", { name: /I'm On My Way/ }).first();
      await expect(stillOn.or(onWay).first(), "the helper card offers neither Still On nor On My Way").toBeVisible({ timeout: 45_000 });
      await expect(
        stillOn.or(onWay).first(),
        "the helper card's day-of control is painted but disabled — the tracker is locked until two hours before the start (JobTracking's isLocked), so this slot is too far out for the journey to walk",
      ).toBeEnabled({ timeout: 45_000 });
      if (await stillOn.isVisible()) {
        test.info().annotations.push({ type: "path", description: "the day-before prompt was offered and taken" });
        await stillOn.click();
        const yes = hp.getByRole("button", { name: /Yes, I Confirm/ });
        if (await appears(yes, 5_000)) await yes.click();
        /* The POSTER's half of the same control, and it is "I'm Still On"
           there too (JobConfirmation's `isOwner` branch). There is no "Confirm
           This Job" button anywhere in `src/`: that string is JobTracking's
           STEP ACTION phrasing for `job_confirmed`, a step the tracker's
           next-step block explicitly skips because JobConfirmation owns it. It
           is pressed when offered rather than required — the poster's window
           is the narrower of the two (`hoursUntilJob > -12` from the job's
           midnight, against the helper's -24), so on an evening job it has
           already closed while the helper's is still open. */
        const pc = await card(pp, "/my-posts", scheduledTab());
        const posterStillOn = pc.getByRole("button", { name: /I'm Still On/ }).first();
        if (await appears(posterStillOn, 10_000)) {
          await press(pp, pc, /I'm Still On/, "poster confirm");
          const py = pp.getByRole("button", { name: /Yes, I Confirm/ });
          if (await appears(py, 5_000)) await py.click();
          await assertHealthy(pp, "poster day-of confirm");
        } else {
          test.info().annotations.push({ type: "path", description: "the poster's day-of window (-12h) has closed; helper's (-24h) has not" });
        }
      } else {
        test.info().annotations.push({ type: "path", description: "the accept itself answered the day-of question (helperDayOfConfirmation); the row opens at On My Way" });
      }
      await journey.milestone(hp, "helper-ready-to-go");
    });

    await test.step("helper heads over and arrives; poster confirms arrival", async () => {
      let c = await card(hp, "/my-jobs", scheduledTab(), false);
      await press(hp, c, /I'm On My Way/, "on my way");
      // The location rationale on the way: this helper declines here (en-route
      // tracking is optional).
      if (await appears(hp.getByRole("button", { name: "Share Location" }), 8_000)) {
        await journey.milestone(hp, "location-rationale");
        await declineLocation(hp);
      }
      await journey.milestone(hp, "on-my-way");
      // ARRIVAL NEEDS A REAL LOCATION AT THE SITE (VN-33, owner: "both required
      // … no fallback"). mark_helper_arrival refuses a missing or far location
      // and writes nothing, so the helper's browser is placed at the job's own
      // coordinates and SHARES its location at the "I've Arrived" tap. The
      // poster's confirmation below is the second half of the rule, not a
      // substitute for the first.
      const site = await request.get(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${S.jobId}&select=latitude,longitude`, { headers: rest(S.poster) });
      expect(site.ok(), `reading the job's coordinates: ${site.status()}`).toBe(true);
      const [{ latitude, longitude }] = (await site.json()) as Array<{ latitude: number | null; longitude: number | null }>;
      await hp.context().grantPermissions(["geolocation"]);
      // A job with no coordinates has nothing to measure against and the RPC
      // accepts any real fix; Lafayette stands in for that case.
      await hp.context().setGeolocation({ latitude: Number(latitude ?? 30.2241), longitude: Number(longitude ?? -92.0198) });
      c = await card(hp, "/my-jobs", scheduledTab(), false);
      const arriveBtn = c.getByRole("button", { name: /I've Arrived/ }).first();
      await expect(arriveBtn, `arrived: no "I've Arrived" control`).toBeVisible({ timeout: 45_000 });
      // Same rule as `press`: painted is not pressable on this rail.
      await expect(arriveBtn, `arrived: "I've Arrived" is on the card but DISABLED`).toBeEnabled({ timeout: 45_000 });
      await arriveBtn.click();
      const share = hp.getByRole("button", { name: "Share Location" });
      if (await appears(share, 8_000)) await share.click();
      await expect.poll(
        async () => {
          const r = await request.get(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${S.jobId}&select=helper_arrival_verified_at`, { headers: rest(S.poster) });
          return r.ok() ? Boolean(((await r.json()) as Array<{ helper_arrival_verified_at: string | null }>)[0]?.helper_arrival_verified_at) : false;
        },
        { timeout: 45_000, message: "the arrival was never server-verified" },
      ).toBe(true);
      await assertHealthy(hp, "arrived");
      await journey.milestone(hp, "arrived-gps");
      c = await card(pp, "/my-posts", "Needs You");
      await press(pp, c, /Confirm They Arrived/, "poster confirms arrival");
      await journey.milestone(pp, "poster-confirmed-arrival");
    });

    await test.step("helper works the job: before photo, start, after photo, request payout", async () => {
      // The card shows ONE next thing at a time; follow it the way a helper does.
      // Harness concession (prod-lifecycle's): the payout request unlocks 30
      // minutes after work started — COALESCE(poster_confirmed_working_at,
      // helper_arrived_at) — so the poster's working stamp is backdated rather
      // than waited on. helper_arrived_at itself can no longer be backdated:
      // only mark_helper_arrival writes it (20260915044137).
      {
        // Named column with the representation (20260915045110): bare
        // `return=representation` is `RETURNING *` and is refused.
        const r = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${S.jobId}&select=id`, {
          headers: rest(S.poster, { Prefer: "return=representation" }),
          data: { poster_confirmed_working_at: new Date(Date.now() - 40 * 60_000).toISOString() },
        });
        expect(r.ok(), `backdating poster_confirmed_working_at: ${r.status()} ${await r.text()}`).toBe(true);
      }
      const seen: string[] = [];
      for (let i = 0; i < 8; i++) {
        const c = await card(hp, "/my-jobs", "Needs You");
        // "Before Photo" / "After Photo" — the PhotoProofCaptureChip labels.
        // These read "Add a before photo" / "Add an after photo" until
        // 2026-09-21, which is PhotoProofStep's title; that panel has ZERO call
        // sites in src/, so this loop was watching for words nothing renders.
        // The same stale pair had already cost the production money loop a
        // 30-second timeout that read like a broken completion flow. Guarded
        // now by src/test/e2eExactLocatorsMatchRealCopy.test.ts.
        const before = c.getByText("Before Photo", { exact: true });
        const after = c.getByText("After Photo", { exact: true });
        const start = c.getByRole("button", { name: /^Start Working$/ });
        // "Mark Job Complete" (owner, 2026-09-14; was "Request My Payout"). Since
        // VN-21 the tracker's Done CTA is the card's ONE primary and the
        // same-label PayoutPrimary stands down, so there is one; `.first()`
        // stays as a guard. It opens the "Mark This Job Complete?"
        // confirmation this step expects (its button reads "Mark Complete",
        // owner 2026-09-14; was "Yes, I'm Done").
        const payout = c.getByRole("button", { name: /^Mark Job Complete$/ }).first();
        await expect(before.or(after).or(start).or(payout).first(), `helper card offers no next step (so far: ${seen.join(" > ")})`).toBeVisible({ timeout: 45_000 });
        if (await before.isVisible() || await after.isVisible()) {
          const label = (await before.isVisible()) ? "Before" : "After";
          seen.push(`${label} photo`);
          /* THE CHIP IS THE TRIGGER — there is no "Add Photo" button.
             That was `PhotoProofStep`'s full-width button, the same removed
             panel the two stale `getByText` literals above were fixed for on
             2026-09-21; only half the locator was corrected. The card renders
             `PhotoProofCaptureChip` in the action row, and the chip's own
             `onClick` opens the dialog (PhotoProof, `chip` branch). Its
             accessible name is "<label> — add the <type> photo for this job",
             so it is matched by prefix, and it stops matching entirely once a
             photo exists (the label becomes "Before (1)"). */
          await c.getByRole("button", { name: new RegExp(`^${label} Photo\\b`) }).first().click();
          const dialog = hp.getByRole("dialog").filter({ hasText: `${label} photos` });
          await expect(dialog).toBeVisible();
          await dialog.locator('input[type="file"]').setInputFiles(join(S.fileDir, "job-photo.png"));
          await dialog.getByRole("button", { name: "Upload" }).click();
          await expect(dialog, `${label} photo dialog never closed`).toBeHidden({ timeout: 45_000 });
          await expect(
            c.getByText(label === "Before" ? "Before Photo" : "After Photo", { exact: true }),
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
          seen.push("Mark Job Complete");
          const payoutButtons = await c.getByRole("button", { name: /^Mark Job Complete$/ }).count();
          test.info().annotations.push({ type: "payout-cta-count", description: String(payoutButtons) });
          await payout.click();
          const yes = hp.getByRole("button", { name: "Mark Complete", exact: true });
          await expect(yes, "Mark Job Complete opened no confirmation").toBeVisible({ timeout: 15_000 });
          await journey.milestone(hp, "request-payout-confirm");
          await yes.click();
          // The done write asks for location on its way out (JobTracking's
          // updateStatus → getLocation), and "Not Now" is deliberately NOT
          // remembered — usePermissionRationale only marks a kind confirmed
          // when the person says yes — so the rationale comes back here even
          // though Start Working already declined it once. e2e-journeys
          // 34927100318 left that dialog open: every button had been pressed,
          // `helper_completed_at` was never written, and the failure shot shows
          // the "Location" alertdialog still up. Answer it, the same way the
          // helper does everywhere else in this journey.
          await hp.getByRole("button", { name: "Share Location" }).waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
          await declineLocation(hp);
          await expect(yes).toBeHidden({ timeout: 30_000 });
          break;
        }
      }
      test.info().annotations.push({ type: "helper-path", description: seen.join(" > ") });
      await expect.poll(async () => Boolean((await readJob(request, S.poster, S.jobId!)).helper_completed_at), { timeout: 30_000, message: `completion never recorded (path: ${seen.join(" > ")})` }).toBe(true);
      /* THE SUBMISSION MOVES THE CARD, so the sentence has to be looked for
         where the card now is. `appliedActivityBucket` files an in-progress job
         with `helper_completed_at` and no `poster_completed_at` under WAITING
         ("waiting on the other party by definition"), and the sentence lives
         inside that card's `SubmittedStep`. This used to be a page-level
         `getByText` on whatever tab the loop happened to leave open, which
         after the move renders the job nowhere at all — "element(s) not found",
         reading as missing copy on a job that had completed perfectly. */
      const submitted = await card(hp, "/my-jobs", "Waiting");
      await expect(
        submitted.getByText(/Waiting for the person who posted this job|Marked Complete/).first(),
        "the helper's card does not say the submission is with the poster",
      ).toBeVisible({ timeout: 45_000 });
      await journey.milestone(hp, "submitted");
    });

    await test.step("poster requests a revision", async () => {
      /* THE REVISION ASK LIVES BEHIND APPROVE, NOT BESIDE IT.
         The poster's in-progress card offers one completion control, the
         "Approve" chip (`InProgressStep`), and it opens `CompletionChoiceSheet`
         — two paths, "All Done — Looks Great!" and "I Need Something Fixed
         First". There is no "Request Revision" button on the card.
         REPORTED, NOT TOUCHED: the "Request Revision" dialog this step used to
         drive still exists in `ActivityDialogs.tsx`, and `Activity.tsx` still
         threads `onRevision` down through PostedJobsTab → PostedJobCard to
         reach it — but `onRevision(` has ZERO call sites in `src/`, so nothing
         can open it. The spec was waiting 45s on a control no code path
         renders, and its failure read as a missing product feature. */
      const c = await card(pp, "/my-posts", "Needs You");
      await press(pp, c, /^Approve\b/, "open the completion choice");
      const sheet = pp.getByRole("dialog").filter({ hasText: "I Need Something Fixed First" });
      await expect(sheet, "Approve did not open the two-path completion sheet").toBeVisible({ timeout: 20_000 });
      await sheet.getByRole("button", { name: /I Need Something Fixed First/ }).click();
      await pp.getByRole("textbox", { name: "Describe what needs to be redone" }).first().fill(`Journey ${RUN}: please redo the corner.`);
      await journey.milestone(pp, "revision-sheet");
      await pp.getByRole("button", { name: "Send Revision Request" }).click();
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
      /* The SAME two-path sheet as the revision step, taken the other way.
         This step used to press Approve and then look for a dialog headed
         "Release the payment?" — which is `DisputedStep`'s confirm, on the
         admin/dispute path, and never renders here. When it did not appear the
         step simply moved on with the sheet still open and nothing released,
         and the failure surfaced 90 seconds later as "release never settled",
         which reads as a broken payout rather than an unclicked button. */
      await press(pp, c, /^Approve\b/, "approve");
      const sheet = pp.getByRole("dialog").filter({ hasText: "All Done — Looks Great!" });
      await expect(sheet, "Approve did not open the two-path completion sheet").toBeVisible({ timeout: 20_000 });
      await journey.milestone(pp, "release-confirm");
      await sheet.getByRole("button", { name: /All Done/ }).click();
      await expect
        .poll(async () => (await readJob(request, S.poster, S.jobId!)).payment_status, { timeout: 90_000, message: "release never settled" })
        .toMatch(/^(payout_pending|released)$/);
      await assertHealthy(pp, "after release");
      await journey.milestone(pp, "released");
    });

    await test.step("poster reviews the helper and tips", async () => {
      const c = await card(pp, "/my-posts", "Done");
      const review = pp.getByRole("dialog").filter({ hasText: "Your overall experience" });
      /* `^Review\b`, not `^Review$`. Every chip in a job step row composes its
         accessible name as "<label> — <ariaLabel>" (JobActionRow's
         composeAccessibleName), so the Done card's chips are named
         "Review — leave a review for Hallie H." and "Tip Hallie H." — and an
         anchored `$` matched neither. `\b` still refuses "Reviewed — …" and
         "Tipped — …", which is the distinction that matters here. */
      if (!(await review.isVisible().catch(() => false))) await press(pp, c, /^Review\b/, "poster review");
      await expect(review).toBeVisible({ timeout: 30_000 });
      await review.getByRole("radio", { name: /5/ }).or(review.getByRole("button", { name: /5 stars?/i })).first().click();
      await review.getByRole("textbox").first().fill(`Journey ${RUN}: great work.`);
      await journey.milestone(pp, "poster-review");
      await review.getByRole("button", { name: /Submit|Post Review|Send/ }).last().click();
      await expect(review).toBeHidden({ timeout: 30_000 });
      /* RELOAD UNTIL THE BADGE LANDS, not once. The chip flips on
         `completedJobMeta[job.id].reviewed`, which `useActivityData` builds
         from a SEPARATE `reviews` query keyed on the completed job ids — so it
         does not move with the dialog closing, and a single reload can paint
         the pre-review chip before that query has come back. Measured
         2026-09-22 on a real released job: the row was in `reviews` at
         05:02:40 and one reload still drew "Review"; the next reload drew
         "Reviewed". Polling the reload asserts the same fact without asserting
         a refresh speed nobody promised. */
      await expect
        .poll(
          async () => (await card(pp, "/my-posts", "Done")).getByRole("button", { name: /^Reviewed\b/ }).count(),
          { timeout: 90_000, message: "the poster's card never showed the Reviewed badge after the review was submitted" },
        )
        .toBeGreaterThan(0);
      const c2 = await card(pp, "/my-posts", "Done", false);
      await press(pp, c2, /^Tip\b/, "tip");
      await journey.milestone(pp, "tip-sheet");
    });

    await test.step("helper reviews the poster", async () => {
      const c = await card(hp, "/my-jobs", "Done");
      await press(hp, c, /^Leave a review for/i, "helper review");
      const review = hp.getByRole("dialog").filter({ hasText: "Your overall experience" });
      await expect(review).toBeVisible({ timeout: 30_000 });
      await review.getByRole("radio", { name: /5/ }).or(review.getByRole("button", { name: /5 stars?/i })).first().click();
      await review.getByRole("textbox").first().fill(`Journey ${RUN}: clear instructions.`);
      await review.getByRole("button", { name: /Submit|Post Review|Send/ }).last().click();
      await expect(review).toBeHidden({ timeout: 30_000 });
      await journey.milestone(hp, "helper-review");
    });
  });
});
