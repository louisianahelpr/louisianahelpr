/**
 * A retried fee transfer is a new Stripe attempt, never a replay of the saved
 * failure (Q1381, lh-money-escrow review: "Crew cancellation-fee transfers
 * reuse a fixed Stripe idempotency key on retry").
 *
 * Stripe keeps a request's result about 24 h and replays it for the same key,
 * failures included, so a member whose first transfer failed could not be paid
 * until the key expired. The three fee ledgers that retry a 'failed' row every
 * run (cancellation_fee_transfers, crew_cancellation_fee_shares,
 * crew_block_fees) salt a retry's key with the UTC hour; a first attempt keeps
 * its legacy key. The edge suites drive each site:
 * void-cancelled-payments-fee-ledger (Part E), void-cancelled-payments-crew
 * (Part D) and process-scheduled-payouts-crew (block fees).
 *
 * @mutate supabase/functions/_shared/money.ts |   return isRetry ? `${base}-h${Math.floor(nowMs / RETRY_KEY_BUCKET_MS)}` : base; |   return base;
 * @mutate supabase/functions/_shared/money.ts | const RETRY_KEY_BUCKET_MS = 60 * 60 * 1000; | const RETRY_KEY_BUCKET_MS = 24 * 60 * 60 * 1000;
 * @mutate supabase/functions/_shared/money.ts |     "StripeInvalidRequestError",\n    "StripeCardError", |     "StripeInvalidRequestError",\n    "StripeConnectionError",\n    "StripeCardError",
 *
 * Review (lh-money-escrow, MEDIUM): a row is salted only after a DEFINITE
 * refusal. An ambiguous error (timeout, dropped connection, 5xx, idempotency)
 * leaves the row's status alone, so the next attempt, even later in the same
 * run, reuses the same key and Stripe dedupes it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { feeTransferIdempotencyKey, isDefiniteStripeRefusal } from "../../supabase/functions/_shared/money";
import { blankComments } from "./helpers/blankNonCode";

const HOUR = 60 * 60 * 1000;
const T = Date.UTC(2026, 9, 12, 15, 10, 0); // a :10 cron run

describe("fee transfer idempotency keys on retry (Q1381)", () => {
  it("a first attempt keeps the legacy, unsalted key", () => {
    expect(feeTransferIdempotencyKey("cancel-fee-row-1", false, T)).toBe("cancel-fee-row-1");
  });

  it("a retry of a failed row gets a key Stripe has not seen, so it is a real new attempt", () => {
    const retry = feeTransferIdempotencyKey("cancel-fee-row-1", true, T);
    expect(retry).not.toBe("cancel-fee-row-1");
    expect(retry.startsWith("cancel-fee-row-1-")).toBe(true);
  });

  it("each hourly retry is a new attempt; two runs inside the same hour share one key (Stripe dedupes them)", () => {
    const run1 = feeTransferIdempotencyKey("crew-block-fee-b1", true, T);
    const sameHour = feeTransferIdempotencyKey("crew-block-fee-b1", true, T + 40 * 60 * 1000);
    const nextRun = feeTransferIdempotencyKey("crew-block-fee-b1", true, T + HOUR);
    expect(sameHour).toBe(run1);
    expect(nextRun).not.toBe(run1);
  });

  it("every fee-ledger retry site builds its key with the helper, salted by the row's own failed status", () => {
    const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));
    const vcp = read("supabase/functions/void-cancelled-payments/index.ts");
    const blocks = read("supabase/functions/_shared/crewBlockFees.ts");
    const sites = [
      ...vcp.matchAll(/idempotencyKey: feeTransferIdempotencyKey\(`(cancel-fee-[^`]+)`, ([^)]+)\)/g),
      ...blocks.matchAll(/idempotencyKey: feeTransferIdempotencyKey\(`(crew-block-fee-[^`]+)`, ([^)]+)\)/g),
    ].map((m) => `${m[1]} <- ${m[2]}`);
    expect(sites.length).toBeGreaterThan(2);
    expect(sites).toEqual([
      "cancel-fee-${feeRow.id} <- wasFailed",
      'cancel-fee-${job.id}-${share.helper_id} <- share.status === "failed"',
      'crew-block-fee-${row.id} <- row.status === "failed"',
    ]);
    // No fixed fee key left anywhere in these two files.
    expect(vcp).not.toMatch(/idempotencyKey: `cancel-fee-/);
    expect(blocks).not.toMatch(/idempotencyKey: `crew-block-fee-/);
  });

  it("only a definite Stripe refusal counts as 'no transfer exists'", () => {
    for (const type of ["StripeInvalidRequestError", "StripeCardError", "StripePermissionError", "StripeAuthenticationError"]) {
      expect(isDefiniteStripeRefusal({ type }), type).toBe(true);
    }
    for (const type of ["StripeConnectionError", "StripeAPIError", "StripeIdempotencyError", "StripeRateLimitError", undefined]) {
      expect(isDefiniteStripeRefusal({ type }), String(type)).toBe(false);
    }
    expect(isDefiniteStripeRefusal(new Error("socket hang up"))).toBe(false);
    expect(isDefiniteStripeRefusal(null)).toBe(false);
  });

  it("every fee-ledger catch marks a row failed only after a definite refusal", () => {
    const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));
    const vcp = read("supabase/functions/void-cancelled-payments/index.ts");
    const blocks = read("supabase/functions/_shared/crewBlockFees.ts");
    expect((vcp.match(/if \(!isDefiniteStripeRefusal\(transferErr\)\) \{/g) ?? []).length).toBe(2);
    expect((blocks.match(/if \(!isDefiniteStripeRefusal\(e\)\) \{/g) ?? []).length).toBe(1);
  });
});
