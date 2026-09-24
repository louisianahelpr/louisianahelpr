/**
 * S-006: platform_settings.feature_flags kept four keys nothing reads, so prod
 * config said subscriptions were off while they were sellable. A flag key must
 * have a reader; these four have none and a migration removes them. If one is
 * ever wired back up, take it out of DEAD and stop removing it.
 *
 * @mutate supabase/migrations/20260924051640_drop_dead_feature_flag_keys.sql | feature_flags - ARRAY['boosts_enabled', | feature_flags - ARRAY[
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DEAD = ["boosts_enabled", "referrals_enabled", "subscriptions_enabled", "ai_helpr_assistant"];
const MIGRATION = "supabase/migrations/20260924051640_drop_dead_feature_flag_keys.sql";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("dead feature-flag keys are removed, not left reading false (S-006)", () => {
  const removed = readFileSync(MIGRATION, "utf8").match(/feature_flags - ARRAY\[([^\]]*)\]/)?.[1] ?? "";
  const code = [...walk("src"), ...walk("supabase/functions")];
  it("the inventory is real", () => expect(code.length).toBeGreaterThan(500));
  for (const key of DEAD) {
    it(`${key}: nothing reads it, and the migration removes it`, () => {
      expect(code.filter((f) => readFileSync(f, "utf8").includes(key))).toEqual([]);
      expect(removed).toContain(`'${key}'`);
    });
  }
});
