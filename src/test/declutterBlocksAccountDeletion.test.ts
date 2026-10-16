/**
 * Declutter slice 3 (money review must-fix 1, 2026-10-14): a member with a
 * Declutter sale in flight (a cart line waiting for checkout, or PAID with the
 * money held on the platform until handover) cannot delete their account, on
 * either side of the sale. The Declutter rows cascade with the account, so a
 * deletion would erase the only record of what is owed to whom.
 *
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (!declutter.ok \|\| declutter.active) return declutter; |   void declutter;
 * @mutate supabase/functions/_shared/accountPurge.ts |     .in("status", ["in_cart", "paid"]) |     .in("status", ["in_cart"])
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (!tasks.ok \|\| tasks.active) return tasks.active ? { ...tasks, detail: `helpr delivery ${tasks.detail}` } : tasks; |   void tasks;
 * @mutate supabase/functions/_shared/accountPurge.ts |   const pay = await activeHelprRows(admin, "helpr_task_payouts", userId, ["pending"]); |   const pay = { ok: true, active: false } as ActiveWorkResult;
 *
 * Slice 5 (Helpr delivery): a Helpr mid-delivery (holding someone's item) or
 * with delivery pay still pending cannot delete their account either.
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
        in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), q),
        or: (expr: string) => {
          if (table !== "declutter_cart_items") return preds.push(() => false), q;
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
const line = (status: string): Row => ({ id: "l1", buyer_id: BUYER, seller_id: SELLER, status });
const HELPR = "33333333-3333-4333-8333-333333333333";

describe("a Declutter sale in flight blocks deleting either party's account", () => {
  it("a line waiting for checkout, or paid (money held), blocks the buyer AND the seller", async () => {
    for (const status of ["in_cart", "paid"]) {
      for (const who of [BUYER, SELLER]) {
        const r = await findActiveWork(fakeAdmin({ declutter_cart_items: [line(status)] }), who);
        expect(r, `${status} ${who}`).toMatchObject({ ok: true, active: true, reason: "declutter" });
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

  it("delivery pay still pending blocks; paid or nothing due does not", async () => {
    const pending = await findActiveWork(fakeAdmin({ helpr_task_payouts: [{ id: "p1", helpr_id: HELPR, status: "pending" }] }), HELPR);
    expect(pending).toMatchObject({ ok: true, active: true });
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
});
