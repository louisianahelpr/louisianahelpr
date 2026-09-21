/**
 * Unit tests for `_shared/payoutClaim.ts` — the shared claim/adopt logic both
 * payout paths (release-payout, process-scheduled-payouts) run before a Stripe
 * transfer. Three defects the second lh-money-escrow review of the
 * dispute-races branch found:
 *
 *  HIGH-1: process-scheduled-payouts passed claimPayout a STALE ledger snapshot
 *    read before its Stripe round-trips. A claim a concurrent run settled in
 *    that window still read `pending`/null in the snapshot, so classifyLedger
 *    called it an orphaned openClaim, claimPayout SKIPPED the INSERT (the unique
 *    index never fired) and a second transfer went out under a different key.
 *    Fix: the caller passes no snapshot, so claimPayout reads fresh.
 *
 *  MEDIUM-1: the adopt match compared the Stripe transfer amount to THIS run's
 *    recompute, which is gross; a first payout writes its claim NET of the $2
 *    onboarding fee, so the canonical orphan was un-adoptable → permanent 409 +
 *    critical page on every helper's first payout. Fix: match the claim row's
 *    recorded amount_cents.
 *
 *  LOW-1: the per-Helpr destination list is paginated and fails CLOSED past a
 *    page cap, so a Helpr with many transfers cannot hide a legacy untagged
 *    transfer for this job off the first page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  checkUnrecordedTransfers,
  claimPayout,
  type LedgerRow,
} from "../../../supabase/functions/_shared/payoutClaim.ts";

const OLD = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // past the in-flight window

/** A supabaseAdmin stub covering exactly the calls payoutClaim makes. */
function makeDb(opts: {
  readRows?: Record<string, unknown>[];
  readError?: { message: string } | null;
  insert?: { data: unknown[] | null; error: { code?: string; message?: string } | null };
}) {
  const reads: string[] = [];
  const inserts: unknown[] = [];
  const api = {
    reads,
    inserts,
    from(table: string) {
      const b: Record<string, unknown> = { _op: "select", _payload: null as unknown };
      b.select = () => b;
      b.insert = (p: unknown) => { b._op = "insert"; b._payload = p; return b; };
      b.eq = () => b;
      b.in = () => b;
      b.then = (resolve: (v: unknown) => void) => {
        if (b._op === "insert") { inserts.push(b._payload); resolve(opts.insert ?? { data: [{ id: "claim-new" }], error: null }); }
        else { reads.push(table); resolve(opts.readError ? { data: null, error: opts.readError } : { data: opts.readRows ?? [], error: null }); }
      };
      return b;
    },
  };
  return api;
}

const baseArgs = {
  jobId: "job-1",
  helperId: "helper-1",
  amountCents: 5000,
  platformFeeCents: 500,
  stripeAccountId: "acct_helper",
  initiatedBy: "system" as const,
};

describe("claimPayout reads the ledger itself — HIGH-1", () => {
  const settledRow = { id: "led-1", stripe_transfer_id: "tr_paid", status: "paid", created_at: OLD };
  const staleOrphan: LedgerRow = { id: "led-orphan", stripe_transfer_id: null, status: "pending", created_at: OLD };

  it("with NO snapshot, blocks on a settled row it reads fresh (the fix's guarantee)", async () => {
    const db = makeDb({ readRows: [settledRow] });
    const res = await claimPayout(db as never, { ...baseArgs });
    expect(res.kind).toBe("blocked");
    expect(db.reads).toContain("payout_transfers"); // it did read
    expect(db.inserts).toHaveLength(0); // no claim, no second transfer
  });

  it("RED: handed a STALE orphan snapshot, it proceeds without reading — why the caller must pass none", async () => {
    // Same DB (a settled row), but the old caller passed the pre-Stripe
    // snapshot. classifyLedger sees an orphan → resume → proceed, and the
    // fresh settled row is never seen: the double-pay HIGH-1 describes.
    const db = makeDb({ readRows: [settledRow] });
    const res = await claimPayout(db as never, { ...baseArgs, ledgerRows: [staleOrphan] });
    expect(res.kind).toBe("proceed");
    expect(db.reads).toHaveLength(0); // it trusted the snapshot, never read
  });

  // A null `error` is not a write (CLAUDE.md). `payout_transfers_one_live_per_job_helper`
  // makes a lost claim race surface as 23505 — covered above — but a zero-row
  // return with error null is the OTHER shape: RLS, a rewritten row, an
  // upsert-that-matched-nothing. Proceeding on it means we believe we hold a
  // claim we do not hold, and both runs then reach transfers.create. Nothing
  // exercised this branch before (money-lane vacuity pass, 2026-09-21).
  it("treats a zero-row insert with error null as an error, not as a held claim", async () => {
    const db = makeDb({ readRows: [], insert: { data: [], error: null } });
    const res = await claimPayout(db as never, { ...baseArgs });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.message).toMatch(/no row/i);
  });

  it("process-scheduled-payouts does NOT hand claimPayout a snapshot", () => {
    const src = readFileSync("supabase/functions/process-scheduled-payouts/index.ts", "utf8");
    const call = src
      .slice(src.indexOf("claimPayout(supabaseAdmin"), src.indexOf("claimPayout(supabaseAdmin") + 900)
      .replace(/^\s*\/\/[^\n]*$/gm, ""); // drop comment lines (one mentions ledgerRows on purpose)
    const argObject = call.slice(0, call.indexOf("});") + 1);
    expect(argObject).not.toMatch(/ledgerRows\s*:/);
  });
});

