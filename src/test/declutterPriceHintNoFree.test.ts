/**
 * The fair-price hint ignores $0 free handovers (lead 2026-10-27, from the Q2430 auto-free review, #8).
 * A free item's paid-and-handed-over cart line is $0 (20261027170717), and day-12 auto-free makes many
 * more of them: counted, they dragged the hint's low end toward $0. Reads the NEWEST definition of
 * declutter_price_hint (effectiveDefs, any dollar-quote tag) and pins that only priced lines count.
 * Backend proof (RED before, GREEN after): src/test/pglite/declutterPriceHintNoFree.pglite.mjs.
 *
 * @mutate supabase/migrations/20261027213431_declutter_price_hint_ignores_free.sql |          AND c.price_cents > 0\n |
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));

describe("the fair-price hint ignores free handovers", () => {
  const def = DEFS.get("declutter_price_hint");
  const fn = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");

  it("reads the newest definition", () => {
    expect(fn.length).toBeGreaterThan(800);
    expect(def?.file).toBe("20261027213431_declutter_price_hint_ignores_free.sql");
  });

  it("only lines with a price are sales", () => {
    expect(fn).toContain("WHERE c.status = 'paid' AND c.price_cents > 0 AND o.status = 'handed_over'");
  });
});
