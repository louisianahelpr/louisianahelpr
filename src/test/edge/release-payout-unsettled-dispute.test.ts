/**
 * `release-payout` × the decided-but-unsettled dispute gate.
 *
 * `rpc_decide_dispute` records the decision and, in the SAME transaction, sets
 * jobs.status='completed' and jobs.dispute_status='resolved' — before
 * `execute-dispute-split` moves a cent. So both markers release-payout's older
 * dispute guard reads already say "closed, pay it" while the escrow is
 * untouched and `disputes.execution_status` is 'pending'. Prod job bb2c3732
 * (dispute c7a12050, decided 50/50) sat in exactly that shape: a full 88%
 * transfer would have gone out on a job whose decision awards the helper half,
 * and a later "Retry settlement" would then have refunded and transferred on
 * top of it.
 *
 * These tests exist because the live call cannot reach this gate on that
 * fixture — bb2c3732 is `payment_status='escrow'`, so release-payout refuses it
 * one check earlier ("payment_status is escrow, expected payout_pending"). The
 * dangerous shape is a job that has ALREADY been walked to 'payout_pending'
 * with an unexecuted decision on it, which is what every case below seeds.
 *
 * ── What this file can and cannot prove ─────────────────────────────────────
 *
 * The Supabase mock's read filters are no-ops: `.eq()` / `.or()` are recorded
 * but never applied, so `scenario.reads.disputes.rows` models what the SERVER
 * would have returned, not what the seeded rows filter down to. That makes the
 * "already executed" case below a statement about the server's answer, not
 * about the predicate. The predicate itself is covered separately at the bottom
 * against a stub client that records the query chain — otherwise "seeded no
 * rows, got no block" would be true of a gate that queried nothing at all.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type SupabaseScenario } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { checkUnsettledDispute } from "../../../supabase/functions/_shared/unsettledDispute.ts";

const CRON_SECRET = "cron-secret-xyz";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("release-payout");
}

const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;

/** Poster-side captured cents: budget + urgent + the 12% customer fee. */
const capturedCents = (budget: number) => Math.round(budget * 100 * 1.12);

/**
 * A job that is payable in every respect EXCEPT whatever the test seeds on
 * `disputes`. Deliberately carries `disputed_at` + `dispute_status='resolved'`:
 * that is the exact shape `rpc_decide_dispute` leaves behind, and it is on the
 * older guard's allow-list, so every block below is attributable to the new
 * gate rather than to the marker check above it.
 */
function seedDecidedDisputeJob(s: SupabaseScenario) {
  const budget = 180;
  s.reads.jobs = {
    rows: [
      {
        id: "job-1",
        title: "Disputed haul-off",
        status: "completed",
        payment_status: "payout_pending",
        helper_id: "helper-1",
        customer_id: "poster-1",
        budget,
        urgent_fee: 0,
        dispute_status: "resolved",
        disputed_at: "2026-09-07T06:41:07.566Z",
        is_group_job: false,
        helpers_needed: null,
        stripe_payment_intent_id: "pi_1",
        stripe_session_id: null,
      },
    ],
  };
  s.reads.pif_credits = { rows: [] };
  s.rpc.restore_pif_credit_for_job = { outcome: "would_restore", applied_cents: capturedCents(budget) };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1",
    status: "succeeded",
    amount: capturedCents(budget),
    amount_received: capturedCents(budget),
  });
  s.reads.profiles = {
    rows: [{ stripe_account_id: "acct_helper", full_name: "Helpful Helper", onboarding_fee_paid: true }],
  };
  s.reads.platform_settings = { rows: [{ helper_fee_percent: 10, onboarding_fee_cents: 200 }] };
  s.reads.payout_transfers = { rows: [] };
  stripeMock.accounts.retrieve.mockResolvedValue({
    id: "acct_helper",
    payouts_enabled: true,
    charges_enabled: true,
  });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_1", transfer_group: "job_job-1" });
}

const callAsCron = async (fn: EdgeHarness) =>
  fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }));

