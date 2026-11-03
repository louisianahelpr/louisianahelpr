/**
 * Q1983: a gift an earlier, never-funded checkout left 'redeemed' on a job (a bank debit that bounced with the
 * gift's return held, or a Q1876 return skipped because the poster's retry moved the job off 'failed') stays spent
 * when the poster's next checkout pays the job in full by card. checkoutSessionCompleted now pages ops once a day
 * per gift, naming the job, the poster's first name and the amount (seed jobs to the digest). Not paged: the gift
 * this checkout consumed itself (a gift difference payment), a gift with a replacement already minted for the job,
 * a bank checkout still settling, and a failed gift read (it never blocks the funding).
 *
 * Runs the REAL stripe-webhook source via the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |       if (!isAsyncPayment) {\n        await pageGiftLeftSpentOnCardFunding( |       if (false) {\n        await pageGiftLeftSpentOnCardFunding(
 * @mutate supabase/functions/stripe-webhook/handlers/_giftLeftSpentOnCardFunding.ts | && g.id !== consumedGiftId); | );
 * @mutate supabase/functions/stripe-webhook/handlers/_giftLeftSpentOnCardFunding.ts |     if (Array.isArray(replacements) && replacements.length > 0) return "none"; |
 * @mutate supabase/functions/stripe-webhook/handlers/_giftLeftSpentOnCardFunding.ts |         seed: job?.is_seed === true, |         seed: false,
 * @mutate supabase/functions/stripe-webhook/handlers/_giftLeftSpentOnCardFunding.ts | Job ${jobId} ("${title}") was just paid in full by card, but ${poster}'s $${dollars} | Job ${jobId} was just paid in full by card, but the poster's
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}

type Alert = { title?: string; message?: string; severity?: string; seed?: boolean; oncePerDayKey?: string; fields?: Record<string, unknown> };
const giftAlerts = () => (slackAlerts as Alert[]).filter((a) => a.title === "Gift card still spent on a job the poster paid in full by card");

async function deliver(opts: {
  gifts?: Array<{ id: string; amount: number; status: string; job_id: string }>;
  replacements?: Array<{ id: string }>;
  giftReadFails?: boolean;
  isSeed?: boolean;
  paymentStatus?: "paid" | "unpaid";
  sessionGiftId?: string;
}) {
  const fn = await loadConfigured();
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: "evt_q1983",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_q1983", mode: "payment", payment_status: opts.paymentStatus ?? "paid", customer_email: "poster@test.com",
        payment_intent: "pi_q1983",
        metadata: { job_id: "job-1", ...(opts.sessionGiftId ? { gift_card_id: opts.sessionGiftId } : {}) },
      },
    },
  });
  scenario.reads.gift_cards = {
    rows: [],
    selectOverrides: [
      { includes: "id, amount, status, job_id", result: opts.giftReadFails ? { rows: [], error: { message: "boom" } } : { rows: opts.gifts ?? [] } },
      { includes: "id", result: { rows: opts.replacements ?? [] } },
    ],
  } as never;
  scenario.reads.jobs = {
    rows: [],
    selectOverrides: [{ includes: "title, is_seed, customer_id", result: { rows: [{ title: "Move a couch", is_seed: opts.isSeed ?? false, customer_id: "poster-1" }] } }],
  } as never;
  scenario.reads.profiles = {
    rows: [],
    selectOverrides: [{ includes: "full_name", result: { rows: [{ full_name: "Dana Poster" }] } }],
  } as never;
  const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
  return res;
}

const STALE = { id: "gift-old", amount: 25, status: "redeemed", job_id: "job-1" };

describe("Q1983: a gift left spent by a never-funded checkout is paged when a card pays the job", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("pages once, naming the job, the poster's first name and the gift amount", async () => {
    const res = await deliver({ gifts: [STALE] });
    expect(res.status).toBe(200);
    const a = giftAlerts();
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe("critical");
    expect(a[0].seed).toBe(false);
    expect(a[0].message).toContain('"Move a couch"');
    expect(a[0].message).toContain("Dana's $25.00 gift card gift-old");
    expect(a[0].fields).toMatchObject({ job_id: "job-1", job_title: "Move a couch", poster: "Dana", gift_card_id: "gift-old", gift_amount: "$25.00" });
    expect(a[0].oncePerDayKey).toBe("gift-spent-card-funded:gift-old");
    // The funding itself still happened.
    expect(scenario.writes.some((w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "escrow")).toBe(true);
  });

  it("a seed job's page goes to the digest", async () => {
    await deliver({ gifts: [STALE], isSeed: true });
    expect(giftAlerts()).toHaveLength(1);
    expect(giftAlerts()[0].seed).toBe(true);
  });

  it("the gift this checkout consumed itself (a difference payment) is not paged", async () => {
    await deliver({ gifts: [STALE], sessionGiftId: "gift-old" });
    expect(giftAlerts()).toHaveLength(0);
  });

  it("a gift with a replacement already minted for the job is not paged", async () => {
    await deliver({ gifts: [STALE], replacements: [{ id: "gift-new" }] });
    expect(giftAlerts()).toHaveLength(0);
  });

  it("no redeemed gift on the job: nothing paged", async () => {
    await deliver({ gifts: [] });
    expect(giftAlerts()).toHaveLength(0);
  });

  it("a bank checkout still settling is not paged (the job is not funded yet)", async () => {
    await deliver({ gifts: [STALE], paymentStatus: "unpaid" });
    expect(giftAlerts()).toHaveLength(0);
  });

  it("a failed gift read pages nothing and never blocks the funding", async () => {
    const res = await deliver({ gifts: [STALE], giftReadFails: true });
    expect(res.status).toBe(200);
    expect(giftAlerts()).toHaveLength(0);
    expect(scenario.writes.some((w) => w.table === "jobs" && w.op === "update")).toBe(true);
  });

  it("reads a real inventory (floor)", async () => {
    await deliver({ gifts: [STALE, { ...STALE, id: "gift-old-2", amount: 10 }] });
    expect(giftAlerts().length).toBeGreaterThan(1);
  });
});
