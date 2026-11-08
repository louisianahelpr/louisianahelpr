/**
 * Shops digital downloads, slice 1 (owner 11-08): the files are private and only shop-digital signs links into them.
 * Behaviour on a real database is src/test/pglite/shopsDigitalDownloads.pglite.mjs (3x; NEW_MIGRATION=skip is RED,
 * and a planted "refunded still downloads" is RED). This guard pins the edge function's side: who the caller is comes
 * from the token, the download check is the database's, a link lives 10 minutes, and a file is checked from its own
 * bytes before it is ever marked usable; and the migration's side: the bucket is private and no storage policy names it.
 *
 * @mutate supabase/functions/shop-digital/index.ts | const DOWNLOAD_LINK_SECONDS = 600; | const DOWNLOAD_LINK_SECONDS = 604800;
 * @mutate supabase/functions/shop-digital/index.ts | { p_file_id: fileId, p_user: userId } | { p_file_id: fileId, p_user: String(body.user_id) }
 * @mutate supabase/functions/shop-digital/index.ts |   else refusal = await refusalFor(admin, row.storage_path, row.ext as DigitalExt, size); |   else refusal = null;
 * @mutate supabase/functions/shop-digital/index.ts |   const off = await requireFeature(admin, "shops", user, corsHeaders);\n  if (off) return off;\n |
 * @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql | VALUES ('shop-digital', 'shop-digital', false, 104857600, | VALUES ('shop-digital', 'shop-digital', true, 104857600,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const EDGE = blankComments(readFileSync(resolve(ROOT, "supabase/functions/shop-digital/index.ts"), "utf8"));
const SQL = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations/20261108182917_shops_digital_downloads.sql"), "utf8"));

describe("Shops digital downloads: private files, short links, checked bytes", () => {
  it("every action runs behind the Shops switch, after the token is read", () => {
    const auth = EDGE.indexOf("auth.getUser(");
    const feature = EDGE.indexOf('requireFeature(admin, "shops", user, corsHeaders)');
    const dispatch = EDGE.indexOf('body.action === "upload_url"');
    expect(auth).toBeGreaterThan(0);
    expect(feature).toBeGreaterThan(auth);
    expect(dispatch).toBeGreaterThan(feature);
  });

  it("the download check is the database's, with the caller from the token, and a link lives 10 minutes", () => {
    expect(EDGE).toMatch(/const DOWNLOAD_LINK_SECONDS = 600;/);
    expect(EDGE).toContain('admin.rpc("shop_digital_download_path", { p_file_id: fileId, p_user: userId })');
    expect(EDGE).toMatch(/return await download\(body, user\.id, admin\)/);
    expect(EDGE).not.toMatch(/body\.(user_id|owner_id|buyer_id)/);
    // A raw storage URL is never handed out: only a signed link.
    expect(EDGE).not.toMatch(/getPublicUrl/);
  });

  it("a file is marked checked only after its own bytes pass", () => {
    const check = EDGE.indexOf("refusal = await refusalFor(admin, row.storage_path, row.ext as DigitalExt, size)");
    const mark = EDGE.indexOf('admin.rpc("shop_digital_file_checked"');
    expect(check).toBeGreaterThan(0);
    expect(mark).toBeGreaterThan(check);
    expect(EDGE).toMatch(/bytesMatchExt\(ext, head\.subarray\(0, SNIFF_BYTES\)\)/);
    expect(EDGE).toMatch(/zipProgramEntry\(cd, dir\.entries\)/);
  });

  it("the bucket is private and no storage policy in the migration names it", () => {
    expect(SQL).toMatch(/VALUES \('shop-digital', 'shop-digital', false, 104857600,/);
    expect(SQL).toMatch(/ON CONFLICT \(id\) DO UPDATE SET\s+public = false/);
    expect(SQL).not.toMatch(/CREATE POLICY[^;]*ON storage\.objects/i);
    // The storage path column is never granted to members.
    const grant = /GRANT SELECT \(([^)]*)\)\s+ON TABLE public\.shop_item_files TO authenticated/.exec(SQL);
    expect(grant?.[1].split(",").map((c) => c.trim()).length).toBeGreaterThan(5);
    expect(grant?.[1]).not.toMatch(/storage_path/);
  });
});
