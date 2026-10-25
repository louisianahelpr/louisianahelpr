/**
 * The abandoned-checkout nudge (lead, 2026-10-25), run for real through the
 * edge harness: stripe-webhook's checkout.session.expired and the one-job
 * checkout-nudge-backfill.
 *
 * Before: a poster who opened checkout and walked away got nothing
 * (checkoutSessionExpired.ts: "A job that was merely abandoned (still
 * 'unpaid') gets no notice"). Now, once per job and only while the
 * checkout_nudge switch is on for the poster, the expiry writes ONE "Finish
 * posting your job" notice linking to Post a job with the job filled in, and
 * sends its email through send-notification-email (which applies the
 * member's email switch, the suppression list and the test-recipient gate).
 *
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts |     if (released && released.payment_status === "unpaid" && released.customer_id) { |     if (released && released.customer_id) {
 * @mutate supabase/functions/_shared/checkoutNudge.ts |     if (claim === "switch_off") return { status: "switch_off" }; |
 * @mutate supabase/functions/_shared/checkoutNudge.ts |     if (claim === "duplicate") return { status: "duplicate" }; |
 * @mutate supabase/functions/_shared/checkoutNudge.ts |     if (claimErr) return { status: "failed", error: `claim: ${claimErr.message}` }; |
 * @mutate supabase/functions/_shared/checkoutNudge.ts |   return `/post-job?rebook=${encodeURIComponent(jobId)}`; |   return "/post-job";
 * @mutate supabase/functions/_shared/checkoutNudge.ts |       type: "job_update",\n      link, |       type: "job_update",\n      link: null,
 * @mutate supabase/functions/checkout-nudge-backfill/index.ts |   const denied = verifyCronSecret(req);\n  if (denied) return denied; |   const denied = null;
 * @mutate supabase/functions/checkout-nudge-backfill/index.ts | const NUDGEABLE = new Set(["unpaid", "abandoned", "failed"]); | const NUDGEABLE = new Set(["unpaid", "abandoned", "failed", "escrow"]);
 * @mutate supabase/functions/checkout-nudge-backfill/index.ts |       ownerApprovedJob: true, |       ownerApprovedJob: false,
 * @mutate supabase/functions/_shared/checkoutNudge.ts |       p_owner_approved: input.ownerApprovedJob === true, |       p_owner_approved: false,
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, notificationEmails } from "./mocks/shared";
import { CHECKOUT_NUDGE_TITLE, checkoutNudgeMessage } from "../../../supabase/functions/_shared/checkoutNudge";

const SERVICE = "service-key";

async function webhook(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}

async function expire(paymentStatus: string, claim: string | null = "claimed") {
  const fn = await webhook();
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: `evt_expired_${paymentStatus}`,
    type: "checkout.session.expired",
    data: { object: { id: "cs_1", metadata: { job_id: "job-1" } } },
  });
  if (claim !== null) scenario.rpc.claim_checkout_nudge = claim;
  scenario.writeSelectRows["jobs:update"] = [
    { id: "job-1", customer_id: "poster-1", title: "Mow the back yard", payment_status: paymentStatus },
  ];
  scenario.writeSelectRows["notifications:insert"] = [{ id: "notif-1" }];
  const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
  return res;
}

const nudgeNotice = () =>
  scenario.writes.find((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).title === CHECKOUT_NUDGE_TITLE);
const claims = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "claim_checkout_nudge");

beforeEach(() => {
  resetSupabaseMock();
  resetStripeMock();
  resetSharedMocks();
});
afterEach(() => resetEnv());

describe("checkout.session.expired on an abandoned (unpaid) job", () => {
  it("switch on: claims the job, writes ONE notice to the form with the job filled in, and emails it", async () => {
    const res = await expire("unpaid");
    expect(res.status).toBe(200);
    expect(claims().length).toBe(1);
    expect(claims()[0].args).toEqual({ p_job_id: "job-1", p_user_id: "poster-1", p_session_id: "cs_1", p_owner_approved: false });
    const n = nudgeNotice();
    expect(n?.payload).toMatchObject({
      user_id: "poster-1",
      job_id: "job-1",
      type: "job_update",
      link: "/post-job?rebook=job-1",
      message: checkoutNudgeMessage("Mow the back yard"),
    });
    expect(notificationEmails.length).toBe(1);
    expect(notificationEmails[0]).toMatchObject({ notification_id: "notif-1", user_id: "poster-1", type: "job_update", link: "/post-job?rebook=job-1" });
    // The outcome is written on the claim.
    const stamp = scenario.writes.find((w) => w.table === "job_checkout_nudges" && w.op === "update");
    expect(stamp?.payload).toMatchObject({ notification_id: "notif-1", emailed: true });
  });

  it("switch off for this poster: no notice, no email", async () => {
    await expire("unpaid", "switch_off");
    expect(claims().length).toBe(1);
    expect(nudgeNotice()).toBeUndefined();
    expect(notificationEmails.length).toBe(0);
  });

  it("already nudged (the claim answers duplicate): no second notice or email", async () => {
    const res = await expire("unpaid", "duplicate");
    expect(res.status).toBe(200);
    expect(nudgeNotice()).toBeUndefined();
    expect(notificationEmails.length).toBe(0);
  });

  it("a declined card ('failed') keeps its own not-posted notice and gets no nudge", async () => {
    await expire("failed");
    expect(claims().length).toBe(0);
    expect(nudgeNotice()).toBeUndefined();
    expect(scenario.writes.find((w) => w.table === "notifications")).toBeDefined();
  });

  it("a nudge that cannot be written never fails the event (the hold release stands; Stripe is not asked to retry)", async () => {
    scenario.rpcErrors = { claim_checkout_nudge: { message: "connection reset", code: "08006" } };
    const res = await expire("unpaid");
    expect(res.status).toBe(200);
    expect(nudgeNotice()).toBeUndefined();
  });
});

async function backfill(body: unknown, bearer = SERVICE) {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE });
  const fn = await loadEdgeFunction("checkout-nudge-backfill");
  return fn.fetch(fn.request({ url: "https://edge.test/checkout-nudge-backfill", headers: { Authorization: `Bearer ${bearer}` }, body }));
}
const JOB = "a136491d-92f2-4f4d-be86-1896fdbaecd8";

describe("checkout-nudge-backfill: ONE owner-approved job", () => {
  it("refuses anyone without the service key", async () => {
    const res = await backfill({ job_id: JOB }, "anon-key");
    expect(res.status).toBe(401);
    expect(claims().length).toBe(0);
  });

  it("an 'abandoned' open job gets the same notice and email, without asking the switch", async () => {
    scenario.reads.jobs = { rows: [{ id: JOB, customer_id: "poster-9", title: "Haul a couch", status: "open", payment_status: "abandoned" }] };
    scenario.writeSelectRows["notifications:insert"] = [{ id: "notif-9" }];
    scenario.rpc.claim_checkout_nudge = "claimed";
    const res = await backfill({ job_id: JOB });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "sent", emailed: true });
    expect(claims()[0].args).toEqual({ p_job_id: JOB, p_user_id: "poster-9", p_session_id: null, p_owner_approved: true });
    expect(nudgeNotice()?.payload).toMatchObject({ link: `/post-job?rebook=${JOB}` });
    expect(notificationEmails.length).toBe(1);
  });

  it("a second call sends nothing (the claim makes it once)", async () => {
    scenario.reads.jobs = { rows: [{ id: JOB, customer_id: "poster-9", title: "Haul a couch", status: "open", payment_status: "abandoned" }] };
    scenario.rpc.claim_checkout_nudge = "duplicate";
    const res = await backfill({ job_id: JOB });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "duplicate" });
    expect(nudgeNotice()).toBeUndefined();
    expect(notificationEmails.length).toBe(0);
  });

  it("refuses a funded job, a cancelled job, and a bad id", async () => {
    scenario.reads.jobs = { rows: [{ id: JOB, customer_id: "poster-9", title: "x", status: "open", payment_status: "escrow" }] };
    expect((await backfill({ job_id: JOB })).status).toBe(409);
    scenario.reads.jobs = { rows: [{ id: JOB, customer_id: "poster-9", title: "x", status: "cancelled", payment_status: "abandoned" }] };
    expect((await backfill({ job_id: JOB })).status).toBe(409);
    expect((await backfill({ job_id: "not-a-uuid" })).status).toBe(400);
    expect(claims().length).toBe(0);
  });
});
