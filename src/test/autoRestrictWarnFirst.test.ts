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
 * @mutate supabase/migrations/20260927043454_auto_restrict_warn_first.sql |       AND created_at >= NOW() - INTERVAL '7 days'; |       ;
 * @mutate supabase/migrations/20260927043454_auto_restrict_warn_first.sql |     WHERE user_id = NEW.user_id\n      AND violation_type NOT IN ( |     WHERE user_id = NEW.user_id\n      AND violation_type IN (
 * @mutate supabase/migrations/20260927043454_auto_restrict_warn_first.sql | REVOKE ALL ON FUNCTION public.auto_restrict_repeat_violators() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.auto_restrict_repeat_violators() FROM PUBLIC;
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

  it("stays closed to clients", () => {
    const { sql } = newestBody();
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.auto_restrict_repeat_violators\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i);
  });
});
