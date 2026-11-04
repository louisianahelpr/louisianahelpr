/**
 * THE TIP LEG READS THE MONEY, NOT ONLY THE NOTICE (Q824 part 3, lh-money-escrow review note).
 *
 * 04-money-outcomes' hire-settle-tip leg used to assert only the helper's "tip" notification. A webhook that
 * wrote the notice but left the tips row pending, or recorded the wrong amount or payer, still passed. The leg
 * now reads the tips row as the helper (RLS "Users can view their own tips") and asserts one paid $3 tip from
 * the poster with a PaymentIntent. This guard keeps those assertions in the spec.
 *
 * @mutate e2e/journeys/04-money-outcomes.spec.ts | expect(tipRows[0].payment_status, "the webhook did not settle the tip").toBe("paid"); | expect(tipRows[0].payment_status, "the webhook did not settle the tip").toBeTruthy();
 * @mutate e2e/journeys/04-money-outcomes.spec.ts | expect(Number(tipRows[0].amount), "the tip row is not the $3 paid at Checkout").toBe(3); |
 * @mutate e2e/journeys/04-money-outcomes.spec.ts | ${SUPABASE_URL}/rest/v1/tips?job_id=eq.${jobId}&helper_id | ${SUPABASE_URL}/rest/v1/notifications?job_id=eq.${jobId}&helper_id
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const SPEC = join(process.cwd(), "e2e/journeys/04-money-outcomes.spec.ts");
const src = blankComments(readFileSync(SPEC, "utf8"));
const leg = src.slice(src.indexOf("hire-settle-tip"), src.indexOf("outcomes and admin paths no journey drives"));

describe("the tip journey reads the tips row (Q824)", () => {
  it("finds the hire-settle-tip leg (inventory floor)", () => {
    expect(leg.length).toBeGreaterThan(2000);
  });

  it("reads the helper's tips row for the job and asserts one paid $3 tip from the poster with a PaymentIntent", () => {
    expect(leg).toMatch(/\/rest\/v1\/tips\?job_id=eq\.\$\{jobId\}&helper_id=eq\.\$\{helper\.user\.id\}/);
    expect(leg).toContain('expect(tipRows, "one tip row for one tip").toHaveLength(1);');
    expect(leg).toContain('.toBe("paid");');
    expect(leg).toContain(".toBe(3);");
    expect(leg).toContain(".toBe(poster.user.id);");
    expect(leg).toContain(".toMatch(/^pi_/);");
  });
});
