/**
 * Q2399 (owner 2026-10-25): hold the poster's card when a job is posted and
 * charge it only when someone is hired. The LIVE Stripe test-mode proof of
 * the hold, on prod with the shared test accounts (Stripe TEST mode, 4242):
 *
 *   hold -> hire -> capture   poster-e2e posts a job 2 days out (held at
 *              posting), pays the hosted Checkout, and the job lands 'held'
 *              with an authorized hold (get_my_job_card_hold). helper-e2e
 *              applies and is hired; the database REFUSES the Helpr's accept
 *              on the held card (payment_not_captured); create-payment
 *              capture_hold charges it (escrow); the accept then completes.
 *              Unwound by settleForward, as every hired journey job is.
 *   hold -> nobody hired -> cancel   a second job is held, the poster closes it
 *              (cancel_escrow); the hold is released (no refund), the job is
 *              cancelled/cancelled and the poster is told their card was not
 *              charged.
 *   hold -> expire -> cancel   a third job is held, the poster cancels it
 *              through the Cancel button's RPC (poster_cancel_job, as the
 *              expiry sweep closes a job), and card-hold-sweep (every 10 min)
 *              releases the hold and tells the poster.
 *
 * The switch card_hold_at_post is created OFF (lead, 2026-10-25) and turned on
 * for testers after landing; until then every leg is announced uncovered and
 * skipped (today's money journeys run unchanged). Every job is is_seed, carries
 * E2E_TITLE_MARKER and parish NULL (no real Helpr is notified), and a hired job
 * is settled forward, never cancelled.
 *
 * @mutate-exempt Subject is deployed edge functions (create-payment, stripe-webhook, card-hold-sweep), the hold migration and Stripe test-mode Checkout reached over REST; the vacuity gate never deploys either. The same paths are pinned with registered mutations in src/test/edge/card-hold.test.ts, src/test/pglite/cardHoldAtPost.pglite.mjs and src/test/fundedSetsAreClassified.test.ts.
 */
import type { APIRequestContext } from "@playwright/test";
import {
  test,
  expect,
  getSession,
  rest,
  sessionsAvailable,
  skipUncovered,
  E2E_TITLE_MARKER,
  SUPABASE_URL,
  ANON,
  type Session,
} from "./fixtures";
import { fitJobTitle } from "../../scripts/lib/jobTextBounds.mjs";
import { centralDatePlus, fund, readRow } from "../prod-audit/fundedOpenJob";
import { settleJobForward } from "../../scripts/e2e/settleForward.mjs";
import { ageJobPastEarlyAccess } from "../ageJobPastEarlyAccess";
import { captureHeldCard } from "../cardHold";
import { CARD_HOLD_COPY } from "../../supabase/functions/_shared/cardHoldCopy";

const avail = sessionsAvailable();
const RUN = Date.now().toString(36).slice(-6);

async function readJson<T>(r: { ok(): boolean; status(): number; text(): Promise<string> }, what: string): Promise<T> {
  const body = await r.text();
  expect(r.ok(), `${what}: HTTP ${r.status()} ${body.slice(0, 300)}`).toBe(true);
  return (body ? JSON.parse(body) : null) as T;
}

/** One job 2 days out (held at posting), parish NULL, aged past early access. */
async function postJob(api: APIRequestContext, poster: Session, label: string): Promise<string> {
  const rows = await readJson<Array<{ id: string; parish: string | null }>>(
    await api.post(`${SUPABASE_URL}/rest/v1/jobs?select=id,parish`, {
      headers: rest(poster, { Prefer: "return=representation" }),
      data: {
        customer_id: poster.user.id, is_seed: true, title: fitJobTitle(`${E2E_TITLE_MARKER} hold ${label}`),
        description: `Card-hold journey ${label}: rake and bag the front yard, bags and rakes on site.`,
        category: "yard_work", location: "4412 Highland Rd, Baton Rouge, LA 70808", parish: null,
        latitude: 30.4028, longitude: -91.1714, date_needed: centralDatePlus(2), budget: 25,
        status: "open", payment_status: "unpaid", pricing_mode: "set_price",
      },
    }),
    `insert the ${label} job`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].parish, "a job with a parish would notify real Helprs").toBeNull();
  await ageJobPastEarlyAccess(SUPABASE_URL, rows[0].id, `the ${label} job`);
  return rows[0].id;
}

async function myHold(api: APIRequestContext, poster: Session, jobId: string) {
  const rows = await readJson<Array<{ state: string; amount_cents: number }>>(
    await api.post(`${SUPABASE_URL}/rest/v1/rpc/get_my_job_card_hold`, { headers: rest(poster), data: { p_job_id: jobId } }),
    "read get_my_job_card_hold",
  );
  return rows[0] ?? null;
}

async function heldJob(api: APIRequestContext, browser: Parameters<typeof fund>[1], poster: Session, label: string): Promise<string> {
  const jobId = await postJob(api, poster, label);
  await fund(api, browser, poster, await readRow(api, poster, jobId), []);
  const row = await readRow(api, poster, jobId);
  expect(row.payment_status, "a card-hold checkout did not leave the job held").toBe("held");
  expect(row.stripe_payment_intent_id, "a held job carries its authorized PaymentIntent").toMatch(/^pi_/);
  const hold = await myHold(api, poster, jobId);
  expect(hold?.state, "the hold is not authorized").toBe("authorized");
  expect(hold?.amount_cents ?? 0).toBeGreaterThanOrEqual(2500);
  return jobId;
}

