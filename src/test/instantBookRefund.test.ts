/**
 * CMP-4 (lead 2026-11-01, money re-review of 20261101071621:224-244): an
 * instant booking charged with nobody hired is refunded IN FULL, automatically,
 * exactly once (supabase/functions/_shared/instantBookRefund.ts; the SQL half,
 * the job closed for review and the claim, is proven in
 * src/test/pglite/instantBookCapturedRefund.pglite.mjs).
 *
 * The fake Stripe keeps the charge's real state: what it captured, what was
 * refunded, and one answer per idempotency key (Stripe replays it, never a
 * second refund). Proven: one refund of everything the charge holds (card fee
 * included); a second run, two runs at once, a run after a crash, and the
 * webhook first each refund nothing more; a timeout retries under the same key;
 * a definite "no" pages a person and keeps the claim; another path's claim is
 * never touched; the setup fee is owed again.
 *
 * @mutate supabase/functions/_shared/instantBookRefund.ts | if ((claim as { claimed_by?: string } \| null)?.claimed_by !== INSTANT_REFUND_HOLDER) return "none"; | if (!claim) return "none";
 * @mutate supabase/functions/_shared/instantBookRefund.ts |     const remainingCents = capturedCents - alreadyRefundedCents; |     const remainingCents = capturedCents - alreadyRefundedCents - 104;
 * @mutate supabase/functions/_shared/instantBookRefund.ts |     if (remainingCents > 0) { |     if (remainingCents > -1) {
 * @mutate supabase/functions/_shared/instantBookRefund.ts |           `${jobId}-r${alreadyRefundedCents}`, |           `${jobId}-${Math.random()}`,
 * @mutate supabase/functions/_shared/instantBookRefund.ts |         if (isDefinitiveStripeRefusal(e)) return stuck(`Stripe refused the refund: | if (false) return stuck(`Stripe refused the refund:
 * @mutate supabase/functions/_shared/instantBookRefund.ts |         return "retry";\n      }\n    }\n  } |         return "refunded";\n      }\n    }\n  }
 * @mutate supabase/functions/_shared/instantBookRefund.ts |   if (feeAt) { |   if (false) {
 * @mutate supabase/functions/_shared/instantBookRefund.ts |     if (row.payment_status !== "cancelling") return stuck( |     if (false) return stuck(
 */
import { describe, expect, it } from "vitest";
import { refundInstantBooking, type InstantRefundDeps } from "../../supabase/functions/_shared/instantBookRefund";

const JOB = "00000000-0000-0000-0000-000000000201";
const POSTER = "00000000-0000-0000-0000-000000000001";
const PI = "pi_instant_1";

type Row = Record<string, unknown>;

function world(opts: { claimedBy?: string | null; paymentStatus?: string; captured?: number; refunded?: number; feeAt?: string | null } = {}) {
  const claims = new Map<string, Row>();
  if (opts.claimedBy !== null) claims.set(JOB, { claimed_by: opts.claimedBy ?? "instant_book_refund" });
  const job: Row = { id: JOB, customer_id: POSTER, status: "cancelled", payment_status: opts.paymentStatus ?? "cancelling", stripe_payment_intent_id: PI };
  const hold: Row = { onboarding_fee_claimed_at: opts.feeAt ?? null };
  const charge = { captured: opts.captured ?? 6386, refunded: opts.refunded ?? 0 };
  const byKey = new Map<string, { id: string }>();
  const calls = { refunds: [] as Array<{ amount: number; key: string }>, finished: 0, unclaimed: 0, pages: [] as string[], defects: [] as string[] };
  let refundFails: unknown = null;
  let retrieveFails: unknown = null;
  let finishFails = false;

  const table = (name: string) => ({
    select: () => ({
      eq: (_c: string, id: string) => ({
        maybeSingle: async () => ({
          data: name === "job_refund_claims" ? (claims.get(id) ?? null) : name === "jobs" ? { ...job } : { ...hold },
          error: null,
        }),
      }),
    }),
  });
  const db = {
    from: table,
    rpc: async (fn: string) => {
      if (fn !== "instant_book_refund_finished") throw new Error(`unexpected rpc ${fn}`);
      if (finishFails) return { data: null, error: { message: "timeout" } };
      // The SQL: only this path's claim, from 'cancelling' or 'refunded', once.
      if (claims.get(JOB)?.claimed_by !== "instant_book_refund" || !["cancelling", "refunded"].includes(String(job.payment_status))) return { data: false, error: null };
      claims.delete(JOB);
      job.payment_status = "refunded";
      calls.finished++;
      return { data: true, error: null };
    },
  };
  const deps: InstantRefundDeps = {
    db,
    stripe: {
      retrievePi: async () => {
        if (retrieveFails) throw retrieveFails;
        return { id: PI, status: "succeeded", amount: charge.captured, amount_received: charge.captured, latest_charge: { amount_refunded: charge.refunded } };
      },
      refund: async (params, key) => {
        if (refundFails) { const e = refundFails; refundFails = null; throw e; }
        // Stripe: the same key answers the first refund again, nothing more moves.
        const seen = byKey.get(key);
        if (seen) return seen;
        if (params.amount > charge.captured - charge.refunded) throw Object.assign(new Error("amount_too_large"), { statusCode: 400, type: "StripeInvalidRequestError" });
        charge.refunded += params.amount;
        calls.refunds.push({ amount: params.amount, key });
        const r = { id: `re_${calls.refunds.length}` };
        byKey.set(key, r);
        return r;
      },
    },
    unclaimSetupFee: async () => { calls.unclaimed++; hold.onboarding_fee_claimed_at = null; },
    record: (d) => { calls.defects.push(d); },
    page: async (_t, message) => { calls.pages.push(message); },
  };
  return {
    deps, calls, job, charge, claims,
    failRefund: (e: unknown) => { refundFails = e; },
    failRetrieve: (e: unknown) => { retrieveFails = e; },
    failFinish: (on: boolean) => { finishFails = on; },
  };
}

