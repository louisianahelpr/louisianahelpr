/**
 * A cancelled recurring-series visit that was never filled, or that a
 * PERMANENT BAN ended, is refunded IN FULL, the service fee included, with no
 * cancellation fee (money audit 2026-09-25 MEDIUM-9; owner decisions Q407 (5)
 * "a date still unfilled when it arrives is not charged" and (9) "future
 * visits are cancelled and not charged"). Every other cancellation keeps its
 * rule: the service fee is withheld.
 *
 * Runs the REAL function source via the edge harness, with the real
 * `_shared/seriesRefund.ts`.
 *
 * @mutate supabase/functions/_shared/seriesRefund.ts |   return !!job.parent_job_id && !job.helper_id; |   return false;
 * @mutate supabase/functions/_shared/seriesRefund.ts |   if (job.cancellation_reason === SERIES_BAN_CANCEL_REASON) return true; |   if (false) return true;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |           const nonRefundableCents = fullSeriesRefund\n            ? 0 |           const nonRefundableCents = false\n            ? 0
 * @mutate supabase/functions/void-cancelled-payments/index.ts | helper_fee_percent, parent_job_id, cancellation_reason") | helper_fee_percent")
 * @mutate supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql |              cancellation_reason = 'series_ended_account_banned', |              cancellation_reason = 'series ended',
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { blankSqlComments } from "../helpers/blankNonCode";

const CRON_SECRET = "cron-secret-void";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_void",
    CRON_SECRET,
  });
  return loadEdgeFunction("void-cancelled-payments");
}

const cronReq = () =>
  new Request("https://x/functions/v1/void-cancelled-payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

/** A $100 visit + $10 service fee captured, cancelled, in escrow. */
function seed(job: Record<string, unknown>) {
  scenario.reads.jobs = {
    selectOverrides: [
      {
        includes: "cancellation_fee",
        result: {
          rows: [{
            id: "visit-1", title: "Weekly walk", stripe_session_id: null, stripe_payment_intent_id: "pi_visit",
            budget: 100, customer_fee_amount: 10, cancellation_fee: 0,
            // Tomorrow morning, so a committed Helpr would put a late fee on it.
            date_needed: "2026-09-06", start_time: "09:00:00", cancelled_at: "2026-09-05T17:00:00Z",
            helper_id: "helper-1", helper_confirmed_at: "2026-09-01T00:00:00Z",
            customer_id: "poster-1", helper_fee_percent: 10,
            parent_job_id: null, cancellation_reason: null,
            ...job,
          }],
        },
      },
    ],
    rows: [],
  };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_visit", status: "succeeded", amount: 11000, amount_received: 11000, latest_charge: null,
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_visit", amount: 11000 });
}

async function refundedCents(): Promise<number | null> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-05T17:00:00Z"));
  try {
    const h = await load();
    await h.fetch(cronReq());
  } finally {
    vi.useRealTimers();
  }
  const call = stripeMock.refunds.create.mock.calls[0];
  return call ? (call[0] as { amount?: number }).amount ?? null : null;
}

describe("void-cancelled-payments: an unfilled or ban-ended series visit is refunded in full", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  it("control: an ordinary cancelled job keeps the service fee (and the late fee)", async () => {
    seed({});
    const cents = await refundedCents();
    expect(cents).not.toBeNull();
    expect(cents!).toBeLessThan(11000 - 1000 + 1);
  });

  it("an UNFILLED series visit (no Helpr on it) gets every cent back", async () => {
    seed({ parent_job_id: "series-1", helper_id: null, helper_confirmed_at: null });
    expect(await refundedCents()).toBe(11000);
  });

  it("a visit a PERMANENT BAN cancelled gets every cent back, with no late fee though a Helpr was booked", async () => {
    seed({ parent_job_id: "series-1", cancellation_reason: "series_ended_account_banned" });
    expect(await refundedCents()).toBe(11000);
  });

  it("the sweep reads the two columns the decision needs", async () => {
    seed({});
    await refundedCents();
    const partA = (scenario.readQueries ?? []).find((q) => q.table === "jobs" && q.cols.includes("cancellation_fee"));
    expect(partA?.cols).toContain("parent_job_id");
    expect(partA?.cols).toContain("cancellation_reason");
  });

  it("the ban migration writes exactly the reason the refund reads", async () => {
    // By path: seriesRefund.ts is Deno source, outside the app tsconfig.
    const mod = new URL("../../../supabase/functions/_shared/seriesRefund.ts", import.meta.url).pathname;
    const { SERIES_BAN_CANCEL_REASON } = (await import(/* @vite-ignore */ mod)) as { SERIES_BAN_CANCEL_REASON: string };
    const sql = blankSqlComments(readFileSync("supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql", "utf8"));
    expect(sql).toContain(`cancellation_reason = '${SERIES_BAN_CANCEL_REASON}',`);
  });
});
