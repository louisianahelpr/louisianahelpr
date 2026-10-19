/**
 * Every identity gate reads ONE rule (owner, 2026-10-19 pop-up: "BOTH WAYS").
 *
 * THE BUG: rentals_create_property and rentals_invite_tenant refused with
 * identity_not_verified unless profiles.idv_status = 'verified' (Stripe
 * Identity), a check no screen had launched since 2026-10-01. A landlord who
 * passed Stripe Connect's identity check (stripe_identity_verified, the badge
 * the app shows) was refused forever; the owner was one of them.
 *
 * THE RULE lives in public.is_identity_verified(uuid) (20261019021418): Stripe
 * Identity OR the Stripe Connect verdict, the same rule as
 * src/lib/awardGate.ts isIdentityVerified. This guard enumerates every live
 * function (newest effective definition) that RAISEs identity_not_verified and
 * fails on one that does not call the helper, or that reads idv_status /
 * stripe_identity_verified itself (a second, drifting copy of the rule).
 * Behaviour: src/test/pglite/rentalsMaintenance.pglite.mjs (Connect-verified
 * passes, Identity-verified passes, neither refused).
 */
// @mutate supabase/migrations/20261019021418_rentals_identity_either_verdict_paid_idv.sql |   IF NOT public.is_identity_verified(v_uid) THEN\n    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';\n  END IF;\n  -- Serialize | IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.idv_status = 'verified') THEN\n    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';\n  END IF;\n  -- Serialize
// @mutate supabase/migrations/20261019021418_rentals_identity_either_verdict_paid_idv.sql |     SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) | SELECT p.idv_status = 'verified'
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { isIdentityVerified } from "@/lib/awardGate";

const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

const GATES = [...DEFS.entries()]
  .filter(([, d]) => /RAISE\s+EXCEPTION\s+'identity_not_verified'/i.test(blankSqlComments(d.stmt)))
  .map(([name, d]) => ({ name, body: flat(d.stmt) }));

describe("every identity_not_verified gate uses public.is_identity_verified", () => {
  it("finds the gates (inventory floor)", () => {
    expect(GATES.map((g) => g.name)).toEqual(expect.arrayContaining(["rentals_create_property", "rentals_invite_tenant"]));
    expect(GATES.length).toBeGreaterThan(1);
  });

  it.each(GATES.map((g) => [g.name, g.body] as const))("%s calls the helper and reads no verdict column itself", (_name, body) => {
    expect(body).toMatch(/IF NOT public\.is_identity_verified\(v_uid\) THEN RAISE EXCEPTION 'identity_not_verified'/);
    expect(body).not.toMatch(/\bidv_status\b/);
    expect(body).not.toMatch(/\bstripe_identity_verified\b/);
  });

  it("the helper accepts EITHER verdict (the client's isIdentityVerified rule)", () => {
    const helper = flat(DEFS.get("is_identity_verified")?.stmt ?? "");
    expect(helper).toContain("SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified)");
    // and that predicate is the either-verdict union
    expect(flat(DEFS.get("identity_is_verified")?.stmt ?? "")).toContain(
      "p_idv_status IS NOT DISTINCT FROM 'verified' OR p_stripe_identity_verified IS TRUE",
    );
    expect(helper).toContain("SECURITY DEFINER");
    // The client rule it mirrors: either one alone is enough.
    expect(isIdentityVerified({ connectIdentityVerified: true, idvStatus: "pending" })).toBe(true);
    expect(isIdentityVerified({ connectIdentityVerified: null, idvStatus: "verified" })).toBe(true);
    expect(isIdentityVerified({ connectIdentityVerified: false, idvStatus: "pending" })).toBe(false);
  });
});
