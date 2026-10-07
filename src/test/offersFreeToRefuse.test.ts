/**
 * Q1281 (owner decision 2026-10-05): NO strike for declining OR ignoring an
 * offer; strikes are only for backing out AFTER accepting. The newest
 * decline_job_offer and expire_unanswered_offers in the migrations must not
 * call apply_job_denial_consequence (it is the strike), while the paths for
 * backing out after accepting still do.
 *
 * Behaviour (real Postgres): src/test/pglite/offersFreeToRefuse.pglite.mjs
 * (6 PASS applied 3x; 4 FAIL with NEW_MIGRATION=skip, the live definitions).
 *
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | Declining isn't a strike: nothing is committed until you accept. | Backing out now counts against your account.
 * @mutate supabase/migrations/20261007125609_offers_are_free_to_refuse.sql |   v_result := jsonb_build_object('action', 'none', 'reason', 'offer_declined'); |   v_result := public.apply_job_denial_consequence(v_app_helper, v_job_id, 'Declined');
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");

describe("Q1281: an offer is free to refuse", () => {
  it("inventory: the functions are found (floor)", () => {
    for (const n of ["decline_job_offer", "expire_unanswered_offers", "helper_cancel_booking"]) expect(body(n).length, n).toBeGreaterThan(500);
  });

  it("declining or letting an offer lapse files no strike", () => {
    expect(body("decline_job_offer")).not.toMatch(/apply_job_denial_consequence\s*\(/);
    expect(body("expire_unanswered_offers")).not.toMatch(/apply_job_denial_consequence\s*\(/);
  });

  it("backing out AFTER accepting still files one (control: the ladder is not gone)", () => {
    expect(body("helper_cancel_booking")).toMatch(/apply_job_denial_consequence\s*\(|apply_consequence_ladder\s*\(/);
  });

  it("the Helpr's decline confirm says it is not a strike, never that it counts against them", () => {
    const src = readFileSync("src/pages/jobs/appliedJobCard/OfferedActions.tsx", "utf8");
    expect(src).toMatch(/Declining isn't a strike/);
    expect(src).not.toMatch(/counts against your account|counts as a reliability strike/);
  });
});
