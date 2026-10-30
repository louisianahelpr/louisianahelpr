/**
 * Q2171 (lh-money-escrow@c4ec33afb#4): a member who still OWES a card fee
 * cannot delete their own account. job_helpr_fault_rulings.helper_id is SET
 * NULL and declutter_seller_fee_debts CASCADE with the account, so the debt
 * would be lost (the owner rule is never absorb a fee). Executed through the
 * real delete-own-account handler in the edge harness: a ruling with a fee
 * left, a ruling whose fee is not priced yet, and a Declutter seller's debt
 * each answer 409 with the plain message; a failed read answers 500 (fail
 * closed); no debt goes on to the purge.
 *
 * @mutate supabase/functions/delete-own-account/index.ts |     if (debt.active) { |     if (false) {
 * @mutate supabase/functions/delete-own-account/index.ts |     if (!debt.ok) { |     if (false) {
 * @mutate supabase/functions/_shared/accountPurge.ts | export const FEE_DEBT_RULING_FILTER = "card_fee_cents.is.null,card_fee_remaining_cents.gt.0"; | export const FEE_DEBT_RULING_FILTER = "card_fee_remaining_cents.gt.0";
 * @mutate supabase/functions/_shared/accountPurge.ts |     .gt("remaining_cents", 0) |     .gte("remaining_cents", 0)
 * @mutate supabase/functions/_shared/accountPurge.ts |     .eq("seller_id", userId)\n    .gt("remaining_cents", 0) |     .eq("buyer_id", userId)\n    .gt("remaining_cents", 0)
 * @mutate supabase/functions/_shared/accountPurge.ts |     .eq("helper_id", userId)\n    .or(FEE_DEBT_RULING_FILTER) |     .or(FEE_DEBT_RULING_FILTER)
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (ruling.error && !tableAbsent(ruling.error)) { |   if (false) {
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (seller.error && !tableAbsent(seller.error)) { |   if (false) {
 * @mutate supabase/functions/_shared/accountPurge.ts | const tableAbsent = (e: { code?: string }) => e.code === "42P01" \|\| e.code === "PGRST205"; | const tableAbsent = (e: { code?: string }) => Boolean(e);
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

// accountPurge.ts touches Deno, so it is outside the app tsconfig: loaded by path, as moneyOwedBlocksAccountDeletion does.
const PURGE = new URL("../../../supabase/functions/_shared/accountPurge.ts", import.meta.url).pathname;
const { FEE_DEBT_BLOCKS_DELETION_MESSAGE, FEE_DEBT_RULING_FILTER } = (await import(/* @vite-ignore */ PURGE)) as {
  FEE_DEBT_BLOCKS_DELETION_MESSAGE: string;
  FEE_DEBT_RULING_FILTER: string;
};

const ME = "11111111-1111-4111-8111-111111111111";

/** A token whose newest proof of identity is now, so the re-auth gate passes. */
function freshToken(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub: ME, amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] })}.sig`;
}

async function call() {
  const fn = await loadEdgeFunction("delete-own-account");
  const res = await fn.fetch(fn.request({
    headers: { Authorization: `Bearer ${freshToken()}` },
    body: { confirmation: "DELETE MY ACCOUNT" },
  }));
  return { res, body: JSON.parse(await res.text()) as Record<string, unknown> };
}

const readsOf = (table: string) => scenario.readQueries.filter((q) => q.table === table);

describe("Q2171: delete-own-account refuses while a fee debt is owed", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
    scenario.authUser = { id: ME, email: "member@example.com" };
  });

  it("a Helpr-at-fault card fee still owed blocks it, scoped to this member", async () => {
    scenario.reads.job_helpr_fault_rulings = { rows: [{ id: "r1" }] };
    const { res, body } = await call();
    expect(res.status).toBe(409);
    expect(body.error).toBe(FEE_DEBT_BLOCKS_DELETION_MESSAGE);
    const q = readsOf("job_helpr_fault_rulings");
    expect(q).toHaveLength(1);
    expect(q[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "helper_id", value: ME }),
      expect.objectContaining({ op: "or" }),
    ]));
    expect(JSON.stringify(q[0].filters)).toContain(FEE_DEBT_RULING_FILTER);
    // Both an unpriced ruling and one with fee left count as owed.
    expect(FEE_DEBT_RULING_FILTER.split(",").sort()).toEqual(["card_fee_cents.is.null", "card_fee_remaining_cents.gt.0"]);
  });

  it("a Declutter seller's fee debt with money left blocks it", async () => {
    scenario.reads.declutter_seller_fee_debts = { rows: [{ id: "d1" }] };
    const { res, body } = await call();
    expect(res.status).toBe(409);
    expect(body.error).toBe(FEE_DEBT_BLOCKS_DELETION_MESSAGE);
    const q = readsOf("declutter_seller_fee_debts");
    expect(q).toHaveLength(1);
    expect(q[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "seller_id", value: ME }),
      expect.objectContaining({ op: "gt", column: "remaining_cents", value: 0 }),
    ]));
  });

  it.each(["job_helpr_fault_rulings", "declutter_seller_fee_debts"])("a failed %s read fails closed (500, nothing deleted)", async (table) => {
    scenario.reads[table] = { error: { code: "57014", message: "statement timeout" } };
    const { res, body } = await call();
    expect(res.status).toBe(500);
    expect(body.error).toBe("Couldn't verify account state. Please try again.");
  });

  it("a missing table (migration lag) owes nothing and is not a refusal", async () => {
    scenario.reads.job_helpr_fault_rulings = { error: { code: "42P01", message: "relation does not exist" } };
    scenario.reads.declutter_seller_fee_debts = { error: { code: "PGRST205", message: "not found" } };
    const { body } = await call();
    expect(body.error).not.toBe(FEE_DEBT_BLOCKS_DELETION_MESSAGE);
    expect(body.error).not.toBe("Couldn't verify account state. Please try again.");
  });

  it("no debt: both tables are read and the delete goes on past the check", async () => {
    const { body } = await call();
    expect(readsOf("job_helpr_fault_rulings")).toHaveLength(1);
    expect(readsOf("declutter_seller_fee_debts")).toHaveLength(1);
    expect(body.error).not.toBe(FEE_DEBT_BLOCKS_DELETION_MESSAGE);
    expect(body.error).not.toBe("Couldn't verify account state. Please try again.");
  });
});
