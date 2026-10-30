/**
 * OWN-FREE: "If it doesn't sell, make it free after __ days". The app's chips (AUTO_FREE_DAY_CHOICES) and the
 * server's two gates (the column CHECK declutter_item_private_auto_free_days_choice and declutter_set_auto_free_days'
 * invalid_choice test) are ONE list, so a chip the server refuses, or a day count the server takes that no chip
 * offers, fails here. Reads the NEWEST definitions (effectiveDefs, any dollar-quote tag; the CHECK from the newest
 * migration that names it). Behaviour proof: src/test/pglite/declutterAutoFreeDays.pglite.mjs.
 *
 * @mutate src/lib/declutter/autoFree.ts | export const AUTO_FREE_DAY_CHOICES = [7, 14, 21, 30] as const; | export const AUTO_FREE_DAY_CHOICES = [7, 12, 14, 21, 30] as const;
 * @mutate supabase/migrations/20261030030408_declutter_auto_free_days.sql |       CHECK (auto_free_days IS NULL OR auto_free_days IN (7, 14, 21, 30)); |       CHECK (auto_free_days IS NULL OR auto_free_days IN (7, 14, 21, 30, 60));
 * @mutate src/lib/declutter/autoFree.ts |   { value: "never", label: "Never" },\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { AUTO_FREE_DAY_CHOICES, AUTO_FREE_OPTIONS } from "@/lib/declutter/autoFree";

const MIG = join(resolve(__dirname, "..", ".."), "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const nums = (list: string) => list.split(",").map((n) => Number(n.trim())).sort((a, b) => a - b);

function newestCheck(): string {
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort().reverse();
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    const at = sql.lastIndexOf("declutter_item_private_auto_free_days_choice");
    if (at < 0) continue;
    const m = /CHECK\s*\(\s*auto_free_days IS NULL OR auto_free_days IN \(([^)]*)\)\s*\)/.exec(sql.slice(at));
    if (m) return m[1];
  }
  return "";
}

describe("make it free after __ days: one list of day counts (OWN-FREE)", () => {
  const app = [...AUTO_FREE_DAY_CHOICES].sort((a, b) => a - b);

  it("the inventory read something", () => {
    expect(app.length).toBeGreaterThan(2);
    expect(newestCheck().length).toBeGreaterThan(5);
  });

  it("the column CHECK takes exactly the app's day counts", () => {
    expect(nums(newestCheck())).toEqual(app);
  });

  it("declutter_set_auto_free_days takes exactly the app's day counts", () => {
    const set = blankSqlComments(DEFS.get("declutter_set_auto_free_days")?.stmt ?? "").replace(/\s+/g, " ");
    const m = /IF p_days IS NOT NULL AND p_days NOT IN \(([^)]*)\) THEN RAISE EXCEPTION 'invalid_choice'/.exec(set);
    expect(m).not.toBeNull();
    expect(nums(m![1])).toEqual(app);
  });

  it("the chips are Never first (the default for a new listing), then each day count", () => {
    expect(AUTO_FREE_OPTIONS.map((o) => o.label)).toEqual(["Never", ...app.map((d) => `${d} days`)]);
  });
});
