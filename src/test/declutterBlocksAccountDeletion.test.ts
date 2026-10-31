/**
 * Declutter slice 3 (money review must-fix 1, 2026-10-14): a member with a
 * Declutter sale in flight (a cart line waiting for checkout, or PAID with the
 * money held on the platform until handover) cannot delete their account, on
 * either side of the sale. The Declutter rows cascade with the account, so a
 * deletion would erase the only record of what is owed to whom.
 *
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (!declutter.ok \|\| declutter.active) return declutter; |   void declutter;
 * @mutate supabase/functions/_shared/accountPurge.ts |       .eq("status", "paid").eq("declutter_orders.status", "paid").limit(1) },
 |       .eq("status", "in_cart").limit(1) },

 * @mutate supabase/functions/_shared/accountPurge.ts |       .eq("status", "paid").eq("declutter_orders.status", "paid").limit(1) }, |       .eq("status", "paid").limit(1) },
 * @mutate supabase/functions/_shared/accountPurge.ts |       .in("status", ["pending", "failed", "held_for_review"]).limit(1) }, |       .in("status", ["pending"]).limit(1) },
 * @mutate supabase/functions/_shared/accountPurge.ts |       .eq("status", "open").limit(1) }, |       .eq("status", "decided").limit(1) },
 * @mutate supabase/functions/_shared/accountPurge.ts |       if (lines.error.code === "42P01" \|\| lines.error.code === "PGRST205") continue; |       if (/does not exist\|42P01\|PGRST205/i.test(`${lines.error.code ?? ""} ${lines.error.message}`)) return { ok: true, active: false };
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (!tasks.ok \|\| tasks.active) return tasks.active ? { ...tasks, detail: `helpr delivery ${tasks.detail}` } : tasks; |   void tasks;
 * @mutate supabase/functions/_shared/accountPurge.ts | userId, ["pending", "failed", "held_for_review"]); | userId, ["pending", "held_for_review"]);
 * @mutate supabase/functions/_shared/accountPurge.ts |   const pay = await activeHelprRows(admin, "helpr_task_payouts", userId, ["pending", "failed", "held_for_review"]); |   const pay = { ok: true, active: false } as ActiveWorkResult;
 *
 * Slice 5 (Helpr delivery): a Helpr mid-delivery (holding someone's item) or
 * with delivery pay still pending cannot delete their account either.
 *
 * Q1929 (delivery-pay raises): a raise still in flight blocks both parties; a settled one, or an abandoned
 * page past its 31-minute life, never blocks (lh-money-escrow review finding 1: an abandoned page and a paid-out
 * raise used to count forever).
 * @mutate supabase/functions/_shared/accountPurge.ts | const RAISE_TASK_RUNNING = ["open", "accepted", "picked_up", "delivered"]; | const RAISE_TASK_RUNNING = ["open", "accepted", "picked_up", "delivered", "confirmed"];
 * @mutate supabase/functions/_shared/accountPurge.ts | .eq("status", "awaiting_payment").gt("created_at", pageCutoff).limit(1) | .eq("status", "awaiting_payment").limit(1)
 * @mutate supabase/functions/_shared/accountPurge.ts |     { label: "refund to send", build: () => raiseQuery(admin, userId).eq("status", "refunding").limit(1) }, |
 */
import { describe, expect, it } from "vitest";

const PURGE = new URL("../../supabase/functions/_shared/accountPurge.ts", import.meta.url).pathname;
type ActiveWork = { ok: boolean; active: boolean; reason?: string; detail?: string };
const { findActiveWork } = (await import(/* @vite-ignore */ PURGE)) as {
  findActiveWork: (admin: unknown, userId: string) => Promise<ActiveWork>;
};

type Row = Record<string, unknown>;
type Tables = Record<string, Row[] | { error: { code: string; message: string } }>;

