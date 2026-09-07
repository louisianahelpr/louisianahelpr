import { test, expect, type APIRequestContext } from "@playwright/test";
import { appendFileSync } from "node:fs";

// The full authenticated money loop, against PRODUCTION, on a Stripe TEST key.
//
// post → fund (escrow) → apply → hire → complete → release → review
//
// ============================================================================
// THIS SPEC HAS NEVER EXECUTED. It is gated on secrets that do not exist yet.
// Its assertions are written from the live schema, the live RLS policies and the
// live edge-function action names, all read on 2026-09-07 — but reading is not
// running, and the first real run should be expected to find things wrong with
// THIS FILE before it finds anything wrong with the app.
// ============================================================================
//
// WHY IT MAY WRITE TO PRODUCTION AT ALL
// -------------------------------------
// Because production is on a Stripe TEST key. Verified independently against the
// Stripe API: every charge produced by prod edge functions on 5–6 Sep is
// `livemode: false`, including a Connect destination charge with a transfer — so
// both the funding and payout legs have already run for real on a test card. The
// card is 4242 4242 4242 4242, any future expiry, any CVC.
//
// The owner intends to keep the key on test until every function has been
// verified against Stripe, so this is not a countdown. But it IS a config value
// one person can change, and the funding leg is the single piece of this suite
// that becomes dangerous the moment it does — see the tripwire at
// `stripeModeFromCheckoutUrl` below.
//
// WHAT HAPPENS IF THE KEY EVER GOES LIVE
// --------------------------------------
// The suite DEGRADES; it does not break, and it does not charge anyone.
//   still runs : post → apply → hire → complete  (no card is involved, and an
//                unfunded job is invisible in browse and triggers no
//                notifications, because every one of those gates requires
//                payment_status IN ('escrow','payout_pending','released'))
//   skipped    : fund → release → review, announced as UNCOVERED via a
//                ::warning:: and a step-summary line, never silently
// Review is in the skipped set because it has to be: the
// `Users can create reviews for eligible jobs` policy requires
// `payment_status IN ('released','payout_pending')`. That is where the
// dependency actually lies, not a judgement call made here.
//
// REPLACING THE FUNDING LEG, if that day comes: the proper fix is a SECOND
// Stripe account used only by tests, with its own `sk_test_` key, reached
// through a mode-aware key selection in the edge functions (e.g. an override
// honoured only for these two account ids — `_shared/proTiers.ts` already has
// the shape of such a switch). There is no way to split the difference on one
// account: Stripe rejects test cards in live mode with `card_declined`, and live
// mode accepts only real cards. That work is explicitly NOT done here.
//
// BLAST RADIUS — every mitigation below is structural, not a convention, and
// each was verified against the live database rather than assumed.
//
//  1. ZERO NOTIFICATION FAN-OUT — the job is posted with `parish = null`.
//     `notify_helpers_on_job_post` opens with
//         IF NEW.parish IS NULL OR NEW.status <> 'open' THEN RETURN NEW;
//     so a parish-less job cannot reach the fan-out loop at all. This does not
//     depend on who is signed up: it is the first statement in the trigger.
//     (The demographic argument — 0 rows in `helper_preferred_parishes`, all 17
//     real profiles with `parish = null` — happens to hold too, but it would
//     stop holding the moment someone sets a ZIP, so it is not relied on.)
//
//  2. EFFECTIVELY ZERO BROWSE EXPOSURE — all four guest surfaces
//     (`open_jobs_browse`, `get_ranked_open_jobs`, `get_open_jobs_for_map`,
//     `get_public_open_jobs`) require `created_at <= early_access_cutoff()`,
//     and `early_access_cutoff()` is `now() - 20 minutes` for a free-tier
//     caller. All 17 real profiles are free tier. So a job younger than 20
//     minutes is invisible to every real account, and this suite moves the job
//     off `status = 'open'` within seconds of funding it. The `is_seed` flag is
//     deliberately NOT what is relied on here: `seed_jobs_hidden_publicly()`
//     returns false in prod (the owner is keeping fixtures visible), which
//     makes `is_seed` a launch switch rather than an isolation mechanism.
//
//  3. THE MONEY SWEEPS DO **NOT** SKIP IT — this control does not exist, and
//     the spec no longer pretends otherwise. It used to assert `is_seed = true`
//     immediately after the poster INSERT, which is unsatisfiable: `is_seed` is
//     locked against posters in TWO independent places, on purpose.
//       * `enforce_jobs_insert_column_lock` sets `NEW.is_seed := false` on every
//         poster INSERT, commented "a poster must not be able to hide a job from
//         the admin money figures by marking it seed data";
//       * `enforce_poster_jobs_money_lock` lists `is_seed` in `locked_always`, so
//         a follow-up UPDATE by the poster raises 42501 as well.
//     Both are correct and neither should change to suit a test. The consequence
//     is that the five sweeps which filter on `is_seed`
//     (`auto-release-payment`, `payment-confirm-reminder`, `money-reconciliation`,
//     `process-scheduled-payouts`, `subscription-reconciliation`) WILL see this
//     job, on top of the seven that ignore the flag anyway. What actually bounds
//     that is controls 1, 2 and 4 plus the sweeper, which runs before AND after
//     every run — the residual exposure is a run that dies mid-loop, which is
//     exactly what the sweeper exists for. `announceUncovered` reports it so the
//     gap is visible in the run rather than assumed away.
//     Closing it properly needs a `SECURITY DEFINER` RPC scoped to these two test
//     user ids — the same shape the sweeper's own README already contemplates for
//     a purge. That is a migration touching authz and is deliberately NOT done
//     here. Handing CI a service-role key is the other option and is REJECTED for
//     the reason this workflow already states in the sweep step: "a CI job holding
//     service-role could delete anything in the database, which is a far larger
//     risk than the rows it tidies."
//
//  4. THE TITLE SAYS SO. Every row carries E2E_TITLE_MARKER, which is both the
//     human signal and the only handle the sweeper has.
//
// RESIDUE, STATED PLAINLY: a run that COMPLETES leaves one settled job plus its
// application, payout_transfer and review in production, permanently. The
// poster cannot delete them — `Customers can delete their own jobs` requires
// `status = 'open'` and an unfunded or abandoned payment_status — and deleting
// settled money rows would be worse than keeping them. At one push per run that
// is bounded but unbounded-in-time growth on a money schema. The clean fix is a
// `SECURITY DEFINER` purge scoped to these two user ids; that is a migration
// touching authz and is NOT written here.

