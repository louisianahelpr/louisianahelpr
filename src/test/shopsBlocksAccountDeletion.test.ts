/**
 * Shops M1 (lh-authz-rls review of 66dec6dd0..178afae7d, note on account
 * deletion): a member with a Shops order in progress, as the buyer or as the
 * shop, cannot delete their account, and is told why in plain words. The
 * database refuses it too (shop_orders_open_has_parties keeps a buyer, seller
 * and shop on every 'awaiting_hold' / 'held' / 'accepted' order, so the SET
 * NULL cascade fails): without this check the member got a raw error.
 *
 * The statuses findActiveWork blocks on are read against the constraint
 * itself, so the two cannot drift apart.
 *
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (!shopOrder.ok \|\| shopOrder.active) return shopOrder; |   void shopOrder;
 * @mutate supabase/functions/_shared/accountPurge.ts | export const SHOP_ORDER_OPEN_STATUSES = ["awaiting_hold", "held", "accepted"]; | export const SHOP_ORDER_OPEN_STATUSES = ["held", "accepted"];
 * @mutate supabase/functions/_shared/accountPurge.ts |     return { ok: false, active: false, detail: rows.error.message };\n  }\n  if (rows.data && rows.data.length > 0) {\n    return { ok: true, active: true, detail: `shop order | return { ok: true, active: false };\n  }\n  if (rows.data && rows.data.length > 0) {\n    return { ok: true, active: true, detail: `shop order
 * @mutate supabase/functions/delete-own-account/index.ts |             : active.reason === "shops"\n            ? SHOPS_BLOCKS_DELETION_MESSAGE\n | \n
 *
 * An unpaid payment page ('awaiting_hold', nothing held) is closed first, as
 * the 2-hour sweep would, so a page neither side can see never blocks the
 * deletion (lh-authz-rls review of 6720f02e6, finding 1).
 * @mutate supabase/functions/_shared/accountPurge.ts |     .eq("status", "awaiting_hold")\n    .select("id"); |     .select("id");
 * @mutate supabase/functions/_shared/accountPurge.ts |     console.error(`[accountPurge] closing unpaid Shops pages failed for ${userId}:`, res.error.message);\n    return { ok: false, | console.error("x");\n    return { ok: true,
 * @mutate supabase/functions/delete-own-account/index.ts |     const pages = await closeUnpaidShopPages(supabaseAdmin, user.id);\n    if (!pages.ok) { |     const pages = { ok: true };\n    if (!pages.ok) {
 * @mutate supabase/functions/admin-delete-user/index.ts |     const pages = await closeUnpaidShopPages(supabaseAdmin, userId);\n    if (!pages.ok) { |     const pages = { ok: true };\n    if (!pages.ok) {
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const PURGE = new URL("../../supabase/functions/_shared/accountPurge.ts", import.meta.url).pathname;
type ActiveWork = { ok: boolean; active: boolean; reason?: string; detail?: string };
const { findActiveWork, SHOP_ORDER_OPEN_STATUSES, closeUnpaidShopPages } = (await import(/* @vite-ignore */ PURGE)) as {
  findActiveWork: (admin: unknown, userId: string) => Promise<ActiveWork>;
  SHOP_ORDER_OPEN_STATUSES: string[];
  closeUnpaidShopPages: (admin: unknown, userId: string) => Promise<{ ok: boolean }>;
};

type Row = Record<string, unknown>;
type Tables = Record<string, Row[] | { error: { code: string; message: string } }>;

/** Minimal PostgREST stand-in: `or("a.eq.X,b.eq.X")` is honoured on shop_orders, every jobs read matches nothing. */
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
          if (table !== "shop_orders") return preds.push(() => false), q;
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
const order = (status: string): Row => ({ id: "o1", buyer_id: BUYER, seller_id: SELLER, status });
const ALL = ["awaiting_hold", "held", "accepted", "declined", "expired", "cancelled", "superseded", "handed_over", "refunded"];

