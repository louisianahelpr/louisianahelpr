/**
 * Q2068: ending a tenancy tells the OTHER party (in the app), never the caller and never an unused invite's invitee.
 * Reads the EFFECTIVE (newest) rentals_end_tenancy; behaviour on a real database is the "end tenancy tells the other
 * side" section of src/test/pglite/rentalsMaintenance.pglite.mjs (Q2068=skip red).
 *
 * @mutate supabase/migrations/20261106171605_homes_end_tenancy_tells_other_side.sql | PERFORM public.rentals_notify(v_t.tenant_id, 'Tenancy ended', | PERFORM public.rentals_notify(v_uid, 'Tenancy ended',
 * @mutate supabase/migrations/20261106171605_homes_end_tenancy_tells_other_side.sql |     ELSIF v_uid = v_t.tenant_id AND v_t.landlord_id IS NOT NULL THEN |     ELSIF false THEN
 * @mutate supabase/migrations/20261106171605_homes_end_tenancy_tells_other_side.sql | (La. R.S. 9:3251).', | .',
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const fn = blankSqlComments(DEFS.get("rentals_end_tenancy")?.stmt ?? "").replace(/\s+/g, " ");

describe("ending a tenancy tells the other side (Q2068)", () => {
  it("reads the newest definition (floor)", () => {
    expect(DEFS.get("rentals_end_tenancy")?.file ?? "").toBe("20261106171605_homes_end_tenancy_tells_other_side.sql");
    expect(fn.length).toBeGreaterThan(800);
  });

  it("keeps the caller rule and the not-found code", () => {
    expect(fn).toContain("PERFORM public.require_feature('rentals')");
    expect(fn).toContain("AND (landlord_id = v_uid OR tenant_id = v_uid) RETURNING * INTO v_t;");
    expect(fn).toContain("RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404'");
  });

  it("the landlord ending it tells the tenant; the tenant ending it tells the landlord with the deposit clock", () => {
    expect(fn).toContain("IF v_uid = v_t.landlord_id AND v_t.tenant_id IS NOT NULL THEN PERFORM public.rentals_notify(v_t.tenant_id, 'Tenancy ended',");
    expect(fn).toContain("ELSIF v_uid = v_t.tenant_id AND v_t.landlord_id IS NOT NULL THEN PERFORM public.rentals_notify(v_t.landlord_id, 'Tenancy ended',");
    expect(fn).toContain("(La. R.S. 9:3251).'");
    // In the app only (the item asks for in-app): p_email false on both.
    expect(fn.match(/'\/rentals', false\)/g)?.length).toBe(2);
  });
});
