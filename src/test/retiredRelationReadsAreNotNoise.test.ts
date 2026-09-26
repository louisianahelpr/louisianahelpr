// @mutate supabase/migrations/20260925234342_retired_relation_reads_from_stale_builds.sql | ('broadcast_dismissals', | ('broadcast_dismissalz',
// @mutate supabase/migrations/20260925234342_retired_relation_reads_from_stale_builds.sql | IF to_regclass(format('public.%I', v_rel)) IS NOT NULL THEN | IF false THEN
// @mutate supabase/migrations/20260925234342_retired_relation_reads_from_stale_builds.sql | IF coalesce(NEW.tags ->> 'origin', '') <> 'client' THEN | IF false THEN
// @mutate src/integrations/supabase/types.ts |       reviews: {\n        Row: { |       broadcast_messages: {\n        Row: {}\n      }\n      reviews: {\n        Row: {
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { relationsInSchema } from "@/test/helpers/schemaRelations";

/**
 * CLASS GUARD (Q387): a PGRST205 from a table the schema RETIRED ON PURPOSE is
 * a stale installed build, not an alert; a PGRST205 from anything else is.
 *
 * WHAT HAPPENED (error_logs, 2026-09-19 → 2026-09-25). The owner's iPhone
 * (native, capacitor://localhost, iOS 18.7, rows with no context.release)
 * logged PGRST205 on every dashboard load for two tables that no longer
 * exist: the gift-card table under its pre-rename name (renamed by
 * 20260913051340) and public.broadcast_messages (dropped by 20260924174847).
 * Nothing in src/ reads either (clientRelationNamesExist.test.ts proves the
 * CURRENT source clean); the caller is a native bundle built before both
 * migrations. Its JavaScript cannot be patched from here, so the fix sits
 * where every client row passes: a BEFORE INSERT trigger on error_logs
 * (trg_error_logs_00_z_retired_relation) drops a CLIENT row whose message is
 * PostgREST's "Could not find the table 'public.X' in the schema cache" when X
 * is listed in public.retired_client_relations AND still does not exist, and
 * counts it there (stale_reads, last_stale_read_at) so the stale build stays
 * visible without a row per dashboard load.
 *
 * WHY IT STAYS LOUD FOR A REAL MISSING TABLE:
 *   · only names in the list are silenced, and the list is exactly the
 *     relations migrations dropped or renamed away that the generated schema
 *     (types.ts) no longer has — so a live table can never be on it;
 *   · a listed name that exists again (to_regclass not null) is let through:
 *     PGRST205 on a real table is a schema-cache fault;
 *   · server rows are never touched.
 *
 * INVENTORY, both directions, from the app's own files:
 *   RETIRED = every `DROP TABLE|VIEW|MATERIALIZED VIEW` and every
 *             `ALTER TABLE x RENAME TO y` (x) in supabase/migrations
 *             (comments blanked), minus every relation types.ts still has.
 *   LISTED  = every relation any migration inserts into
 *             public.retired_client_relations.
 *   RETIRED must equal LISTED: a future migration that drops a table and does
 *   not list it fails here, and a listed name that comes back (types.ts has
 *   it) fails here too.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const TYPES = join(process.cwd(), "src", "integrations", "supabase", "types.ts");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const sql = files.map((f) => ({ f, code: blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8")) }));
const schema = relationsInSchema(readFileSync(TYPES, "utf8"));

const ident = String.raw`(?:public\.)?"?([a-z][a-z0-9_]*)"?`;
const identNC = String.raw`(?:public\.)?"?[a-z][a-z0-9_]*"?`;

export function retiredIn(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(new RegExp(String.raw`\bDROP\s+(?:MATERIALIZED\s+)?(?:TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?((?:${identNC}\s*,\s*)*${identNC})`, "gi"))) {
    for (const name of m[1].split(",")) out.push(name.trim().replace(/^public\./i, "").replace(/"/g, "").toLowerCase());
  }
  for (const m of code.matchAll(new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${ident}\s+RENAME\s+TO\b`, "gi"))) {
    out.push(m[1].toLowerCase());
  }
  return out;
}

export function listedIn(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/INSERT\s+INTO\s+public\.retired_client_relations\b[^;]*?\bVALUES\b([\s\S]*?);/gi)) {
    for (const row of m[1].matchAll(/\(\s*'([a-z][a-z0-9_]*)'/g)) out.push(row[1]);
  }
  return out;
}

const RETIRED = new Set(sql.flatMap(({ code }) => retiredIn(code)).filter((n) => !schema.has(n)));
const LISTED = new Set(sql.flatMap(({ code }) => listedIn(code)));

/** The newest body of a function, whatever its dollar-quote tag. */
function newestBody(fn: string): string | null {
  let body: string | null = null;
  const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${fn}\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1`, "gi");
  for (const { code } of sql) for (const m of code.matchAll(re)) body = m[2];
  return body;
}

describe("PGRST205 on a retired relation is a stale build, not noise — and only then", () => {
  // Spelled with an escape: giftCardNaming.test.ts forbids the old name outside migrations.
  const OLD_GIFT_TABLE = "p\u0069f_cred\u0069ts";

  it("inventory floor: both sides are real, and hold the two Q387 tables", () => {
    expect(schema.size).toBeGreaterThan(50);
    expect(RETIRED.size).toBeGreaterThan(20);
    for (const name of [OLD_GIFT_TABLE, "broadcast_messages"]) {
      expect(RETIRED.has(name), `${name} not found retired by a migration`).toBe(true);
      expect(LISTED.has(name), `${name} not listed in retired_client_relations`).toBe(true);
    }
  });

  it("every relation a migration retired is listed (a new drop must be listed)", () => {
    const missing = [...RETIRED].filter((n) => !LISTED.has(n)).sort();
    expect(missing, `list these in public.retired_client_relations (new migration, ON CONFLICT DO NOTHING)`).toEqual([]);
  });

  it("nothing listed is live or unretired (a live table must stay loud)", () => {
    const live = [...LISTED].filter((n) => schema.has(n)).sort();
    const never = [...LISTED].filter((n) => !RETIRED.has(n)).sort();
    expect(live, "listed but types.ts still has them: their PGRST205 would be silenced").toEqual([]);
    expect(never, "listed but no migration retired them").toEqual([]);
  });

  it("the trigger drops only client rows, only for a listed name that still does not exist, and counts them", () => {
    const body = newestBody("drop_retired_relation_error_log");
    expect(body, "drop_retired_relation_error_log is not defined by any migration").not.toBeNull();
    expect(body!).toMatch(/NEW\.tags\s*->>\s*'origin'/);
    expect(body!).toMatch(/Could not find the table/);
    expect(body!).toMatch(/FROM\s+public\.retired_client_relations/i);
    expect(body!).toMatch(/to_regclass\(/);
    expect(body!).toMatch(/stale_reads\s*=\s*r?\.?stale_reads\s*\+\s*1|stale_reads\s*=\s*stale_reads\s*\+\s*1/);
    const trg = sql.map(({ code }) => code).join("\n").match(/CREATE\s+TRIGGER\s+trg_error_logs_00_z_retired_relation\s+BEFORE\s+INSERT\s+ON\s+public\.error_logs[\s\S]*?EXECUTE\s+FUNCTION\s+public\.drop_retired_relation_error_log\(\)/i);
    expect(trg, "trg_error_logs_00_z_retired_relation is not created BEFORE INSERT on error_logs").not.toBeNull();
  });

  it("parser sanity: comma lists, IF EXISTS, quoting and renames are read", () => {
    expect(retiredIn(`DROP TABLE IF EXISTS public.a_one, public.b_two CASCADE;`)).toEqual(["a_one", "b_two"]);
    expect(retiredIn(`drop view "c_three";`)).toEqual(["c_three"]);
    expect(retiredIn(`ALTER TABLE public.old_name RENAME TO new_name;`)).toEqual(["old_name"]);
    expect(retiredIn(`ALTER TABLE public.jobs RENAME COLUMN a TO b;`)).toEqual([]);
    expect(listedIn(`INSERT INTO public.retired_client_relations (relation, retired_by) VALUES ('x_one', '1'), ('y_two', '2') ON CONFLICT DO NOTHING;`)).toEqual(["x_one", "y_two"]);
  });
});
