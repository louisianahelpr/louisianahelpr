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

const DIR = resolve(process.cwd(), "supabase/migrations");

/** Every migration, newest last — the order Postgres applies them in. */
const migrations = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(resolve(DIR, f), "utf8") }));

/** The body of the LAST migration that defines `name`, or null. */
function latestDefinitionOf(name: string): string | null {
  for (let i = migrations.length - 1; i >= 0; i--) {
    const { sql } = migrations[i];
    const re = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`,
      "i",
    );
    const m = re.exec(sql);
    if (!m) continue;
    // From the definition to the end of its body — the next CREATE FUNCTION,
    // or end of file. Comments above it are excluded so a historical note
    // quoting the OLD predicate cannot satisfy the assertion.
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

describe("every identity gate honours the check a user can complete", () => {
  // `idv_status` is written by stripe-idv-webhook and is the ONLY one of the
  // four columns a user can move by doing something in the app. Any gate that
  // ignores it can refuse somebody who did everything asked of them.
  const GATES = ["helper_award_block_reason", "get_user_credential_tier"];

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

  it("keeps payout setup as a separate, earlier refusal", () => {
    expect(def).toContain("helper_payout_setup_incomplete");
    expect(def.indexOf("helper_payout_setup_incomplete"))
      .toBeLessThan(def.indexOf("helper_identity_unverified"));
  });

  it("has no operator kill switch left", () => {
    // Owner decision 2026-09-07: identity verification is always required, and
    // the `idv_requirement_paused` flag that could lift it was deleted in
    // migration 20260908001056. This asserts the LATEST definition carries no
    // escape hatch — a re-introduced pause would fail here.
    expect(def).not.toContain("idv_requirement_paused");
    expect(def).not.toContain("feature_flags");
  });

  it("requires the literal 'verified', not merely a non-null idv_status", () => {
    // `idv_status IS NOT NULL` would let 'processing' and 'requires_input'
    // through — the states a user sits in mid-check.
    expect(def).toMatch(/v_idv\s+IS\s+DISTINCT\s+FROM\s+'verified'/i);
  });
});
