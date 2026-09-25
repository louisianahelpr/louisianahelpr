/**
 * A cancelled recurring-series visit that was never filled, or that a
 * PERMANENT BAN ended, is refunded IN FULL, the service fee included, with no
 * cancellation fee (money audit 2026-09-25 MEDIUM-9; owner decisions Q407 (5)
 * "a date still unfilled when it arrives is not charged" and (9) "future
 * visits are cancelled and not charged"). Every other cancellation keeps its
 * rule: the service fee is withheld.
 *
 * WHICH visit a ban ended is read from a SERVER-OWNED marker,
 * jobs.series_ban_cancelled_at (set only by end_series_for_banned_account,
 * 20260925170555), never from the free-text cancellation_reason: a poster's
 * poster_cancel_job copies their own p_reason verbatim, so a reason-based
 * rule let ANY poster type the ban reason and take a full refund off a
 * committed Helpr's late fee (money review 2026-09-25 HIGH-1). The class
 * guard that no settlement path branches on cancellation_reason is
 * src/test/settlementIgnoresCancellationReason.test.ts.
 *
 * Runs the REAL function source via the edge harness, with the real
 * `_shared/seriesRefund.ts`.
 *
 * @mutate supabase/functions/_shared/seriesRefund.ts |   return !!job.parent_job_id && !job.helper_id; |   return false;
 * @mutate supabase/functions/_shared/seriesRefund.ts |   if (inSeries && !!job.series_ban_cancelled_at) return true; |   if (!!job.series_ban_cancelled_at) return true;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |           const nonRefundableCents = fullSeriesRefund\n            ? 0 |           const nonRefundableCents = false\n            ? 0
 * @mutate supabase/functions/void-cancelled-payments/index.ts |         if (markerErr && !isMissingColumn(markerErr)) { |         if (false) {
 * @mutate supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql |              series_ban_cancelled_at = now(), |              series_ban_cancelled_at = NULL,
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
function seed(job: Record<string, unknown>, marker: string | null | Error = null) {
  scenario.reads.jobs = {
    selectOverrides: [
      {
        includes: "cancellation_fee",
        result: {
          rows: [{
            id: "visit-1", title: "Weekly walk", stripe_session_id: null, stripe_payment_intent_id: "pi_visit",
            budget: 100, customer_fee_amount: 10, cancellation_fee: 0,
            // Tomorrow morning (a fixed far-future day, so it never ages into the
            // past), so a committed Helpr would put a late fee on it.
            date_needed: "2032-09-06", start_time: "09:00:00", cancelled_at: "2032-09-05T17:00:00Z",
            helper_id: "helper-1", helper_confirmed_at: "2032-09-01T00:00:00Z",
            customer_id: "poster-1", helper_fee_percent: 10,
            parent_job_id: null, recurrence_days: null, cancellation_reason: null,
            ...job,
          }],
        },
      },
      {
        includes: "series_ban_cancelled_at",
        result: marker instanceof Error
          ? { error: { message: marker.message, code: (marker as Error & { code?: string }).code } }
          : { rows: [{ series_ban_cancelled_at: marker }] },
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
  vi.setSystemTime(new Date("2032-09-05T17:00:00Z"));
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

  it("a visit a PERMANENT BAN cancelled (server marker) gets every cent back, with no late fee though a Helpr was booked", async () => {
    seed({ parent_job_id: "series-1" }, "2032-09-05T16:00:00Z");
    expect(await refundedCents()).toBe(11000);
  });

  it("visit one of a ban-ended series (the parent itself) is marked the same way", async () => {
    seed({ recurrence_days: [1, 3] }, "2032-09-05T16:00:00Z");
    expect(await refundedCents()).toBe(11000);
  });

  it("HIGH-1: a ONE-TIME job whose poster typed the ban reason keeps the late fee AND the service fee", async () => {
    seed({});
    const control = await refundedCents();
    resetSupabaseMock();
    resetStripeMock();
    seed({ cancellation_reason: "series_ended_account_banned" });
    expect(await refundedCents()).toBe(control);
    expect(control!).toBeLessThan(11000 - 1000 + 1);
  });

  it("HIGH-1: a SERIES visit with the typed reason but no server marker keeps its fees", async () => {
    seed({ parent_job_id: "series-1", cancellation_reason: "series_ended_account_banned" });
    expect(await refundedCents()).toBeLessThan(11000 - 1000 + 1);
  });

  it("a marker on a job outside any series grants nothing", async () => {
    seed({}, "2032-09-05T16:00:00Z");
    expect(await refundedCents()).toBeLessThan(11000 - 1000 + 1);
  });

  it("the rule itself: a marker outside a series grants nothing; the typed reason grants nothing", async () => {
    // By path: seriesRefund.ts is Deno source, outside the app tsconfig.
    const mod = new URL("../../../supabase/functions/_shared/seriesRefund.ts", import.meta.url).pathname;
    const { refundsSeriesVisitInFull } = (await import(/* @vite-ignore */ mod)) as {
      refundsSeriesVisitInFull: (j: Record<string, unknown>) => boolean;
    };
    expect(refundsSeriesVisitInFull({ helper_id: "h", series_ban_cancelled_at: "2032-09-05T16:00:00Z" })).toBe(false);
    expect(refundsSeriesVisitInFull({ helper_id: "h", parent_job_id: "s", cancellation_reason: "series_ended_account_banned" })).toBe(false);
    expect(refundsSeriesVisitInFull({ helper_id: "h", parent_job_id: "s", series_ban_cancelled_at: "2032-09-05T16:00:00Z" })).toBe(true);
    expect(refundsSeriesVisitInFull({ helper_id: "h", recurrence_days: [1], series_ban_cancelled_at: "2032-09-05T16:00:00Z" })).toBe(true);
    expect(refundsSeriesVisitInFull({ helper_id: null, parent_job_id: "s" })).toBe(true);
    expect(refundsSeriesVisitInFull({ helper_id: null })).toBe(false);
  });

  it("deploy order: before the marker column exists (42703) nothing is ban-ended, and the visit still settles", async () => {
    seed({ parent_job_id: "series-1" }, Object.assign(new Error('column jobs.series_ban_cancelled_at does not exist'), { code: "42703" }));
    expect(await refundedCents()).toBeLessThan(11000 - 1000 + 1);
  });

  it("any other marker read error moves no money for that visit (fail closed)", async () => {
    seed({ parent_job_id: "series-1" }, Object.assign(new Error("connection reset"), { code: "08006" }));
    expect(await refundedCents()).toBeNull();
  });

  it("the ban migration sets the marker on every visit it cancels", () => {
    const sql = blankSqlComments(readFileSync("supabase/migrations/20260925170555_permanent_ban_ends_recurring_series.sql", "utf8"));
    expect(sql).toMatch(/SET status = 'cancelled',[\s\S]{0,200}series_ban_cancelled_at = now\(\),/);
  });
});
