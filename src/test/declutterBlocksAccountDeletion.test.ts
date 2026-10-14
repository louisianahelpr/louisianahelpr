/**
 * Declutter slice 3 (money review must-fix 1, 2026-10-14): a member with a
 * Declutter sale in flight (a cart line waiting for checkout, or PAID with the
 * money held on the platform until handover) cannot delete their account, on
 * either side of the sale. The Declutter rows cascade with the account, so a
 * deletion would erase the only record of what is owed to whom.
 *
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (!declutter.ok \|\| declutter.active) return declutter; |   void declutter;
 * @mutate supabase/functions/_shared/accountPurge.ts |     .in("status", ["in_cart", "paid"]) |     .in("status", ["in_cart"])
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
