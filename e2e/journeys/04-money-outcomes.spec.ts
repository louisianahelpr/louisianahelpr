/**
 * WHY THIS CARRIES AN EXEMPTION RATHER THAN A MUTATION.
 *
 * Every assertion here is on the REAL backend's answer to a door the app calls
 * (create-payment's escrow / cancel_escrow / tip / admin_* actions, the
 * saved-search and tip notification producers, stripe-webhook). The vacuity
 * gate mutates `src/` and rebuilds the web bundle; it deploys no edge function
 * and no migration, so a `@mutate` here would come back SURVIVED for an
 * environment reason. What this file asserts is held able to fail by the
 * registries it drives and their guards: src/test/journeyOutcomesDriven.test.ts,
 * src/test/notificationProducersCovered.test.ts and
 * src/test/adminWritePathsDriven.test.ts each carry registered @mutate lines
 * shown red on 2026-09-26.
 *
 * @mutate-exempt Subject is deployed edge functions, DB triggers and Stripe test-mode webhooks reached over REST; the gate never deploys either. The coverage CLAIMS this spec makes are pinned by three registered guards (journeyOutcomesDriven, notificationProducersCovered, adminWritePathsDriven), each shown red.
 */
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import {
  test,
  expect,
  announceUncovered,
  getSession,
  payOnStripeCheckout,
  rest,
  sessionAvailable,
  sessionsAvailable,
  skipUncovered,
  stripeModeFromCheckoutUrl,
  ANON,
  E2E_TITLE_MARKER,
  SUPABASE_URL,
  type Session,
} from "./fixtures";
import { centralDatePlus, fund, invoke, readRow, retireFundedJob } from "../prod-audit/fundedOpenJob";
import { settleJobForward } from "../../scripts/e2e/settleForward.mjs";
import { OUTCOME_UNDRIVEN, filteredOut, rotationFor, scenarioTitle } from "./scenarios";
import { uncoveredAdminPaths } from "./adminWritePaths";

/**
 * MONEY OUTCOMES the marketplace chain does not reach (Q226, Q230, Q253).
 *
 * 02-marketplace drives ONE job down the happy path (smooth, revision). This
 * file drives the other money outcomes, each on a job THIS RUN posts and funds
 * on Stripe TEST mode with 4242 4242 4242 4242, and nothing else:
 *
 *   cancelled  poster funds, a saved search of the helper's matches it (the
 *              saved-search alert is asserted), the poster cancels
 *              (create-payment cancel_escrow: refund, cancelled/cancelled).
 *   refunded   poster funds; the poster is REFUSED every create-payment admin
 *              action on it; the ADMIN issues a full Quick Refund
 *              (admin_refund_general) — cancelled/refunded plus the poster's
 *              "Refund issued" row. Admin credentials exist only in CI
 *              (PLAYWRIGHT_ADMIN_*), so this leg cannot run on a laptop.
 *   tip        poster funds, helper applies, poster hires, the job is settled
 *              forward down the product's own doors (scripts/e2e/settleForward),
 *              the poster tips $3 through create-payment's tip Checkout, and the
 *              helper's tip notification is asserted.
 *
 * BLAST RADIUS. Every job is is_seed, carries E2E_TITLE_MARKER (the CI sweeper
 * unwinds strays), and has parish NULL — asserted right after the insert — so
 * the parish fan-out (notify_helpers_on_job_post) returns on its first line and
 * no real Helpr is notified. The saved search is the helper's own, matches only
 * this run's token, and is deleted after. Nothing here strikes, bans or cancels
 * a HIRED job (settleForward exists so a hired job is never cancelled).
 *
 * WebKit: skipped by design (justified in e2e/skipAllowlist.ts). These legs are
 * REST + Stripe's hosted page; 02-marketplace already drives that page in
 * WebKit, and a second engine would double every Stripe test charge and prod
 * write for no new surface.
 */

const avail = sessionsAvailable();
const rotation = rotationFor(3);
const RUN = Date.now().toString(36).slice(-6);

const titleFor = (journey: string, outcome: "cancelled" | "refunded" | "smooth") =>
  scenarioTitle({ journey, persona: "both", state: "approved", rotation, jobType: "set-price", outcome });

/** Every admin-only create-payment action a NON-admin must be refused. */
const NON_ADMIN_REFUSED = ["admin_refund_general", "admin_refund_dispute", "admin_release_dispute"] as const;

