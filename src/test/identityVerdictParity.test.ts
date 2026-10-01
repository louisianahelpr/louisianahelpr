// The app must not hold two different opinions about "is this person ID-verified".
//
// It did, and it broke the core transaction. Measured against prod 2026-09-06:
//
//     idv_status = 'verified'                      13
//     stripe_identity_verified IS TRUE              4
//     ID-verified by the app's own check, unhirable 10
//
// Ten of thirteen people who completed identity verification could not be
// hired. Applicants -> Hire -> Send Offer returned 400 P0001
// `helper_identity_unverified` while the applicant card beside the button
// showed a green "ID verified by Stripe" badge.
//
// The cause was that four columns track this one fact and different surfaces
// picked different ones:
//
//   jobs INSERT policy      idv_status = 'verified'          (can post)
//   is_id_verified (badge)  idv_status = 'verified'          (looks verified)
//   helper_award_block_reason  stripe_identity_verified      (can be hired)  <-- odd one out
//   get_user_credential_tier   stripe_identity_verified
//                              OR id_verification_status     (missing idv_status)
//
// Since 2026-10-01 identity gates NEITHER posting nor hiring (migration
// 20261001222911_remove_idv_requirement; guarded by
// src/test/identityNeverGatesPostOrAward.test.ts). What is left reading identity
// is display: the credential tier that draws the badge. That tier must still
// honour both verdicts, or a verified person shows as unverified.
//
// This test derives each predicate FROM THE MIGRATIONS rather than from a list
// written here, because a list of "places that check identity" maintained by
// hand is the exact shape that cannot fail for a missing member.
//
// Two rules that keep a discovery test honest, both learned the hard way:
//   * take the NEWEST migration that defines an object — migrations are
//     append-only, so a pinned path grades a body Postgres has already replaced;
//   * assert the discovery set is NON-EMPTY, because a discovery pass that finds
//     nothing passes for precisely the reason it exists to prevent.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no type declarations
import { stripSqlComments } from "../../scripts/check-migration-raise-codes.mjs";

const DIR = resolve(process.cwd(), "supabase/migrations");

/** Every migration, newest last — the order Postgres applies them in. */
const migrations = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(resolve(DIR, f), "utf8") }));

/**
 * The body of the LAST migration that defines `name`, or null — WITH EVERY SQL
 * COMMENT BLANKED.
 *
 * Comments ABOVE the definition were already excluded. Comments INSIDE it were
 * not, and that made this whole file satisfiable by prose. Measured 2026-09-21
 * on 20260908001056: replacing `p.idv_status` in
 * `helper_award_block_reason`'s SELECT INTO with `NULL::text` — so `v_idv` is
 * forever NULL, `v_idv IS DISTINCT FROM 'verified'` is forever true, and the
 * ten-of-thirteen unhirable defect this file exists to prevent is back — left
 * all ten assertions GREEN, because the comment two lines below still reads
 * "idv_status is the check a user can actually complete".
 *
 * `stripSqlComments` is a scanner, not a regex: `--` inside a single-quoted
 * literal is left alone, and blanking (rather than deleting) preserves offsets
 * so the ordering assertion below still compares real positions.
 */
function latestDefinitionOf(name: string): string | null {
  for (let i = migrations.length - 1; i >= 0; i--) {
    const sql = stripSqlComments(migrations[i].sql) as string;
    const re = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`,
      "i",
    );
    const m = re.exec(sql);
    if (!m) continue;
    // From the definition to the end of its body — the next CREATE FUNCTION,
    // or end of file.
    const from = sql.slice(m.index);
    const next = /\n(?:CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION)/i.exec(from.slice(1));
    return next ? from.slice(0, next.index + 1) : from;
  }
  return null;
}

describe("migration discovery is actually finding things", () => {
  it("has migrations to read at all", () => {
    expect(migrations.length).toBeGreaterThan(50);
  });
});

describe("every identity verdict honours both sources", () => {
  // `idv_status` is written by stripe-idv-webhook. A reader that ignores it
  // shows somebody who completed the check as unverified.
  const GATES = ["get_user_credential_tier"];

  it.each(GATES)("%s is defined in a migration", (fn) => {
    expect(latestDefinitionOf(fn)).not.toBeNull();
  });

  it.each(GATES)("%s reads idv_status", (fn) => {
    const def = latestDefinitionOf(fn)!;
    expect(def).toMatch(/idv_status/);
  });

  it.each(GATES)("%s still honours the Stripe Connect verdict too", (fn) => {
    // UNION, not replacement. One real profile carries stripe_identity_verified
    // WITHOUT idv_status='verified'; dropping this branch would trade ten
    // broken accounts for one.
    const def = latestDefinitionOf(fn)!;
    expect(def).toMatch(/stripe_identity_verified/);
  });
});

describe("the hiring gate still bites", () => {
  const def = latestDefinitionOf("helper_award_block_reason")!;

  it("keeps payout setup as its refusal", () => {
    expect(def).toContain("helper_payout_setup_incomplete");
  });
});

// Stop `get_user_credential_tier` reading `idv_status`: a person who completed
// Stripe Identity but carries no Connect flag drops a tier and loses the badge.
// The comment above the clause still says "idv_status", which is why the
// assertions read comment-stripped SQL.
// @mutate supabase/migrations/20260923130457_remove_bond_credential_type.sql | OR p.idv_status = 'verified') | OR NULL::text = 'verified')
