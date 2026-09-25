/**
 * money-reconciliation grades a crew member by member (docs/OPEN.md Q407; money
 * review LOW-13): a crew has no lead, each member is paid their own frozen
 * share, and a crew's cancellation fee is its ledger of per-member shares.
 *
 * Runs the REAL function source via the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret";

async function load(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET });
  return loadEdgeFunction("money-reconciliation");
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function seedCrew({ transfers, jobPatch = {} }: { transfers: Array<Record<string, unknown>>; jobPatch?: Record<string, unknown> }) {
  scenario.reads.jobs = {
    rows: [{
      id: "job-crew", is_seed: false, status: "completed", payment_status: "released",
      budget: 100, urgent_fee: 0, date_needed: daysAgo(5), start_time: "09:00:00", cancelled_at: null,
      helper_id: null, helper_confirmed_at: null, cancellation_fee: 0, cancellation_fee_status: null,
      late_cancellation: false, platform_fee_amount: 12, helper_fee_percent: 12, is_group_job: true,
      helpers_needed: 2, has_active_dispute: false, dispute_status: null, poster_completed_at: daysAgo(4),
      helper_completed_at: daysAgo(4), payout_scheduled_at: null, updated_at: daysAgo(4), stripe_payment_intent_id: null,
      customer_fee_amount: 0,
      ...jobPatch,
    }],
  };
  scenario.reads.group_job_helpers = {
    rows: [
      { id: "g1", job_id: "job-crew", helper_id: "m1", share_cents: 5000 },
      { id: "g2", job_id: "job-crew", helper_id: "m2", share_cents: 5000 },
    ],
  };
  scenario.reads.payout_transfers = { rows: transfers };
  scenario.reads.profiles = { rows: [] };
  scenario.reads.disputes = { rows: [] };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.crew_cancellation_fee_shares = { rows: [] };
}

/** The JOB row of a crew cancelled late (a jobs patch, not a ledger row). */
const CANCELLED_CREW_JOB: Record<string, unknown> = {
  status: "cancelled", payment_status: "refunded", date_needed: "2024-06-25", start_time: "10:00:00",
  cancelled_at: "2024-06-25T14:00:00Z", cancellation_fee: 50, cancellation_fee_status: "charged",
};

const paid = (helper: string, amount: number, fee: number) => ({
  job_id: "job-crew", helper_id: helper, amount_cents: amount, platform_fee_cents: fee, status: "paid", stripe_transfer_id: `tr_${helper}`,
});

async function findingNames(): Promise<string[]> {
  const fn = await load();
  const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
  const b = JSON.parse(await res.text()) as { findings?: Array<{ check: string }> };
  return (b.findings ?? []).map((f) => f.check);
}

describe("money-reconciliation — a crew, member by member", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("control: a released crew with every member paid their share raises nothing crew-specific", async () => {
    seedCrew({ transfers: [paid("m1", 4400, 600), paid("m2", 4400, 600)] });
    const names = await findingNames();
    expect(names).not.toContain("crew_member_unpaid_on_released_job");
    expect(names).not.toContain("crew_transfers_exceed_escrow");
    // The per-job commission check does not grade a crew against one stamp.
    expect(names).not.toContain("platform_fee_self_inconsistent");
  });

  // @mutate supabase/functions/money-reconciliation/index.ts | if (!paid.has(helperId)) checks.crewMemberUnpaid.add | if (false) checks.crewMemberUnpaid.add
  it("a released crew with one member unpaid is critical", async () => {
    seedCrew({ transfers: [paid("m1", 4400, 600)] });
    expect(await findingNames()).toContain("crew_member_unpaid_on_released_job");
  });

  // @mutate supabase/functions/money-reconciliation/index.ts | if (grossCents > escrowCents) { | if (false) {
  it("crew transfers adding up to more than the escrow are critical", async () => {
    seedCrew({ transfers: [paid("m1", 8800, 1200), paid("m2", 4400, 600)] });
    expect(await findingNames()).toContain("crew_transfers_exceed_escrow");
  });

  // @mutate supabase/functions/money-reconciliation/index.ts | return priced.mismatch ? Number.NaN : priced.total; | return 0;
  it("a cancelled crew's stored fee is graded against its re-priced ledger", async () => {
    // $100 / 2 at 50% (cancelled 1h before a 10:00 Central start): $25 each.
    const patch = CANCELLED_CREW_JOB;
    seedCrew({ transfers: [], jobPatch: patch });
    scenario.reads.crew_cancellation_fee_shares = {
      rows: [
        { job_id: "job-crew", helper_id: "m1", committed: true, share_basis_cents: 5000, share_amount: "25.00" },
        { job_id: "job-crew", helper_id: "m2", committed: true, share_basis_cents: 5000, share_amount: "25.00" },
      ],
    };
    expect(await findingNames()).not.toContain("cancellation_fee_mismatch");
    seedCrew({ transfers: [], jobPatch: { ...patch, cancellation_fee: 80 } });
    scenario.reads.crew_cancellation_fee_shares = {
      rows: [
        { job_id: "job-crew", helper_id: "m1", committed: true, share_basis_cents: 5000, share_amount: "25.00" },
        { job_id: "job-crew", helper_id: "m2", committed: true, share_basis_cents: 5000, share_amount: "25.00" },
      ],
    };
    expect(await findingNames()).toContain("cancellation_fee_mismatch");
  });
});
