/**
 * LEAD-OFFERS-CHOICE (owner 2026-10-31): sellers choose offers or Buy now only in more places.
 *   (1) Listing defaults keep "Accept offers" (declutter_seller_defaults.accepts_offers, 20261031201036), and until that
 *       column is on prod the rest of the defaults still read and save.
 *   (3) "Turn offers off / on for all my listings" calls the listing's own switch once for each listing that is up and
 *       not already set that way; a refusal is counted, the rest still change.
 *
 * @mutate src/lib/declutter/offersForAll.ts |  return items.filter((it) => (it.status === "live" \|\| it.status === "paused") && (it.accepts_offers !== false) !== on); |  return items.filter((it) => it.accepts_offers !== on);
 * @mutate src/lib/declutter/offersForAll.ts |        failed += 1; |        void err;
 * @mutate src/lib/declutter/sellerDefaults.ts |    acceptsOffers: r.accepts_offers !== false, |    acceptsOffers: true,
 * @mutate src/lib/declutter/sellerDefaults.ts |  let { error } = await upsert({ ...row, accepts_offers: d.acceptsOffers }); |  let { error } = await upsert(row);
 * @mutate src/lib/declutter/sellerDefaults.ts |  if (noOffersColumn(error)) ({ error } = await upsert(row)); |  void noOffersColumn;
 * @mutate src/lib/declutter/sellerDefaults.ts |  if (noOffersColumn(res.error)) res = | if (false) res =
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  selects: [] as string[],
  upserts: [] as Record<string, unknown>[],
  row: null as Record<string, unknown> | null,
  missingColumn: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  const colErr = { code: "42703", message: "column declutter_seller_defaults.accepts_offers does not exist" };
  const from = () => ({
    select: (cols: string) => {
      h.selects.push(cols);
      const err = h.missingColumn && cols.includes("accepts_offers") ? colErr : null;
      const q = { eq: () => q, maybeSingle: async () => ({ data: err ? null : h.row, error: err }) };
      return q;
    },
    upsert: (r: Record<string, unknown>) => ({
      select: async () => {
        h.upserts.push(r);
        return { data: null, error: h.missingColumn && "accepts_offers" in r ? { ...colErr, code: "PGRST204", message: "Could not find the 'accepts_offers' column" } : null };
      },
    }),
  });
  return { supabase: { from } };
});

import { fetchSellerDefaults, saveSellerDefaults, SELLER_DEFAULTS } from "@/lib/declutter/sellerDefaults";
import { listingsToSwitch, setOffersForAll } from "@/lib/declutter/offersForAll";
import type { DeclutterItem } from "@/lib/declutter/api";

const saved = { keep_up: true, drops: true, drop_pct: 5, floor_pct: 50, free_after_days: null, handovers: ["porch"] };

beforeEach(() => {
  h.selects = [];
  h.upserts = [];
  h.row = null;
  h.missingColumn = false;
});

describe("Listing defaults: Accept offers", () => {
  it("is on with nothing saved, reads a saved off, and saves the choice", async () => {
    expect(SELLER_DEFAULTS.acceptsOffers).toBe(true);
    h.row = { ...saved, accepts_offers: false };
    expect((await fetchSellerDefaults("u1"))?.acceptsOffers).toBe(false);
    h.row = { ...saved, accepts_offers: true };
    expect((await fetchSellerDefaults("u1"))?.acceptsOffers).toBe(true);
    expect(await saveSellerDefaults("u1", { ...SELLER_DEFAULTS, acceptsOffers: false })).toBe(true);
    expect(h.upserts[h.upserts.length - 1]).toMatchObject({ member_id: "u1", accepts_offers: false });
  });

  it("before the column is on prod the rest still reads (offers on) and saves", async () => {
    h.missingColumn = true;
    h.row = { ...saved, drop_pct: 10 };
    const d = await fetchSellerDefaults("u1");
    expect(d).toMatchObject({ dropPct: 10, acceptsOffers: true });
    expect(await saveSellerDefaults("u1", { ...SELLER_DEFAULTS, dropPct: 15, acceptsOffers: false })).toBe(true);
    expect(h.upserts[h.upserts.length - 1]).toMatchObject({ drop_pct: 15 });
    expect(h.upserts[h.upserts.length - 1]).not.toHaveProperty("accepts_offers");
  });
});

describe("Turn offers off / on for all my listings", () => {
  const items: { id: string; status: DeclutterItem["status"]; accepts_offers?: boolean }[] = [
    { id: "live-on", status: "live", accepts_offers: true },
    { id: "paused-on", status: "paused" },
    { id: "live-off", status: "live", accepts_offers: false },
    { id: "draft-on", status: "draft", accepts_offers: true },
    { id: "sold-on", status: "sold", accepts_offers: true },
    { id: "review-on", status: "pending_review", accepts_offers: true },
  ];

  it("changes only listings that are up and set the other way", () => {
    expect(listingsToSwitch(items, false).map((i) => i.id)).toEqual(["live-on", "paused-on"]);
    expect(listingsToSwitch(items, true).map((i) => i.id)).toEqual(["live-off"]);
    expect(listingsToSwitch(items, false).length).toBeGreaterThan(0);
  });

  it("calls each listing's own switch, and a refusal is counted while the rest still change", async () => {
    const set = vi.fn(async (id: string) => {
      if (id === "paused-on") throw new Error("item_not_editable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await setOffersForAll(items, false, set)).toEqual({ changed: 1, failed: 1 });
    expect(set.mock.calls).toEqual([["live-on", false, false], ["paused-on", false, false]]);
    expect(await setOffersForAll(items, true, vi.fn(async () => {}))).toEqual({ changed: 1, failed: 0 });
    warn.mockRestore();
  });
});