describe("checkUnrecordedTransfers adopt-amount — MEDIUM-1", () => {
  // A first payout: gross 5000, but the claim recorded NET 4800 (the $2 fee),
  // and the orphaned Stripe transfer carries 4800.
  const orphanClaim = { id: "led-orphan", helper_id: "helper-1", stripe_transfer_id: null, status: "pending", created_at: OLD, amount_cents: 4800 };
  const stripeWith = (data: unknown[]) => ({
    transfers: {
      list: async (p: { transfer_group?: string; destination?: string }) =>
        ({ data: p.destination === "acct_helper" ? data : [], has_more: false }),
    },
  });

  it("adopts the orphan whose amount matches the CLAIM's recorded net, not this run's gross", async () => {
    const db = makeDb({ readRows: [orphanClaim] });
    const stripe = stripeWith([{ id: "tr_net", amount: 4800, amount_reversed: 0, destination: "acct_helper", metadata: { job_id: "job-1" } }]);
    const res = await checkUnrecordedTransfers(db as never, stripe as never, { ...baseArgs });
    expect(res).toEqual({ kind: "adopt", claimId: "led-orphan", transferId: "tr_net" });
  });

  it("still refuses (conflict) when the amount matches neither the claim nor this run", async () => {
    const db = makeDb({ readRows: [orphanClaim] });
    const stripe = stripeWith([{ id: "tr_other", amount: 1234, amount_reversed: 0, destination: "acct_helper", metadata: { job_id: "job-1" } }]);
    const res = await checkUnrecordedTransfers(db as never, stripe as never, { ...baseArgs });
    expect(res.kind).toBe("conflict");
  });
});

describe("checkUnrecordedTransfers destination pagination — LOW-1", () => {
  it("fails CLOSED when the Helpr's transfer list never ends", async () => {
    const db = makeDb({ readRows: [] }); // no ledger rows → nothing recorded
    const stripe = {
      transfers: {
        list: async (p: { transfer_group?: string; destination?: string; starting_after?: string }) => {
          if (p.transfer_group) return { data: [], has_more: false };
          // A destination that always claims more pages — an active Helpr.
          return { data: [{ id: `tr_${Math.random()}`, amount: 10, amount_reversed: 0, destination: "acct_helper", metadata: {} }], has_more: true };
        },
      },
    };
    const res = await checkUnrecordedTransfers(db as never, stripe as never, { ...baseArgs });
    expect(res.kind).toBe("error");
  });

  it("walks starting_after to the end and unions both pages", async () => {
    const db = makeDb({ readRows: [] });
    const pages: Record<string, { data: unknown[]; has_more: boolean }> = {
      first: { data: [{ id: "tr_a", amount: 5000, amount_reversed: 0, destination: "acct_helper", metadata: { job_id: "job-1" } }], has_more: true },
      "tr_a": { data: [{ id: "tr_b", amount: 5000, amount_reversed: 0, destination: "acct_helper", metadata: { job_id: "other" } }], has_more: false },
    };
    const stripe = {
      transfers: {
        list: async (p: { transfer_group?: string; destination?: string; starting_after?: string }) => {
          if (p.transfer_group) return { data: [], has_more: false };
          return pages[p.starting_after ?? "first"];
        },
      },
    };
    // tr_a is for THIS job with amount 5000, no ledger row, and there is no
    // orphan claim → conflict names it (proving the second page was reached and
    // tr_a from the first page was retained).
    const res = await checkUnrecordedTransfers(db as never, stripe as never, { ...baseArgs });
    expect(res.kind).toBe("conflict");
    if (res.kind === "conflict") expect(res.transferIds).toContain("tr_a");
  });
});

// Proof this guard can fail: match the orphaned Stripe transfer against this
// run's GROSS recompute instead of the net the claim recorded, and the canonical
// orphan stops being adoptable — MEDIUM-1, which paged on every first payout.
// @mutate supabase/functions/_shared/payoutClaim.ts | openClaim.amount_cents != null ? Number(openClaim.amount_cents) : args.amountCents | args.amountCents
// Proof the zero-row claim branch is covered: delete the `.select("id")` emptiness
// check and a claim nobody holds reads as held — the double-pay that "a null
// error is not a write" exists to stop.
// @mutate supabase/functions/_shared/payoutClaim.ts | if (!inserted \|\| inserted.length === 0) {\n    return { kind: "error", message: "payout claim insert returned no row" };\n  }\n | 
