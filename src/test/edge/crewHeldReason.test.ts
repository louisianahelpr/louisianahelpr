/**
 * Q2440: a crew cancellation-fee share or a crew block fee the live payout gate holds says why on its row
 * (`payee_not_payable: <kind>`, the text a single Helpr's cancellation_fee_transfers row already gets), and the
 * run reads each payee's Connect account once (holdUnlessPayable's cache), not once per row.
 *
 * Behaviour on the REAL void-cancelled-payments source; the class checks read every payCrewBlockFees caller and the
 * newest grant on crew_cancellation_fee_shares (the new column is the service role's only:
 * src/test/pglite/crewShareHeldReason.pglite.mjs runs it on real Postgres, 19 PASS, 6 FAIL without the migration).
 *
 * @mutate supabase/functions/void-cancelled-payments/index.ts |           const noted = await noteHeldReason(supabaseAdmin, "crew_cancellation_fee_shares", share.id, shareLive.kind); |           const noted = null;
 * @mutate supabase/functions/_shared/crewBlockFees.ts |       const noted = await noteHeldReason(admin, "crew_block_fees", row.id, live.kind); |       const noted = null;
 * @mutate supabase/functions/_shared/heldReason.ts |     .or(`failure_reason.is.null,failure_reason.neq."${reason}"`); |     ;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |           fields: { job_id: job.id, share_id: share.id, amount: memberPayout },\n          cache: liveGates, |           fields: { job_id: job.id, share_id: share.id, amount: memberPayout },
 * @mutate supabase/functions/_shared/crewBlockFees.ts |       cache: deps.liveGates, |       cache: undefined,
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | fn: "process-scheduled-payouts", liveGates }, job, | fn: "process-scheduled-payouts" }, job,
 * @mutate supabase/migrations/20261103014109_crew_share_held_reason.sql | REVOKE SELECT ON TABLE public.crew_cancellation_fee_shares FROM authenticated; | SELECT 1;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock, PAYABLE_CONNECT_ACCOUNT } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { blankComments, blankSqlComments } from "../helpers/blankNonCode";

const CRON_SECRET = "cron-secret-crew-held-reason";

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

const MEMBERS = ["member-a", "member-b", "member-c"];
const NOT_PAYABLE = { ...PAYABLE_CONNECT_ACCOUNT, payouts_enabled: false };

/** $300 crew of 3 cancelled 1 hour before a 10:00 Central start (the 50% tier: $50 a share), plus a block fee. */
function seed() {
  scenario.reads.jobs = {
    selectOverrides: [
      {
        includes: "cancellation_fee",
        result: {
          rows: [{
            id: "job-crew", title: "Move a piano", stripe_session_id: null, stripe_payment_intent_id: "pi_crew",
            budget: 300, customer_fee_amount: 30, cancellation_fee: 150, date_needed: "2024-06-25", start_time: "10:00:00",
            cancelled_at: "2024-06-25T14:00:00Z", helper_id: null, helper_confirmed_at: null, customer_id: "poster-1",
            helper_fee_percent: 10, is_group_job: true, helpers_needed: 3,
          }],
        },
      },
    ],
    rows: [],
  };
  scenario.reads.crew_cancellation_fee_shares = {
    rows: MEMBERS.map((m, i) => ({
      id: `share-${i + 1}`, helper_id: m, committed: true, share_basis_cents: 10000, share_amount: "50.00", status: "pending", stripe_transfer_id: null,
    })),
  };
  scenario.reads.crew_block_fees = {
    rows: [{ id: "bf-1", job_id: "job-crew", helper_id: "member-d", slot_no: 3, share_basis_cents: 10000, fee_percent: 25, fee_cents: 2500, status: "owed", stripe_transfer_id: null }],
  };
  // Every member is paid to the same account here, so a per-run cache reads it once.
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_member", subscription_tier: null }] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_crew", status: "succeeded", amount: 33000, amount_received: 33000, latest_charge: "ch_crew",
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_crew", amount: 15000 });
  stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string } }) => ({ id: `tr_${params.metadata.helper_id}` }));
}

const reasonWrites = (table: string) =>
  scenario.writes.filter((w) => w.table === table && w.op === "update" &&
    String((w.payload as { failure_reason?: unknown }).failure_reason ?? "").startsWith("payee_not_payable"));

