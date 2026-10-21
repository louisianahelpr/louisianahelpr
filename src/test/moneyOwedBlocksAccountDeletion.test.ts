/**
 * Q2273 (lh-money-escrow review of the board 120 copy): delete-own-account
 * refuses while money is still owed TO the member and only their account can
 * receive it: a pending/failed cancellation-fee transfer, a held tip's re-drive
 * (owed/reversed/repaying/failed), or a job payout held by a card dispute (as
 * lead or crew) that the bank has not decided against. Each payee column is
 * SET NULL or orphaned by the delete, and the money path then refuses the row.
 *
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (!owed.ok \|\| owed.active) return owed; |   void owed;
 * @mutate supabase/functions/_shared/accountPurge.ts | export const CANCELLATION_FEE_OWED_STATUSES = ["pending", "failed"]; | export const CANCELLATION_FEE_OWED_STATUSES = ["pending"];
 * @mutate supabase/functions/_shared/accountPurge.ts | export const TIP_REDRIVE_OWED_STATUSES = ["owed", "reversed", "repaying", "failed"]; | export const TIP_REDRIVE_OWED_STATUSES = ["owed"];
 * @mutate supabase/functions/_shared/accountPurge.ts | export const CHARGEBACK_SETTLED_DISPUTE_STATUS = "dispute_lost"; | export const CHARGEBACK_SETTLED_DISPUTE_STATUS = "resolved";
 * @mutate supabase/functions/_shared/accountPurge.ts | export const CLAWBACK_OWED_FILTER = "status.in.(repaying,repay_failed),held_repay_owed_at.not.is.null"; | export const CLAWBACK_OWED_FILTER = "status.in.(repaying,repay_failed)";
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (held.error) { |   if (false) {
 * @mutate supabase/functions/_shared/accountPurge.ts |   const owedShare = (share.data ?? []).find((r) => Number(r.share_amount) > 0); |   const owedShare = (share.data ?? [])[0];
 * @mutate supabase/functions/_shared/accountPurge.ts |   const absent = (e: { code?: string; message: string }) => /^(42P01\|PGRST205)$/.test(e.code ?? ""); |   const absent = (e: { code?: string; message: string }) => /does not exist\|42P01\|PGRST205/i.test(`${e.code ?? ""} ${e.message}`);
 * @mutate supabase/functions/admin-delete-user/index.ts |             : active.reason === "money_owed" |             : active.reason === "money_owed_x"
 * Board 141 (Q2272): a live refund request, as the poster who asked or the
 * Helpr asked (open, declined with its dispute not filed yet, or agreed and
 * not yet split), blocks it too; a settled one does not.
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (!refund.ok \|\| refund.active) return refund; |   void refund;
 * @mutate supabase/functions/_shared/accountPurge.ts | export const REFUND_REQUEST_WAITING_FILTER = "status.in.(open,finish_offered,coming_back),and(status.eq.declined,dispute_id.is.null)"; | export const REFUND_REQUEST_WAITING_FILTER = "status.in.(open),and(status.eq.declined,dispute_id.is.null)";
 * @mutate supabase/functions/_shared/accountPurge.ts |     .or("execution_status.is.null,execution_status.neq.executed", { referencedTable: "disputes" }) |     .or("execution_status.is.null,execution_status.neq.pending", { referencedTable: "disputes" })
 * @mutate supabase/functions/delete-own-account/index.ts |             : active.reason === "money_owed"\n            ? MONEY_OWED_BLOCKS_DELETION_MESSAGE\n | \n
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const PURGE = new URL("../../supabase/functions/_shared/accountPurge.ts", import.meta.url).pathname;
type ActiveWork = { ok: boolean; active: boolean; reason?: string; detail?: string };
const mod = (await import(/* @vite-ignore */ PURGE)) as {
  findActiveWork: (admin: unknown, userId: string) => Promise<ActiveWork>;
  MONEY_OWED_BLOCKS_DELETION_MESSAGE: string;
  CLAWBACK_OWED_FILTER: string;
  CANCELLATION_FEE_OWED_STATUSES: string[];
  TIP_REDRIVE_OWED_STATUSES: string[];
};

