import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { TIER_PERKS, type SubscriptionTier } from "@/lib/subscriptionTiers";

/**
 * The SQL gate and the perk table must name the same tiers.
 *
 * `helper_has_advanced_analytics()` hard-codes the entitled tier list, because
 * Postgres cannot import a TypeScript object. That is a duplicated fact, and
 * duplicated facts in this repo drift: the fee ladder needed
 * `src/lib/helperFees.parity.test.ts` for exactly this reason, and the tier
 * DISPLAY names needed `src/lib/tierNames.parity.test.ts` for the same one.
 *
 * The failure this guards against is silent and expensive in both directions:
 *
 *   - Perk table says a tier gets Advanced Analytics, SQL disagrees → someone
 *     pays for a page that answers `entitled:false`. That is the bug this
 *     whole feature exists to fix, reintroduced from the other end.
 *   - SQL says a tier gets it, perk table disagrees → the perk is given away,
 *     and no pricing surface mentions it.
 *
 * Static parse, no database: it costs milliseconds and fails in CI long before
 * a deploy could.
 */

const repoRoot = resolve(__dirname, "../..");
const MIGRATIONS = resolve(repoRoot, "supabase/migrations");

/** The migration that owns the gate — found by name so a rename fails loudly. */
function gateMigrationSource(): string {
  const file = readdirSync(MIGRATIONS).find((f) =>
    f.endsWith("_helper_advanced_analytics.sql"),
  );
  expect(
    file,
    "No *_helper_advanced_analytics.sql in supabase/migrations. If the gate moved, point this test at its new home rather than deleting it.",
  ).toBeTruthy();
  return readFileSync(resolve(MIGRATIONS, file!), "utf8");
}

/** Tiers listed in `subscription_tier IN (…)` inside helper_has_advanced_analytics. */
function tiersInSql(sql: string): string[] {
  const fn = /CREATE FUNCTION public\.helper_has_advanced_analytics[\s\S]*?\$function\$([\s\S]*?)\$function\$/.exec(sql);
  expect(fn, "helper_has_advanced_analytics(uuid) not found in the migration").toBeTruthy();
  const list = /subscription_tier\s+IN\s*\(([^)]*)\)/i.exec(fn![1]);
  expect(list, "No `subscription_tier IN (…)` list inside helper_has_advanced_analytics").toBeTruthy();
  return [...list![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe("Advanced Analytics entitlement: SQL ↔ TIER_PERKS", () => {
  it("the SQL tier list is exactly the set with advancedAnalytics: true", () => {
    const fromPerks = (Object.keys(TIER_PERKS) as SubscriptionTier[])
      .filter((t) => TIER_PERKS[t].advancedAnalytics)
      .sort();

    expect(fromPerks.length, "No tier grants advancedAnalytics — did a perk row get dropped?")
      .toBeGreaterThan(0);
    expect(tiersInSql(gateMigrationSource())).toEqual(fromPerks);
  });

  it("every tier the SQL names is a real tier in TIER_PERKS", () => {
    // Catches a typo ('proo') that would silently deny everyone, since the
    // comparison above would then fail on both sides at once and be harder to
    // read than this.
    for (const tier of tiersInSql(gateMigrationSource())) {
      expect(Object.keys(TIER_PERKS)).toContain(tier);
    }
  });

  it("the free tier's fee percent matches the rate the page quotes", () => {
    // FREE_TIER_FEE_PERCENT drives the "your plan saved you $X" line. If the
    // Free commission ever changes, the comparison must move with it or the
    // page will overstate (or understate) the value of the subscription.
    // Imported lazily so this file's other assertions still run if the module
    // graph changes shape.
    return import("@/lib/helperAnalytics").then(({ FREE_TIER_FEE_PERCENT }) => {
      expect(FREE_TIER_FEE_PERCENT).toBe(TIER_PERKS.free.platformFeePercent);
    });
  });
});
