/**
 * Q807 (docs/OPEN.md): the SERVER refuses writes from a session whose email is
 * unconfirmed. Before 20260927234313 only GoTrue (mailer_autoconfirm off) and
 * the client (ProtectedRoute -> /signup-pending) looked at email_confirmed_at;
 * nothing in the database did, and 118 SECURITY DEFINER functions executable
 * by `authenticated` (measured live 2026-09-27) bypass RLS, so the gate is a
 * FOR EACH STATEMENT trigger on every public table plus RESTRICTIVE storage
 * policies.
 *
 * Behaviour is proven in src/test/pglite/unconfirmedEmailWritesRefused.pglite.mjs
 * (migration applied 3x): ALL PASS (16 checks) with it, 9 FAILED with
 * NEW_MIGRATION=skip. This file pins the shape of the NEWEST definitions, and
 * fails CI when a later migration creates a public table without calling
 * attach_unconfirmed_email_gate() (the table would be ungated) or drops the
 * trigger.
 *
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | AND u.email_confirmed_at IS NOT NULL | AND true
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | AND coalesce(auth.role(), '') = 'authenticated' | AND true
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | IF public.session_email_unconfirmed() THEN | IF false THEN
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | RAISE EXCEPTION 'email_unconfirmed' | RAISE NOTICE 'email_unconfirmed'
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | BEFORE INSERT OR UPDATE OR DELETE ON | BEFORE INSERT ON
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | c.relname NOT IN ('analytics_events', 'error_logs') | c.relname NOT IN ('analytics_events', 'error_logs', 'jobs')
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | SELECT public.attach_unconfirmed_email_gate(); | SELECT 1;
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | AS RESTRICTIVE FOR INSERT | AS PERMISSIVE FOR INSERT
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | AS RESTRICTIVE FOR DELETE TO authenticated\n  USING (NOT public.session_email_unconfirmed()); | AS RESTRICTIVE FOR DELETE TO authenticated\n  USING (true);
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | FROM PUBLIC, anon;\nGRANT | FROM PUBLIC;\nGRANT
 * @mutate supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql | REVOKE ALL ON FUNCTION public.attach_unconfirmed_email_gate() FROM PUBLIC, anon, authenticated, service_role; | REVOKE ALL ON FUNCTION public.attach_unconfirmed_email_gate() FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(resolve(__dirname, "../.."), "supabase", "migrations");
const Q807 = "20260927234313";

const files = readdirSync(MIG)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort()
  .map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));

/** Newest CREATE [OR REPLACE] FUNCTION public.<name> body, any dollar tag. */
function newestBody(name: string): { f: string; body: string } {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  const hits = files.filter(({ sql }) => new RegExp(head.source, "i").test(sql));
  expect(hits.length, `no migration defines public.${name}`).toBeGreaterThan(0);
  const { f, sql } = hits[hits.length - 1];
  const all = [...sql.matchAll(head)];
  const at = all[all.length - 1].index!;
  const tag = /AS\s+(\$\w*\$)/i.exec(sql.slice(at))![1];
  const open = sql.indexOf(tag, at);
  const close = sql.indexOf(tag, open + tag.length);
  return { f, body: sql.slice(at, close + tag.length) };
}

/** Newest CREATE POLICY "<name>" ON storage.objects statement. */
function newestPolicy(name: string): string | null {
  let found: string | null = null;
  const re = new RegExp(`CREATE\\s+POLICY\\s+"${name}"\\s+ON\\s+storage\\.objects[\\s\\S]*?;`, "gi");
  for (const { sql } of files) for (const m of sql.matchAll(re)) found = m[0];
  return found;
}

/**
 * Public tables a migration creates with no attach_unconfirmed_email_gate()
 * call after the last CREATE TABLE in the same file. The synthetic case below
 * proves the scan can fail.
 */
