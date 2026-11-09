/**
 * Owner request 11-05: "add a way for me to see how many people saw each item." Guard for the whole path:
 *
 *  - server (newest definitions across supabase/migrations, any dollar tag): the record RPC never counts the seller,
 *    an admin, a test account or a test listing, counts once per person, and the count RPC answers only the caller's
 *    own items; no migration grants the table itself to anon or authenticated.
 *  - client: the item page reports a view only after the page settled, once per item per session; a guest sends a
 *    kept device id, a member none.
 *  - display: the "N views" line on the item page is behind isSeller (buyers never see it), and the item page never
 *    reports the seller's own listing.
 * Behaviour on real Postgres: src/test/pglite/declutterItemViews.pglite.mjs (14 PASS; FAILs with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261105163501_declutter_item_views.sql | IF v_uid = v_seller | IF false
 * @mutate supabase/migrations/20261105163501_declutter_item_views.sql | OR public.is_test_member(v_uid) THEN | THEN
 * @mutate supabase/migrations/20261105163501_declutter_item_views.sql | WHERE i.seller_id = (SELECT auth.uid()) | WHERE true
 * @mutate supabase/migrations/20261105163501_declutter_item_views.sql | interval '1 hour') >= 30 THEN | interval '1 hour') >= 30000 THEN
 * @mutate supabase/migrations/20261105163501_declutter_item_views.sql | PERFORM public.attach_unconfirmed_email_gate(); | NULL;
 * @mutate src/lib/declutter/itemViews.ts | sent.add(key); | void key;
 * @mutate src/lib/declutter/itemViews.ts | const device = signedIn ? null : viewerDeviceId(); | const device = signedIn ? null : crypto.randomUUID();
 * @mutate src/components/declutter/DeclutterItemView.tsx | {isSeller && <ItemViewsCount | {true && <ItemViewsCount
 * @mutate src/components/declutter/DeclutterItemView.tsx | const viewable = !!item.data && !ownListing && | const viewable = !!item.data &&
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "@/test/helpers/trackedFiles";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";

const rpc = vi.fn(async (_item: string, _device: string | null) => {});
vi.mock("@/lib/declutter/api", () => ({
  sendItemViewRpc: (item: string, device: string | null) => rpc(item, device),
  fetchMyItemViewCounts: async () => new Map(),
}));
// recordItemView also logs the funnel's item_view step (H3); stubbed so its RPC never leaves the test (CI's
// prodNetworkGuard caught it landing during a later test of this file).
vi.mock("@/lib/declutter/funnel", () => ({ trackFunnel: () => {} }));
const settled: Array<() => void> = [];
vi.mock("@/lib/routePrefetch", () => ({
  whenPageSettled: (cb: () => void) => { settled.push(cb); return () => {}; },
}));

const { recordItemView, resetSentItemViews, viewsLabel } = await import("./itemViews");

const DIR = "supabase/migrations";
const body = (name: string) => {
  const d = effectiveDefs(DIR).get(name);
  if (!d) throw new Error(`no definition of ${name}`);
  return blankSqlComments(d.stmt);
};

describe("item views: the server counts unique real people, and only the seller reads them (owner 11-05)", () => {
  it("the record RPC skips the seller, admins, test accounts and test listings, and dedupes", () => {
    const b = body("declutter_record_item_view");
    expect(b).toMatch(/IF\s+v_uid\s*=\s*v_seller/i);
    expect(b).toMatch(/has_role\s*\(\s*v_uid\s*,\s*'admin'/i);
    expect(b).toMatch(/OR\s+public\.is_test_member\s*\(\s*v_uid\s*\)\s+THEN/i);
    expect(b).toMatch(/i\.is_seed\s+IS\s+NOT\s+TRUE/i);
    expect(b).toMatch(/i\.status\s+IN\s*\(\s*'live'\s*,\s*'reserved'\s*\)/i);
    expect((b.match(/DO\s+NOTHING/gi) ?? []).length).toBe(2);
    // lh-authz-rls review: a guest's device id is the caller's choice, so new guest views are capped per item per hour.
    expect(b).toMatch(/device_id\s+IS\s+NOT\s+NULL\s+AND\s+v\.created_at\s*>\s*now\(\)\s*-\s*interval\s*'1 hour'\)\s*>=\s*30\s+THEN\s+RETURN/i);
  });

  it("the new table carries the unconfirmed-email gate (Q807)", () => {
    const sql = blankSqlComments(readFileSync(`${DIR}/20261105163501_declutter_item_views.sql`, "utf8"));
    expect(sql).toMatch(/PERFORM\s+public\.attach_unconfirmed_email_gate\(\)/);
  });

  it("the count RPC answers only the caller's own items and drops test viewers", () => {
    const b = body("declutter_my_item_view_counts");
    expect(b).toMatch(/WHERE\s+i\.seller_id\s*=\s*\(SELECT\s+auth\.uid\(\)\)/i);
    expect(b).toMatch(/is_test_member\s*\(\s*v\.viewer_id\s*\)/i);
  });

  it("no migration grants the views table to anon or authenticated", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
    const touching = files.filter((f) => /declutter_item_views/.test(readFileSync(`${DIR}/${f}`, "utf8")));
    expect(touching.length).toBeGreaterThan(0);
    for (const f of touching) {
      const sql = blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"));
      expect(sql, f).not.toMatch(/GRANT[^;]*ON\s+(TABLE\s+)?public\.declutter_item_views\s+TO[^;]*\b(anon|authenticated)\b/i);
      expect(sql, f).not.toMatch(/CREATE\s+POLICY[^;]*ON\s+public\.declutter_item_views/i);
    }
  });
});

describe("item views: the item page reports a view once, after the page settled", () => {
  beforeEach(() => {
    rpc.mockClear();
    settled.length = 0;
    resetSentItemViews();
    window.localStorage.clear();
  });

  it("sends nothing until the page settles, then once per item however often it opens", async () => {
    recordItemView("item-1", true);
    expect(rpc).not.toHaveBeenCalled();
    settled.splice(0).forEach((cb) => cb());
    recordItemView("item-1", true);
    settled.splice(0).forEach((cb) => cb());
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("item-1", null);
  });

  it("a guest sends the same kept device id on every item; a member sends none", async () => {
    recordItemView("item-a", false);
    recordItemView("item-b", false);
    settled.splice(0).forEach((cb) => cb());
    await Promise.resolve();
    const ids = rpc.mock.calls.map((c) => c[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toBe(ids[0]);
  });

  it("says people, singular and plural", () => {
    expect(viewsLabel(0)).toBe("0 views");
    expect(viewsLabel(1)).toBe("1 view");
    expect(viewsLabel(12)).toBe("12 views");
  });
});

describe("item views: buyers never see the count, and the seller's own visit is never reported", () => {
  const src = blankComments(readFileSync("src/components/declutter/DeclutterItemView.tsx", "utf8"));
  it("the item page's count line is behind isSeller", () => {
    const uses = [...src.matchAll(/(\S+)\s*&&\s*<ItemViewsCount\b/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((u) => u === "{isSeller")).toBe(true);
  });
  it("the page reports only a listing that is not the viewer's own", () => {
    expect(src).toMatch(/const viewable = !!item\.data && !ownListing &&/);
    expect(src).toMatch(/viewable \? recordItemView\(/);
  });
});
