/**
 * A member who still owes a card fee cannot delete their account (owner rule:
 * a fee is never absorbed). Two debts are taken from the next payout and would
 * be lost with the account: a Helpr-at-fault card fee (job_helpr_fault_rulings,
 * helper_id ON DELETE SET NULL; card_fee_remaining_cents > 0, or a ruling not
 * yet priced, which a gone Helpr would settle at 0) and a Declutter / Shops
 * seller's card-fee debt (declutter_seller_fee_debts, ON DELETE CASCADE).
 * Executed through the real delete-own-account handler and _shared/accountPurge.ts.
 *
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (!feeDebt.ok \|\| feeDebt.active) return feeDebt; |   void feeDebt;
 * @mutate supabase/functions/_shared/accountPurge.ts | r.card_fee_cents === null \|\| (r.card_fee_remaining_cents ?? 0) > 0 | (r.card_fee_remaining_cents ?? 0) > 0
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (declutter.error && !isMissingTable(declutter.error)) { |   if (false) {
 * @mutate supabase/functions/_shared/accountPurge.ts |  const missing = e.code === "42P01" \|\| e.code === "PGRST205"; |  const missing = /does not exist\|42P01\|PGRST205/i.test(`${e.code ?? ""} ${e.message ?? ""}`);
 * @mutate supabase/functions/_shared/accountPurge.ts |     + owedDebts.reduce((n, d) => n + d.remaining_cents, 0); | ;
 * @mutate supabase/functions/delete-own-account/index.ts |             ? feeDebtBlocksDeletionMessage(active.owedCents ?? 0) |             ? feeDebtBlocksDeletionMessage(0)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const USER = { id: "44444444-4444-4444-8444-444444444444", email: "helpr@example.test" };

async function del() {
  const fn = await loadEdgeFunction("delete-own-account");
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body: { confirmation: "DELETE MY ACCOUNT" } }));
  return { status: res.status, body: (await res.json()) as { error?: string } };
}

const feeReads = () => (scenario.readQueries ?? []).filter((q) => q.table === "job_helpr_fault_rulings" || q.table === "declutter_seller_fee_debts");

describe("a card fee still owed blocks deleting the account (never absorb a fee)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
    scenario.authUser = USER;
  });
  afterEach(() => resetEnv());

  it("a Helpr-at-fault card fee not yet taken from a payout refuses 409 and names the amount", async () => {
    scenario.reads.job_helpr_fault_rulings = { rows: [{ job_id: "j1", card_fee_cents: 147, card_fee_remaining_cents: 147 }] };
    const r = await del();
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("$1.47");
    expect(r.body.error).toContain("next payout");
    // Scoped to the caller's own rulings and Declutter debts.
    const reads = feeReads();
    expect(reads.length, "inventory floor: both fee-debt reads ran").toBeGreaterThan(0);
    expect(reads.find((q) => q.table === "job_helpr_fault_rulings")?.filters).toEqual(
      expect.arrayContaining([{ op: "eq", column: "helper_id", value: USER.id }]),
    );
  });

  it("a ruling not yet priced (card_fee_cents NULL) refuses too", async () => {
    scenario.reads.job_helpr_fault_rulings = { rows: [{ job_id: "j1", card_fee_cents: null, card_fee_remaining_cents: null }] };
    const r = await del();
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/card fee .*still being worked out/i);
  });

  it("a Declutter / Shops seller fee debt refuses, and the amounts add up across both debts", async () => {
    scenario.reads.declutter_seller_fee_debts = { rows: [{ id: "d1", remaining_cents: 53 }] };
    expect((await del()).body.error).toContain("$0.53");
    resetSupabaseMock();
    scenario.authUser = USER;
    scenario.reads.declutter_seller_fee_debts = { rows: [{ id: "d1", remaining_cents: 53 }] };
    scenario.reads.job_helpr_fault_rulings = { rows: [{ job_id: "j1", card_fee_cents: 147, card_fee_remaining_cents: 100 }] };
    const both = await del();
    expect(both.status).toBe(409);
    expect(both.body.error).toContain("$1.53");
    expect(feeReads().find((q) => q.table === "declutter_seller_fee_debts")?.filters).toEqual(
      expect.arrayContaining([{ op: "eq", column: "seller_id", value: USER.id }]),
    );
  });

  it("a paid-off debt or a fully taken ruling does not block", async () => {
    scenario.reads.job_helpr_fault_rulings = { rows: [{ job_id: "j1", card_fee_cents: 147, card_fee_remaining_cents: 0 }] };
    scenario.reads.declutter_seller_fee_debts = { rows: [{ id: "d1", remaining_cents: 0 }] };
    const r = await del();
    expect(r.status).not.toBe(409);
    expect(r.body.error ?? "").not.toMatch(/card fee/i);
  });

  it("a failed fee-debt read fails closed (500, nothing deleted); a table not deployed yet owes nothing", async () => {
    for (const table of ["job_helpr_fault_rulings", "declutter_seller_fee_debts"]) {
      resetSupabaseMock();
      scenario.authUser = USER;
      scenario.reads[table] = { error: { code: "08006", message: "connection reset" } };
      const r = await del();
      expect(r.status, table).toBe(500);
      expect(r.body.error, table).toContain("Couldn't verify account state");
      // A missing COLUMN (or function) "does not exist" too, but it is not
      // an absent table: it must refuse, never read as "owes nothing".
      resetSupabaseMock();
      scenario.authUser = USER;
      scenario.reads[table] = { error: { code: "42703", message: `column "remaining_cents" does not exist` } };
      const col = await del();
      expect(col.status, `${table} missing column`).toBe(500);
    }
    resetSupabaseMock();
    scenario.authUser = USER;
    scenario.reads.job_helpr_fault_rulings = { error: { code: "42P01", message: 'relation "job_helpr_fault_rulings" does not exist' } };
    scenario.reads.declutter_seller_fee_debts = { error: { code: "42P01", message: 'relation "declutter_seller_fee_debts" does not exist' } };
    const absent = await del();
    expect(absent.body.error ?? "").not.toContain("Couldn't verify account state");
  });
});
