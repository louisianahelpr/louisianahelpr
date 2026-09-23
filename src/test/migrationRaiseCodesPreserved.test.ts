/**
 * A migration that redefines a function keeps every guard (RAISE code) the
 * newest earlier definition had, unless scripts/migration-raise-codes-allowlist.json
 * says why not. Inventory: the migrations themselves. See
 * scripts/check-migration-raise-codes.mjs for the incident this closes
 * (open_dispute_as losing `job_already_completed`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error — plain .mjs script, no type declarations
import * as check from "../../scripts/check-migration-raise-codes.mjs";

const MIG = "supabase/migrations";

describe("migrations keep the guards of the functions they redefine", () => {
  it("parses function bodies and terse RAISE codes (prose messages are not codes)", () => {
    const defs = check.functionDefinitions(`
      CREATE OR REPLACE FUNCTION public.f(a uuid) RETURNS void LANGUAGE plpgsql AS $function$
      BEGIN RAISE EXCEPTION 'job_already_completed'; RAISE EXCEPTION 'dispute already %', x; END; $function$;
      CREATE OR REPLACE FUNCTION g() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`);
    expect(defs.map((d: { name: string }) => d.name)).toEqual(["public.f", "public.g"]);
    expect([...check.raiseCodes(defs[0].body)]).toEqual(["job_already_completed"]);
  });

  it("is RED on the dispute-settlement migration as it stood before the re-derive", () => {
    const guard = readFileSync(path.join(MIG, "20260915025607_block_disputes_on_completed_jobs.sql"), "utf8");
    const prefix = readFileSync("src/test/fixtures/migrationRaiseCodes/open_dispute_as.prefix.sql.txt", "utf8");
    const files: Record<string, string> = {
      "20260915025607_block_disputes_on_completed_jobs.sql": guard,
      "20260915034822_dispute_settlement_claim_and_race_locks.sql": prefix,
    };
    const dropped = check.droppedCodes({ files: Object.keys(files), readFile: (f: string) => files[f], allowlist: [] });
    expect(dropped).toEqual([
      expect.objectContaining({ function: "public.open_dispute_as", code: "job_already_completed" }),
    ]);
  });

  it("an allowlist entry with a reason lets a deliberate drop through", () => {
    const files: Record<string, string> = {
      "20260915000000_a.sql": "CREATE OR REPLACE FUNCTION public.h() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'old_guard'; END $f$;",
      "20260915040000_b.sql": "CREATE OR REPLACE FUNCTION public.h() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN NULL; END $f$;",
    };
    const readFile = (f: string) => files[f];
    expect(check.droppedCodes({ files: Object.keys(files), readFile, allowlist: [] })).toHaveLength(1);
    const allowlist = [{ migration: "20260915040000_b.sql", function: "public.h", code: "old_guard", reason: "guard moved to a trigger" }];
    expect(check.droppedCodes({ files: Object.keys(files), readFile, allowlist })).toHaveLength(0);
  });

  it("every allowlist entry carries a reason", () => {
    for (const a of check.loadAllowlist()) expect(String(a.reason ?? "").length).toBeGreaterThan(10);
  });

  it("a commented-out RAISE does not stand in for the live one", () => {
    // The hollow shape this guard had until 2026-09-20: measured on
    // 20260919195158, replacing the live `RAISE EXCEPTION 'job_not_found'` with
    // `NULL; -- RAISE EXCEPTION 'job_not_found' …` deleted the guard and left
    // all 5 tests here GREEN. Comments are blanked before anything is read.
    const files: Record<string, string> = {
      "20260915000000_a.sql": "CREATE OR REPLACE FUNCTION public.k() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'live_guard'; END $f$;",
      "20260915040000_b.sql": "CREATE OR REPLACE FUNCTION public.k() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN\n  NULL; -- RAISE EXCEPTION 'live_guard';\nEND $f$;",
    };
    expect(
      check.droppedCodes({ files: Object.keys(files), readFile: (f: string) => files[f], allowlist: [] }),
    ).toEqual([expect.objectContaining({ function: "public.k", code: "live_guard" })]);
    // …and a `--` inside a quoted literal is not a comment.
    expect([...check.raiseCodes(check.stripSqlComments("RAISE EXCEPTION 'a_b' USING HINT = 'x -- y';"))]).toEqual(["a_b"]);
  });

  it("the allowlist has no stale entry (an entry that no longer excuses a real drop must go)", () => {
    // Shown able to fail on a synthetic pair: the same entry is live while
    // the drop exists, and stale once the later migration keeps the code.
    const dropping: Record<string, string> = {
      "20260915000000_a.sql": "CREATE OR REPLACE FUNCTION public.h() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'old_guard'; END $f$;",
      "20260915040000_b.sql": "CREATE OR REPLACE FUNCTION public.h() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN NULL; END $f$;",
    };
    const keeping: Record<string, string> = { ...dropping, "20260915040000_b.sql": dropping["20260915000000_a.sql"] };
    const allowlist = [{ migration: "20260915040000_b.sql", function: "public.h", code: "old_guard", reason: "x" }];
    expect(check.staleAllowlistEntries({ files: Object.keys(dropping), readFile: (f: string) => dropping[f], allowlist })).toEqual([]);
    expect(check.staleAllowlistEntries({ files: Object.keys(keeping), readFile: (f: string) => keeping[f], allowlist })).toEqual([
      "20260915040000_b.sql|public.h|old_guard",
    ]);
    const stale: string[] = check.staleAllowlistEntries();
    expect(
      stale,
      stale.map((k) => `stale baseline entry ${k} — remove it (lower the baseline)`).join("\n"),
    ).toEqual([]);
  });

  it("the live migrations drop no guard", () => {
    expect(check.droppedCodes()).toEqual([]);
  });
});

// Deleting a live guard from the newest definition of a function must be seen.
// @mutate supabase/migrations/20260919195158_before_photo_gates_working_step.sql | RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002'; | NULL; -- RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
