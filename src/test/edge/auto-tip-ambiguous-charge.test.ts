/**
 * ME-011: auto-tip-charge treated EVERY throw from paymentIntents.create as a
 * decline — marked the tip failed and told the poster "Your tip didn't go
 * through". A lost response or Stripe 5xx can follow a charge that succeeded,
 * so that told a charged poster they had not paid. Only a Stripe card/request
 * error proves no charge; anything else retries once on the same idempotency
 * key, and if still unknown leaves the row pending, tells nobody it failed, and
 * turns the run red.
 */
//
// @mutate supabase/functions/auto-tip-charge/index.ts |           if (isDefiniteRefusal(firstErr)) throw firstErr; |           throw firstErr;
// @mutate supabase/functions/auto-tip-charge/index.ts |         if (err instanceof AmbiguousCharge) { |         if (false) {
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const stripeErr = (type: string, message: string) => Object.assign(new Error(message), { type });

async function run(...outcomes: Array<Error | { id: string; status: string }>) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET: "cron-secret",
  });
  const fn = await loadEdgeFunction("auto-tip-charge");
  scenario.rpc.auto_tip_candidates = [
    { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10 },
  ];
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
  scenario.adminUsers = { "poster-1": { email: "poster@test.com" } };
  stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }] });
  stripeMock.paymentMethods.list.mockResolvedValue({ data: [{ id: "pm_1" }] });
  for (const o of outcomes) {
    if (o instanceof Error) stripeMock.paymentIntents.create.mockRejectedValueOnce(o);
    else stripeMock.paymentIntents.create.mockResolvedValueOnce(o);
  }
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
  return JSON.parse(await res.text()) as { defectReasons?: string[] };
}

const tipUpdates = () => scenario.writes.filter((w) => w.table === "tips" && w.op === "update").map((w) => w.payload as Record<string, unknown>);
const failedNotice = () =>
  scenario.writes.some((w) => w.table === "notifications" && (w.payload as { title?: string }).title === "Your tip didn't go through");

describe("auto-tip: an unknown charge outcome is not a decline (ME-011)", () => {
  beforeEach(() => { resetEnv(); resetStripeMock(); resetSupabaseMock(); resetSharedMocks(); });

  it("a card decline still marks failed and tells the poster", async () => {
    await run(stripeErr("StripeCardError", "Your card was declined."));
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect(tipUpdates().some((p) => p.payment_status === "failed")).toBe(true);
    expect(failedNotice()).toBe(true);
  });

  it("a lost response retries on the same key and settles as paid when Stripe replays success", async () => {
    await run(stripeErr("StripeConnectionError", "socket hang up"), { id: "pi_1", status: "succeeded" });
    const keys = stripeMock.paymentIntents.create.mock.calls.map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(tipUpdates().some((p) => p.payment_status === "paid")).toBe(true);
    expect(failedNotice()).toBe(false);
  });

  it("still unknown after the retry: row not failed, poster not told, run red", async () => {
    const b = await run(stripeErr("StripeAPIError", "internal error"), new Error("network timeout"));
    expect(tipUpdates().some((p) => p.payment_status === "failed")).toBe(false);
    expect(tipUpdates().some((p) => String(p.failure_reason).startsWith("ambiguous:"))).toBe(true);
    expect(failedNotice()).toBe(false);
    expect((b.defectReasons ?? []).join(" ")).toMatch(/outcome UNKNOWN/);
  });
});