const timeout = Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
const refused = Object.assign(new Error("This account is not currently able to refund charges"), { type: "StripeInvalidRequestError", statusCode: 400 });

describe("instant book: the automatic full refund (CMP-4)", () => {
  it("refunds everything the charge holds, card fee included, once; closes the claim; the setup fee is owed again", async () => {
    const w = world({ feeAt: "2026-11-01T07:00:00Z" });
    expect(await refundInstantBooking(w.deps, JOB)).toBe("refunded");
    expect(w.calls.refunds).toEqual([{ amount: 6386, key: `${JOB}-r0` }]);
    expect(w.charge.refunded).toBe(6386);
    expect(w.calls.unclaimed).toBe(1);
    expect(w.calls.finished).toBe(1);
    expect(w.job.payment_status).toBe("refunded");
    expect(w.claims.has(JOB)).toBe(false);
    expect(w.calls.pages).toEqual([]);
  });

  it("a second run refunds nothing", async () => {
    const w = world();
    await refundInstantBooking(w.deps, JOB);
    expect(await refundInstantBooking(w.deps, JOB)).toBe("none");
    expect(w.calls.refunds).toHaveLength(1);
    expect(w.charge.refunded).toBe(6386);
  });

  it("two runs at once (both read the charge before either refunds) send ONE refund: same key, same amount", async () => {
    const w = world();
    const [a, b] = await Promise.all([refundInstantBooking(w.deps, JOB), refundInstantBooking(w.deps, JOB)]);
    expect([a, b].sort()).toEqual(["none", "refunded"]);
    expect(w.calls.refunds).toHaveLength(1);
    expect(w.charge.refunded).toBe(6386);
  });

  it("a run that crashed after the refund (claim still open): the next run reads the charge refunded and sends nothing", async () => {
    const w = world();
    w.failFinish(true);
    expect(await refundInstantBooking(w.deps, JOB)).toBe("retry");
    w.failFinish(false);
    expect(await refundInstantBooking(w.deps, JOB)).toBe("refunded");
    expect(w.calls.refunds).toHaveLength(1);
    expect(w.charge.refunded).toBe(6386);
  });

  it("the webhook wrote 'refunded' first: no Stripe call, the claim closes", async () => {
    const w = world({ paymentStatus: "refunded", refunded: 6386 });
    expect(await refundInstantBooking(w.deps, JOB)).toBe("refunded");
    expect(w.calls.refunds).toHaveLength(0);
    expect(w.calls.finished).toBe(1);
  });

  it("an earlier partial refund on the charge: only the rest goes back", async () => {
    const w = world({ refunded: 200 });
    expect(await refundInstantBooking(w.deps, JOB)).toBe("refunded");
    expect(w.calls.refunds).toEqual([{ amount: 6186, key: `${JOB}-r200` }]);
  });

  it("Stripe did not answer: retried under the same key, the claim stays, then one refund", async () => {
    const w = world();
    w.failRefund(timeout);
    expect(await refundInstantBooking(w.deps, JOB)).toBe("retry");
    expect(w.claims.has(JOB)).toBe(true);
    expect(w.calls.finished).toBe(0);
    expect(await refundInstantBooking(w.deps, JOB)).toBe("refunded");
    expect(w.calls.refunds).toHaveLength(1);
  });

  it("the charge could not be read: retried, nothing sent", async () => {
    const w = world();
    w.failRetrieve(timeout);
    expect(await refundInstantBooking(w.deps, JOB)).toBe("retry");
    expect(w.calls.refunds).toHaveLength(0);
    expect(w.claims.has(JOB)).toBe(true);
  });

  it("Stripe definitely refused: a person is paged once (one key), the claim and the closed job stay", async () => {
    const w = world();
    w.failRefund(refused);
    expect(await refundInstantBooking(w.deps, JOB)).toBe("needs_person");
    expect(w.calls.pages).toHaveLength(1);
    expect(w.calls.pages[0]).toMatch(/closed for review/);
    expect(w.claims.has(JOB)).toBe(true);
    expect(w.job.payment_status).toBe("cancelling");
    expect(w.calls.finished).toBe(0);
  });

  it("another path's claim (cancel_escrow) or no claim: nothing is read in Stripe, nothing refunded", async () => {
    for (const by of ["cancel_escrow", null]) {
      const w = world({ claimedBy: by });
      expect(await refundInstantBooking(w.deps, JOB)).toBe("none");
      expect(w.calls.refunds).toHaveLength(0);
      expect(w.calls.finished).toBe(0);
    }
  });

  it("our claim on a job that no longer reads 'cancelling' (escrow): never refunded, a person is paged", async () => {
    const w = world({ paymentStatus: "escrow" });
    expect(await refundInstantBooking(w.deps, JOB)).toBe("needs_person");
    expect(w.calls.refunds).toHaveLength(0);
  });
});
