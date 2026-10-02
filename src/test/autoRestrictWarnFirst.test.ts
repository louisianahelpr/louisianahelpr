/**
 * Q183 (docs/OPEN.md): auto_restrict_repeat_violators is warn-first.
 *
 * Before (live pg_get_functiondef, 2026-09-26) it counted every violation the
 * user ever had (COUNT(*), no type filter, no time window), so an old
 * off_platform warning plus one later low_ratings row suspended an account for
 * 7 days with no human review. The newest definition must count only its own
 * types, only in the last 7 days. Behaviour is proven in
 * src/test/pglite/autoRestrictWarnFirst.pglite.mjs (6 FAIL on the old body,
 * ALL PASS on the new one, migration applied 3x). This file pins the shape of
 * the NEWEST definition, so a later restatement that drops a clause fails.
 *
 * Q745: each suspension UPDATE must read its row count and send no notice when
 * it changed nothing (no profile row). PGlite case 7 in the same proof is red
 * on 20260927043454 (Q745=skip: 2 notices sent, 0 defects) and green after.
 *
 * Q820: the first-trip "Final warning" branch must send nothing when there is
 * no profile row (FOUND after the profile SELECT) and must check that its
 * final_warning UPDATE changed a row. PGlite case 8 is red on 20260927222831
 * (Q820=skip: 1 sent, 0 defects) and green after.
 *
 * Q834: the violation_count >= 4 "Repeat offender" admin notice gets the same
 * profile_found gate. PGlite case 10 is red on 20260927230819 (Q834=skip)
 * and green after.
 *
 * Q744: two violations committed at the same moment both counted 1 and both
 * sent "Final warning" (no suspension). The body takes a per-user advisory
 * lock before the COUNT; scripts/probes/auto-restrict-race.embedded-pg.mjs
 * races two real connections: green on 20261002055040, red on 20260927231939
 * (final_warning, two Final warnings).
 *
 * @mutate supabase/migrations/20261002055040_auto_restrict_lock_per_user.sql | (as Q745 does for the suspensions).\n      IF NOT profile_found THEN | (as Q745 does for the suspensions).\n      IF false THEN
 * @mutate supabase/migrations/20261002055040_auto_restrict_lock_per_user.sql | log the miss, as Q820 does.\n      IF NOT profile_found THEN | log the miss, as Q820 does.\n      IF false THEN
 * @mutate supabase/migrations/20261002055040_auto_restrict_lock_per_user.sql | 'repeat offender: no profiles row; admin notice skipped',\n            jsonb_build_object('violation_id', NEW.id, 'violation_count', violation_count));\n        EXCEPTION WHEN OTHERS THEN\n          NULL;\n        END;\n        RETURN NEW; | 'repeat offender: no profiles row; admin notice skipped',\n            jsonb_build_object('violation_id', NEW.id, 'violation_count', violation_count));\n        EXCEPTION WHEN OTHERS THEN\n          NULL;\n        END;
 * @mutate supabase/migrations/20261002055040_auto_restrict_lock_per_user.sql |     profile_found := FOUND; |     profile_found := true;
 * @mutate supabase/migrations/20261002055040_auto_restrict_lock_per_user.sql |         GET DIAGNOSTICS warned_rows = ROW_COUNT; |         warned_rows := 1;
 * @mutate supabase/migrations/20261002055040_auto_restrict_lock_per_user.sql |       AND created_at >= NOW() - INTERVAL '7 days'; |       ;
 * @mutate supabase/migrations/20261002055040_auto_restrict_lock_per_user.sql |     WHERE user_id = NEW.user_id\n      AND violation_type NOT IN ( |     WHERE user_id = NEW.user_id\n      AND violation_type IN (
 * @mutate supabase/migrations/20261002055040_auto_restrict_lock_per_user.sql | INTERVAL '7 days'\n      WHERE user_id = NEW.user_id;\n      GET DIAGNOSTICS suspended_rows = ROW_COUNT; | INTERVAL '7 days'\n      WHERE user_id = NEW.user_id;
 * @mutate supabase/migrations/20261002055040_auto_restrict_lock_per_user.sql | REVOKE ALL ON FUNCTION public.auto_restrict_repeat_violators() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.auto_restrict_repeat_violators() FROM PUBLIC;
 * @mutate supabase/migrations/20261002055040_auto_restrict_lock_per_user.sql |     PERFORM pg_advisory_xact_lock(hashtextextended('auto_restrict_repeat_violators:' \|\| NEW.user_id::text, 0)); |     NULL;
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(resolve(__dirname, "../.."), "supabase", "migrations");
const EXCLUDED = ["admin_action", "admin_warning", "cancel_with_helper", "off_platform", "job_denial", "no_show"];

const defs = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }))
  .filter(({ sql }) => /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.auto_restrict_repeat_violators\s*\(/i.test(sql));

function newestBody(): { f: string; body: string; sql: string } {
  const { f, sql } = defs[defs.length - 1];
  const all = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.auto_restrict_repeat_violators\s*\(/gi)];
  const at = all[all.length - 1].index!;
  const tag = /AS\s+(\$\w*\$)/i.exec(sql.slice(at))![1];
  const open = sql.indexOf(tag, at);
  const close = sql.indexOf(tag, open + tag.length);
  return { f, body: sql.slice(at, close), sql };
}

describe("auto_restrict_repeat_violators is warn-first (Q183)", () => {
  it("finds the function in more than one migration", () => {
    expect(defs.length).toBeGreaterThan(5);
  });

  it("counts only its own types, only in the last 7 days", () => {
    const { body } = newestBody();
    const count = /SELECT\s+COUNT\(\*\)\s+INTO\s+violation_count\s+FROM\s+public\.user_violations\s+WHERE([\s\S]*?);/i.exec(body);
    expect(count).not.toBeNull();
    const where = count![1];
    expect(where).toMatch(/user_id\s*=\s*NEW\.user_id/i);
    expect(where).toMatch(/created_at\s*>=\s*NOW\(\)\s*-\s*INTERVAL\s*'7 days'/i);
    const notIn = /violation_type\s+NOT\s+IN\s*\(([^)]*)\)/i.exec(where);
    expect(notIn).not.toBeNull();
    const listed = [...notIn![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...EXCLUDED].sort());
  });

  it("suspends 7 days on the second trip, and only warns on the first", () => {
    const { body } = newestBody();
    const two = body.search(/ELSIF\s+violation_count\s*=\s*2\s+THEN[\s\S]*?INTERVAL\s*'7 days'/i);
    const one = body.search(/ELSIF\s+violation_count\s*=\s*1\s+THEN/i);
    expect(two).toBeGreaterThan(-1);
    expect(one).toBeGreaterThan(two);
    expect(body.slice(one)).not.toMatch(/temp_banned/);
  });

  it("sends no suspension notice when the suspension UPDATE changed no row (Q745)", () => {
    const { body } = newestBody();
    const updates = [...body.matchAll(/UPDATE\s+public\.profiles\s+SET\s+ban_status\s*=\s*'temp_banned'[\s\S]*?;/gi)];
    expect(updates.length).toBe(2);
    for (const u of updates) {
      const after = body.slice(u.index! + u[0].length);
      const notice = after.search(/INSERT\s+INTO\s+public\.notifications/i);
      const guard = /^\s*GET\s+DIAGNOSTICS\s+(\w+)\s*=\s*ROW_COUNT\s*;\s*(?:--[^\n]*\n\s*)*IF\s+(\w+)\s*=\s*0\s+THEN([\s\S]*?)END\s+IF\s*;/i.exec(after);
      expect(guard, "GET DIAGNOSTICS + IF <n> = 0 right after the suspension UPDATE").not.toBeNull();
      expect(guard![2]).toBe(guard![1]);
      expect(guard!.index! + guard![0].length).toBeLessThan(notice);
      expect(guard![3]).toMatch(/log_cron_defect/);
      expect(guard![3]).toMatch(/RETURN\s+NEW\s*;/i);
    }
  });

  it("sends no Final warning without a profile row or a changed strike (Q820)", () => {
    const { body } = newestBody();
    const found = /FROM\s+public\.profiles\s+WHERE\s+user_id\s*=\s*NEW\.user_id\s*;\s*(\w+)\s*:=\s*FOUND\s*;/i.exec(body);
    expect(found, "<var> := FOUND right after the profile SELECT").not.toBeNull();
    const branch = body.slice(body.search(/ELSIF\s+violation_count\s*=\s*1\s+THEN/i));
    const notice = branch.search(/'Final warning'/);
    expect(notice).toBeGreaterThan(-1);
    const gate = new RegExp(`IF\\s+NOT\\s+${found![1]}\\s+THEN([\\s\\S]*?)END\\s+IF\\s*;`, "i").exec(branch);
    expect(gate, "IF NOT <found> THEN ... END IF before the notice").not.toBeNull();
    expect(gate!.index!).toBeLessThan(notice);
    expect(gate![1]).toMatch(/log_cron_defect/);
    expect(gate![1]).toMatch(/RETURN\s+NEW\s*;/i);
    const upd = /UPDATE\s+public\.profiles\s+SET\s+ban_status\s*=\s*'final_warning'[^;]*;\s*GET\s+DIAGNOSTICS\s+(\w+)\s*=\s*ROW_COUNT\s*;\s*IF\s+(\w+)\s*=\s*0\s+THEN[\s\S]*?RETURN\s+NEW\s*;/i.exec(branch);
    expect(upd, "GET DIAGNOSTICS + IF <n> = 0 ... RETURN NEW after the final_warning UPDATE").not.toBeNull();
    expect(upd![2]).toBe(upd![1]);
    expect(upd!.index! + upd![0].length).toBeLessThan(notice);
  });

  it("sends no Repeat offender notice without a profile row (Q834)", () => {
    const { body } = newestBody();
    const found = /FROM\s+public\.profiles\s+WHERE\s+user_id\s*=\s*NEW\.user_id\s*;\s*(\w+)\s*:=\s*FOUND\s*;/i.exec(body);
    expect(found, "<var> := FOUND right after the profile SELECT").not.toBeNull();
    const start = body.search(/IF\s+violation_count\s*>=\s*4\s+THEN/i);
    expect(start).toBeGreaterThan(-1);
    const branch = body.slice(start, start + body.slice(start).search(/ELSIF\s+violation_count\s*=\s*3\s+THEN/i));
    const notice = branch.search(/'Repeat offender:/);
    expect(notice).toBeGreaterThan(-1);
    const gate = new RegExp(`IF\\s+NOT\\s+${found![1]}\\s+THEN([\\s\\S]*?)END\\s+IF\\s*;`, "i").exec(branch);
    expect(gate, "IF NOT <found> THEN ... END IF before the notice").not.toBeNull();
    expect(gate!.index!).toBeLessThan(notice);
    expect(gate![1]).toMatch(/log_cron_defect/);
    expect(gate![1]).toMatch(/RETURN\s+NEW\s*;/i);
  });

  it("locks per user before counting, so a concurrent pair still suspends (Q744)", () => {
    const { body } = newestBody();
    const lock = /PERFORM\s+pg_advisory_xact_lock\(\s*hashtextextended\(\s*'auto_restrict_repeat_violators:'\s*\|\|\s*NEW\.user_id::text\s*,\s*0\s*\)\s*\)\s*;/i.exec(body);
    expect(lock).not.toBeNull();
    const count = /SELECT\s+COUNT\(\*\)\s+INTO\s+violation_count/i.exec(body);
    expect(count).not.toBeNull();
    expect(lock!.index).toBeLessThan(count!.index);
  });

  it("stays closed to clients", () => {
    const { sql } = newestBody();
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.auto_restrict_repeat_violators\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i);
  });
});