async function readJson<T>(r: { ok(): boolean; status(): number; text(): Promise<string> }, what: string): Promise<T> {
  const body = await r.text();
  expect(r.ok(), `${what}: HTTP ${r.status()} ${body.slice(0, 300)}`).toBe(true);
  return (body ? JSON.parse(body) : null) as T;
}

/**
 * Post one job as the poster, parish NULL, aged past the free-tier
 * early-access window (the same harness concession 02-marketplace makes and
 * asserts), and prove the parish stayed null before anything funds it.
 */
async function postJob(api: APIRequestContext, poster: Session, label: string, daysAhead: number): Promise<string> {
  const rows = await readJson<Array<{ id: string; parish: string | null; is_seed: boolean }>>(
    await api.post(`${SUPABASE_URL}/rest/v1/jobs?select=id,parish,is_seed`, {
      headers: rest(poster, { Prefer: "return=representation" }),
      data: {
        customer_id: poster.user.id,
        is_seed: true,
        title: `${E2E_TITLE_MARKER} ${label} ${RUN}`,
        description: `Money-outcome journey ${label} ${RUN}: hang two floating shelves, studs marked, anchors and level on site.`,
        category: "handyman",
        location: "4412 Highland Rd, Baton Rouge, LA 70808",
        parish: null,
        latitude: 30.4028,
        longitude: -91.1714,
        date_needed: centralDatePlus(daysAhead),
        budget: 25,
        status: "open",
        payment_status: "unpaid",
        pricing_mode: "set_price",
      },
    }),
    `insert the ${label} job`,
  );
  expect(rows, `the ${label} job insert returned no row`).toHaveLength(1);
  const job = rows[0];
  // A parish would fan this job out to every real Helpr in it once funded.
  expect(job.parish, `the ${label} job came back WITH a parish — funding it would notify real Helprs`).toBeNull();
  expect(job.is_seed, `the ${label} job is not is_seed`).toBe(true);
  const aged = await readJson<unknown[]>(
    await api.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}&select=id`, {
      headers: rest(poster, { Prefer: "return=representation" }),
      data: { created_at: new Date(Date.now() - 25 * 60_000).toISOString() },
    }),
    `age the ${label} job past early access`,
  );
  expect(aged, `ageing the ${label} job matched zero rows`).toHaveLength(1);
  return job.id;
}

type NotificationRow = { id: string; title: string; type: string; link: string | null; job_id: string | null };

/** Poll one account's notifications with a PostgREST filter until a row lands. */
async function waitForNotification(api: APIRequestContext, who: Session, filter: string, what: string, timeoutMs: number) {
  let rows: NotificationRow[] = [];
  await expect
    .poll(
      async () => {
        rows = await readJson<NotificationRow[]>(
          await api.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${who.user.id}&${filter}&select=id,title,type,link,job_id&order=created_at.desc`, {
            headers: rest(who),
          }),
          `read ${what}`,
        );
        return rows.length;
      },
      { timeout: timeoutMs, intervals: [5_000, 10_000], message: `${what} never landed` },
    )
    .toBeGreaterThan(0);
  return rows;
}

/** Mark read, then delete, the notification rows a leg asserted (own read row DELETE is allowed). */
async function dropNotifications(api: APIRequestContext, who: Session, rows: NotificationRow[]) {
  for (const row of rows) {
    await api.patch(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${row.id}`, { headers: rest(who), data: { read: true } });
    await api.delete(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${row.id}`, { headers: rest(who) });
  }
}

/** Unwind a job this run funded: an unhired one is cancelled (refund), a hired one settled forward, never cancelled. */
async function unwind(api: APIRequestContext, poster: Session, helper: Session, jobId: string) {
  const row = await readRow(api, poster, jobId);
  if (row.status === "cancelled" || ["released", "payout_pending", "refunded"].includes(row.payment_status ?? "")) return "already settled";
  if (row.payment_status === "unpaid") {
    const r = await api.post(`${SUPABASE_URL}/rest/v1/rpc/poster_cancel_job`, {
      headers: rest(poster),
      data: { p_job_id: jobId, p_reason: "E2E money-outcome teardown" },
    });
    return `poster_cancel_job ${r.status()}`;
  }
  if (!row.helper_id) return retireFundedJob(api, poster, jobId);
  const out = await settleJobForward({
    base: SUPABASE_URL,
    anon: ANON,
    posterToken: poster.access_token,
    helperToken: helper.access_token,
    posterId: poster.user.id,
    helperId: helper.user.id,
    jobId,
  });
  return `settle forward: ${out.reason} (${out.status}/${out.paymentStatus})`;
}