describe("Q2440: a held crew share or block fee says why, and the run reads each account once", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  it("every held share and the held block fee get payee_not_payable: <kind>, only when it differs, never on a paid row", async () => {
    seed();
    stripeMock.accounts.retrieve.mockResolvedValue(NOT_PAYABLE);
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    const shares = reasonWrites("crew_cancellation_fee_shares");
    expect(shares.map((w) => (w.filters.find((f) => f.op === "eq" && f.column === "id") as { value: string }).value).sort())
      .toEqual(["share-1", "share-2", "share-3"]);
    const block = reasonWrites("crew_block_fees");
    expect(block).toHaveLength(1);
    for (const w of [...shares, ...block]) {
      const reason = (w.payload as { failure_reason: string }).failure_reason;
      expect(reason).toMatch(/^payee_not_payable: [a-z_]+$/);
      expect(Object.keys(w.payload as Record<string, unknown>)).toEqual(["failure_reason"]);
      expect(w.filters).toEqual(expect.arrayContaining([
        { op: "neq", column: "status", value: "paid" },
        { op: "or", column: "", value: `failure_reason.is.null,failure_reason.neq."${reason}"` },
      ]));
    }
  });

  it("control: a payable account gets no reason written, and every member is paid", async () => {
    seed();
    stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
    const h = await load();
    await h.fetch(cronReq());
    expect(reasonWrites("crew_cancellation_fee_shares")).toHaveLength(0);
    expect(reasonWrites("crew_block_fees")).toHaveLength(0);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(4);
  });

  it("the run reads the one shared account once for three shares and a block fee", async () => {
    seed();
    stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
    const h = await load();
    await h.fetch(cronReq());
    const reads = stripeMock.accounts.retrieve.mock.calls.filter(([id]) => id === "acct_member");
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(4);
    expect(reads).toHaveLength(1);
  });

  it("class: every payCrewBlockFees caller passes its run's liveGates", () => {
    const callers: string[] = [];
    const missing: string[] = [];
    const dirs = readdirSync("supabase/functions", { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "_shared");
    for (const d of dirs) {
      let src: string;
      try {
        src = blankComments(readFileSync(`supabase/functions/${d.name}/index.ts`, "utf8"));
      } catch {
        continue; // a folder without an index.ts is no function
      }
      for (const m of src.matchAll(/payCrewBlockFees\(\{([^}]*)\}/g)) {
        callers.push(d.name);
        if (!/\bliveGates\b/.test(m[1])) missing.push(`${d.name}: ${m[1].trim()}`);
      }
    }
    // Inventory floor: void-cancelled-payments x3, process-scheduled-payouts x1.
    expect(callers.length).toBeGreaterThan(3);
    expect(new Set(callers)).toEqual(new Set(["void-cancelled-payments", "process-scheduled-payouts"]));
    expect(missing).toEqual([]);
  });

  it("class: after every migration, authenticated holds no table-wide SELECT on crew_cancellation_fee_shares and no failure_reason", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    // Replayed in order: a table-wide GRANT covers every column, new ones included, until a table-wide REVOKE;
    // a column GRANT adds its columns (and a table-wide REVOKE takes them away too).
    let tableWide = false;
    let cols = new Set<string>();
    let statements = 0;
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(`supabase/migrations/${f}`, "utf8")).replace(/\s+/g, " ");
      for (const m of sql.matchAll(/(REVOKE SELECT ON TABLE|REVOKE ALL ON TABLE|GRANT SELECT ON TABLE|GRANT SELECT \(([^)]*)\) ON) public\.crew_cancellation_fee_shares (?:TO|FROM) [^;]*\bauthenticated\b/gi)) {
        statements++;
        if (/^REVOKE/i.test(m[1])) { tableWide = false; cols = new Set(); }
        else if (m[2] !== undefined) for (const c of m[2].split(",")) cols.add(c.trim());
        else tableWide = true;
      }
    }
    // Inventory floor: 20260925154606's REVOKE ALL + GRANT, and this migration's REVOKE + column GRANT.
    expect(statements).toBeGreaterThan(3);
    expect(tableWide).toBe(false);
    expect(cols.size).toBeGreaterThan(10);
    expect([...cols]).not.toContain("failure_reason");
  });
});
