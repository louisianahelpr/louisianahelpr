/**
 * Q1952 (docs/NOT-LAUNCHED.md; spec L47, L52, L56, L73; migration 20261110195956): "Permit on file" shows only for a
 * CHECKED permit that has not expired, the paperwork queue is admin only and is the one read of sos_number, and
 * shop_permits is server-owned. Behaviour proof: src/test/pglite/shopsPaperwork.pglite.mjs (3x replay; red with
 * NEW_MIGRATION=skip and on planted defects). This guard reads the NEWEST definition of each function.
 *
 * @mutate supabase/migrations/20261110195956_shops_paperwork_queue.sql | WHERE sp.shop_id = s.id AND sp.status = 'verified' AND sp.expires_on >= current_date)) | WHERE sp.shop_id = s.id AND sp.status = 'verified'))
 * @mutate supabase/migrations/20261110195956_shops_paperwork_queue.sql | REVOKE ALL ON FUNCTION public.shops_admin_paperwork() FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.shops_admin_paperwork() FROM PUBLIC;
 * @mutate supabase/migrations/20261110195956_shops_paperwork_queue.sql |        AND sp.status IN ('pending', 'verified')\n  ); |        AND sp.status IN ('pending')\n  );
 * @mutate supabase/migrations/20261110195956_shops_paperwork_queue.sql | REVOKE ALL ON TABLE public.shop_permits FROM PUBLIC, anon, authenticated; | REVOKE ALL ON TABLE public.shop_permits FROM PUBLIC, anon;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, "20261110195956_shops_paperwork_queue.sql"), "utf8"));
const ADMIN = ["shops_admin_paperwork", "shops_admin_review_permit", "shops_admin_check_registration", "shops_admin_set_hidden"];

describe("Shops paperwork: Permit on file and the admin queue (Q1952)", () => {
  it("reads a real inventory", () => {
    for (const fn of [...ADMIN, "shop_badges", "shops_submit_permit", "shops_my_permits"]) expect(DEFS.has(fn), fn).toBe(true);
    expect(body("shop_badges").length).toBeGreaterThan(200);
  });

  it("the permit badge needs a checked, unexpired permit", () => {
    expect(body("shop_badges")).toContain(
      "'permit', EXISTS (SELECT 1 FROM public.shop_permits sp WHERE sp.shop_id = s.id AND sp.status = 'verified' AND sp.expires_on >= current_date)",
    );
  });

  it("every admin RPC checks the admin role first (admins skip the switch) and anon is revoked", () => {
    for (const fn of ADMIN) {
      expect(body(fn), fn).toMatch(/BEGIN IF v_uid IS NULL OR NOT public\.has_role\(v_uid, 'admin'\) THEN PERFORM public\.require_feature\('shops'\); RAISE EXCEPTION 'not_admin'/);
    }
    for (const sig of ["shops_admin_paperwork\\(\\)", "shops_admin_review_permit\\(uuid, boolean, text\\)", "shops_submit_permit\\(text, text, date\\)", "shops_my_permits\\(\\)"]) {
      expect(MIG, sig).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon;`));
    }
  });

  it("shop_permits is server-owned; the owner's read never returns the reviewer; sos_number goes only to admins", () => {
    expect(MIG).toContain("REVOKE ALL ON TABLE public.shop_permits FROM PUBLIC, anon, authenticated;");
    expect(MIG).toContain("ALTER TABLE public.shop_permits ENABLE ROW LEVEL SECURITY;");
    expect(body("shops_my_permits")).not.toContain("reviewed_by");
    expect(body("shops_my_permits")).toContain("WHERE s.owner_id = v_uid");
    expect(body("shops_admin_paperwork")).toContain("'sos_number', s.sos_number");
    expect(MIG).not.toMatch(/GRANT SELECT[^;]*sos_number/i);
  });

  it("the file behind a sent or checked permit is locked against its owner's update / delete", () => {
    expect(body("is_submitted_credential_object")).toContain(
      "SELECT 1 FROM public.shop_permits sp WHERE sp.owner_id = auth.uid() AND sp.document_path = p_name AND sp.status IN ('pending', 'verified')",
    );
    // Every earlier branch is still there (restated verbatim).
    for (const t of ["p.license_url = p_name", "c.document_url = p_name", "rp.ownership_proof_path = p_name", "mp.storage_path = p_name", "lr.front_path = p_name"]) {
      expect(body("is_submitted_credential_object"), t).toContain(t);
    }
  });

  it("a member sends only their own upload, in the permit folder", () => {
    expect(body("shops_submit_permit")).toContain("p_document_path !~ ('^' || v_uid::text || '/shop-permits/' || p_kind || '-[0-9]{13}");
    expect(body("shops_submit_permit")).toContain("o.bucket_id = 'user-documents' AND o.name = p_document_path");
    expect(body("shops_submit_permit")).toMatch(/^.*BEGIN PERFORM public\.require_feature\('shops'\);/);
  });
});
