/*
 * Q246 — docs/audit/launch-2026-09/PROTOCOL.md §6d told lanes `pet_report_cards`
 * and `care_relationships` were "live" pet-profile tables to leave alone.
 * Both are gone: `care_relationships` was dropped by owner decision
 * (20260829083842_drop_family_care.sql) and `pet_report_cards` was dropped as a
 * proven-dead object (20260913053041_drop_proven_dead_objects.sql). A lane
 * trusting the stale line would have skipped auditing two rows in the Removed
 * Features table that had already turned into real removal findings.
 *
 * `tableExistenceAfterMigrations` is the reusable two-way primitive (any table
 * name against the real migration history, newest-wins); the two `it`s below
 * pin it to this specific doc claim so a revert of the wording — or a migration
 * that recreates one of these tables without the doc catching up — goes red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");
const PROTOCOL = join(REPO, "docs", "audit", "launch-2026-09", "PROTOCOL.md");

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi;
const DROP_TABLE = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi;

/** table name -> true (exists) / false (dropped), replaying every migration in filename order. */
export function tableExistenceAfterMigrations(files: { name: string; sql: string }[]): Map<string, boolean> {
  const state = new Map<string, boolean>();
  for (const { sql } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const m of sql.matchAll(CREATE_TABLE)) state.set(m[1].toLowerCase(), true);
    for (const m of sql.matchAll(DROP_TABLE)) state.set(m[1].toLowerCase(), false);
  }
  return state;
}

describe("tableExistenceAfterMigrations (fixtures)", () => {
  it("is false after a DROP with no later CREATE", () => {
    const state = tableExistenceAfterMigrations([
      { name: "1_create.sql", sql: "CREATE TABLE IF NOT EXISTS public.foo (id uuid);" },
      { name: "2_drop.sql", sql: "DROP TABLE IF EXISTS public.foo;" },
    ]);
    expect(state.get("foo")).toBe(false);
  });

  it("is true when a later migration recreates the dropped table", () => {
    const state = tableExistenceAfterMigrations([
      { name: "1_create.sql", sql: "CREATE TABLE public.foo (id uuid);" },
      { name: "2_drop.sql", sql: "DROP TABLE public.foo;" },
      { name: "3_recreate.sql", sql: "CREATE TABLE public.foo (id uuid);" },
    ]);
    expect(state.get("foo")).toBe(true);
  });
});

describe("PROTOCOL.md §6d never claims a dropped pet/care table is still live (Q246)", () => {
  const protocolMd = readFileSync(PROTOCOL, "utf8");
  const migrationFiles = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));
  const state = tableExistenceAfterMigrations(migrationFiles);

  it("ground truth: both are actually dropped on the migration timeline", () => {
    expect(state.get("care_relationships")).toBe(false);
    expect(state.get("pet_report_cards")).toBe(false);
  });

  it("the Pet evacuation row's live-tables clause names only tables that are actually live", () => {
    const clause = protocolMd.match(/\*\*Pet profiles stay\*\*\s*—\s*([^.]+)\./);
    expect(clause, "PROTOCOL.md's 'Pet profiles stay' clause was not found — did the row's wording change?").not.toBeNull();
    const idsClaimedLive = [...(clause as RegExpMatchArray)[1].matchAll(/`(\w+)`/g)].map((m) => m[1].toLowerCase());
    expect(idsClaimedLive.length).toBeGreaterThan(0);
    const staleClaims = idsClaimedLive.filter((id) => state.get(id) === false);
    expect(staleClaims, `PROTOCOL.md claims these dropped tables are live: ${staleClaims.join(", ")}`).toEqual([]);
  });

  it("the Family & Care dashboard row correctly labels care_relationships as dropped", () => {
    const row = protocolMd.match(/\*\*Family & Care dashboard\*\*[^\n]*/);
    expect(row, "PROTOCOL.md's Family & Care dashboard row is missing").not.toBeNull();
    const text = (row as RegExpMatchArray)[0];
    expect(text).toContain("`care_relationships`");
    expect(text).toMatch(/dropped/i);
  });
});