describe("a Shops order in progress blocks deleting either party's account", () => {
  it("the open statuses are exactly the ones the database keeps both parties on", () => {
    // The NEWEST migration that declares the constraint (a later one may restate it).
    const dir = join(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const re = /CONSTRAINT shop_orders_open_has_parties CHECK \(\s*status NOT IN \(([^)]*)\)/;
    let m: RegExpExecArray | null = null;
    for (const f of files) {
      const raw = readFileSync(join(dir, f), "utf8");
      if (raw.includes("shop_orders_open_has_parties")) m = re.exec(blankSqlComments(raw)) ?? m;
    }
    expect(m, "shop_orders_open_has_parties not found").not.toBeNull();
    const db = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(db.length).toBeGreaterThan(2);
    expect([...SHOP_ORDER_OPEN_STATUSES].sort()).toEqual(db);
  });

  it("an open order blocks the buyer AND the shop, with the Shops reason", async () => {
    for (const status of SHOP_ORDER_OPEN_STATUSES) {
      for (const who of [BUYER, SELLER]) {
        const r = await findActiveWork(fakeAdmin({ shop_orders: [order(status)] }), who);
        expect(r, `${status} ${who}`).toMatchObject({ ok: true, active: true, reason: "shops" });
      }
    }
  });

  it("a closed order does not block, and nor does someone else's", async () => {
    for (const status of ALL.filter((s) => !SHOP_ORDER_OPEN_STATUSES.includes(s))) {
      const r = await findActiveWork(fakeAdmin({ shop_orders: [order(status)] }), BUYER);
      expect(r, status).toMatchObject({ ok: true, active: false });
    }
    const other = await findActiveWork(fakeAdmin({ shop_orders: [order("held")] }), "33333333-3333-4333-8333-333333333333");
    expect(other).toMatchObject({ ok: true, active: false });
  });

  it("before the table exists nothing blocks; any other read error fails closed", async () => {
    const absent = await findActiveWork(fakeAdmin({ shop_orders: { error: { code: "42P01", message: 'relation "shop_orders" does not exist' } } }), BUYER);
    expect(absent).toMatchObject({ ok: true, active: false });
    const down = await findActiveWork(fakeAdmin({ shop_orders: { error: { code: "08006", message: "connection reset" } } }), BUYER);
    expect(down.ok).toBe(false);
  });

  it("the member and the admin are told it is a Shops order, in plain words", () => {
    const own = blankComments(readFileSync(join(process.cwd(), "supabase/functions/delete-own-account/index.ts"), "utf8"));
    expect(own).toMatch(/active\.reason === "shops"\s*\?\s*SHOPS_BLOCKS_DELETION_MESSAGE/);
    const admin = blankComments(readFileSync(join(process.cwd(), "supabase/functions/admin-delete-user/index.ts"), "utf8"));
    expect(admin).toMatch(/active\.reason === "shops"\s*\?\s*"This user has a Shops order in progress/);
  });
});

/** Records one update: its values, and the rows its filters select from `rows`. */
function updatingAdmin(rows: Row[] | { error: { code: string; message: string } }) {
  const seen: { table?: string; values?: Row; matched: Row[] } = { matched: [] };
  return {
    seen,
    from(table: string) {
      seen.table = table;
      const preds: Array<(r: Row) => boolean> = [];
      const q = {
        update: (v: Row) => ((seen.values = v), q),
        eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
        or: (expr: string) => {
          const terms = expr.split(",").map((t) => t.split(".eq."));
          preds.push((r) => terms.some(([c, v]) => r[c] === v));
          return q;
        },
        select: () => {
          if (!Array.isArray(rows)) return Promise.resolve({ data: null, error: rows.error });
          seen.matched = rows.filter((r) => preds.every((p) => p(r)));
          return Promise.resolve({ data: seen.matched.map((r) => ({ id: r.id })), error: null });
        },
      };
      return q;
    },
  };
}

describe("an unpaid payment page never blocks a deletion", () => {
  it("closes only the member's own unpaid pages, as the sweep does", async () => {
    const rows = [
      { id: "p1", buyer_id: BUYER, seller_id: SELLER, status: "awaiting_hold" },
      { id: "p2", buyer_id: "33333333-3333-4333-8333-333333333333", seller_id: SELLER, status: "awaiting_hold" },
      { id: "h1", buyer_id: BUYER, seller_id: SELLER, status: "held" },
    ];
    const admin = updatingAdmin(rows);
    expect(await closeUnpaidShopPages(admin, BUYER)).toEqual({ ok: true });
    expect(admin.seen.table).toBe("shop_orders");
    expect(admin.seen.values).toMatchObject({ status: "expired", close_reason: "page_unpaid" });
    expect(admin.seen.matched.map((r) => r.id)).toEqual(["p1"]);
    const asShop = updatingAdmin(rows);
    await closeUnpaidShopPages(asShop, SELLER);
    expect(asShop.seen.matched.map((r) => r.id)).toEqual(["p1", "p2"]);
  });

  it("before the table exists there is nothing to close; any other error fails closed", async () => {
    expect((await closeUnpaidShopPages(updatingAdmin({ error: { code: "42P01", message: 'relation "shop_orders" does not exist' } }), BUYER)).ok).toBe(true);
    expect((await closeUnpaidShopPages(updatingAdmin({ error: { code: "08006", message: "connection reset" } }), BUYER)).ok).toBe(false);
  });

  it("both deletion paths close the pages BEFORE the check, and stop on a failure", () => {
    for (const [file, uid] of [["supabase/functions/delete-own-account/index.ts", "user.id"], ["supabase/functions/admin-delete-user/index.ts", "userId"]]) {
      const src = blankComments(readFileSync(join(process.cwd(), file), "utf8"));
      const close = src.indexOf(`await closeUnpaidShopPages(supabaseAdmin, ${uid})`);
      const check = src.indexOf(`await findActiveWork(supabaseAdmin, ${uid})`);
      expect(close, file).toBeGreaterThan(0);
      expect(close, file).toBeLessThan(check);
      expect(src.slice(close, check), file).toMatch(/if \(!pages\.ok\) \{\s*return new Response/);
    }
  });
});