test.describe("money outcomes", () => {
  test.skip(!avail.ok, avail.why);
  test.skip(({ browserName }) => browserName === "webkit", "money outcomes run in Chromium only: REST + Stripe's hosted page, already driven in WebKit by 02-marketplace");

  let poster: Session;
  let helper: Session;

  test.beforeAll(async ({ request }) => {
    poster = await getSession(request, "poster");
    helper = await getSession(request, "helper");
    expect(poster.user.id).not.toBe(helper.user.id);
  });

  const cancelledTitle = titleFor("saved-search-then-cancel", "cancelled");
  test(cancelledTitle, async ({ request, browser, journey }) => {
    test.skip(filteredOut(cancelledTitle), "SCENARIO pins another scenario");
    test.setTimeout(12 * 60_000);

    // The helper must be able to receive a job-match alert at all.
    const prefs = await readJson<Array<{ job_matches: boolean | null; match_digest_mode: boolean | null }>>(
      await request.get(`${SUPABASE_URL}/rest/v1/notification_preferences?user_id=eq.${helper.user.id}&select=job_matches,match_digest_mode`, { headers: rest(helper) }),
      "read the helper's notification preferences",
    );
    if (prefs[0] && (prefs[0].job_matches === false || prefs[0].match_digest_mode === true)) {
      skipUncovered(
        "Saved-search alert not drivable",
        `the shared helper has job_matches=${prefs[0].job_matches} / match_digest_mode=${prefs[0].match_digest_mode}; a saved-search match would be muted or batched into the daily digest, not sent. Restore the helper's preferences.`,
      );
    }

    // 1. The helper saves a search that matches ONLY this run's job.
    const token = `ss${RUN}`;
    const search = await readJson<Array<{ id: string }>>(
      await request.post(`${SUPABASE_URL}/rest/v1/saved_searches?select=id`, {
        headers: rest(helper, { Prefer: "return=representation" }),
        data: { user_id: helper.user.id, name: `E2E ${token}`, query: token, notify_enabled: true },
      }),
      "create the helper's saved search",
    );
    journey.cleanup("delete the saved search", () => request.delete(`${SUPABASE_URL}/rest/v1/saved_searches?id=eq.${search[0].id}`, { headers: rest(helper) }));

    // 2. The poster posts and funds a job whose title carries the token.
    const jobId = await postJob(request, poster, `SS ${token}`, 3);
    journey.cleanup("unwind the cancelled-leg job", () => unwind(request, poster, helper, jobId));
    const log: string[] = [];
    await fund(request, browser, poster, await readRow(request, poster, jobId), log);
    test.info().annotations.push({ type: "funded", description: `${jobId}: ${log.join("; ")}` });

    // 3. The saved-search alert: queued inside the funding write
    //    (notify_saved_searches_on_new_job), sent by the per-minute
    //    saved-search-alert-queue sweep once the job is in the helper's feed
    //    (deliver_saved_search_alert: type job_match, link /home?job=<id>).
    const alert = await waitForNotification(request, helper, `type=eq.job_match&link=eq.${encodeURIComponent(`/home?job=${jobId}`)}`, "the helper's saved-search alert", 4 * 60_000);
    expect(alert, "one funded job must produce exactly one saved-search alert").toHaveLength(1);
    journey.cleanup("drop the saved-search alert", () => dropNotifications(request, helper, alert));

    // 4. OUTCOME cancelled: the poster cancels the funded, unhired job through
    //    the app's own door, and the row — not the 200 — says it landed.
    const retired = await retireFundedJob(request, poster, jobId);
    test.info().annotations.push({ type: "outcome", description: `cancelled: ${retired}` });
  });

  const refundedTitle = titleFor("admin-quick-refund", "refunded");
  test(refundedTitle, async ({ request, browser, journey }) => {
    test.skip(filteredOut(refundedTitle), "SCENARIO pins another scenario");
    test.setTimeout(10 * 60_000);

    const jobId = await postJob(request, poster, "QR", 3);
    journey.cleanup("unwind the refund-leg job", () => unwind(request, poster, helper, jobId));
    const log: string[] = [];
    await fund(request, browser, poster, await readRow(request, poster, jobId), log);

    // 1. REFUSAL: the poster owns this funded job and is still refused every
    //    admin money action on it, and nothing moves.
    for (const action of NON_ADMIN_REFUSED) {
      const res = await invoke(request, poster, "create-payment", { action, jobId, reason: "E2E non-admin probe" });
      expect(res.status, `SECURITY: a non-admin's ${action} on its own job answered ${res.status} ${res.text.slice(0, 200)}`).toBeGreaterThanOrEqual(400);
      expect(res.text, `${action} refused the non-admin for some other reason`).toMatch(/admin only/i);
    }
    const untouched = await readRow(request, poster, jobId);
    expect(`${untouched.status}/${untouched.payment_status}`, "a refused admin action still moved the job").toBe("open/escrow");

    // 2. SUCCESS: the admin's Quick Refund. CI-only credential.
    if (!sessionAvailable("admin")) {
      skipUncovered(
        "Admin Quick Refund not driven",
        "PLAYWRIGHT_ADMIN_EMAIL/_PASSWORD are not set here (they exist only as CI secrets in e2e-journeys.yml); the non-admin refusal half ran, the refund did not. The job is unwound by cancel_escrow.",
      );
    }
    const admin = await getSession(request, "admin");
    const since = new Date(Date.now() - 5_000).toISOString();
    const refund = await invoke(request, admin, "create-payment", { action: "admin_refund_general", jobId, reason: `E2E journey Quick Refund ${RUN}` });
    expect(refund.status, `admin_refund_general answered ${refund.status} ${refund.text.slice(0, 300)}`).toBe(200);
    const after = await readRow(request, poster, jobId);
    expect(`${after.status}/${after.payment_status}`, "the Quick Refund answered 200 but the job did not land refunded").toBe("cancelled/refunded");

    // 3. The poster is told, with the server's words and a link to the job.
    const told = await waitForNotification(
      request,
      poster,
      `title=eq.${encodeURIComponent("Refund issued")}&link=eq.${encodeURIComponent(`/posts?job=${jobId}`)}&created_at=gte.${encodeURIComponent(since)}`,
      "the poster's \"Refund issued\" notification",
      60_000,
    );
    journey.cleanup("drop the refund notification", () => dropNotifications(request, poster, told));
    test.info().annotations.push({ type: "outcome", description: `refunded: ${jobId} cancelled/refunded by admin_refund_general` });
  });

  const tipTitle = titleFor("hire-settle-tip", "smooth");
  test(tipTitle, async ({ request, browser, journey }) => {
    test.skip(filteredOut(tipTitle), "SCENARIO pins another scenario");
    test.setTimeout(15 * 60_000);

    const prefs = await readJson<Array<{ financial_alerts: boolean | null }>>(
      await request.get(`${SUPABASE_URL}/rest/v1/notification_preferences?user_id=eq.${helper.user.id}&select=financial_alerts`, { headers: rest(helper) }),
      "read the helper's financial-alerts preference",
    );
    if (prefs[0]?.financial_alerts === false) {
      skipUncovered("Tip notification not drivable", "the shared helper has financial_alerts OFF, so notify_helper_on_tip sends nothing. Restore the helper's preferences.");
    }

    // 1. Post (today, so the day-of doors are open), fund, apply, hire.
    const jobId = await postJob(request, poster, "TIP", 0);
    journey.cleanup("unwind the tip-leg job", () => unwind(request, poster, helper, jobId));
    const log: string[] = [];
    await fund(request, browser, poster, await readRow(request, poster, jobId), log);
    await readJson(
      await request.post(`${SUPABASE_URL}/rest/v1/rpc/apply_to_job`, { headers: rest(helper), data: { p_job_id: jobId, p_message: `Money-outcome journey ${RUN}: happy to help.` } }),
      "helper applies",
    );
    const apps = await readJson<Array<{ id: string }>>(
      await request.get(`${SUPABASE_URL}/rest/v1/applications?job_id=eq.${jobId}&helper_id=eq.${helper.user.id}&status=eq.pending&select=id`, { headers: rest(poster) }),
      "poster reads the application",
    );
    expect(apps, "the helper's application is not visible to the poster").toHaveLength(1);
    await readJson(
      await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_application`, {
        headers: rest(poster),
        data: { p_application_id: apps[0].id, p_deadline: new Date(Date.now() + 24 * 3_600_000).toISOString(), p_offer_message: null },
      }),
      "poster hires the helper",
    );

    // 2. Settle it forward down the product's own doors (arrival, confirm,
    //    proof, Done, release). Never cancelled: that would strike the poster.
    const settled = await settleJobForward({
      base: SUPABASE_URL,
      anon: ANON,
      posterToken: poster.access_token,
      helperToken: helper.access_token,
      posterId: poster.user.id,
      helperId: helper.user.id,
      jobId,
      log: (line: string) => test.info().annotations.push({ type: "settle-forward", description: line.trim() }),
    });
    expect(settled.settled, `settling the hired job forward did not finish: ${settled.reason} (${settled.status}/${settled.paymentStatus})`).toBe(true);
    expect((await readRow(request, poster, jobId)).status, "a released job must be completed before it can be tipped").toBe("completed");

    // 3. The tip, through the same create-payment door TipDialog calls, paid on
    //    Stripe's hosted page. cs_test_ or it is not paid at all.
    const since = new Date(Date.now() - 5_000).toISOString();
    const tip = await invoke(request, poster, "create-payment", { action: "tip", jobId, amount: 3, tipAttemptId: randomUUID(), native: false });
    const url = typeof tip.json.url === "string" ? tip.json.url : "";
    expect(tip.status === 200 && url, `create-payment tip refused: ${tip.status} ${tip.text.slice(0, 300)}`).toBeTruthy();
    expect(stripeModeFromCheckoutUrl(url), "the tip Checkout is not a Stripe TEST session — refusing to pay it").toBe("test");
    // An untracked, signed-out context, like fund()'s: after paying, Stripe
    // returns to the app's success_url, and a signed-out landing there is not
    // the screen under test (its client reports must not be read as this leg's).
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await payOnStripeCheckout(page);
    } finally {
      await ctx.close();
    }

    // 4. The helper's tip notification: notify_helper_on_tip, fired when the
    //    webhook flips the tips row to paid (type financial_alerts).
    const tipped = await waitForNotification(
      request,
      helper,
      `type=eq.financial_alerts&job_id=eq.${jobId}&created_at=gte.${encodeURIComponent(since)}`,
      "the helper's tip notification",
      3 * 60_000,
    );
    expect(tipped[0].title, "the tip notification does not name the amount").toMatch(/\$3/);
    // RECORDED, not asserted: stripe-webhook's checkoutSessionCompleted writes
    // its own "You received a tip!" row for the same tip. Two in-app rows for
    // one tip is a suspected duplicate, reported rather than locked in here.
    const webhookRows = await readJson<NotificationRow[]>(
      await request.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${helper.user.id}&job_id=eq.${jobId}&created_at=gte.${encodeURIComponent(since)}&select=id,title,type,link,job_id`, { headers: rest(helper) }),
      "read every tip-time notification for the helper",
    );
    test.info().annotations.push({
      type: "tip-notifications",
      description: `${webhookRows.length} helper row(s) for one $3 tip on ${jobId}: ${webhookRows.map((r) => `${r.type}:"${r.title}"`).join(", ")}`,
    });
    journey.cleanup("drop the tip notifications", () => dropNotifications(request, helper, webhookRows));
  });

  test("outcomes and admin paths no journey drives are annotated uncovered", async () => {
    // Not a pass for them: each is a visible ::warning with its concrete reason,
    // and the registries' guards keep the lists honest in both directions.
    for (const [outcome, u] of Object.entries(OUTCOME_UNDRIVEN)) {
      const where = u?.elsewhere ? ` Driven elsewhere: ${u.elsewhere.file} (${u.elsewhere.door}).` : "";
      announceUncovered(`Outcome "${outcome}" not driven by a journey`, `${u?.why}${where}`);
      test.info().annotations.push({ type: "uncovered", description: `outcome ${outcome}: ${u?.why}${where}` });
    }
    for (const p of uncoveredAdminPaths()) {
      test.info().annotations.push({ type: "uncovered", description: `admin ${p.path} (${p.half}): ${p.why}` });
    }
    const n = uncoveredAdminPaths().length;
    announceUncovered(`${n} admin write path halves not driven`, uncoveredAdminPaths().map((p) => `${p.path} (${p.half})`).join(", "));
    expect(Object.keys(OUTCOME_UNDRIVEN).length + n, "nothing to annotate — the registries are empty, which the guards forbid").toBeGreaterThan(0);
  });
});