describe("release-payout — decided-but-unsettled dispute gate", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("refuses a payout when the decided dispute has not executed, and names it", async () => {
    seedDecidedDisputeJob(scenario);
    scenario.reads.disputes = {
      rows: [
        {
          id: "dispute-1",
          execution_status: "pending",
          payout_split: { helper: 0.5, poster: 0.5 },
        },
      ],
    };
    const fn = await load();
    const res = await callAsCron(fn);

    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toMatch(/has not been settled yet/i);
    // The operator has to be able to find the dispute from the refusal alone —
    // "payout blocked" with no id is a dead end on the one screen whose job is
    // finding stuck money.
    expect(body.dispute_id).toBe("dispute-1");
    expect(body.execution_status).toBe("pending");
    expect(body.payout_split).toEqual({ helper: 0.5, poster: 0.5 });
    // The point of the gate: no money moved.
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("treats a NULL execution_status as unsettled, not as settled", async () => {
    // A dispute row predating the execution-column backfill (20260907194838)
    // has no stamp at all. Reading "no stamp" as "already executed" would pay
    // out every historical decision in full.
    seedDecidedDisputeJob(scenario);
    scenario.reads.disputes = {
      rows: [{ id: "dispute-2", execution_status: null, payout_split: { helper: 0.25, poster: 0.75 } }],
    };
    const fn = await load();
    const res = await callAsCron(fn);

    expect(res.status).toBe(409);
    expect((await json(res)).dispute_id).toBe("dispute-2");
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("lets the payout through once the split has executed", async () => {
    // The server-side `.eq('status','decided').or(execution_status…)` filters
    // an executed row out, so an all-settled job answers with no rows. See the
    // header note: this asserts the gate does not block on an empty answer, and
    // the predicate that produces that empty answer is asserted below.
    seedDecidedDisputeJob(scenario);
    scenario.reads.disputes = { rows: [] };
    const fn = await load();
    const res = await callAsCron(fn);

    expect(res.status).toBe(200);
    expect((await json(res)).success).toBe(true);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("FAILS CLOSED on 42703 — an unreadable answer is not permission to pay", async () => {
    // 42703 = the execution columns aren't deployed on this database yet. That
    // means we cannot tell a settled decision from an unsettled one, which is
    // the one circumstance in which paying is least defensible.
    seedDecidedDisputeJob(scenario);
    scenario.reads.disputes = {
      error: { message: 'column "execution_status" does not exist', code: "42703" },
    };
    const fn = await load();
    const res = await callAsCron(fn);

    expect(res.status).toBe(500);
    expect((await json(res)).error).toMatch(/dispute settlement check failed/i);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("tolerates 42P01 — a database with no disputes table has nothing to block", async () => {
    // The ONE benign failure. If the table does not exist there can be no
    // dispute rows, so there is nothing this check could have caught, and
    // failing closed here would freeze every payout on a fresh database.
    seedDecidedDisputeJob(scenario);
    scenario.reads.disputes = {
      error: { message: 'relation "public.disputes" does not exist', code: "42P01" },
    };
    const fn = await load();
    const res = await callAsCron(fn);

    expect(res.status).toBe(200);
    expect((await json(res)).success).toBe(true);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
  });
});

/**
 * The predicate itself, against a stub that records the chain.
 *
 * Without this, every case above would still pass if `checkUnsettledDispute`
 * queried the wrong table, forgot `status='decided'`, or dropped the `.or()`
 * that admits NULL — because the harness mock applies no read filters.
 */
describe("checkUnsettledDispute — the query it actually sends", () => {
  it("asks disputes for this job's decided, not-yet-executed rows", async () => {
    const chain: Array<[string, unknown, unknown]> = [];
    let table = "";
    const builder: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["select", "eq", "or", "limit"]) {
      builder[m] = (...args: unknown[]) => {
        chain.push([m, args[0], args[1]]);
        return m === "limit" ? Promise.resolve({ data: [], error: null }) : builder;
      };
    }
    const client = { from: (t: string) => { table = t; return builder; } };

    const result = await checkUnsettledDispute(client, "job-9");

    expect(result.blocked).toBe(false);
    expect(table).toBe("disputes");
    expect(chain).toContainEqual(["eq", "job_id", "job-9"]);
    expect(chain).toContainEqual(["eq", "status", "decided"]);
    expect(chain).toContainEqual(["or", "execution_status.is.null,execution_status.neq.executed", undefined]);
    // The id is what the 409 hands the operator; the split is what tells them
    // the payout would have been wrong rather than merely early.
    expect(chain[0]?.[1]).toBe("id, execution_status, payout_split");
  });

  it("returns the dispute when one is unsettled", async () => {
    const row = { id: "d-1", execution_status: "pending", payout_split: { helper: 0.5 } };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or"]) builder[m] = () => builder;
    builder.limit = () => Promise.resolve({ data: [row], error: null });
    const result = await checkUnsettledDispute({ from: () => builder }, "job-9");

    expect(result.blocked).toBe(true);
    expect(result.dispute).toEqual(row);
    expect(result.readError).toBeUndefined();
  });

  it("blocks with the real cause on an unrecognised read error", async () => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or"]) builder[m] = () => builder;
    builder.limit = () =>
      Promise.resolve({ data: null, error: { message: "connection reset", code: "08006" } });
    const result = await checkUnsettledDispute({ from: () => builder }, "job-9");

    expect(result.blocked).toBe(true);
    expect(result.readError).toBe("connection reset");
    expect(result.dispute).toBeUndefined();
  });
});
