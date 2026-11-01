// @mutate supabase/migrations/20261101235806_declutter_manager_photos_stay.sql |     AND NOT public.declutter_photo_object_attached(objects.name) |     AND NOT EXISTS (SELECT 1 FROM public.declutter_item_photos p WHERE p.storage_path = objects.name)
// @mutate supabase/migrations/20261101235806_declutter_manager_photos_stay.sql | STABLE\nSECURITY DEFINER | STABLE\nSECURITY INVOKER
// @mutate src/lib/declutter/api.ts |   return supabase.storage.from(DECLUTTER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl; |   return supabase.storage.from(DECLUTTER_PHOTO_BUCKET).getPublicUrl(path.replace(/^[^/]+/, "seller")).data.publicUrl;
//
// Declutter manager mode, lead condition 1 (phase 1 verdict, 11-01): a photo the manager uploaded (to their OWN folder)
// stays on the seller's listing for buyers, and the manager cannot delete it, during or after the grant. Reads the
// NEWEST storage DELETE policy for Declutter photos: its attached check runs without the caller's RLS (a manager cannot
// read the seller's photo rows, so a check under RLS saw every upload as unattached). Buyers see a listing photo by
// its public URL from whatever folder it is in (job-photos is a public bucket, read on prod 11-01), so nothing has to
// move when the grant ends. Behaviour: src/test/pglite/declutterManagerPhotosStay.pglite.mjs (7 checks; NEW_MIGRATION=skip
// and PLANT=rls go red on P1).
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort();
const DEFS = effectiveDefs(MIG);

function newestPolicy(name: string): string {
  let last = "";
  for (const f of FILES) {
    const sql = blankSqlComments(readFileSync(resolve(MIG, f), "utf8")).replace(/\s+/g, " ");
    for (const m of sql.matchAll(new RegExp(`CREATE POLICY "${name}" ON storage\\.objects[^;]*;`, "g"))) last = m[0];
  }
  return last;
}

describe("Declutter manager mode: a manager's photos stay on the listing", () => {
  it("reads the real migrations", () => {
    expect(FILES.length).toBeGreaterThan(500);
    expect(newestPolicy("Sellers delete own unattached declutter photos").length).toBeGreaterThan(100);
  });

  it("the delete policy's attached check reads every photo row, not only the caller's", () => {
    const p = newestPolicy("Sellers delete own unattached declutter photos");
    expect(p).toContain("FOR DELETE TO authenticated");
    expect(p).toContain("AND NOT public.declutter_photo_object_attached(objects.name)");
    expect(p).not.toContain("NOT EXISTS (SELECT 1 FROM public.declutter_item_photos");
    const fn = blankSqlComments(DEFS.get("declutter_photo_object_attached")?.stmt ?? "").replace(/\s+/g, " ");
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("SELECT EXISTS (SELECT 1 FROM public.declutter_item_photos p WHERE p.storage_path = p_name)");
  });

  it("a listing photo is shown by its public URL, whatever folder it is in", () => {
    const api = readFileSync(resolve(__dirname, "../lib/declutter/api.ts"), "utf8");
    expect(api).toContain('export const DECLUTTER_PHOTO_BUCKET = "job-photos";');
    expect(api).toContain("return supabase.storage.from(DECLUTTER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;");
  });
});
