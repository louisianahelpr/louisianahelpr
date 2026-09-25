/**
 * Q406: an `@mutate` that edits a migration edits the definition the database
 * RUNS, not a copy a later migration replaced.
 *
 * Guards read the newest definition of a SQL function (guardsReadTheNewestMigration
 * holds them to that). A registration that breaks an OLDER migration's copy is
 * therefore invisible to its own guard: the guard stays green, the vacuity run
 * scores it "survived" at best, and at worst the line sits in the file looking
 * like proof. jobCancelClosesPendingApplications was this on 2026-09-25, and
 * guardsReadTheNewestMigration could not see it because it blanks comments,
 * which is where every @mutate lives.
 *
 * This reads every @mutate in every test (scripts/vacuity/lib.mjs, the same
 * parser the vacuity run uses) and, for each one aimed at
 * supabase/migrations/*.sql, finds the function, view or trigger its find
 * string sits in. It fails when a later migration redefines that object, or
 * when a pg_get_functiondef + regexp_replace migration has since rewritten the
 * text it finds (effectiveDefs() replays both). Measured 2026-09-25: 24 of 309
 * migration-targeting registrations were stale; 23 were re-pointed at the
 * newest definition and each shown red there, and consequenceCopyParity was
 * moved off its superseded pin so its re-pointed line goes red too.
 *
 * @mutate src/test/bannedBlockerKeepsBlock.test.ts | supabase/migrations/20260924220318_rename_tab_addresses.sql | supabase/migrations/20260923232809_banned_blocker_keeps_block.sql
 * @mutate src/test/helpers/supersededMutateTargets.ts | if (eff.file !== file \|\| eff.index !== inside.start) { | if (eff.file !== file) {
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { guardFiles, parseDirectives, untrackedGuardFiles } from "../../scripts/vacuity/lib.mjs";
import { blankComments } from "./helpers/blankNonCode";
import { gradeMutateTargets, MIGRATION_TARGET, type MutateTarget } from "./helpers/supersededMutateTargets";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");

/**
 * Registrations that DELIBERATELY break a superseded copy, because their guard
 * reads that exact migration by name to grade it (a restatement check compares
 * one migration's body with the one before it). Keyed `guard | target | find`.
 * Each entry must still be flagged, and its guard must name the target file in
 * code (not a comment), or this fails.
 *
 * routeProbeCloseRule's "restated from the NEWEST prior body" test reads
 * Q94_FILE's ops_alert_condition by name; this mutation of another branch of
 * that body turns it red (measured 2026-09-25), and the same mutation on the
 * newest body is seedNeverNotifiesReal's to catch, not this guard's.
 */
// @two-way src/test/mutateTargetsTheNewestDefinition.test.ts:"these no longer target a superseded definition
const EXEMPT_HISTORICAL_TARGETS: readonly string[] = [
  "src/test/routeProbeCloseRule.test.ts | supabase/migrations/20260923182022_ops_route_probe_close_rule.sql | ELSIF p_source = 'seed-boundary-check-failed' THEN",
];

const keyOf = (m: MutateTarget) => `${m.guard} | ${m.target} | ${m.find}`;

function realMigrationTargets(): MutateTarget[] {
  const files = [...new Set([...guardFiles(), ...untrackedGuardFiles()])];
  return files.flatMap((g) => parseDirectives(g).mutations).filter((m) => MIGRATION_TARGET.test(m.target));
}

