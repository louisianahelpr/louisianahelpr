/**
 * Q2794 (lead + owner 2026-11-14, by the lh-money-escrow review's recommendation): a stale payout-account clear pages
 * ops only when the member has money history. After Stripe rejected the platform on 2026-10-23, 16 clears paged one
 * by one (ops ledger acf4ea2ff283), each for a member with nothing owed. The REAL stripe-connect source, through the
 * edge harness (nothing reaches Stripe), proves each clear is tagged money_history:
 *   - false for a member with no row in any of MONEY_HISTORY_SOURCES (job, crew, cancellation-fee, tip, instant,
 *     referral, Declutter, shipping-claim, Shops, delivery and provider money, payee waits and holds; the list is
 *     pinned here, and the lh-money-escrow review of 2026-11-14 named every table on it)
 *     (public.error_log_is_record_only, 20261115040732, keeps that row out of Slack and the ledger:
 *     src/test/pglite/connectRecordOnlyRowsNeverPage.pglite.mjs);
 *   - true when any of those exist, and true when any of those reads FAILS (a doubt still pages);
 *   - the breaker's source/kind/origin are unchanged, so every clear is still counted.
 *
 * @mutate supabase/functions/stripe-connect/index.ts |       tags: { source: "stripe-connect", kind: STALE_CLEAR_KIND, money_history: moneyHistory, | tags: { source: "stripe-connect", kind: STALE_CLEAR_KIND, money_history: false,
 * @mutate supabase/functions/_shared/connectRecord.ts |     if (r.error \|\| !Array.isArray(r.data)) return true; |     if (r.error \|\| !Array.isArray(r.data)) return false;
 * @mutate supabase/functions/_shared/connectRecord.ts |   { table: "payout_payee_waits", member: "payee_id" },\n | \n
 * @mutate supabase/functions/_shared/connectRecord.ts |       if (src.in) q = q.in(src.in.column, src.in.values); |       if (src.in) q = q;
 * @mutate supabase/functions/_shared/connectRecord.ts |     // A doubt pages: the caller tags the clear money_history true.\n    return true; |     return false;
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { MONEY_HISTORY_SOURCES, memberHasMoneyHistory } from "../../../supabase/functions/_shared/connectRecord";

const USER = { id: "77777777-7777-4777-8777-777777777777", email: "member@example.test" };
const ACCT = "acct_gone_with_platform";
const accountGone = (id: string) =>
  Object.assign(new Error(`No such account: '${id}'`), { statusCode: 404, code: "resource_missing", type: "StripeInvalidRequestError" });

async function removeMethod() {
  const fn = await loadEdgeFunction("stripe-connect");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body: { action: "delete_payout_method", method_id: "ba_any" } }));
}
const clearTags = () =>
  scenario.writes
    .filter((w) => w.table === "error_logs" && w.op === "insert" && (w.payload as { tags?: { kind?: string } }).tags?.kind === "stale-clear")
    .map((w) => (w.payload as { tags: Record<string, unknown> }).tags);

beforeEach(() => {
  resetSupabaseMock();
  resetSharedMocks();
  resetStripeMock();
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_live_x" });
  scenario.authUser = USER;
  scenario.reads.profiles = { rows: [{ stripe_account_id: ACCT }] };
  scenario.reads.error_logs = { rows: [], count: 0 };
  scenario.writeSelectRows.profiles = [{ id: "p1", is_seed: false }];
  stripeMock.accounts.deleteExternalAccount.mockRejectedValue(accountGone(ACCT));
  stripeMock.accounts.retrieve.mockRejectedValue(accountGone(ACCT));
});
afterEach(() => resetEnv());

describe("a stale payout-account clear pages only with money history (Q2794)", () => {
  it("a member with no money history: the clear is tagged money_history false, and still counted by the breaker", async () => {
    await removeMethod();
    const tags = clearTags();
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ source: "stripe-connect", kind: "stale-clear", money_history: false });
    // It asked every money source about this member.
    const asked = (scenario.readQueries ?? []).filter((q) => MONEY_HISTORY_SOURCES.some((m) => m.table === q.table && q.filters.some((f) => f.column === m.member && f.value === USER.id)));
    expect(new Set(asked.map((q) => q.table))).toEqual(new Set(MONEY_HISTORY_SOURCES.map((m) => m.table)));
  });

  it("the money sources are exactly the reviewed list (two-way)", () => {
    expect(MONEY_HISTORY_SOURCES.map((m) => `${m.table}.${m.member}`).sort()).toEqual([
      "cancellation_fee_transfers.helper_id", "crew_cancellation_fee_shares.helper_id", "declutter_manager_payouts.manager_id",
      "declutter_orders.seller_id", "declutter_payouts.seller_id", "helpr_task_payouts.helpr_id", "helpr_task_tips.helpr_id",
      "instant_payouts.helper_id", "jobs.helper_id", "payout_holds.helper_id", "payout_payee_waits.payee_id",
      "payout_transfers.helper_id", "provider_payouts.payee_user_id", "referral_credits.user_id",
      "shipping_claim_payouts.seller_id", "shop_orders.seller_id", "tips.helper_id",
    ]);
  });

  for (const src of MONEY_HISTORY_SOURCES) {
    it(`${src.table}: a row for the member tags the clear money_history true (it pages)`, async () => {
      scenario.reads[src.table] = { rows: [{ [src.member]: USER.id }] };
      await removeMethod();
      expect(clearTags()[0]).toMatchObject({ kind: "stale-clear", money_history: true });
    });
    it(`${src.table}: a failed read tags it true (a doubt still pages)`, async () => {
      scenario.reads[src.table] = { error: { message: "boom" } };
      await removeMethod();
      expect(clearTags()[0]).toMatchObject({ kind: "stale-clear", money_history: true });
    });
  }

  it("money-state filters: a Helpr's job money, a paid or handed-over Declutter order, every tip but a failed one", async () => {
    await removeMethod();
    const q = (t: string) => (scenario.readQueries ?? []).find((r) => r.table === t);
    expect(q("jobs")?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "payment_status", value: ["escrow", "held", "payout_pending", "released", "cancelling", "chargeback"] })]));
    expect(q("declutter_orders")?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "status", value: ["paid", "handed_over"] })]));
    expect(q("tips")?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "neq", column: "payment_status", value: "failed" })]));
  });

  it("a query that throws while it is being built still answers true", async () => {
    const db = { from: () => { throw new Error("client gone"); } };
    expect(await memberHasMoneyHistory(db, USER.id)).toBe(true);
  });

  it("a read that throws (not just one that errors) still answers true", async () => {
    const q: Record<string, unknown> = {};
    q.limit = () => Promise.reject(new Error("socket hang up"));
    q.in = () => q;
    q.neq = () => q;
    q.eq = () => q;
    const db = { from: () => ({ select: () => q }) };
    expect(await memberHasMoneyHistory(db, USER.id)).toBe(true);
  });
});