async function notCharged(api: APIRequestContext, poster: Session, jobId: string, timeoutMs: number) {
  await expect
    .poll(async () => {
      const rows = await readJson<Array<{ title: string }>>(
        await api.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${poster.user.id}&job_id=eq.${jobId}&select=title`, { headers: rest(poster) }),
        "read the poster's notices",
      );
      return rows.some((r) => r.title === CARD_HOLD_COPY.releasedTitle);
    }, { timeout: timeoutMs, message: "the poster was never told their card was not charged" })
    .toBe(true);
}

test.describe("card hold at posting (Q2399)", () => {
  test.skip(!avail.ok, avail.why);
  test.skip(({ browserName }) => browserName === "webkit", "REST + Stripe's hosted page, Chromium only (as 04-money-outcomes)");

  let poster: Session;
  let helper: Session;

  test.beforeAll(async ({ request }) => {
    poster = await getSession(request, "poster");
    helper = await getSession(request, "helper");
  });

  test.beforeEach(async ({ request }) => {
    const on = await readJson<boolean>(
      await request.post(`${SUPABASE_URL}/rest/v1/rpc/feature_enabled_for`, { headers: rest(poster), data: { p_key: "card_hold_at_post" } }),
      "read card_hold_at_post for poster-e2e",
    );
    if (on !== true) {
      skipUncovered("Card hold not driven", "card_hold_at_post is not on for poster-e2e (created off; the lead turns it on for testers after landing), so checkouts still capture at posting and the money journeys cover that.");
    }
  });

  test("hold -> hire -> capture: nothing is charged until the Helpr accepts", async ({ request, browser }) => {
    test.setTimeout(10 * 60_000);
    const jobId = await heldJob(request, browser, poster, `hire${RUN}`);
    try {
      await readJson(await request.post(`${SUPABASE_URL}/rest/v1/rpc/apply_to_job`, { headers: rest(helper), data: { p_job_id: jobId, p_message: `Card-hold journey ${RUN}` } }), "apply_to_job");
      const apps = await readJson<Array<{ id: string }>>(
        await request.get(`${SUPABASE_URL}/rest/v1/applications?job_id=eq.${jobId}&helper_id=eq.${helper.user.id}&select=id`, { headers: rest(helper) }),
        "read the application",
      );
      await readJson(await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_application`, {
        headers: rest(poster), data: { p_application_id: apps[0].id, p_deadline: new Date(Date.now() + 3_600_000).toISOString() },
      }), "accept_application (the poster's Hire is an offer: allowed on a held card)");
      expect((await readRow(request, poster, jobId)).payment_status, "the Hire must not charge").toBe("held");

      const refused = await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_job_offer`, { headers: rest(helper), data: { p_job_id: jobId } });
      expect(refused.ok(), "the database let a hire complete on a card that was only held").toBe(false);
      expect(await refused.text()).toMatch(/payment_not_captured/);

      expect(await captureHeldCard(request, helper, jobId)).toBe("captured");
      expect((await readRow(request, poster, jobId)).payment_status, "the capture did not move the job to escrow").toBe("escrow");
      expect((await myHold(request, poster, jobId))?.state).toBe("captured");

      const accepted = await readJson<{ state?: string }>(
        await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_job_offer`, { headers: rest(helper), data: { p_job_id: jobId } }),
        "accept_job_offer after the capture",
      );
      expect(accepted.state).toBe("accepted");
    } finally {
      const out = await settleJobForward({
        base: SUPABASE_URL, anon: ANON, posterToken: poster.access_token, helperToken: helper.access_token,
        posterId: poster.user.id, helperId: helper.user.id, jobId,
      });
      test.info().annotations.push({ type: "cleanup", description: `settle forward: ${out.reason} (${out.status}/${out.paymentStatus})` });
    }
  });

  test("hold -> nobody hired -> cancel: the hold is released, never refunded", async ({ request, browser }) => {
    test.setTimeout(6 * 60_000);
    const jobId = await heldJob(request, browser, poster, `cancel${RUN}`);
    const res = await readJson<{ success?: boolean; released?: boolean }>(
      await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, { headers: rest(poster), data: { action: "cancel_escrow", jobId } }),
      "cancel_escrow on the held job",
    );
    expect(res.released, "cancel_escrow did not release the hold").toBe(true);
    const row = await readRow(request, poster, jobId);
    expect(`${row.status}/${row.payment_status}`).toBe("cancelled/cancelled");
    expect((await myHold(request, poster, jobId))?.state).toBe("released");
    const refunds = await readJson<unknown[]>(
      await request.get(`${SUPABASE_URL}/rest/v1/payment_refunds?job_id=eq.${jobId}&select=id`, { headers: rest(poster) }),
      "read payment_refunds",
    );
    expect(refunds, "a released hold wrote a refund").toHaveLength(0);
    await notCharged(request, poster, jobId, 60_000);
  });

  test("hold -> expire -> cancel: card-hold-sweep releases the hold of a job closed unhired", async ({ request, browser }) => {
    test.setTimeout(16 * 60_000);
    const jobId = await heldJob(request, browser, poster, `expire${RUN}`);
    await readJson(await request.post(`${SUPABASE_URL}/rest/v1/rpc/poster_cancel_job`, {
      headers: rest(poster), data: { p_job_id: jobId, p_reason: "E2E card-hold expiry leg" },
    }), "poster_cancel_job (the close the expiry sweep makes)");
    // card-hold-sweep runs every 10 minutes ('3-59/10 * * * *').
    await expect
      .poll(async () => (await readRow(request, poster, jobId)).payment_status, { timeout: 12 * 60_000, intervals: [30_000], message: "card-hold-sweep never released the hold" })
      .toBe("cancelled");
    expect((await myHold(request, poster, jobId))?.state).toBe("released");
    await notCharged(request, poster, jobId, 60_000);
  });
});