type Row = Record<string, unknown>;
type Tables = Record<string, Row[] | { error: { code: string; message: string } }>;
const get = (r: Row, c: string) => c.split(".").reduce<unknown>((o, k) => (o as Row | undefined)?.[k], r);

/** PostgREST stand-in: dotted columns read an embedded row; the LIVE-status job reads match nothing. */
function fakeAdmin(tables: Tables) {
  return {
    from(table: string) {
      const preds: Array<(r: Row) => boolean> = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          if (table === "jobs" && c === "payment_status" && v === "chargeback") (q as { cb?: boolean }).cb = true;
          preds.push((r) => get(r, c) === v);
          return q;
        },
        neq: (c: string, v: unknown) => (preds.push((r) => get(r, c) !== v), q),
        is: (c: string, v: unknown) => (preds.push((r) => (get(r, c) ?? null) === v), q),
        not: () => q,
        gte: () => q,
        gt: (c: string, v: number) => (preds.push((r) => Number(get(r, c)) > v), q),
        in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(get(r, c))), q),
        or: (expr: string, opts?: { referencedTable?: string }) => {
          // Parse the real filter string (never a hardcoded copy of it), so a
          // changed filter in accountPurge changes what matches here.
          const terms = splitOr(expr);
          if (!terms.every((t) => /^(dispute_status|status|held_repay_owed_at|requester_id|responder_id|execution_status)\.|^and\(/.test(t))) {
            preds.push(() => false); // the LIVE job filters: match nothing
            return q;
          }
          const base = opts?.referencedTable ? `${opts.referencedTable}.` : "";
          preds.push((r) => terms.some((t) => orTerm(t, (c) => get(r, base + c))));
          return q;
        },
        limit: () => q,
        then: (res: (v: unknown) => unknown) => {
          // `jobs!chargeback`: an error only on the chargeback read, so the test
          // reaches it past the earlier live-job reads.
          const t = (q as { cb?: boolean }).cb && tables["jobs!chargeback"] ? tables["jobs!chargeback"] : tables[table] ?? [];
          if (!Array.isArray(t)) return Promise.resolve({ data: null, error: t.error }).then(res);
          return Promise.resolve({ data: t.filter((r) => preds.every((p) => p(r))), error: null }).then(res);
        },
      };
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({}), listBuckets: () => Promise.resolve({ data: [], error: null }) },
  };
}


/** Split a PostgREST or=() body on its top-level commas. */
function splitOr(expr: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  return [...out, cur].filter(Boolean);
}
/** One `col.op.value` term: is.null, neq.X, in.(a,b), not.is.null. */
function orTerm(t: string, read: (c: string) => unknown): boolean {
  // and(a,b): every inner term (refund_requests' "declined with no dispute yet").
  const and = /^and\((.*)\)$/.exec(t);
  if (and) return splitOr(and[1]).every((x) => orTerm(x, read));
  const m = /^([\w]+)\.(not\.is|is|neq|eq|in)\.(.*)$/.exec(t);
  if (!m) throw new Error(`fake cannot parse ${t}`);
  const [, c, op, v] = m;
  const val = read(c) ?? null;
  if (op === "is") return v === "null" ? val === null : String(val) === v;
  if (op === "not.is") return v === "null" ? val !== null : String(val) !== v;
  if (op === "neq") return val !== null && val !== v;
  if (op === "eq") return val === v;
  return v.replace(/^\(|\)$/g, "").split(",").includes(String(val));
}

const ME = "11111111-1111-4111-8111-111111111111";
/** The embedded dispute a refund_requests read returns (status, execution_status). */
const embed = (status: string, execution_status: string) => ({ status, execution_status });
const OTHER = "22222222-2222-4222-8222-222222222222";
const check = (tables: Tables) => mod.findActiveWork(fakeAdmin(tables), ME);

