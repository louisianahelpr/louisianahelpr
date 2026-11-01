/**
 * THE PUBLIC PROFILE PAGE SHOWS ONLY PUBLIC THINGS (LEAD-PROFILE-LINK, owner 2026-10-31 ~10:50 PM, OWNER-DECISIONS
 * "Shareable profile link": guests see the full profile; never addresses, exact locations, contact info,
 * private/test data, expired or cancelled jobs).
 *
 * Server: public_profile_by_handle (20261101041833), behaviour proven in
 * src/test/pglite/publicProfileByHandle.pglite.mjs (--before red 9/9; 13 planted defects each red). This file pins
 * the newest definition's load-bearing clauses, so a later restatement that drops one is red here.
 *
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql | IF v_p.user_id IS NULL OR public.is_test_member(v_p.user_id) THEN | IF v_p.user_id IS NULL THEN
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql | 'town', public.mask_job_location(j.location), | 'town', j.location,
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |          AND w.public | 
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql |          AND j.status = 'open' | 
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql | 'reviewer_name', public.member_display_name(r.reviewer_name), | 'reviewer_name', r.reviewer_name,
 * @mutate supabase/migrations/20261101041833_public_profile_by_handle.sql | 'id', i.id, | 'id', i.id, 'pickup_address', i.pickup_address,
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
    ["no page for a test member", "IF v_p.user_id IS NULL OR public.is_test_member(v_p.user_id) THEN RETURN NULL;"],
    ["no page for a banned, unverified or deleted member", "AND p.email_verified AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned')) AND p.is_seed IS NOT TRUE AND p.anonymized_at IS NULL"],
    ["the job's town, never its address", "'town', public.mask_job_location(j.location),"],
    ["open jobs only", "AND j.status = 'open'"],
    ["never past the offer cutoff", "AND public.job_offer_cutoff(j.date_needed, j.start_time) > now()"],
    ["never expired", "AND (j.expires_at IS NULL OR j.expires_at > now())"],
    ["live listings only", "AND i.status = 'live' AND NOT i.seller_hidden AND i.is_seed IS NOT TRUE"],
    ["public Wanted posts only", "AND w.status = 'open' AND w.public AND w.removed_at IS NULL AND w.expires_at > now() AND w.is_seed IS NOT TRUE"],
    ["reviewers as First L.", "'reviewer_name', public.member_display_name(r.reviewer_name),"],
    ["the public name as First L.", "'name', public.member_display_name(v_p.full_name),"],
  ])("%s", (_what, clause) => {
    expect(body).toContain(clause);
  });

  it("names no contact, address, coordinate, storage or user-id field", () => {
    const banned = /^(email|phone|address|pickup_address|location|area_lat|area_lng|latitude|longitude|lat|lng|storage_path|user_id|seller_id|customer_id|helper_id|full_name|bio)$/;
    expect(keys.filter((k) => banned.test(k))).toEqual([]);
  });

  it("anon can call it", () => {
    const file = blankSqlComments(def?.file ? readFileSync(resolve(MIGRATIONS, def.file), "utf8") : "");
    expect(file).toContain(`GRANT EXECUTE ON FUNCTION public.${RPC}(text) TO anon, authenticated, service_role;`);
  });
});
