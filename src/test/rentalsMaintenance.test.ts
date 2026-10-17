/**
 * Rentals S1 (20261017205605_rentals_maintenance_requests; owner decisions in
 * docs/specs/landlord-hub-prep.md Q37-Q48, Q5-Q6, Q53, Q59). The fast half of
 * the proof: the shape every later Rentals slice must keep, read from the
 * NEWEST definitions the migrations leave (effectiveDefs), so a later
 * restatement that drops a gate fails here.
 *
 *   1. Every client-callable rentals RPC starts with
 *      PERFORM public.require_feature('rentals') (hidden switch, server side).
 *   2. Every write RPC names is_caller_banned() and reads the caller with
 *      auth.uid() in its own body; the ones a tenant or landlord ACTS through
 *      also run rentals_assert_member() (under 18 refused, Q59).
 *   3. The owner rules: ID-verified landlords (Q5), admin-approved ownership
 *      before any invite (Q6/Q53), a reason on every "no" (Q46), emergencies
 *      never auto-approved (Q40/Q48), only the token's SHA-256 is stored.
 *   4. No client role writes a Rentals table; internal helpers are server-only.
 *   5. The switch is created OFF and the behaviour proof exists.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/rentalsMaintenance.pglite.mjs
 * (97 PASS on the migration; NEW_MIGRATION=skip 0 PASS / 97 FAIL; 22 planted
 * defects each caught, incl. the Q807 unconfirmed-email gate call removed,
 * measured 2026-10-15).
 */
