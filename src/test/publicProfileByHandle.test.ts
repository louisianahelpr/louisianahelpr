/**
 * THE PUBLIC PROFILE PAGE SHOWS ONLY PUBLIC THINGS (LEAD-PROFILE-LINK, owner 2026-10-31 ~10:50 PM, OWNER-DECISIONS
 * "Shareable profile link": guests see the full profile; never addresses, exact locations, contact info,
 * private/test data, expired or cancelled jobs).
 *
 * Server: public_profile_by_handle (20261101041833), behaviour proven in
 * src/test/pglite/publicProfileByHandle.pglite.mjs (--before red 9/9; 13 planted defects each red). This file pins
 * the newest definition's load-bearing clauses, so a later restatement that drops one is red here.
 *
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |      OR public.is_test_member(v_p.user_id) THEN | THEN
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |      OR COALESCE(public.member_under_18(v_p.user_id), true) | 
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |      OR public.declutter_member_out(v_p.user_id) | 
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql | AND p.ban_status IS DISTINCT FROM 'temp_banned' | 
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql | SET search_path TO 'public', 'pg_temp' | SET search_path TO 'public'
 * @mutate supabase/migrations/20261101034834_profile_handle.sql |     IF public.profile_handle_problem(v_try) IS NULL THEN | IF true THEN
 * @mutate supabase/migrations/20261101034834_profile_handle.sql |       RAISE EXCEPTION 'handle_retired' USING ERRCODE = '23505'; | NULL;
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql | 'town', public.mask_job_location(j.location), | 'town', j.location,
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |          AND w.public | 
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |          AND j.status = 'open' | 
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql | 'reviewer_name', public.member_display_name(r.reviewer_full_name), | 'reviewer_name', r.reviewer_full_name,
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |                  AND NOT COALESCE(public.member_under_18(rp.user_id), true) | 
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |                  AND rp.anonymized_at IS NULL | 
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |          AND NOT public.is_test_member(rv.reviewer_id) | 
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |          AND j.is_seed IS NOT TRUE\n         AND NOT public.is_test_member(rv.reviewer_id) |          AND NOT public.is_test_member(rv.reviewer_id)
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql | 'id', i.id, | 'id', i.id, 'pickup_address', i.pickup_address,
 * @mutate supabase/migrations/20261101034834_profile_handle.sql | VALUES (OLD.handle, CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE OLD.user_id END) | VALUES (OLD.handle, OLD.user_id)
 * @mutate supabase/migrations/20261101034834_profile_handle.sql | r.user_id IS DISTINCT FROM NEW.user_id | r.user_id <> NEW.user_id
 * @mutate supabase/migrations/20261101034834_profile_handle.sql | user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, | user_id uuid NOT NULL,
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql | WHERE r.handle = v_handle AND r.user_id IS NOT NULL)) | WHERE r.handle = v_handle))
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = resolve(import.meta.dirname, "../../supabase/migrations");
const RPC = "public_profile_by_handle";
const defs = latestFunctionDefs(MIGRATIONS);
const def = defs.get(RPC);
const body = blankSqlComments(def?.body ?? "").replace(/\s+/g, " ");

/** Every key the answer's jsonb_build_object calls name: the page's whole public surface. */
const keys = [...body.matchAll(/'([a-z_]+)',\s*(?=[a-z(]|'|coalesce|public|jsonb|v_)/g)].map((m) => m[1]);

describe("the newest public_profile_by_handle keeps every rule", () => {
  it("is defined, and the key inventory is read", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(def, `${RPC} must be defined by a migration`).toBeDefined();
    expect(keys.length).toBeGreaterThan(20);
  });

  it.each([
    ["no page for a test member", "OR public.is_test_member(v_p.user_id) THEN RETURN NULL;"],
    ["no page for a banned (any form), unverified or deleted member", "AND p.email_verified AND p.ban_status IS DISTINCT FROM 'banned' AND p.ban_status IS DISTINCT FROM 'temp_banned' AND p.ban_status IS DISTINCT FROM 'permanently_banned' AND p.is_seed IS NOT TRUE AND p.anonymized_at IS NULL"],
    ["no page for a member out of Declutter (review 2026-11-01)", "OR public.declutter_member_out(v_p.user_id)"],
    ["no page for a member under 18 (lead 2026-11-01)", "OR COALESCE(public.member_under_18(v_p.user_id), true)"],
    ["an old handle opens only its owner's page", "p.user_id = (SELECT r.user_id FROM public.profile_handles_retired r WHERE r.handle = v_handle AND r.user_id IS NOT NULL))"],
    ["the job's town, never its address", "'town', public.mask_job_location(j.location),"],
    ["open jobs only", "AND j.status = 'open'"],
    ["never past the offer cutoff", "AND public.job_offer_cutoff(j.date_needed, j.start_time) > now()"],
    ["never expired", "AND (j.expires_at IS NULL OR j.expires_at > now())"],
    ["live listings only", "AND i.status = 'live' AND NOT i.seller_hidden AND i.is_seed IS NOT TRUE"],
    ["public Wanted posts only", "AND w.status = 'open' AND w.public AND w.removed_at IS NULL AND w.expires_at > now() AND w.is_seed IS NOT TRUE"],
    ["reviewers as First L.", "'reviewer_name', public.member_display_name(r.reviewer_full_name),"],
    ["a reviewer's name only under the hidden-member rules (review 2026-11-01)", "AND rp.email_verified AND rp.ban_status IS DISTINCT FROM 'banned' AND rp.ban_status IS DISTINCT FROM 'temp_banned' AND rp.ban_status IS DISTINCT FROM 'permanently_banned' AND rp.anonymized_at IS NULL AND NOT public.declutter_member_out(rp.user_id) AND NOT COALESCE(public.member_under_18(rp.user_id), true)"],
    ["reviews: the stats' rules, for every caller (re-review 2026-11-01)", "WHERE rv.reviewee_id = v_p.user_id AND rv.status = 'published' AND rv.feedback_visible_at IS NOT NULL AND rv.feedback_visible_at <= now() AND j.status <> 'cancelled' AND j.is_seed IS NOT TRUE AND NOT public.is_test_member(rv.reviewer_id) AND NOT public.is_test_member(rv.reviewee_id)"],
    ["the public name as First L.", "'name', public.member_display_name(v_p.full_name),"],
  ])("%s", (_what, clause) => {
    expect(body).toContain(clause);
  });

  it("never reads the caller-dependent public reviews read (its seed rule reads auth.uid())", () => {
    expect(body).not.toContain("get_public_profile_reviews(");
  });

  it("names no contact, address, coordinate, storage or user-id field", () => {
    const banned = /^(email|phone|address|pickup_address|location|area_lat|area_lng|latitude|longitude|lat|lng|storage_path|user_id|seller_id|customer_id|helper_id|full_name|bio)$/;
    expect(keys.filter((k) => banned.test(k))).toEqual([]);
  });

  it("pins search_path to public, pg_temp (review 2026-11-01)", () => {
    const file = blankSqlComments(def?.file ? readFileSync(resolve(MIGRATIONS, def.file), "utf8") : "");
    expect(file).toMatch(/FUNCTION public\.public_profile_by_handle\(p_handle text\)[\s\S]*?SET search_path TO 'public', 'pg_temp'/);
  });

  it("anon can call it", () => {
    const file = blankSqlComments(def?.file ? readFileSync(resolve(MIGRATIONS, def.file), "utf8") : "");
    expect(file).toContain(`GRANT EXECUTE ON FUNCTION public.${RPC}(text) TO anon, authenticated, service_role;`);
  });
});

describe("the newest handle functions keep the review's rules (2026-11-01)", () => {
  const body = (fn: string) => blankSqlComments(defs.get(fn)?.body ?? "").replace(/\s+/g, " ");
  it("a default handle runs the same checks as a picked one", () => {
    expect(body("rpc_ensure_my_handle")).toContain("IF public.profile_handle_problem(v_try) IS NULL THEN");
    expect(body("rpc_set_my_handle")).toContain("v_problem := public.profile_handle_problem(v_new);");
    expect(body("profile_handle_base")).toContain("public.profile_handle_problem(b) IS NULL THEN b ELSE 'neighbor' END");
  });
  it("a retired handle is refused to anyone else", () => {
    expect(body("profile_handle_retire")).toContain("RAISE EXCEPTION 'handle_retired' USING ERRCODE = '23505';");
  });
  // Lead 2026-11-01: a deleted member's handles stay reserved but unlinked. Behaviour (and the account-deletion FK
  // failure the CASE prevents) in src/test/pglite/profileHandle.pglite.mjs H11; the redirect in
  // publicProfileByHandle.pglite.mjs P14.
  it("a deleted member's handle stays reserved, unlinked, and resolves to nothing", () => {
    const retire = body("profile_handle_retire");
    expect(retire).toContain("VALUES (OLD.handle, CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE OLD.user_id END)");
    expect(retire).toContain("WHERE r.handle = NEW.handle AND r.user_id IS DISTINCT FROM NEW.user_id) THEN");
    expect(blankSqlComments(readFileSync(resolve(MIGRATIONS, "20261101034834_profile_handle.sql"), "utf8")))
      .toMatch(/user_id uuid REFERENCES auth\.users\(id\) ON DELETE SET NULL,/);
    expect(body(RPC)).toContain("WHERE r.handle = v_handle AND r.user_id IS NOT NULL))");
  });
});
