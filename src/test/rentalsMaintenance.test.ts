/**
 * Rentals S1 (20261015061259_rentals_maintenance_requests; owner decisions in
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
// @mutate supabase/migrations/20261015061259_rentals_maintenance_requests.sql | VALUES ('rentals', 'off', | VALUES ('rentals', 'testers',
// @mutate supabase/migrations/20261015061259_rentals_maintenance_requests.sql |   IF v_status <> 'approved' THEN\n    RAISE EXCEPTION 'ownership_not_approved' |   IF false THEN\n    RAISE EXCEPTION 'ownership_not_approved'
// @mutate supabase/migrations/20261015061259_rentals_maintenance_requests.sql |   v_auto := p_urgency <> 'emergency' AND v_p.auto_approve_limit_cents IS NOT NULL; |   v_auto := v_p.auto_approve_limit_cents IS NOT NULL;
// @mutate supabase/migrations/20261015061259_rentals_maintenance_requests.sql |   IF public.member_under_18(v_uid) THEN |   IF false THEN
// @mutate supabase/migrations/20261015061259_rentals_maintenance_requests.sql | REVOKE ALL ON FUNCTION public.rentals_notify(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.rentals_notify(uuid, text, text, text, boolean) FROM PUBLIC, anon;
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261015061259_rentals_maintenance_requests.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
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
const READ_RPCS = ["rentals_request_job_state", "rentals_my_homes"];
/** Shared helpers this migration restates with their live grants (authenticated keeps EXECUTE). */
const SHARED_RESTATED = ["is_submitted_credential_object"];
const POLICY_HELPERS = ["rentals_caller_is_active_tenant_of"];
const INTERNAL = ["rentals_assert_member", "rentals_notify", "rentals_end_tenancy_on_tenant_delete"];
const TABLES = ["rental_properties", "rental_units", "rental_tenancies", "maintenance_requests", "maintenance_request_photos"];

/** Functions the migration GRANTs EXECUTE to authenticated. */
function clientCallable(): Set<string> {
  const out = new Set<string>();
  for (const m of MIG.matchAll(/(GRANT\s+EXECUTE|REVOKE\s+ALL)\s+ON\s+FUNCTION\s+public\.(\w+)\s*\([^)]*\)\s+(?:TO|FROM)\s+([^;]+);/gi)) {
    const roles = m[3].toLowerCase();
    if (/^grant/i.test(m[1]) && /\bauthenticated\b/.test(roles)) out.add(m[2]);
    if (/^revoke/i.test(m[1]) && /\bauthenticated\b/.test(roles)) out.delete(m[2]);
  }
  return out;
}

describe("Rentals S1: hidden, gated maintenance requests (20261015061259)", () => {
  const callable = clientCallable();

  it("reads a real inventory (floors)", () => {
    expect(DEFS.has("rentals_file_request")).toBe(true);
    expect(callable.size).toBeGreaterThan(10);
    expect([...callable].sort()).toEqual([...MEMBER_RPCS, ...OTHER_RPCS, ...READ_RPCS, ...POLICY_HELPERS, ...SHARED_RESTATED].sort());
  });

  it("1. every client-callable Rentals RPC starts with require_feature('rentals')", () => {
    const missing = [...MEMBER_RPCS, ...OTHER_RPCS, ...READ_RPCS].filter(
      (fn) => !/\bBEGIN\s+PERFORM\s+public\.require_feature\('rentals'\);/i.test(body(fn)),
    );
    expect(missing).toEqual([]);
  });

  it("2. write RPCs name is_caller_banned(), read the caller from auth.uid(), and member RPCs run the member gates", () => {
    for (const fn of [...MEMBER_RPCS, "link_maintenance_request_job", "rentals_admin_review_property"]) {
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
    expect(flat(body("link_maintenance_request_job"))).toContain("OR (cur.payment_status IN ('unpaid', 'cancelling') AND cur.stripe_session_id IS NOT NULL)");
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

  it("5. the switch is created OFF and the behaviour proof exists", () => {
    expect(flat(MIG)).toContain("VALUES ('rentals', 'off',");
    const proof = join(ROOT, "src/test/pglite/rentalsMaintenance.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    expect(readFileSync(proof, "utf8")).toContain("20261015061259");
  });
});