function ungatedNewTables(migrations: { f: string; sql: string }[], from: string): string[] {
  const out: string[] = [];
  const create =
    /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi;
  for (const { f, sql } of migrations) {
    if (f.slice(0, 14) <= from) continue;
    let last = -1;
    const names: string[] = [];
    for (const m of sql.matchAll(create)) {
      const q = m[1].replace(/"/g, "");
      const [schema, table] = q.includes(".") ? q.split(".") : ["public", q];
      if (schema.toLowerCase() !== "public") continue;
      names.push(table);
      last = m.index!;
    }
    if (last < 0) continue;
    const call = sql.slice(last).search(/public\.attach_unconfirmed_email_gate\s*\(\s*\)/i);
    if (call < 0) out.push(...names.map((t) => `${f}: public.${t}`));
  }
  return out;
}

describe("unconfirmed email cannot write (Q807)", () => {
  it("reads a real migration corpus", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some(({ f }) => f.startsWith(Q807))).toBe(true);
  });

  it("session_email_unconfirmed reads auth.users.email_confirmed_at for an authenticated sub", () => {
    const { body } = newestBody("session_email_unconfirmed");
    expect(body).toMatch(/SECURITY\s+DEFINER/i);
    expect(body).toMatch(/SET\s+search_path\s*=\s*''/i);
    expect(body).toMatch(/auth\.uid\(\)\s+IS\s+NOT\s+NULL/i);
    expect(body).toMatch(/coalesce\(auth\.role\(\),\s*''\)\s*=\s*'authenticated'/i);
    expect(body).toMatch(
      /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+auth\.users\s+u\s+WHERE\s+u\.id\s*=\s*auth\.uid\(\)\s+AND\s+u\.email_confirmed_at\s+IS\s+NOT\s+NULL\s*\)/i,
    );
    // Never a JWT claim: user_metadata.email_verified is user-writable.
    expect(body).not.toMatch(/email_verified|auth\.jwt\(\)/i);
  });

  it("the trigger function raises email_unconfirmed when the session is unconfirmed", () => {
    const { body } = newestBody("refuse_unconfirmed_email_write");
    expect(body).toMatch(/SECURITY\s+DEFINER/i);
    expect(body).toMatch(
      /IF\s+public\.session_email_unconfirmed\(\)\s+THEN\s+RAISE\s+EXCEPTION\s+'email_unconfirmed'/i,
    );
  });

  it("attach gates every public table except the two anon-writable telemetry tables, on all three writes", () => {
    const { body } = newestBody("attach_unconfirmed_email_gate");
    const exempt = /c\.relname\s+NOT\s+IN\s*\(([^)]*)\)/i.exec(body);
    expect(exempt, "exempt list missing").not.toBeNull();
    const names = [...exempt![1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["analytics_events", "error_logs"]);
    expect(body).toMatch(/ns\.nspname\s*=\s*'public'/i);
    expect(body).toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.%I/i);
    expect(body).toMatch(/FOR\s+EACH\s+STATEMENT\s+EXECUTE\s+FUNCTION\s+public\.refuse_unconfirmed_email_write\(\)/i);
  });

  it("the Q807 migration attaches the gate to the tables that exist", () => {
    const { sql } = files.find(({ f }) => f.startsWith(Q807))!;
    const def = sql.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.attach_unconfirmed_email_gate/i);
    const call = sql.search(/SELECT\s+public\.attach_unconfirmed_email_gate\(\s*\)\s*;/i);
    expect(def).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(def);
  });

  it("storage.objects has RESTRICTIVE insert/update/delete policies on the same check", () => {
    const ins = newestPolicy("Unconfirmed email cannot upload");
    const upd = newestPolicy("Unconfirmed email cannot update objects");
    const del = newestPolicy("Unconfirmed email cannot delete objects");
    expect(ins).toMatch(/AS\s+RESTRICTIVE\s+FOR\s+INSERT\s+TO\s+authenticated\s+WITH\s+CHECK\s*\(\s*NOT\s+public\.session_email_unconfirmed\(\)\s*\)/i);
    expect(upd).toMatch(/AS\s+RESTRICTIVE\s+FOR\s+UPDATE\s+TO\s+authenticated\s+USING\s*\(\s*NOT\s+public\.session_email_unconfirmed\(\)\s*\)\s+WITH\s+CHECK\s*\(\s*NOT\s+public\.session_email_unconfirmed\(\)\s*\)/i);
    expect(del).toMatch(/AS\s+RESTRICTIVE\s+FOR\s+DELETE\s+TO\s+authenticated\s+USING\s*\(\s*NOT\s+public\.session_email_unconfirmed\(\)\s*\)/i);
  });

  it("grants: the helper is closed to anon, the trigger and attach functions to every client role", () => {
    const all = files.map(({ sql }) => sql).join("\n");
    expect(all).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.session_email_unconfirmed\(\)\s+FROM\s+PUBLIC,\s*anon\s*;/i);
    expect(all).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.refuse_unconfirmed_email_write\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role\s*;/i);
    expect(all).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.attach_unconfirmed_email_gate\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role\s*;/i);
    expect(all).not.toMatch(/GRANT\s+[^;]*ON\s+FUNCTION\s+public\.session_email_unconfirmed\(\)\s+TO\s+[^;]*\banon\b/i);
  });

  it("no later migration drops or disables the gate trigger", () => {
    const later = files.filter(({ f }) => f.slice(0, 14) > Q807);
    const drops = later.filter(({ sql }) =>
      /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?zz_refuse_unconfirmed_email_write"?/i.test(sql) ||
      /DISABLE\s+TRIGGER\s+(?:ALL\b|"?zz_refuse_unconfirmed_email_write"?)/i.test(sql),
    );
    expect(drops.map(({ f }) => f)).toEqual([]);
  });

  it("every public table created after Q807 calls attach_unconfirmed_email_gate() in the same migration", () => {
    expect(ungatedNewTables(files, Q807)).toEqual([]);
  });

  it("the new-table scan can fail (synthetic migration without the call)", () => {
    const fake = [
      { f: "29990101000000_x.sql", sql: "CREATE TABLE public.new_thing (id int);\nCREATE TABLE storage.skip (id int);" },
      { f: "29990101000001_y.sql", sql: "CREATE TABLE IF NOT EXISTS other (id int);\nSELECT public.attach_unconfirmed_email_gate();" },
    ];
    expect(ungatedNewTables(fake, Q807)).toEqual(["29990101000000_x.sql: public.new_thing"]);
  });
});