/** Minimal PostgREST stand-in: `or("a.eq.X,b.eq.X")` is honoured on Declutter lines, every jobs read matches nothing. */
function fakeAdmin(tables: Tables) {
  return {
    from(table: string) {
      const preds: Array<(r: Row) => boolean> = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
        neq: (c: string, v: unknown) => (preds.push((r) => r[c] !== v), q),
        is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
        not: () => q,
        gte: () => q,
        gt: (c: string, v: unknown) => (preds.push((r) => String(r[c] ?? "") > String(v)), q),
        in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), q),
        or: (expr: string) => {
          // A raise or problem row carries its order's buyer_id / seller_id flattened (the !inner embed's filter).
          if (table !== "declutter_cart_items" && table !== "declutter_delivery_raises" && table !== "declutter_problems") return preds.push(() => false), q;
          const terms = expr.split(",").map((t) => t.split(".eq."));
          preds.push((r) => terms.some(([c, v]) => r[c] === v));
          return q;
        },
        limit: () => q,
        then: (res: (v: unknown) => unknown) => {
          const t = tables[table] ?? [];
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

const BUYER = "11111111-1111-4111-8111-111111111111";
const SELLER = "22222222-2222-4222-8222-222222222222";
// A paid line carries its order's status flattened (the !inner embed's filter): money held until handover.
const line = (status: string, orderStatus = "paid"): Row => ({ id: "l1", buyer_id: BUYER, seller_id: SELLER, status, "declutter_orders.status": orderStatus });
const HELPR = "33333333-3333-4333-8333-333333333333";

describe("a Declutter sale in flight blocks deleting either party's account", () => {
  it("a line waiting for checkout, or paid (money held), blocks the buyer AND the seller", async () => {
    for (const status of ["in_cart", "paid"]) {
      for (const who of [BUYER, SELLER]) {
        const r = await findActiveWork(fakeAdmin({ declutter_cart_items: [line(status)] }), who);
        expect(r, `${status} ${who}`).toMatchObject({ ok: true, active: true, reason: status === "paid" ? "declutter_held" : "declutter" });
      }
    }
  });

  it("a missed or cancelled line does not block", async () => {
    for (const status of ["missed", "cancelled_by_seller"]) {
      const r = await findActiveWork(fakeAdmin({ declutter_cart_items: [line(status)] }), BUYER);
      expect(r).toMatchObject({ ok: true, active: false });
    }
  });

  it("before the table exists nothing blocks; any other read error fails closed", async () => {
    const absent = await findActiveWork(fakeAdmin({ declutter_cart_items: { error: { code: "42P01", message: 'relation "declutter_cart_items" does not exist' } } }), BUYER);
    expect(absent).toMatchObject({ ok: true, active: false });
    const down = await findActiveWork(fakeAdmin({ declutter_cart_items: { error: { code: "08006", message: "connection reset" } } }), BUYER);
    expect(down.ok).toBe(false);
  });
});

describe("a Helpr delivery in flight blocks deleting the Helpr's account", () => {
  it("a taken, picked-up or left-at-the-door delivery blocks; open, finished or failed ones do not", async () => {
    for (const status of ["accepted", "picked_up", "delivered"]) {
      const r = await findActiveWork(fakeAdmin({ helpr_tasks: [{ id: "t1", helpr_id: HELPR, status }] }), HELPR);
      expect(r, status).toMatchObject({ ok: true, active: true, reason: "declutter" });
    }
    for (const status of ["confirmed", "failed", "cancelled", "unfilled"]) {
      const r = await findActiveWork(fakeAdmin({ helpr_tasks: [{ id: "t1", helpr_id: HELPR, status }] }), HELPR);
      expect(r, status).toMatchObject({ ok: true, active: false });
    }
    const other = await findActiveWork(fakeAdmin({ helpr_tasks: [{ id: "t1", helpr_id: BUYER, status: "accepted" }] }), HELPR);
    expect(other).toMatchObject({ ok: true, active: false });
  });

  it("delivery pay still pending or being retried blocks; paid or nothing due does not", async () => {
    for (const status of ["pending", "failed"]) {
      const owed = await findActiveWork(fakeAdmin({ helpr_task_payouts: [{ id: "p1", helpr_id: HELPR, status }] }), HELPR);
      expect(owed, status).toMatchObject({ ok: true, active: true });
    }
    for (const status of ["succeeded", "nothing_due"]) {
      const r = await findActiveWork(fakeAdmin({ helpr_task_payouts: [{ id: "p1", helpr_id: HELPR, status }] }), HELPR);
      expect(r, status).toMatchObject({ ok: true, active: false });
    }
  });

  it("before the tables exist nothing blocks; any other read error fails closed", async () => {
    const missing = { error: { code: "42P01", message: 'relation "helpr_tasks" does not exist' } };
    expect(await findActiveWork(fakeAdmin({ helpr_tasks: missing, helpr_task_payouts: missing }), HELPR)).toMatchObject({ ok: true, active: false });
    const down = { error: { code: "08006", message: "connection reset" } };
    expect((await findActiveWork(fakeAdmin({ helpr_tasks: down }), HELPR)).ok).toBe(false);
    expect((await findActiveWork(fakeAdmin({ helpr_task_payouts: down }), HELPR)).ok).toBe(false);
  });

  it("Q1929: a delivery-pay raise in flight blocks both parties; a settled or abandoned one does not", async () => {
    const now = Date.now();
    // A raise row carries its order's parties and its task's status flattened (the !inner embeds' filters).
    const raise = (r: Row): Row => ({ id: "r1", buyer_id: BUYER, seller_id: SELLER, "helpr_tasks.status": "open", created_at: new Date(now).toISOString(), ...r });
    const blocks: Row[] = [
      raise({ status: "refunding" }),
      raise({ status: "applied" }),
      raise({ status: "applied", "helpr_tasks.status": "delivered" }),
      raise({ status: "awaiting_payment", created_at: new Date(now - 5 * 60e3).toISOString() }),
    ];
    for (const row of blocks) {
      for (const who of [BUYER, SELLER]) {
        const r = await findActiveWork(fakeAdmin({ declutter_delivery_raises: [row] }), who);
        expect(r, `${row.status} ${who}`).toMatchObject({ ok: true, active: true, reason: "declutter" });
      }
    }
    const settled: Row[] = [
      // Confirmed: the raise is in the Helpr's payout (paid by declutter-money or settled by hand), not in flight.
      raise({ status: "applied", "helpr_tasks.status": "confirmed" }),
      raise({ status: "refunded" }),
      raise({ status: "superseded" }),
      raise({ status: "awaiting_payment", created_at: new Date(now - 2 * 3600e3).toISOString() }),
    ];
    for (const row of settled) {
      const r = await findActiveWork(fakeAdmin({ declutter_delivery_raises: [row] }), BUYER);
      expect(r, `${row.status} ${String(row["helpr_tasks.status"])}`).toMatchObject({ ok: true, active: false });
    }
    expect(await findActiveWork(fakeAdmin({ declutter_delivery_raises: [raise({ status: "applied", buyer_id: HELPR, seller_id: HELPR })] }), BUYER))
      .toMatchObject({ ok: true, active: false });
    expect((await findActiveWork(fakeAdmin({ declutter_delivery_raises: { error: { code: "08006", message: "connection reset" } } }), BUYER)).ok).toBe(false);
  });

  it("Q2307: a paid line whose sale is settled (handed over or refunded) no longer blocks; a seller's payout still owed does", async () => {
    for (const orderStatus of ["handed_over", "refunded"]) {
      for (const who of [BUYER, SELLER]) {
        const r = await findActiveWork(fakeAdmin({ declutter_cart_items: [line("paid", orderStatus)] }), who);
        expect(r, `${orderStatus} ${who}`).toMatchObject({ ok: true, active: false });
      }
    }
    for (const status of ["pending", "failed", "held_for_review"]) {
      const owed = await findActiveWork(fakeAdmin({ declutter_payouts: [{ id: "dp1", seller_id: SELLER, status }] }), SELLER);
      expect(owed, status).toMatchObject({ ok: true, active: true, reason: "declutter" });
      const buyer = await findActiveWork(fakeAdmin({ declutter_payouts: [{ id: "dp1", seller_id: SELLER, status }] }), BUYER);
      expect(buyer, `${status} buyer`).toMatchObject({ ok: true, active: false });
    }
    for (const status of ["succeeded", "nothing_due", "settled_by_hand"]) {
      const r = await findActiveWork(fakeAdmin({ declutter_payouts: [{ id: "dp1", seller_id: SELLER, status }] }), SELLER);
      expect(r, status).toMatchObject({ ok: true, active: false });
    }
    const down = { error: { code: "08006", message: "connection reset" } };
    expect((await findActiveWork(fakeAdmin({ declutter_payouts: down }), SELLER)).ok).toBe(false);
  });

  it("Q2307: a problem still open on one of their sales blocks either party; a decided one does not", async () => {
    const problem = (status: string): Row => ({ id: "pr1", buyer_id: BUYER, seller_id: SELLER, status });
    for (const who of [BUYER, SELLER]) {
      expect(await findActiveWork(fakeAdmin({ declutter_problems: [problem("open")] }), who), who).toMatchObject({ ok: true, active: true, reason: "declutter" });
      expect(await findActiveWork(fakeAdmin({ declutter_problems: [problem("decided")] }), who), who).toMatchObject({ ok: true, active: false });
    }
    expect(await findActiveWork(fakeAdmin({ declutter_problems: [problem("open")] }), HELPR)).toMatchObject({ ok: true, active: false });
  });

  it("Q2307 (review #4): only a missing TABLE counts as nothing in flight, and the later checks still run; a missing column fails closed", async () => {
    const noTable = { error: { code: "42P01", message: 'relation "declutter_cart_items" does not exist' } };
    // The cart table is missing, but a seller payout is owed: the later check still runs and blocks.
    expect(await findActiveWork(fakeAdmin({ declutter_cart_items: noTable, declutter_payouts: [{ id: "dp1", seller_id: SELLER, status: "pending" }] }), SELLER))
      .toMatchObject({ ok: true, active: true, reason: "declutter" });
    // ... and the Helpr checks after the loop still run too.
    expect(await findActiveWork(fakeAdmin({ declutter_cart_items: noTable, helpr_tasks: [{ id: "t1", helpr_id: HELPR, status: "accepted" }] }), HELPR))
      .toMatchObject({ ok: true, active: true });
    const noColumn = { error: { code: "42703", message: 'column declutter_orders_1.status does not exist' } };
    expect((await findActiveWork(fakeAdmin({ declutter_cart_items: noColumn }), BUYER)).ok).toBe(false);
  });
});
