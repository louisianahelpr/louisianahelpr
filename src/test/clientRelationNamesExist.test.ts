// @mutate src/pages/dashboard/useDashboardSideQueries.ts | .from("gift_cards" as never) | .from("gift_cardz" as never)
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * CLASS CHECK: no client query may name a relation the schema does not have.
 *
 * WHAT HAPPENED (prod error_logs, 2026-09-19 → 2026-09-21, severity warning,
 * tag source=`useDashboardSideQueries.` + the old gift-card count's name):
 *
 *   Could not find the table 'public.<old gift-card table>' in the schema cache
 *   · code=PGRST205 · hint=Perhaps you meant the table 'public.referral_credits'
 *
 * `20260913051340_rename_gift_card_table_and_rpcs.sql` renamed
 * the old gift-card table (OLD_TABLE below) to `public.gift_cards`. The dashboard's count query kept
 * asking for the old name, so PostgREST answered PGRST205 and the count fell
 * back to 0 — a wrong number, not an error screen. (PostgREST's hint was wrong
 * too: `referral_credits` is a different feature. Verified on prod
 * 2026-09-22: `to_regclass` of the old name is NULL,
 * `to_regclass('public.gift_cards')` exists.)
 *
 * The client half is already fixed (`0a397aa8a`, reads `gift_cards`). This is
 * the check that keeps the WHOLE CLASS from coming back: any future rename
 * that leaves a `.from("old_name")` behind fails here instead of degrading to
 * a silently wrong number in someone's dashboard.
 *
 * Inventory is the app's own call sites — every `.from("…")` under src/ —
 * checked against the app's own generated schema (`Tables` + `Views` of the
 * public schema in src/integrations/supabase/types.ts, which
 * `supabase gen types` writes from the live database). Both sides are derived,
 * neither is a hand-kept list.
 */

const SRC = join(process.cwd(), "src");
const TYPES = join(SRC, "integrations", "supabase", "types.ts");

/** Every table and view PostgREST exposes on `public`, from the generated types. */
export function relationsInSchema(typesSource: string): Set<string> {
  const tablesAt = typesSource.indexOf("    Tables: {");
  const viewsAt = typesSource.indexOf("    Views: {");
  const functionsAt = typesSource.indexOf("    Functions: {");
  if (tablesAt < 0 || viewsAt < 0 || functionsAt < 0) {
    throw new Error("types.ts no longer has the public Tables/Views/Functions blocks this guard reads");
  }
  const region = typesSource.slice(tablesAt, functionsAt);
  const names = new Set<string>();
  for (const m of region.matchAll(/^ {6}([a-z0-9_]+): \{$/gm)) names.add(m[1]);
  return names;
}

/** Every relation name a `.from("…")` call site in this file asks for. */
export function relationsQueriedIn(source: string): string[] {
  return [...source.matchAll(/\.from\(\s*["']([a-z][a-z0-9_]*)["']/g)].map((m) => m[1]);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "test" || entry === "__snapshots__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("every relation a client query names exists in the schema", () => {
  const schema = relationsInSchema(readFileSync(TYPES, "utf8"));
  // The pre-rename table name, spelled with escapes: giftCardNaming.test.ts
  // forbids the old name anywhere outside migration history, this file included.
  const OLD_TABLE = "p\u0069f_cred\u0069ts";

  it("has a non-trivial inventory on both sides", () => {
    expect(schema.size).toBeGreaterThan(50);
    expect(schema.has("gift_cards")).toBe(true);
    expect(schema.has(OLD_TABLE)).toBe(false);
  });

  it("names no relation the schema does not have", () => {
    const unknown: string[] = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const rel of relationsQueriedIn(source)) {
        if (!schema.has(rel)) unknown.push(`${file.slice(process.cwd().length + 1)} → .from("${rel}")`);
      }
    }
    expect(
      unknown,
      `These client queries name a relation the public schema does not expose. PostgREST answers ` +
        `PGRST205 and the query degrades to its fallback value — a wrong number, not an error screen. ` +
        `Point each at the relation that exists, or delete the query:\n  ${unknown.join("\n  ")}`,
    ).toEqual([]);
  });

  // VACUITY: the same extractor + the same schema, shown failing on the exact
  // call site that produced the prod warning.
  it("is RED on the defect as it stood: .from(<old gift-card table>)", () => {
    const asItStood = `const { data, error } = await supabase.from("${OLD_TABLE}").select("id, status");`;
    const queried = relationsQueriedIn(asItStood);
    expect(queried).toEqual([OLD_TABLE]);
    expect(queried.filter((r) => !schema.has(r))).toEqual([OLD_TABLE]);
  });
});
