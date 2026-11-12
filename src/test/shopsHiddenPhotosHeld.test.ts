/**
 * Q1957 (lh-authz-rls review of shops slice 1; lead decision 11-12): a hidden shop's, or a banned owner's, photos stop
 * serving at their public URL: they move to the PRIVATE shop-photos-held bucket at the same path and back when the
 * shop is shown again. Reads the EFFECTIVE definitions, the declutter-money step and the purge list; behaviour on a
 * real database is src/test/pglite/shopsHiddenPhotosHeld.pglite.mjs (3x; skip red; 7 planted defects each RED).
 *
 * @mutate supabase/migrations/20261112100000_shops_hidden_photos_held.sql |     SELECT s.hidden_at IS NOT NULL OR NOT COALESCE(public.shop_owner_in_good_standing(s.owner_id), false) |     SELECT s.hidden_at IS NOT NULL
 * @mutate supabase/migrations/20261112100000_shops_hidden_photos_held.sql |     UNION ALL\n    SELECT i.shop_id, ip.storage_path FROM public.shop_item_photos ip JOIN public.shop_items i ON i.id = ip.item_id\n |
 * @mutate supabase/migrations/20261112100000_shops_hidden_photos_held.sql |      AND o.bucket_id <> w.to_bucket\n |
 * @mutate supabase/functions/_shared/shopPhotoHolds.ts | .move(row.storage_path, row.storage_path, { destinationBucket: row.to_bucket }) | .move(row.storage_path, row.storage_path)
 * @mutate supabase/functions/_shared/shopPhotoHolds.ts |       if (!stray.error) res = await move();\n |
 * @mutate supabase/functions/declutter-money/index.ts |     const holds = await moveShopPhotoHolds(admin);\n |     const holds = { moved: 0, failures: [] as string[] };\n
 * @mutate supabase/functions/_shared/purgeBuckets.ts |   { bucket: "shop-photos-held", folder: "shops" },\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { IDENTITY_SUBFOLDERS } from "../../supabase/functions/_shared/purgeBuckets";

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8")).replace(/\s+/g, " ");

describe("Q1957: a hidden or banned shop's photos leave the public bucket", () => {
  it("held = hidden, or the owner not in good standing (banned, a temp ban still running, 3 strikes)", () => {
    expect(flat("shop_photos_held")).toContain(
      "SELECT s.hidden_at IS NOT NULL OR NOT COALESCE(public.shop_owner_in_good_standing(s.owner_id), false) FROM public.shops s WHERE s.id = p_shop_id",
    );
  });

  it("the list is every shop and item photo object in the wrong bucket right now, server-only", () => {
    const body = flat("shop_photos_to_move");
    expect(body).toContain("SELECT p.shop_id, p.storage_path FROM public.shop_photos p UNION ALL SELECT i.shop_id, ip.storage_path FROM public.shop_item_photos ip JOIN public.shop_items i ON i.id = ip.item_id");
    expect(body).toContain("CASE WHEN public.shop_photos_held(x.shop_id) THEN 'shop-photos-held' ELSE 'job-photos' END AS to_bucket");
    expect(body).toContain("AND o.bucket_id IN ('job-photos', 'shop-photos-held') AND o.bucket_id <> w.to_bucket");
    const file = blankSqlComments(readFileSync(resolve(MIG, DEFS.get("shop_photos_to_move")?.file ?? ""), "utf8")).replace(/\s+/g, " ");
    expect(file).toContain("VALUES ('shop-photos-held', 'shop-photos-held', false,");
    expect(file).not.toMatch(/CREATE POLICY[^;]*shop-photos-held/);
    for (const sig of ["shop_photos_to_move(integer)", "shop_photos_held(uuid)"]) {
      expect(file, sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(file, sig).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
  });

  it("the money cron moves them, across buckets, in its own try", () => {
    const helper = src("supabase/functions/_shared/shopPhotoHolds.ts");
    expect(helper).toContain('admin.rpc("shop_photos_to_move", { p_limit: limit })');
    expect(helper).toContain(".move(row.storage_path, row.storage_path, { destinationBucket: row.to_bucket })");
    // A stray copy at the destination (uploaded at a held path, never byte-checked) is removed, then the move retried.
    expect(helper).toMatch(/const stray = await admin\.storage\.from\(row\.to_bucket\)\.remove\(\[row\.storage_path\]\); if \(!stray\.error\) res = await move\(\);/);
    const cron = src("supabase/functions/declutter-money/index.ts");
    expect(cron).toMatch(/try \{ const holds = await moveShopPhotoHolds\(admin\); out\.shop_photos_moved = holds\.moved;/);
  });

  it("held photos still go with the account", () => {
    const held = IDENTITY_SUBFOLDERS.filter((s) => s.bucket === "shop-photos-held").map((s) => s.folder).sort();
    expect(held).toEqual(["shop-items", "shops"]);
  });
});