describe("the detector (fixture tree, never real files)", () => {
  const dir = mkdtempSync(join(tmpdir(), "q406-"));
  const mig = join(dir, "supabase", "migrations");
  mkdirSync(mig, { recursive: true });
  writeFileSync(
    join(mig, "20990101000000_first.sql"),
    [
      "CREATE OR REPLACE FUNCTION public.f_redefined() RETURNS void LANGUAGE plpgsql AS $fn$",
      "BEGIN IF old_rule THEN RETURN; END IF; END $fn$;",
      "CREATE OR REPLACE FUNCTION public.g_rewritten() RETURNS text LANGUAGE sql AS $$ SELECT 'keep_me' || 'rewrite_me' $$;",
      "CREATE OR REPLACE FUNCTION public.h_twice() RETURNS int LANGUAGE sql AS $body$ SELECT 1 /* first_h */ $body$;",
      "CREATE OR REPLACE FUNCTION public.h_twice() RETURNS int LANGUAGE sql AS $body$ SELECT 2 /* second_h */ $body$;",
      "CREATE OR REPLACE VIEW public.v_redefined AS SELECT 1 AS old_col;",
      "CREATE TRIGGER t_redefined BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.old_trigger_fn();",
      "CREATE OR REPLACE FUNCTION public.k_untouched() RETURNS int LANGUAGE sql AS $$ SELECT 42 $$;",
      "GRANT EXECUTE ON FUNCTION public.k_untouched() TO service_role;",
    ].join("\n"),
  );
  writeFileSync(
    join(mig, "20990102000000_second.sql"),
    [
      "-- CREATE OR REPLACE FUNCTION public.k_untouched() is only cited here, in a comment.",
      "CREATE OR REPLACE FUNCTION public.f_redefined() RETURNS void LANGUAGE plpgsql AS $fn$",
      "BEGIN IF new_rule THEN RETURN; END IF; END $fn$;",
      "CREATE OR REPLACE VIEW public.v_redefined AS SELECT 2 AS new_col;",
      "DROP TRIGGER IF EXISTS t_redefined ON public.jobs;",
      "CREATE TRIGGER t_redefined BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.new_trigger_fn();",
    ].join("\n"),
  );
  writeFileSync(
    join(mig, "20990103000000_rewrite.sql"),
    [
      "DO $do$ DECLARE r record; BEGIN",
      "  FOR r IN SELECT * FROM (VALUES (1, 'g_rewritten', $p$rewrite_me$p$, $q$rewritten$q$, 'g')) AS t(ord, fn, pat, rep, flags) LOOP",
      "    EXECUTE regexp_replace(pg_get_functiondef(('public.' || r.fn)::regproc), r.pat, r.rep, r.flags);",
      "  END LOOP;",
      "END $do$;",
    ].join("\n"),
  );

  const at = (file: string, find: string, line = 1): MutateTarget => ({
    guard: "fixture.test.ts",
    line,
    target: `supabase/migrations/${file}`,
    find,
  });
  const FIRST = "20990101000000_first.sql";
  const SECOND = "20990102000000_second.sql";
  const graded = gradeMutateTargets(mig, [
    at(FIRST, "IF old_rule THEN", 1),
    at(FIRST, "'rewrite_me'", 2),
    at(FIRST, "'keep_me'", 3),
    at(FIRST, "first_h", 4),
    at(FIRST, "second_h", 5),
    at(FIRST, "1 AS old_col", 6),
    at(FIRST, "public.old_trigger_fn()", 7),
    at(FIRST, "SELECT 42", 8),
    at(FIRST, "TO service_role", 9),
    at(SECOND, "IF new_rule THEN", 10),
    at(SECOND, "2 AS new_col", 11),
    at(SECOND, "public.new_trigger_fn()", 12),
  ]);
  rmSync(dir, { recursive: true, force: true });
  const flagged = new Map(graded.superseded.map((s) => [s.line, s]));

  it("flags a find string inside a function, view or trigger a LATER migration redefines", () => {
    expect(flagged.get(1)?.now).toBe(SECOND);
    expect(flagged.get(6)?.object).toBe("view v_redefined");
    expect(flagged.get(7)?.object).toBe("trigger t_redefined@jobs");
  });

  it("flags text a pg_get_functiondef + regexp_replace rewrite replaced, not text it left alone", () => {
    expect(flagged.get(2)?.now).toMatch(/rewritten by 20990103000000_rewrite\.sql#1/);
    expect(flagged.has(3)).toBe(false);
  });

  it("flags the first of two definitions in ONE migration, not the second", () => {
    expect(flagged.has(4)).toBe(true);
    expect(flagged.has(5)).toBe(false);
  });

  it("does not flag the newest definition, a comment citation, or text outside every definition", () => {
    for (const line of [8, 9, 10, 11, 12]) expect(flagged.has(line), `line ${line}`).toBe(false);
    expect([...flagged.keys()].sort((a, b) => a - b)).toEqual([1, 2, 4, 6, 7]);
    // 11 of the 12 sit inside a definition; the GRANT does not.
    expect(graded.inside).toBe(11);
  });
});

describe("every @mutate on a migration breaks the definition the database runs", () => {
  const targets = realMigrationTargets();
  const { inside, superseded } = gradeMutateTargets(MIGRATIONS, targets);
  const exempt = new Set(EXEMPT_HISTORICAL_TARGETS);

  it("reads a real inventory (floor)", () => {
    expect(targets.length, "almost no @mutate targets a migration — the directive scan is broken").toBeGreaterThan(250);
    expect(inside, "almost no find string sits inside a parsed definition — the span parser is broken").toBeGreaterThan(200);
  });

  it("no registration targets a superseded copy", () => {
    expect(
      superseded
        .filter((s) => !exempt.has(keyOf(s)))
        .map((s) => `${s.guard}:${s.line} breaks ${s.object} in ${s.target}, but the database runs ${s.now}`),
      "the guard reads the newest definition, so breaking this copy proves nothing. Point the @mutate at " +
        "the migration named after 'runs' (same find string, made unique there), then show the guard goes red.",
    ).toEqual([]);
  });

  it("the historical exemptions are exact, and each guard reads that migration by name", () => {
    const live = new Set(superseded.map(keyOf));
    expect(
      EXEMPT_HISTORICAL_TARGETS.filter((k) => !live.has(k)),
      "these no longer target a superseded definition (or no longer exist) — remove them",
    ).toEqual([]);
    for (const k of EXEMPT_HISTORICAL_TARGETS) {
      const [guard, target] = k.split(" | ");
      const file = target.split("/").pop()!;
      expect(blankComments(readFileSync(join(REPO, guard), "utf8")), `${guard} does not read ${file} by name`).toContain(file);
    }
  });
});
