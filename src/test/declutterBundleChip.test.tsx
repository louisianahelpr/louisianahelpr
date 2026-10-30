/**
 * D-NEW12 (lead 2026-10-30 05:00Z): one small "Bundle deal" chip on Browse cards whose seller has a bundle discount on
 * (Q2427 "Buy 2+, get N% off"); one chip only, the shared Badge, no second photo tag.
 *
 * Server: 20261030135334_declutter_bundle_sellers, one read for a page of sellers. Behaviour:
 * src/test/pglite/declutterBundleSellers.pglite.mjs (13 PASS applied 3x; NEW_MIGRATION=skip 13 FAIL; a planted
 * "every seller" body 4 FAIL).
 *
 * @mutate supabase/migrations/20261030135334_declutter_bundle_sellers.sql |      WHERE r.seller_id = ANY (p_seller_ids) |      WHERE true
 * @mutate supabase/migrations/20261030135334_declutter_bundle_sellers.sql |   IF cardinality(p_seller_ids) > 200 THEN |   IF cardinality(p_seller_ids) > 2000 THEN
 * @mutate supabase/migrations/20261030135334_declutter_bundle_sellers.sql | REVOKE ALL ON FUNCTION public.declutter_bundle_sellers(uuid[]) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_bundle_sellers(uuid[]) FROM PUBLIC;
 * @mutate supabase/migrations/20261030135334_declutter_bundle_sellers.sql |   PERFORM public.require_feature('declutter'); |
 * @mutate src/components/declutter/DeclutterItemCard.tsx |       {bundle && <Badge | {false && <Badge
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |                   bundle={bundles.data?.has(item.seller_id) ?? false} |                   bundle={false}
 * @mutate src/lib/declutter/bundle.ts |   if (res.error && isMissingRpcNamed(res.error, "declutter_bundle_sellers")) return new Set(); |
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } } }));

import { ItemCard } from "@/components/declutter/DeclutterItemCard";
import { fetchBundleSellers } from "@/lib/declutter/bundle";
import type { DeclutterItem } from "@/lib/declutter/api";

const ITEM = {
  id: "i1", seller_id: "s1", title: "Oak chair", category: "furniture", price_cents: 4000, current_price_cents: 4000,
  area_label: "Mid City", porch_ok: false, delivery_size: "small",
} as unknown as DeclutterItem;
const card = (bundle?: boolean, tag?: "drop" | "delivery" | null) =>
  render(<MemoryRouter><ItemCard item={ITEM} miles={null} approximate={false} bundle={bundle} tag={tag} /></MemoryRouter>);
const sql = () => blankSqlComments(readFileSync("supabase/migrations/20261030135334_declutter_bundle_sellers.sql", "utf8")).replace(/\s+/g, " ");

describe("D-NEW12: the Bundle deal chip", () => {
  beforeEach(() => rpc.mockReset());

  it("a card whose seller has a bundle discount wears one 'Bundle deal' chip; others wear none", () => {
    const { container, unmount } = card(true);
    expect(screen.getAllByText("Bundle deal")).toHaveLength(1);
    expect(container.querySelectorAll("[data-card-bundle]")).toHaveLength(1);
    unmount();
    const plain = card(false);
    expect(screen.queryByText("Bundle deal")).toBeNull();
    plain.unmount();
    card(undefined);
    expect(screen.queryByText("Bundle deal")).toBeNull();
  });

  it("it never takes the photo's one tag: a drop tag and the chip sit apart, the chip under the text", () => {
    const { container } = card(true, "drop");
    expect(container.querySelectorAll("[data-card-tag]")).toHaveLength(1);
    const chip = container.querySelector("[data-card-bundle]")!;
    expect(chip.closest("[data-card-tag]")).toBeNull();
    expect(container.querySelector("[data-card-title]")!.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Browse asks once for the page's sellers and hands each card its seller's answer", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    expect(src).toContain("queryFn: () => fetchBundleSellers(sellerIds)");
    expect(src).toContain("bundle={bundles.data?.has(item.seller_id) ?? false}");
    expect(src).toMatch(/const sellerIds = useMemo\(\(\) => \[\.\.\.new Set\(others\.map\(\(i\) => i\.seller_id\)\)\]\.sort\(\), \[others\]\);/);
  });

  it("the read: one call, at most 200 sellers; no chip (an empty set) before the function is deployed", async () => {
    rpc.mockResolvedValueOnce({ data: ["s1"], error: null });
    expect([...(await fetchBundleSellers(["s1", "s2"]))]).toEqual(["s1"]);
    expect(rpc).toHaveBeenCalledWith("declutter_bundle_sellers", { p_seller_ids: ["s1", "s2"] });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_bundle_sellers(p_seller_ids) in the schema cache" } });
    expect((await fetchBundleSellers(["s1"])).size).toBe(0);
    rpc.mockClear();
    const many = Array.from({ length: 250 }, (_, i) => `s${i}`);
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await fetchBundleSellers(many);
    expect((rpc.mock.calls[0][1] as { p_seller_ids: string[] }).p_seller_ids).toHaveLength(200);
    expect((await fetchBundleSellers([])).size).toBe(0);
  });

  it("the server: members only, Declutter on, at most 200, only the sellers asked about that have a rule", () => {
    const s = sql();
    expect(s).toContain("IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';");
    expect(s).toContain("PERFORM public.require_feature('declutter');");
    expect(s).toContain("IF cardinality(p_seller_ids) > 200 THEN RAISE EXCEPTION 'invalid_request'");
    expect(s).toContain("SELECT array_agg(DISTINCT r.seller_id ORDER BY r.seller_id) FROM public.declutter_bundle_rules r WHERE r.seller_id = ANY (p_seller_ids)");
    expect(s).toContain("SECURITY DEFINER SET search_path TO 'public', 'pg_temp'");
    expect(s).toContain("REVOKE ALL ON FUNCTION public.declutter_bundle_sellers(uuid[]) FROM PUBLIC, anon;");
    expect(s).toContain("GRANT EXECUTE ON FUNCTION public.declutter_bundle_sellers(uuid[]) TO authenticated, service_role;");
  });
});
