/**
 * Memberships RETIRED (owner 2026-11-04 8:33 AM: "no membership features
 * should be used anymore"; Builder 114). Every member gets the same standard
 * experience; no paid-tier branch is reachable anywhere.
 *
 * Built from inventory, exact both ways:
 *  1. the newest migration statement that sets the 'memberships' switch leaves
 *     it OFF;
 *  2. SQL: every newest function definition that reads subscription_tier
 *     either gates its perk on feature_enabled_for_user('memberships', ...)
 *     (unreachable while the switch is off) or is listed in NOT_A_PERK with
 *     why it decides nothing for a member;
 *  3. edge: every edge source that reads subscription_tier or imports
 *     tierPerks either gates on the memberships switch or is listed in
 *     EDGE_NOT_GATED with why no member gets a tier difference from it.
 * The fee resolver itself (no switch read) is proven in
 * src/test/membershipsRetiredFees.test.ts; the app hooks in
 * src/test/membershipsOffInNativeApp.test.ts.
 *
 * @mutate supabase/migrations/20261104143451_memberships_retired_off.sql |    SET audience = 'off', |    SET audience = 'testers',
 * @mutate supabase/migrations/20261021062609_memberships_off_paid_perks.sql |           AND public.feature_enabled_for_user('memberships', p_helper)) |           AND true)
 * @mutate supabase/functions/instant-payout/index.ts | const membershipsOn = await featureEnabledForUser(supabaseAdmin, "memberships", user); | const membershipsOn = true;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");

/** Functions that read subscription_tier but grant nothing by it. */
const NOT_A_PERK: Record<string, string> = {
  prevent_self_escalation: "refuses a member writing their own tier; protection, not a perk",
  profiles_locked_update_columns: "lists the columns a member may not write; protection, not a perk",
  get_safe_profiles: "returns the column (null for every member, measured 2026-11-04); no screen shows a tier (usePaidTierBadge is always null)",
  get_helper_analytics: "returns the tier as data; the advanced numbers are gated by helper_has_advanced_analytics, which reads the switch",
};

/** Edge sources that read the tier without the switch, and why no member gets a tier difference. */
const EDGE_NOT_GATED: Record<string, string> = {
  "supabase/functions/_shared/helperFees.ts": "feePercentForTier returns the standard rate for every tier (membershipsRetiredFees.test.ts)",
  "supabase/functions/money-reconciliation/index.ts": "prices its check with feePercentForTier: the standard rate",
  "supabase/functions/expire-subscriptions/index.ts": "only ends lapsed plans; grants nothing",
  "supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts": "records a Stripe plan purchase; create-pro-checkout refuses every checkout while the switch is off",
  "supabase/functions/stripe-webhook/handlers/customerSubscriptionDeleted.ts": "ends a Stripe plan; grants nothing",
  "supabase/functions/stripe-webhook/handlers/customerSubscriptionUpdated.ts": "mirrors a Stripe plan change; no checkout can start while the switch is off",
};

describe("memberships are retired: no paid-tier branch is reachable", () => {
  it("the newest migration statement that sets the memberships switch leaves it off", () => {
    const files = execFileSync("git", ["ls-files", "supabase/migrations"], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".sql")).sort();
    let last: { file: string; audience: string } | null = null;
    let seen = 0;
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(join(ROOT, f), "utf8"));
      const re = /INSERT\s+INTO\s+public\.feature_switches[^;]*?VALUES\s*\(\s*'memberships'\s*,\s*'(\w+)'[^;]*;|UPDATE\s+public\.feature_switches\s+SET\s+audience\s*=\s*'(\w+)'(?:(?!UPDATE\s)[\s\S])*?WHERE\s+key\s*=\s*'memberships'/gi;
      for (const m of sql.matchAll(re)) { last = { file: f, audience: (m[1] ?? m[2]).toLowerCase() }; seen++; }
    }
    expect(seen).toBeGreaterThan(1);
    expect(last?.audience, last?.file).toBe("off");
  });

  it("every SQL function that reads subscription_tier gates on the switch or grants nothing (exact both ways)", () => {
    const defs = latestFunctionDefs(MIG);
    const readers = [...defs].filter(([, d]) => /\bsubscription_tier\b/.test(d.body));
    expect(readers.length).toBeGreaterThan(6);
    const ungated = readers
      .filter(([, d]) => !/feature_enabled_for_user\(\s*'memberships'/.test(d.body))
      .map(([n]) => n)
      .sort();
    expect(ungated).toEqual(Object.keys(NOT_A_PERK).sort());
  });

  it("every edge source that reads a tier gates on the switch or gives no tier difference (exact both ways)", () => {
    const files = execFileSync("git", ["ls-files", "supabase/functions"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const readers = files.filter((f) => /subscription_tier|tierPerks\.ts/.test(blankComments(readFileSync(join(ROOT, f), "utf8"))));
    expect(readers.length).toBeGreaterThan(12);
    const GATE = /featureEnabledForUser\([^)]*"memberships"|requireFeature\([^)]*"memberships"|membershipsSwitchFor\(/;
    const ungated = readers.filter((f) => !GATE.test(blankComments(readFileSync(join(ROOT, f), "utf8")))).sort();
    expect(ungated).toEqual(Object.keys(EDGE_NOT_GATED).sort());
  });
});
