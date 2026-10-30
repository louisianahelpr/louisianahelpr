/**
 * Declutter price drops are OPT-IN (owner 2026-10-28: "I would want them to stay that price the full time it's
 * listed"). The newest migration that sets declutter_items.drop_pct's default must set it to 0, and the sell form
 * must start with drops off.
 *
 * @mutate supabase/migrations/20261028185049_declutter_price_drops_opt_in.sql | ALTER COLUMN drop_pct SET DEFAULT 0; | ALTER COLUMN drop_pct SET DEFAULT 5;
 * @mutate src/components/declutter/sellForm.ts |   drops: false, |   drops: true,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const dir = join(process.cwd(), "supabase/migrations");

describe("Declutter price drops are opt-in", () => {
  it("the newest default for declutter_items.drop_pct is 0 (off)", () => {
    let last: string | null = null;
    const migrations = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
    // Floor (vacuity, nightly-red #2894): 1379 migrations on 2026-10-29.
    expect(migrations.length).toBeGreaterThan(1000);
    for (const f of migrations) {
      // declutter_seller_defaults.drop_pct (20261030144112) is the seller's saved choice, not this column's default.
      const sql = blankSqlComments(readFileSync(join(dir, f), "utf8")).replace(/CREATE TABLE[^;]*declutter_seller_defaults[^;]*;/gi, "");
      const re = /drop_pct\s+(?:smallint[^;]*?)?(?:SET\s+)?DEFAULT\s+(\d+)/gi;
      for (const m of sql.matchAll(re)) last = m[1];
    }
    expect(last).toBe("0");
  });

  it("the sell form starts with price drops off", () => {
    const form = readFileSync(join(process.cwd(), "src/components/declutter/sellForm.ts"), "utf8");
    const empty = /export const EMPTY: FormState = \{[\s\S]*?\n\};/.exec(form)?.[0] ?? "";
    expect(empty, "EMPTY found").not.toBe("");
    expect(empty).toMatch(/\bdrops:\s*false,/);
  });
});
