/**
 * Q730: effectiveDefs honours DROP FUNCTION.
 *
 * Before this, a function dropped by a later migration stayed in the replayed
 * set, so every guard built on effectiveDefs (41+ call sites) scanned code that
 * is not in the database, and groupCrewReminders.test.ts had to classify two
 * dropped parish-badge functions to stay green. On 2026-09-27 the replay's 428
 * surviving names all existed in prod pg_proc and its 56 dropped names were all
 * absent (read-only execute_sql).
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMigration, effectiveDefs, parseDrops, type FnDef } from "./helpers/effectiveFunctionDefs";

// @mutate src/test/helpers/effectiveFunctionDefs.ts | if (e.drop.argCount === null \|\| have === null \|\| have === e.drop.argCount) defs.delete(e.drop.name); | void have;
// @mutate src/test/helpers/effectiveFunctionDefs.ts | if (skip.some((r) => at >= r.index && at < r.end)) continue; | void skip;

const replay = (...files: string[]) => {
  const defs = new Map<string, FnDef>();
  files.forEach((sql, i) => applyMigration(defs, `m${i}.sql`, sql));
  return defs;
};

describe("effectiveDefs honours DROP FUNCTION (Q730)", () => {
  it("a later DROP removes an earlier CREATE; a CREATE after the DROP in one file stands", () => {
    const defs = replay(
      "CREATE OR REPLACE FUNCTION public.gone(a uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n" +
        "CREATE FUNCTION public.kept() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
      "DROP FUNCTION IF EXISTS public.gone(uuid) CASCADE;\n" +
        "DROP FUNCTION public.kept();\nCREATE FUNCTION public.kept() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;",
    );
    expect(defs.has("gone")).toBe(false);
    expect(defs.get("kept")?.file).toBe("m1.sql");
  });

  it("dropping an old overload after the replacement is created leaves the replacement", () => {
    const defs = replay(
      "CREATE FUNCTION public.ranked(a integer, b integer) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
      "CREATE OR REPLACE FUNCTION public.ranked(a integer, b integer, c boolean, OUT total int) LANGUAGE sql AS $$ SELECT 1 $$;\n" +
        "DROP FUNCTION IF EXISTS public.ranked(integer, integer);",
    );
    expect(defs.get("ranked")?.file).toBe("m1.sql");
    // A drop list naming several functions drops each.
    const multi = replay(
      "CREATE FUNCTION a() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; CREATE FUNCTION b(x text) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
      "DROP FUNCTION IF EXISTS public.a(), public.b(p_x text);",
    );
    expect([...multi.keys()]).toEqual([]);
  });

  it("a DROP FUNCTION inside a function body or a comment is not a migration-level drop", () => {
    const defs = replay(
      "CREATE FUNCTION public.target() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
      "-- DROP FUNCTION public.target();\n" +
        "CREATE FUNCTION public.runner() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN EXECUTE 'x'; DROP FUNCTION public.target(); END $body$;",
    );
    expect(defs.has("target")).toBe(true);
    expect(parseDrops("DROP FUNCTION IF EXISTS public.x(uuid), y;").map((d) => d.name)).toEqual(["x", "y"]);
  });

  it("the real replay: the parish-badge functions dropped by 20260915191403 are gone", () => {
    const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
    expect(defs.size).toBeGreaterThan(300);
    for (const fn of ["get_helper_parish_badges", "get_top_helpers_by_parish", "enforce_parish_limit"]) {
      expect(defs.has(fn), `${fn} was dropped and is not in prod`).toBe(false);
    }
    // Still-live functions survive their own old-overload drops.
    for (const fn of ["get_ranked_open_jobs", "accept_application", "export_my_data"]) {
      expect(defs.has(fn), `${fn} is live in prod`).toBe(true);
    }
  });
});