describe("Q2273: money owed to the member blocks deleting the account", () => {
  it("a clean account is not blocked", async () => {
    expect(await check({})).toMatchObject({ ok: true, active: false });
  });

  it.each(["pending", "failed"])("a cancellation-fee transfer %s blocks", async (status) => {
    const r = await check({ cancellation_fee_transfers: [{ id: "c1", helper_id: ME, status }] });
    expect(r).toMatchObject({ ok: true, active: true, reason: "money_owed" });
  });

  it.each(["paid", "reversed", "waived"])("a cancellation-fee transfer %s does not", async (status) => {
    expect(await check({ cancellation_fee_transfers: [{ id: "c1", helper_id: ME, status }] })).toMatchObject({ active: false });
  });

  it.each(["owed", "reversed", "repaying", "failed"])("a tip re-drive %s blocks", async (status) => {
    const r = await check({ tip_hold_redrives: [{ tip_id: "t1", helper_id: ME, status }] });
    expect(r).toMatchObject({ ok: true, active: true, reason: "money_owed" });
  });

  it.each(["repaid", "not_reversed", "kept"])("a tip re-drive %s does not", async (status) => {
    expect(await check({ tip_hold_redrives: [{ tip_id: "t1", helper_id: ME, status }] })).toMatchObject({ active: false });
  });

  it("a payout held by a card dispute blocks unless the dispute is known lost", async () => {
    const job = (dispute_status: string | null) => ({ id: "j1", helper_id: ME, payment_status: "chargeback", dispute_status });
    expect(await check({ jobs: [job("stripe_chargeback")] })).toMatchObject({ active: true, reason: "money_owed" });
    expect(await check({ jobs: [job("dispute_won")] })).toMatchObject({ active: true, reason: "money_owed" });
    expect(await check({ jobs: [job("dispute_lost")] })).toMatchObject({ active: false });
    expect(await check({ jobs: [job(null)] })).toMatchObject({ active: true, reason: "money_owed" });
    // An internal status cannot tell open/won from lost: fail closed (Q2277 covers clearing a lost one).
    expect(await check({ jobs: [job("resolved")] })).toMatchObject({ active: true, reason: "money_owed" });
  });

  it("a full page of crew fee shares fails closed (an owed one could hide past it)", async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ id: `s${i}`, helper_id: ME, status: "pending", share_amount: 0 }));
    expect(await check({ crew_cancellation_fee_shares: many })).toMatchObject({ ok: false });
  });

  it("a crew member's unsent fee share blocks; a $0 share never does", async () => {
    expect(await check({ crew_cancellation_fee_shares: [{ id: "s1", helper_id: ME, status: "pending", share_amount: 12.5 }] })).toMatchObject({ active: true, reason: "money_owed" });
    expect(await check({ crew_cancellation_fee_shares: [{ id: "s1", helper_id: ME, status: "pending", share_amount: 0 }] })).toMatchObject({ active: false });
  });

  it("a clawed-back payout being re-paid after a won dispute blocks", async () => {
    for (const status of ["repaying", "repay_failed"]) {
      expect(await check({ chargeback_clawbacks: [{ id: "k1", helper_id: ME, status }] })).toMatchObject({ active: true, reason: "money_owed" });
    }
    // A won re-pay waiting on a payout hold.
    expect(await check({ chargeback_clawbacks: [{ id: "k1", helper_id: ME, status: "reversed", held_repay_owed_at: "2026-10-20T00:00:00Z" }] })).toMatchObject({ active: true, reason: "money_owed" });
    expect(await check({ chargeback_clawbacks: [{ id: "k1", helper_id: ME, status: "repaid" }] })).toMatchObject({ active: false });
  });

  it("a jobs read error, and a missing COLUMN on a ledger, fail closed", async () => {
    expect(await check({ "jobs!chargeback": { error: { code: "XX000", message: "boom" } } })).toMatchObject({ ok: false });
    expect(await check({ tip_hold_redrives: { error: { code: "42703", message: 'column "helper_id" does not exist' } } })).toMatchObject({ ok: false });
    // ...while a missing TABLE is tolerated (not deployed yet: nothing can be owed).
    expect(await check({ tip_hold_redrives: { error: { code: "42P01", message: 'relation "tip_hold_redrives" does not exist' } } })).toMatchObject({ ok: true, active: false });
  });

  it("an admin deletion is refused with its own words", () => {
    const fn = blankComments(readFileSync(join(process.cwd(), "supabase/functions/admin-delete-user/index.ts"), "utf8"));
    expect(fn).toMatch(/active\.reason === "money_owed"\s*\?\s*"Money is still owed to this user/);
  });

  it("a crew member's held chargeback payout blocks too", async () => {
    const r = await check({ group_job_helpers: [{ job_id: "g1", helper_id: ME, jobs: { payment_status: "chargeback", dispute_status: "stripe_chargeback" } }] });
    expect(r).toMatchObject({ active: true, reason: "money_owed" });
  });

  it.each([
    ["an open request the member asked", { requester_id: ME, status: "open", dispute_id: null }, true],
    ["an open request the member was asked", { responder_id: ME, status: "open", dispute_id: null }, true],
    ["declined, its dispute not filed yet", { responder_id: ME, status: "declined", dispute_id: null }, true],
    ["agreed, not yet split", { requester_id: ME, status: "agreed", dispute_id: "d1", disputes: embed("decided", "pending") }, true],
    ["agreed, split failed (waiting on a retry)", { responder_id: ME, status: "agreed", dispute_id: "d1", disputes: embed("decided", "failed") }, true],
    ["agreed and split", { requester_id: ME, status: "agreed", dispute_id: "d1", disputes: embed("decided", "executed") }, false],
    ["declined with its dispute filed (the disputed job blocks on its own)", { requester_id: ME, status: "declined", dispute_id: "d1" }, false],
    ["a come-back offer the poster has not answered (Q2326)", { responder_id: ME, status: "finish_offered", dispute_id: null }, true],
    ["a come-back accepted, not yet handed over", { requester_id: ME, status: "coming_back", dispute_id: null }, true],
    ["closed as coming back", { requester_id: ME, status: "closed", dispute_id: null }, false],
    ["another member's open request", { requester_id: OTHER, status: "open", dispute_id: null }, false],
  ])("Q2272: a refund request %s", async (_name, row, blocks) => {
    const r = await check({ refund_requests: [{ id: "rr1", ...row }] });
    if (blocks) expect(r).toMatchObject({ ok: true, active: true, reason: "job" });
    else expect(r).toMatchObject({ ok: true, active: false });
  });

  it("Q2272: an unreadable refund request list fails closed; a missing table blocks nobody", async () => {
    expect(await check({ refund_requests: { error: { code: "XX000", message: "boom" } } })).toMatchObject({ ok: false });
    expect(await check({ refund_requests: { error: { code: "42P01", message: 'relation "refund_requests" does not exist' } } })).toMatchObject({ ok: true, active: false });
  });

  it("another member's money does not block this one", async () => {
    expect(await check({ cancellation_fee_transfers: [{ id: "c1", helper_id: OTHER, status: "pending" }] })).toMatchObject({ active: false });
  });

  it("a read error fails closed", async () => {
    const r = await check({ cancellation_fee_transfers: { error: { code: "XX000", message: "boom" } } });
    expect(r).toMatchObject({ ok: false, active: false });
  });

  it("the statuses match each ledger's CHECK, so the lists cannot name a status that does not exist", () => {
    const sql = (f: string) => blankSqlComments(readFileSync(join(process.cwd(), "supabase/migrations", f), "utf8"));
    const fee = sql("20261002052502_cancellation_fee_transfers_ledger.sql");
    const tip = sql("20261004220059_tip_held_payout_redrive.sql");
    for (const s of mod.CANCELLATION_FEE_OWED_STATUSES) expect(fee).toContain(`'${s}'`);
    for (const s of mod.TIP_REDRIVE_OWED_STATUSES) expect(tip).toContain(`'${s}'`);
  });

  it("the member is told in plain words, without naming a payout hold", () => {
    const fn = blankComments(readFileSync(join(process.cwd(), "supabase/functions/delete-own-account/index.ts"), "utf8"));
    expect(fn).toMatch(/active\.reason === "money_owed"\s*\?\s*MONEY_OWED_BLOCKS_DELETION_MESSAGE/);
    expect(mod.MONEY_OWED_BLOCKS_DELETION_MESSAGE).not.toMatch(/hold on your|payout hold|held because/i);
  });
});