const SUPABASE_URL = (process.env.PLAYWRIGHT_SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
// Publishable, and already in every shipped bundle — defaulted so the secret
// list stays down to the four that are genuinely secret.
const ANON =
  process.env.PLAYWRIGHT_SUPABASE_ANON_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP";

const POSTER_EMAIL = process.env.PLAYWRIGHT_POSTER_EMAIL;
const POSTER_PASSWORD = process.env.PLAYWRIGHT_POSTER_PASSWORD;
const HELPER_EMAIL = process.env.PLAYWRIGHT_HELPER_EMAIL;
const HELPER_PASSWORD = process.env.PLAYWRIGHT_HELPER_PASSWORD;

const READY = Boolean(POSTER_EMAIL && POSTER_PASSWORD && HELPER_EMAIL && HELPER_PASSWORD);

/** Shared with the sweeper. Changing it orphans every row the sweeper knows about. */
const E2E_TITLE_MARKER = "[E2E DO NOT ACCEPT]";

/** Stripe's universally-accepted test card. Only ever valid on a test key. */
const TEST_CARD = { number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123", zip: "70801" };

/**
 * THE LIVE-KEY TRIPWIRE.
 *
 * Production's `STRIPE_SECRET_KEY` is a test key today, and the owner intends to
 * keep it that way until every function has been verified against Stripe. This
 * guard is therefore expected to do nothing, indefinitely. It exists for the day
 * someone flips that key.
 *
 * On that day, without this check, the funding leg would type a card number into
 * a LIVE Stripe Checkout on every push. It would not even fail usefully: Stripe
 * rejects `4242 4242 4242 4242` in live mode with `card_declined`, so the suite
 * would go red with a message about a declined card and someone would "fix" it by
 * supplying a real one. That is the whole failure class this workstream exists to
 * catch — a thing that is correct right up until a config change makes it
 * dangerous, with nothing watching.
 *
 * HOW THE MODE IS DETECTED, AND WHY THIS WAY
 * ------------------------------------------
 * From the Checkout Session id embedded in the URL `create-payment` returns:
 * `cs_test_…` or `cs_live_…`. Chosen over the two alternatives because:
 *   * the `sk_test_` / `sk_live_` prefix would require the secret key itself to
 *     be readable by CI. Putting a live Stripe secret into a GitHub Actions
 *     environment to find out whether it is a live Stripe secret is a worse
 *     trade than the problem it solves.
 *   * a `livemode` field on some previously-created object tells you the mode as
 *     of the LAST charge, not the current configuration — precisely the stale
 *     reading that would let a freshly flipped key through.
 * The session id is produced by the key that is live RIGHT NOW, arrives in the
 * response the app already returns, and needs no secret at all. Creating a
 * Checkout Session charges nothing — the card is only taken when the hosted page
 * is submitted — so this reads the environment at the last safe moment before
 * the only irreversible step.
 */
function stripeModeFromCheckoutUrl(url: string): "test" | "live" | "unknown" {
  const m = /\/(cs_(test|live)_[A-Za-z0-9]+)/.exec(url);
  if (!m) return "unknown";
  return m[2] === "live" ? "live" : "test";
}

/** Announce a degraded leg where CI actually shows it, not only in the log. */
function announceUncovered(title: string, detail: string) {
  // GitHub picks workflow commands out of any step's stdout.
  console.log(`::warning title=${title}::${detail}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      appendFileSync(summary, `- **${title}.** ${detail}\n`);
    } catch {
      // A summary file we cannot write is not a reason to fail the run; the
      // ::warning:: above still lands.
    }
  }
}

type Session = { access_token: string; user: { id: string } };

async function signIn(api: APIRequestContext, email: string, password: string): Promise<Session> {
  const r = await api.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(r.ok(), `sign-in failed for ${email}: ${r.status()} ${await r.text()}`).toBe(true);
  const body = (await r.json()) as Session;
  expect(body.access_token, "GoTrue returned no access token").toBeTruthy();
  return body;
}

function rest(session: Session) {
  return {
    apikey: ANON,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

/** Read a job's current row as the poster. */
async function readJob(api: APIRequestContext, session: Session, jobId: string) {
  const r = await api.get(
    `${SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}&select=id,status,payment_status,helper_id,parish,is_seed,poster_completed_at,helper_completed_at`,
    { headers: rest(session) },
  );
  expect(r.ok(), `reading job ${jobId}: ${r.status()}`).toBe(true);
  const rows = await r.json();
  expect(rows, `job ${jobId} vanished`).toHaveLength(1);
  return rows[0];
}

test.describe("full money loop against production", () => {
  test.skip(
    !READY,
    "Set PLAYWRIGHT_POSTER_EMAIL / PLAYWRIGHT_POSTER_PASSWORD and PLAYWRIGHT_HELPER_EMAIL / " +
      "PLAYWRIGHT_HELPER_PASSWORD. Until then the escrow, hire, complete, release and review " +
      "legs have NO unmocked coverage — see e2e-real-backend.yml's boundary report.",
  );

  // One test, not seven. The legs are not independent: each needs the state the
  // previous one produced, and splitting them into separate tests would either
  // re-run the whole loop per leg (four funded jobs per push) or leak state
  // between tests through prod. A single linear test is the honest shape.
  test("post, fund, apply, hire, complete, release, review", async ({ page, request }) => {
    test.setTimeout(5 * 60_000);

    const poster = await signIn(request, POSTER_EMAIL!, POSTER_PASSWORD!);
    const helper = await signIn(request, HELPER_EMAIL!, HELPER_PASSWORD!);
    expect(poster.user.id, "poster and helper resolved to the same account").not.toBe(helper.user.id);

    // --- 1. POST ------------------------------------------------------------
    // Created over REST rather than through the post-job form, deliberately.
    // The form derives `parish` from the ZIP, and a null parish IS the
    // blast-radius control that works — a UI-posted job would notify real
    // helpers. `is_seed` is sent for intent only; the column lock will force
    // it false and control 3 above explains why that is correct. The form's
    // own coverage lives in the mocked happy-path suite
    // (customer-post-job.spec.ts); what is unmocked here is everything
    // downstream of the row existing.
    const runId = `${Date.now()}-${process.env.GITHUB_RUN_ID ?? "local"}`;
    const created = await request.post(`${SUPABASE_URL}/rest/v1/jobs`, {
      headers: { ...rest(poster), Prefer: "return=representation" },
      data: {
        customer_id: poster.user.id,
        title: `${E2E_TITLE_MARKER} automated lifecycle ${runId}`,
        description:
          "Automated end-to-end test row. Not a real job. Created and settled by CI; " +
          "if you are reading this in the app, something has gone wrong with the test harness.",
        category: "cleaning",
        budget: 25,
        location: "Baton Rouge, LA",
        date_needed: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
        status: "open",
        payment_status: "unpaid",
        pricing_mode: "set_price",
        // The two blast-radius fields. Asserted below, because a silently
        // dropped column here is the difference between a quiet test row and
        // one that emails strangers.
        parish: null,
        is_seed: true,
      },
    });
    expect(created.ok(), `job insert failed: ${created.status()} ${await created.text()}`).toBe(true);
    const [job] = await created.json();
    expect(job.id, "insert returned no row").toBeTruthy();

    // These are not decoration. If `parish` came back non-null the fan-out
    // trigger is live for this row, and the run must stop before funding it —
    // funding is what arms the notification.
    expect(job.parish, "parish must be null or the helper fan-out fires").toBeNull();
    // NOT `toBe(true)`. That assertion could never pass — see control 3 above —
    // and it failed here, 1.4s in, on every run this workflow has ever done,
    // which is why nothing downstream of it has any coverage at all. Asserting
    // the real value keeps the lock honest: if someone ever weakens
    // enforce_jobs_insert_column_lock so a poster CAN set is_seed, this goes red
    // and the reason is written directly above.
    expect(
      job.is_seed,
      "a poster INSERT must not be able to set is_seed — the column lock is the control here",
    ).toBe(false);
    announceUncovered(
      "Money sweeps are NOT excluded from the test job",
      "`is_seed` is locked against posters in two places by design, so this run's job is visible to the " +
        "five sweeps that filter on it. Bounded by the null parish, the browse embargo, the title marker " +
        "and the sweeper that runs before and after. Closing it needs a SECURITY DEFINER RPC scoped to the " +
        "two test accounts; a service-role key in CI is explicitly not the answer.",
    );

    // --- 2. FUND (real Stripe Checkout) -------------------------------------
    const escrow = await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
      headers: rest(poster),
      data: { action: "escrow", jobId: job.id },
    });
    expect(escrow.ok(), `create-payment escrow failed: ${escrow.status()} ${await escrow.text()}`).toBe(true);
    const { url: checkoutUrl } = await escrow.json();
    expect(checkoutUrl, "create-payment returned no checkout url").toBeTruthy();
    expect(String(checkoutUrl)).toContain("checkout.stripe.com");

    const mode = stripeModeFromCheckoutUrl(String(checkoutUrl));
    // "unknown" is treated as live. A URL shape we cannot read is not evidence
    // of safety, and the failure mode of guessing wrong is a real charge.
    const cardIsSafe = mode === "test";

    if (!cardIsSafe) {
      announceUncovered(
        "Funding leg SKIPPED — Stripe is in LIVE mode",
        `create-payment returned a ${mode === "live" ? "cs_live_" : "unrecognised"} Checkout Session, so the ` +
          `funding leg cannot run without charging a real card — Stripe rejects test card 4242 in live mode, ` +
          `and there is no card this suite can safely submit. Escrow funding, payout release and review are ` +
          `therefore UNCOVERED on this run. The fix is a second Stripe account dedicated to tests, not a real ` +
          `card here. Post, apply, hire and complete still ran.`,
      );
      test.info().annotations.push({
        type: "uncovered",
        description: "Stripe LIVE mode — funding, release and review skipped",
      });
      // Unwind the session we created. It was never submitted, so nothing was
      // charged and nothing will be; this just stops the row sitting around
      // with a stripe_session_id for the next sweep to reason about.
      await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
        headers: rest(poster),
        data: { action: "cancel_escrow", jobId: job.id },
      });
    } else {
      await page.goto(String(checkoutUrl), { waitUntil: "domcontentloaded" });
      await page.getByPlaceholder("1234 1234 1234 1234").fill(TEST_CARD.number);
      await page.getByPlaceholder("MM / YY").fill(TEST_CARD.expiry);
      await page.getByPlaceholder("CVC").fill(TEST_CARD.cvc);
      const zip = page.getByPlaceholder("12345");
      if (await zip.count()) await zip.fill(TEST_CARD.zip);
      await page.getByTestId("hosted-payment-submit-button").click();
      await page.waitForURL(/\/payment-success/, { timeout: 90_000 });

      // The webhook, not the redirect, is what moves the row. Poll for it — a
      // redirect that lands before `checkout.session.completed` is delivered is
      // normal, and asserting immediately would make this flaky in a way that
      // looks like a product bug.
      await expect
        .poll(async () => (await readJob(request, poster, job.id)).payment_status, {
          timeout: 60_000,
          message: "stripe-webhook never moved payment_status to escrow",
        })
        .toBe("escrow");
    }

    // --- 3. APPLY -----------------------------------------------------------
    const applied = await request.post(`${SUPABASE_URL}/rest/v1/applications`, {
      headers: { ...rest(helper), Prefer: "return=representation" },
      data: {
        job_id: job.id,
        helper_id: helper.user.id,
        message: `${E2E_TITLE_MARKER} automated application`,
      },
    });
    expect(applied.ok(), `application insert failed: ${applied.status()} ${await applied.text()}`).toBe(true);
    const [application] = await applied.json();
    expect(application.id).toBeTruthy();

    // --- 4. HIRE ------------------------------------------------------------
    const hired = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}`, {
      headers: { ...rest(poster), Prefer: "return=representation" },
      data: { helper_id: helper.user.id, status: "accepted" },
    });
    expect(hired.ok(), `hire failed: ${hired.status()} ${await hired.text()}`).toBe(true);
    // A PATCH matching zero rows returns 200 with []. The house rule is to
    // assert the row, not the absence of an error.
    expect(await hired.json(), "hire matched zero rows — RLS refused it silently").toHaveLength(1);

    const afterHire = await readJob(request, poster, job.id);
    expect(afterHire.helper_id).toBe(helper.user.id);

    // --- 5. COMPLETE (both sides) -------------------------------------------
    for (const [who, session] of [["helper", helper], ["poster", poster]] as const) {
      const done = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}`, {
        headers: { ...rest(session), Prefer: "return=representation" },
        data:
          who === "helper"
            ? { helper_completed_at: new Date().toISOString() }
            : { poster_completed_at: new Date().toISOString(), status: "completed" },
      });
      expect(done.ok(), `${who} completion failed: ${done.status()} ${await done.text()}`).toBe(true);
      expect(await done.json(), `${who} completion matched zero rows`).toHaveLength(1);
    }

    // --- 6 & 7. RELEASE and REVIEW ------------------------------------------
    // Both are downstream of funding, and the dependency is not stylistic: the
    // `Users can create reviews for eligible jobs` policy requires
    // `j.payment_status = ANY (ARRAY['released','payout_pending'])`, so an
    // unfunded job cannot be reviewed no matter what else is true of it. That is
    // exactly where the degradation line falls, and it is a property of the
    // database rather than a choice made here.
    if (cardIsSafe) {
      const released = await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
        headers: rest(poster),
        data: { action: "release", jobId: job.id },
      });
      expect(released.ok(), `release failed: ${released.status()} ${await released.text()}`).toBe(true);

      await expect
        .poll(async () => (await readJob(request, poster, job.id)).payment_status, {
          timeout: 60_000,
          message: "payment_status never reached a settled state after release",
        })
        .toMatch(/^(payout_pending|released)$/);

      // The money actually moved: a transfer row for THIS job, to the helper.
      const transfers = await request.get(
        `${SUPABASE_URL}/rest/v1/payout_transfers?job_id=eq.${job.id}&select=id,status,amount_cents,helper_id`,
        { headers: rest(poster) },
      );
      expect(transfers.ok(), `reading payout_transfers: ${transfers.status()}`).toBe(true);
      const transferRows = await transfers.json();
      expect(transferRows, "release produced no payout_transfers row").not.toHaveLength(0);
      expect(Number(transferRows[0].amount_cents), "payout was zero or negative").toBeGreaterThan(0);

      const review = await request.post(`${SUPABASE_URL}/rest/v1/reviews`, {
        headers: { ...rest(poster), Prefer: "return=representation" },
        data: {
          job_id: job.id,
          reviewer_id: poster.user.id,
          reviewee_id: helper.user.id,
          rating: 5,
          comment: `${E2E_TITLE_MARKER} automated review`,
        },
      });
      expect(review.ok(), `review insert failed: ${review.status()} ${await review.text()}`).toBe(true);
      expect(await review.json(), "review insert matched zero rows").toHaveLength(1);
    }

    // --- 8. The blast-radius claims, re-asserted after the fact --------------
    // Stated as assertions rather than trusted from step 1, because a trigger
    // or a later PATCH could have changed them mid-loop.
    const final = await readJob(request, poster, job.id);
    expect(final.parish, "parish became non-null during the run").toBeNull();
    expect(final.is_seed, "nothing in the loop should have been able to set is_seed").toBe(false);

    // And the thing that matters most: this job never became publicly visible.
    const anonBrowse = await request.get(
      `${SUPABASE_URL}/rest/v1/open_jobs_browse?id=eq.${job.id}&select=id`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
    );
    expect(anonBrowse.ok(), `anon browse read failed: ${anonBrowse.status()}`).toBe(true);
    expect(
      await anonBrowse.json(),
      "the test job was visible to a signed-out visitor in open_jobs_browse",
    ).toHaveLength(0);
  });
});

export { E2E_TITLE_MARKER };
