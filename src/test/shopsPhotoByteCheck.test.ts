/**
 * Q1956 (NOT-LAUNCHED; lh-authz-rls review of shops slice 1): a shop photo's type is decided from its own bytes, never
 * from the content type the uploader sent. Reads the EFFECTIVE (newest) definitions of the two attach RPCs, the
 * shop-photo-check edge function and both clients; behaviour on a real database is
 * src/test/pglite/shopsPhotoByteCheck.pglite.mjs (3x; skip red; 7 planted defects each RED).
 *
 * @mutate supabase/migrations/20261112095000_shops_photo_byte_check.sql |          AND so.name = p_storage_path) THEN\n    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';\n  END IF;\n  -- The stamp is used once.\n  DELETE FROM public.shop_photo_byte_checks WHERE storage_path = p_storage_path;\n\n  IF p_kind = 'gallery' THEN |          AND so.name IS NOT NULL) THEN\n    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';\n  END IF;\n  -- The stamp is used once.\n  DELETE FROM public.shop_photo_byte_checks WHERE storage_path = p_storage_path;\n\n  IF p_kind = 'gallery' THEN
 * @mutate supabase/migrations/20261112095000_shops_photo_byte_check.sql |         WHERE o.id = p_object_id AND o.bucket_id = 'job-photos' AND o.name = p_path |         WHERE o.bucket_id = 'job-photos' AND o.name = p_path
 * @mutate supabase/migrations/20261112095000_shops_photo_byte_check.sql | REVOKE ALL ON TABLE public.shop_photo_byte_checks FROM PUBLIC, anon, authenticated; | REVOKE ALL ON TABLE public.shop_photo_byte_checks FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261112095000_shops_photo_byte_check.sql |   IF public.shop_photos_held(v_shop) THEN\n |   IF false THEN\n
 * @mutate supabase/migrations/20261112095000_shops_photo_byte_check.sql |   IF public.shop_photos_held(v_item.shop_id) THEN\n |   IF false THEN\n
 * @mutate supabase/functions/_shared/digitalFileCheck.ts |   if (bytesMatchExt("jpg", head)) return "jpg"; |   if (head.length > 0) return "jpg";
 * @mutate supabase/functions/shop-photo-check/index.ts |     if (!imageKindFromBytes(head)) { |     if (!head) {
 * @mutate supabase/functions/shop-photo-check/index.ts |   return !!owner && owner === userId; |   return !!owner;
 * @mutate supabase/functions/shop-photo-check/index.ts |     if (stamp.data !== true) return json({ error: "photo_not_uploaded" }, 400);\n |
 * @mutate src/lib/shops/api.ts |   await checkShopPhotoBytes(SHOP_PHOTO_BUCKET, path);\n |
 * @mutate src/lib/shops/items.ts |   await checkShopPhotoBytes(ITEM_PHOTO_BUCKET, path);\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { imageKindFromBytes } from "../../supabase/functions/_shared/digitalFileCheck";

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8")).replace(/\s+/g, " ");
const RPCS = ["shops_attach_photo", "shops_add_item_photo"];

describe("Q1956: a shop photo is an image by its own bytes", () => {
  it("both attach RPCs require a fresh bytes stamp for this caller and use it up", () => {
    for (const fn of RPCS) {
      const body = flat(fn);
      expect(body.length, fn).toBeGreaterThan(400);
      // The stamp is for the object NOW at the path (its id), never the path alone: a delete and re-upload of other
      // bytes at the same path is a new object (authz review FAIL #1).
      expect(body, fn).toMatch(/OR NOT EXISTS \( SELECT 1 FROM public\.shop_photo_byte_checks c JOIN storage\.objects so ON so\.id = c\.object_id WHERE c\.storage_path = p_storage_path AND c\.owner_id = v_uid AND c\.checked_at > now\(\) - interval '1 hour' AND so\.bucket_id = 'job-photos' AND so\.name = p_storage_path\) THEN RAISE EXCEPTION 'photo_not_uploaded'/);
      expect(body, fn).toContain("DELETE FROM public.shop_photo_byte_checks WHERE storage_path = p_storage_path;");
      // Q1957 review: a held shop (its photos in the private held bucket) adds no new, public photo.
      expect(body, fn).toMatch(/IF public\.shop_photos_held\((v_shop|v_item\.shop_id)\) THEN RAISE EXCEPTION 'shop_hidden'/);
    }
  });

  it("members can neither read nor write the stamps", () => {
    const files = [...DEFS.values()].map((d) => d.file);
    const file = files.find((f) => readFileSync(resolve(MIG, f), "utf8").includes("CREATE TABLE IF NOT EXISTS public.shop_photo_byte_checks")) ?? "";
    expect(file).not.toBe("");
    const sql = blankSqlComments(readFileSync(resolve(MIG, file), "utf8")).replace(/\s+/g, " ");
    expect(sql).toContain("ALTER TABLE public.shop_photo_byte_checks ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.shop_photo_byte_checks FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/GRANT [A-Z, ]+ ON TABLE public\.shop_photo_byte_checks TO [a-z_, ]*\b(authenticated|anon)\b/);
    expect(sql).not.toMatch(/CREATE POLICY [^;]* ON public\.shop_photo_byte_checks/);
    // The stamp writer checks the very object id it was handed is still at the path; both helpers are server-only.
    expect(flat("shop_photo_stamp")).toContain("WHERE o.id = p_object_id AND o.bucket_id = 'job-photos' AND o.name = p_path AND (o.owner_id = p_owner::text OR o.owner = p_owner)) THEN RETURN false;");
    for (const sig of ["shop_photo_object_id(text, uuid)", "shop_photo_stamp(text, uuid, uuid)"]) {
      expect(sql, sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(sql, sig).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
  });

  it("the byte check: PNG, JPEG and WebP pass; a non-image body under an image name does not", () => {
    const b = (...xs: number[]) => new Uint8Array([...xs, ...new Array(16).fill(0)].slice(0, 16));
    expect(imageKindFromBytes(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(imageKindFromBytes(b(0xff, 0xd8, 0xff, 0xe0))).toBe("jpg");
    expect(imageKindFromBytes(b(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe("webp");
    expect(imageKindFromBytes(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(imageKindFromBytes(b(0x25, 0x50, 0x44, 0x46, 0x2d))).toBeNull(); // a PDF
    expect(imageKindFromBytes(b(0x4d, 0x5a))).toBeNull(); // a Windows program
    expect(imageKindFromBytes(b(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull(); // RIFF WAVE
    expect(imageKindFromBytes(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it("shop-photo-check reads the bytes as the caller's own folder only, deletes a refusal and stamps a match", () => {
    const fn = src("supabase/functions/shop-photo-check/index.ts");
    expect(fn).toContain("refuseUnconfirmedEmail(user, corsHeaders)");
    expect(fn).toContain('requireFeature(admin, "shops", user, corsHeaders)');
    expect(fn).toContain("if (!shopPhotoPathFor(path, user.id))");
    expect(fn).toContain("return !!owner && owner === userId;");
    expect(fn).toMatch(/if \(!imageKindFromBytes\(head\)\) \{ const gone = await admin\.storage\.from\(BUCKET\)\.remove\(\[path\]\);/);
    const lookup = fn.indexOf('admin.rpc("shop_photo_object_id", { p_path: path, p_owner: user.id })');
    expect(lookup).toBeGreaterThan(0);
    expect(lookup).toBeLessThan(fn.indexOf("const head = await readHead(admin, path);"));
    expect(fn).toContain('admin.rpc("shop_photo_stamp", { p_path: path, p_owner: user.id, p_object_id: objectId })');
    expect(fn).toContain('if (stamp.data !== true) return json({ error: "photo_not_uploaded" }, 400);');
  });

  it("both clients check the bytes between the upload and the attach", () => {
    for (const [file, bucket, rpc] of [["src/lib/shops/api.ts", "SHOP_PHOTO_BUCKET", "shops_attach_photo"], ["src/lib/shops/items.ts", "ITEM_PHOTO_BUCKET", "shops_add_item_photo"]]) {
      const s = src(file);
      const check = s.indexOf(`await checkShopPhotoBytes(${bucket}, path);`);
      expect(check, file).toBeGreaterThan(0);
      expect(check, file).toBeGreaterThan(s.indexOf('if (upErr) throw new Error("photo_not_uploaded");'));
      expect(check, file).toBeLessThan(s.indexOf(`supabase.rpc("${rpc}"`));
    }
    expect(src("src/lib/shops/photoByteCheck.ts")).toContain('supabase.functions.invoke("shop-photo-check", { body: { path } })');
  });
});