// @mutate supabase/migrations/20261017205605_rentals_maintenance_requests.sql | VALUES ('rentals', 'off', | VALUES ('rentals', 'testers',
// @mutate supabase/migrations/20261017205605_rentals_maintenance_requests.sql |   IF v_status <> 'approved' THEN\n    RAISE EXCEPTION 'ownership_not_approved' |   IF false THEN\n    RAISE EXCEPTION 'ownership_not_approved'
// @mutate supabase/migrations/20261017205605_rentals_maintenance_requests.sql |   v_auto := p_urgency <> 'emergency' AND v_p.auto_approve_limit_cents IS NOT NULL; |   v_auto := v_p.auto_approve_limit_cents IS NOT NULL;
// @mutate supabase/migrations/20261017205605_rentals_maintenance_requests.sql |   IF public.member_under_18(v_uid) THEN |   IF false THEN
// @mutate supabase/migrations/20261017205605_rentals_maintenance_requests.sql | REVOKE ALL ON FUNCTION public.rentals_notify(uuid, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.rentals_notify(uuid, text, text, text, boolean, boolean) FROM PUBLIC, anon;
// Owner decision 2026-10-17: the landlord never learns which admin reviewed the proof.
// @mutate supabase/migrations/20261017205605_rentals_maintenance_requests.sql | ownership_review_note, auto_approve_limit_cents, created_at, updated_at)\n  ON TABLE public.rental_properties TO authenticated; | ownership_review_note, auto_approve_limit_cents, created_at, updated_at, ownership_reviewed_by)\n  ON TABLE public.rental_properties TO authenticated;
// @mutate supabase/migrations/20261017205605_rentals_maintenance_requests.sql |     '/rentals', false, true); |     '/rentals', false);
// @mutate supabase/migrations/20261017205605_rentals_maintenance_requests.sql |   IF p_staff THEN\n    IF public.notification_crosses_seed_boundary(p_user, NULL, v_link, v_actor) THEN |   IF false THEN\n    IF public.notification_crosses_seed_boundary(p_user, NULL, v_link, v_actor) THEN
// @mutate src/lib/rentals/api.ts | ownership_review_note, auto_approve_limit_cents, created_at, updated_at"; | ownership_review_note, auto_approve_limit_cents, created_at, updated_at, ownership_reviewed_by";
// @mutate src/lib/rentals/copy.ts |   approved: "Approved by Louisiana Helpr", |   approved: "Owner verified",
// @mutate supabase/migrations/20261017221621_rentals_visit_time.sql |    WHERE j.id = p_job_id AND j.helper_id = v_uid | WHERE j.id = p_job_id
// @mutate supabase/migrations/20261017221621_rentals_visit_time.sql |                                   WHERE r.id = p_request_id AND r.visit_proposed_for = p_at) THEN |                                   WHERE r.id = p_request_id) THEN
// @mutate supabase/migrations/20261017221621_rentals_visit_time.sql |        AND ((j.helper_id = v_uid AND j.helper_confirmed_at IS NOT NULL) OR j.customer_id = v_uid); |        AND (j.helper_id = v_uid OR j.customer_id = v_uid);
// @mutate supabase/migrations/20261017221621_rentals_visit_time.sql |    WHERE j.id = p_job_id AND j.helper_id = v_uid AND j.helper_confirmed_at IS NOT NULL |    WHERE j.id = p_job_id AND j.helper_id = v_uid
// @mutate supabase/migrations/20261017221621_rentals_visit_time.sql |                   JOIN public.rental_tenancies t ON t.id = r.tenancy_id\n                  WHERE r.id = p_request_id AND t.tenant_id = v_uid AND t.status = 'active') THEN |                   JOIN public.rental_tenancies t ON t.id = r.tenancy_id\n                  WHERE r.id = p_request_id AND t.tenant_id = v_uid) THEN
// @mutate supabase/migrations/20261017221621_rentals_visit_time.sql |   IF p_at <= now() THEN |   IF false THEN
// @mutate supabase/migrations/20261017220911_rentals_link_one_live_job.sql |                        AND (cur.stripe_session_id IS NULL OR cur.payment_status = 'abandoned'))) |                        )) 
// @mutate supabase/migrations/20261017220911_rentals_link_one_live_job.sql |                    OR (cur.status = 'cancelled' |                    OR (true
// @mutate supabase/migrations/20261017220911_rentals_link_one_live_job.sql |     AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'failed', 'abandoned')\n     AND (j.stripe_session_id IS NULL OR j.payment_status = 'abandoned')\n   FOR UPDATE; |     FOR UPDATE;
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { RENTAL_PROPERTY_COLUMNS } from "@/lib/rentals/api";
import { OWNERSHIP_STATUS_LABEL } from "@/lib/rentals/copy";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261017205605_rentals_maintenance_requests.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
/** S1 plus every later Rentals migration (read from the directory): their grants join the callable inventory. */
const LATER = readdirSync(MIG_DIR).filter((f) => /^\d{14}_rentals_.*\.sql$/.test(f) && f > FILE).sort();
const ALL_MIG = [MIG, ...LATER.map((f) => blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8")))].join("\n");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

/** RPCs a member acts through (all member gates incl. under 18). */
const MEMBER_RPCS = [
  "rentals_create_property",
  "rentals_submit_ownership_proof",
  "rentals_add_unit",
  "rentals_set_auto_approve",
  "rentals_invite_tenant",
  "rentals_accept_invite",
  "rentals_file_request",
  "rentals_approve_request",
  "rentals_decline_request",
  "rentals_tenant_answer_fixed",
];
/** RPCs that only take access away or link a job (banned / under-18 may still leave). */
const OTHER_RPCS = ["rentals_end_tenancy", "rentals_withdraw_request", "link_maintenance_request_job", "rentals_admin_review_property"];
const READ_RPCS = ["rentals_request_job_state", "rentals_my_homes", "rentals_visit_for_job"];
/** Slice 3 writes: visit time (the Helpr, not a Rentals member, proposes; the tenant confirms through
 *  rentals_assert_member) and the landlord's cancel of an unpaid repair job. */
const VISIT_RPCS = ["rentals_propose_visit", "rentals_confirm_visit", "rentals_cancel_request_job"];
/** Shared helpers this migration restates with their live grants (authenticated keeps EXECUTE). */
const SHARED_RESTATED = ["is_submitted_credential_object"];
const POLICY_HELPERS = ["rentals_caller_is_active_tenant_of"];
const INTERNAL = ["rentals_assert_member", "rentals_notify", "rentals_end_tenancy_on_tenant_delete"];
const TABLES = ["rental_properties", "rental_units", "rental_tenancies", "maintenance_requests", "maintenance_request_photos"];

/** Functions the migration GRANTs EXECUTE to authenticated. */
function clientCallable(): Set<string> {
  const out = new Set<string>();
  for (const m of ALL_MIG.matchAll(/(GRANT\s+EXECUTE|REVOKE\s+ALL)\s+ON\s+FUNCTION\s+public\.(\w+)\s*\([^)]*\)\s+(?:TO|FROM)\s+([^;]+);/gi)) {
    const roles = m[3].toLowerCase();
    if (/^grant/i.test(m[1]) && /\bauthenticated\b/.test(roles)) out.add(m[2]);
    if (/^revoke/i.test(m[1]) && /\bauthenticated\b/.test(roles)) out.delete(m[2]);
  }
  return out;
}

describe("Rentals S1: hidden, gated maintenance requests (20261017205605)", () => {
  const callable = clientCallable();

  it("reads a real inventory (floors)", () => {
    expect(DEFS.has("rentals_file_request")).toBe(true);
    expect(callable.size).toBeGreaterThan(10);
    expect(LATER.length).toBeGreaterThan(1);
    expect([...callable].sort()).toEqual([...MEMBER_RPCS, ...OTHER_RPCS, ...READ_RPCS, ...VISIT_RPCS, ...POLICY_HELPERS, ...SHARED_RESTATED].sort());
  });

  it("1. every client-callable Rentals RPC starts with require_feature('rentals')", () => {
    const missing = [...MEMBER_RPCS, ...OTHER_RPCS, ...READ_RPCS, ...VISIT_RPCS].filter(
      (fn) => !/\bBEGIN\s+PERFORM\s+public\.require_feature\('rentals'\);/i.test(body(fn)),
    );
    expect(missing).toEqual([]);
  });

  it("2. write RPCs name is_caller_banned(), read the caller from auth.uid(), and member RPCs run the member gates", () => {
    for (const fn of [...MEMBER_RPCS, ...VISIT_RPCS, "link_maintenance_request_job", "rentals_admin_review_property"]) {
      const b = body(fn);
      expect(b, `${fn} must not be STABLE/IMMUTABLE (it writes)`).not.toMatch(/\b(STABLE|IMMUTABLE)\b/i);
      expect(b, `${fn} names is_caller_banned()`).toMatch(/public\.is_caller_banned\(\)/);
    }
    for (const fn of MEMBER_RPCS) {
      expect(body(fn), fn).toContain("PERFORM public.rentals_assert_member();");
      expect(body(fn), fn).toContain("v_uid := (SELECT auth.uid());");
    }
    const gate = flat(body("rentals_assert_member"));
    expect(gate).toContain("IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'");
    expect(gate).toContain("IF public.is_caller_banned() THEN");
    expect(gate).toContain("IF public.member_under_18(v_uid) THEN RAISE EXCEPTION 'under_18'");
  });

  it("3. the owner rules", () => {
    expect(flat(body("rentals_create_property"))).toContain("p.user_id = v_uid AND p.idv_status = 'verified'");
    expect(flat(body("rentals_invite_tenant"))).toContain("IF v_status <> 'approved' THEN RAISE EXCEPTION 'ownership_not_approved'");
    expect(flat(body("rentals_invite_tenant"))).toContain("encode(sha256(convert_to(v_token, 'UTF8')), 'hex')");
    expect(flat(body("rentals_admin_review_property"))).toContain("NOT public.has_role(v_uid, 'admin'::public.app_role)");
    expect(flat(body("rentals_admin_review_property"))).toContain("INSERT INTO public.admin_audit_log");
    const decline = flat(body("rentals_decline_request"));
    expect(decline).toContain("IF p_reason_code IS NULL OR p_reason_code NOT IN");
    expect(decline).toContain("WHERE id = p_request_id AND landlord_id = v_uid AND status = 'submitted'");
    const file = flat(body("rentals_file_request"));
    expect(file).toContain("v_auto := p_urgency <> 'emergency' AND v_p.auto_approve_limit_cents IS NOT NULL;");
    expect(file).toContain("v_leak := public.contact_leak_reason(");
    expect(file).toContain("WHERE id = p_tenancy_id AND tenant_id = v_uid AND status = 'active'");
    // A funded job OR a checkout in flight is never re-pointed (no double payment).
    // Slice 3 (20261017220911): the request moves off its job only once that job is SETTLED (money back, or
    // cancelled and never funded with no live checkout); the reader's 'none' is the same test.
    const settled = "COALESCE(cur.payment_status, 'unpaid') IN ('refunded', 'cancelled') OR (cur.status = 'cancelled' AND COALESCE(cur.payment_status, 'unpaid') IN ('unpaid', 'failed', 'abandoned') AND (cur.stripe_session_id IS NULL OR cur.payment_status = 'abandoned'))";
    expect(flat(body("link_maintenance_request_job"))).toContain(`AND NOT (${settled}) FOR SHARE) THEN RETURN false;`);
    expect(flat(body("rentals_request_job_state"))).toContain(`WHEN ${settled.replace(/cur\./g, "j.").replace("j.status =", "j.status::text =")} THEN 'none'`);
    // The way out: only the landlord, only an open never-funded job with no checkout running, under its row lock.
    const cancel = flat(body("rentals_cancel_request_job"));
    expect(cancel).toContain("WHERE r.id = p_request_id AND r.landlord_id = v_uid AND r.status = 'approved' FOR UPDATE;");
    expect(cancel).toContain("WHERE j.id = v_job AND j.customer_id = v_uid AND j.status = 'open' AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'failed', 'abandoned') AND (j.stripe_session_id IS NULL OR j.payment_status = 'abandoned') FOR UPDATE;");
    expect(cancel).toContain("PERFORM public.poster_cancel_job(v_job,");
    // Slice 3 visit time (owner Q41): only the job's Helpr proposes, only the tenant confirms the exact time on
    // file, and the job-side read answers only the job's Helpr and poster (behaviour: the PGlite "visit:" cases).
    expect(flat(body("rentals_propose_visit"))).toContain("WHERE j.id = p_job_id AND j.helper_id = v_uid");
    expect(flat(body("rentals_confirm_visit"))).toContain("WHERE r.id = p_request_id AND r.tenant_id = v_uid AND r.status = 'approved'");
    expect(flat(body("rentals_confirm_visit"))).toContain("WHERE r.id = p_request_id AND r.visit_proposed_for = p_at) THEN");
    expect(flat(body("rentals_visit_for_job"))).toContain("AND ((j.helper_id = v_uid AND j.helper_confirmed_at IS NOT NULL) OR j.customer_id = v_uid);");
    // lh-authz-rls review of 39ee72808: a CONFIRMED Helpr only, a tenant who still lives there, a time still ahead.
    expect(flat(body("rentals_propose_visit"))).toContain("j.helper_id = v_uid AND j.helper_confirmed_at IS NOT NULL");
    expect(flat(body("rentals_confirm_visit"))).toContain("WHERE j.id = v_job AND j.helper_confirmed_at IS NOT NULL");
    expect(flat(body("rentals_confirm_visit"))).toContain("WHERE r.id = p_request_id AND t.tenant_id = v_uid AND t.status = 'active') THEN");
    expect(flat(body("rentals_confirm_visit"))).toContain("IF p_at <= now() THEN RAISE EXCEPTION 'visit_time_passed'");
    // The job state the screen reads answers only the request's two parties.
    expect(flat(body("rentals_request_job_state"))).toContain("WHERE r.id = p_request_id AND (r.tenant_id = v_uid OR r.landlord_id = v_uid)");
    // Review fixes (lh-authz-rls of 3e84eea25): tenant deletion ends the tenancy; tenants never read the
    // property row; submitted proof/photos are locked; caps serialized; ID re-checked on invite.
    expect(flat(body("rentals_end_tenancy_on_tenant_delete"))).toContain("IF NEW.tenant_id IS NULL AND OLD.tenant_id IS NOT NULL AND NEW.status = 'active' THEN NEW.status := 'ended';");
    expect(flat(MIG)).toContain("BEFORE UPDATE OF tenant_id ON public.rental_tenancies");
    const sub = flat(body("is_submitted_credential_object"));
    expect(sub).toContain("rp.ownership_proof_path = p_name AND rp.ownership_status IN ('pending_review', 'approved')");
    expect(sub).toContain("mp.tenant_id = auth.uid() AND mp.storage_path = p_name");
    expect(sub).toContain("c.document_url = p_name"); // the live credential branches kept
    expect(flat(body("rentals_file_request"))).toContain("pg_advisory_xact_lock(hashtext('rentals_file:' || v_uid::text))");
    expect(flat(body("rentals_invite_tenant"))).toContain("pr.idv_status = 'verified'");
    // Filing never creates a job (the noJobRowBeforePayment rule): the landlord posts and pays.
    for (const fn of [...MEMBER_RPCS, ...OTHER_RPCS]) expect(body(fn), fn).not.toMatch(/INSERT\s+INTO\s+public\.jobs\b/i);
  });

  it("4. no client role writes a Rentals table; internal helpers are server-only", () => {
    for (const t of TABLES) {
      expect(MIG, t).toMatch(new RegExp(String.raw`ALTER TABLE public\.${t} ENABLE ROW LEVEL SECURITY;`));
      expect(MIG).not.toMatch(new RegExp(String.raw`GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[^;]*\bON\s+(?:TABLE\s+)?[^;]*public\.${t}\b[^;]*\b(anon|authenticated)\b`, "i"));
    }
    for (const fn of INTERNAL) {
      expect(callable.has(fn), `${fn} must not be client-callable`).toBe(false);
      expect(MIG, fn).toMatch(new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.${fn}\([^)]*\) FROM PUBLIC, anon, authenticated;`));
    }
    // The policy helper answers only about the caller (no user argument).
    expect(flat(body("rentals_caller_is_active_tenant_of"))).toContain("t.tenant_id = (SELECT auth.uid())");
    expect(body("rentals_caller_is_active_tenant_of")).not.toMatch(/p_user/);
  });

  it("6. the landlord never learns which admin reviewed the ownership proof (owner, 2026-10-17)", () => {
    // Client reads: authenticated holds a COLUMN grant on rental_properties without ownership_reviewed_by.
    expect(MIG).not.toMatch(/GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.rental_properties\s+TO\s+[^;]*\bauthenticated\b/i);
    const grants = [...MIG.matchAll(/GRANT\s+SELECT\s*\(([^)]*)\)\s*ON\s+(?:TABLE\s+)?public\.rental_properties\s+TO\s+([^;]+);/gi)];
    expect(grants.length).toBe(1);
    expect(grants[0][2]).toMatch(/\bauthenticated\b/);
    const granted = grants[0][1].split(",").map((c) => c.trim());
    expect(granted.length).toBeGreaterThan(10);
    expect(granted).not.toContain("ownership_reviewed_by");
    expect(granted).toEqual(expect.arrayContaining(["owner_id", "ownership_status", "ownership_review_note", "ownership_reviewed_at"]));
    // The client names exactly those columns (select("*") would be refused, and the payload carries no reviewer id).
    expect(RENTAL_PROPERTY_COLUMNS.split(",").map((c) => c.trim())).toEqual(granted);
    const api = readFileSync(join(ROOT, "src/lib/rentals/api.ts"), "utf8");
    expect(api).not.toMatch(/from\("rental_properties"\)\.select\("\*"\)/);
    // The owner's notice: sent as staff (no actor in the link), the seed boundary judged with the actor instead.
    expect(flat(body("rentals_admin_review_property"))).toContain("'/rentals', false, true);");
    expect(flat(body("rentals_notify"))).toContain(
      "IF p_staff THEN IF public.notification_crosses_seed_boundary(p_user, NULL, v_link, v_actor) THEN BEGIN INSERT INTO public.notification_logs",
    );
    expect(OWNERSHIP_STATUS_LABEL.approved).toBe("Approved by Louisiana Helpr");
  });

  it("5. the switch is created OFF and the behaviour proof exists", () => {
    expect(flat(MIG)).toContain("VALUES ('rentals', 'off',");
    const proof = join(ROOT, "src/test/pglite/rentalsMaintenance.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    expect(readFileSync(proof, "utf8")).toContain("20261017205605");
  });
});
