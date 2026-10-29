/**
 * Declutter audit 1a #10 (prod 2026-10-29): a handover photo the RPC refused stayed in the private
 * declutter-handover bucket for good (no policy let its uploader delete it; each retry left another photo of the
 * seller's porch). Now the uploader may delete their own handover-folder object while nothing references it, and
 * the app removes the file when the RPC refuses it.
 *
 * CLASS: built from the migrations' own inventory, every column a handover photo RPC saves a declutter-handover path
 * into (`SET <col> = p_photo_path` in the EFFECTIVE definition of a function that checks a 'declutter-handover'
 * object) must be in declutter_handover_photo_unattached's NOT EXISTS, so an attached photo can never be deleted.
 * A new column that holds handover photos and is missing from the check turns this red.
 * Backend proof: src/test/pglite/declutterHandoverPhotoCleanup.pglite.mjs (3x; RED without the migration).
 *
 * @mutate supabase/migrations/20261029222816_declutter_handover_photo_cleanup.sql |                      WHERE h.set_out_photo_path = p_name OR h.picked_up_photo_path = p_name), |                      WHERE h.set_out_photo_path = p_name),
 * @mutate supabase/migrations/20261029222816_declutter_handover_photo_cleanup.sql |     AND split_part(p_name, '/', 1) = (SELECT auth.uid())::text\n | \n
 * @mutate supabase/migrations/20261029222816_declutter_handover_photo_cleanup.sql |     AND (storage.foldername(name))[3] = 'handover'\n | \n
 * @mutate src/lib/declutter/handover.ts |   if (res.error) await discardRefusedHandoverPhoto(photoPath);\n  return rpcData(res, (e) => rpcErrorMessage("declutter_porch_photo", e)) | return rpcData(res, (e) => rpcErrorMessage("declutter_porch_photo", e))
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIGRATIONS);
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const POLICY = "declutter-handover: the uploader deletes an unattached handover photo";

/** Every column a handover photo RPC writes p_photo_path into. */
function savedColumns(): Set<string> {
  const cols = new Set<string>();
  for (const [, d] of DEFS) {
    const body = flat(d.stmt);
    if (!body.includes("'declutter-handover'")) continue;
    for (const m of body.matchAll(/\b([a-z_]+_photo_path) = p_photo_path\b/g)) cols.add(m[1]);
  }
  return cols;
}

/** The newest CREATE POLICY with this name, from the migrations in order. */
function newestPolicy(): string {
  let last = "";
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = flat(readFileSync(resolve(MIGRATIONS, f), "utf8"));
    const at = sql.lastIndexOf(`CREATE POLICY "${POLICY}"`);
    if (at >= 0) last = sql.slice(at, sql.indexOf(";", at));
  }
  return last;
}

describe("audit 1a #10: a refused handover photo can be removed, an attached one never", () => {
  const cols = savedColumns();
  const helper = flat(DEFS.get("declutter_handover_photo_unattached")?.stmt ?? "");

  it("reads the handover photo columns (floor)", () => {
    expect(cols.size).toBeGreaterThan(1);
  });

  it("every column a handover photo is saved in is in the not-referenced check", () => {
    const missing = [...cols].filter((c) => !new RegExp(`\\bh\\.${c} = p_name\\b`).test(helper));
    expect(missing).toEqual([]);
  });

  it("the helper answers only for the caller's own handover folder, and is SECURITY DEFINER", () => {
    expect(helper).toContain("SECURITY DEFINER");
    expect(helper).toContain("AND split_part(p_name, '/', 1) = (SELECT auth.uid())::text");
    expect(helper).toContain("AND split_part(p_name, '/', 3) = 'handover'");
  });

  it("the delete policy: authenticated, the handover bucket, own folder, the handover folder, unattached", () => {
    const p = newestPolicy();
    expect(p).toContain("FOR DELETE TO authenticated");
    expect(p).toContain("bucket_id = 'declutter-handover'");
    expect(p).toContain("(storage.foldername(name))[1] = (SELECT auth.uid())::text");
    expect(p).toContain("(storage.foldername(name))[3] = 'handover'");
    expect(p).toContain("public.declutter_handover_photo_unattached(name)");
  });

  it("the app removes the file when a handover photo RPC refuses it", () => {
    const handover = src("src/lib/declutter/handover.ts");
    expect(handover).toMatch(/if \(res\.error\) await discardRefusedHandoverPhoto\(photoPath\);\s*return rpcData\(res, \(e\) => rpcErrorMessage\("declutter_porch_photo", e\)\)/);
    expect(handover).toMatch(/if \(res\.error\) await discardRefusedHandoverPhoto\(photoPath\);\s*return rpcData\(res, \(e\) => rpcErrorMessage\("declutter_seller_picked_up", e\)\)/);
    expect(src("src/lib/declutter/sellerDelivery.ts")).toMatch(/if \(res\.error\) await discardRefusedHandoverPhoto\(photoPath\);\s*data\(res, \(e\) => rpcErrorMessage\("declutter_seller_delivered", e\)\)/);
  });
});
