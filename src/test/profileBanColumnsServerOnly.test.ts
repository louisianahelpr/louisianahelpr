/**
 * CLASS CHECK (Q304) — profiles.ban_status and profiles.auto_suspended_until
 * are written by the server only.
 *
 * `authenticated` held column UPDATE on both until 20260923212305. The five
 * admin UI writers that relied on it (BanDialog x3, AutoRestrictedRail,
 * useAdminUserActions.unbanUser) now call the admin-user-actions edge function
 * (`setProfileBanStatus`, src/lib/adminBanStatus.ts), which checks the admin
 * role and writes as service_role. Two ways this can come back:
 *
 *  1. A client write re-appears. With the grant gone it would fail at runtime
 *     with 42501 — an admin ban that silently never lands in some screen — so
 *     the scan below fails the build first. It reads every non-test .ts/.tsx
 *     under src/ with the TypeScript parser (comments are not code), and flags
 *     any `.from("profiles")…update/upsert({ … })` whose payload names either
 *     column.
 *  2. The grant re-appears. `sync_profiles_update_grants()` runs every 10
 *     minutes and re-grants authenticated every profiles column NOT in
 *     `profiles_locked_update_columns()`, so a bare REVOKE is undone within ten
 *     minutes (proven in PGlite 2026-09-23, ~/.lh-shots/q304/pglite.log). The
 *     lock therefore lives in that list: the NEWEST definition must name both
 *     columns, the newest sync function must still subtract it, and no
 *     migration after Q304 may GRANT UPDATE/ALL that reaches either column.
 *
 * Live state is checked by the migration's own REVOKE + sync and by
 * `has_column_privilege` after db-deploy (see the Q304 report); this file is
 * the CI half.
 *
 * @mutate src/components/admin/adminusers/useAdminUserActions.ts | await setProfileBanStatus({ | await supabase.from("profiles").update({ ban_status: "active" }).eq("user_id", profile.user_id);\n      await setProfileBanStatus({
 * @mutate supabase/migrations/20260923212305_revoke_profile_ban_column_updates.sql | 'ban_status', | 'ban_status_retired',
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { walkSource } from "./helpers/walkSource";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const REPO = join(__dirname, "..", "..");
const SRC = join(REPO, "src");
const MIGRATIONS = join(REPO, "supabase", "migrations");
const Q304 = "20260923212305_revoke_profile_ban_column_updates.sql";
const COLUMNS = ["ban_status", "auto_suspended_until"] as const;

// ── 1. client writes ────────────────────────────────────────────────────────

function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  return x;
}

/** The table a `.update/.upsert` call writes, when its chain starts at `.from("t")`. */
function writtenTable(call: ts.CallExpression): string | null {
  const c = unwrap(call.expression);
  if (!ts.isPropertyAccessExpression(c) || !["update", "upsert"].includes(c.name.text)) return null;
  let x: ts.Expression = c.expression;
  for (;;) {
    x = unwrap(x);
    if (ts.isCallExpression(x)) {
      const callee = unwrap(x.expression);
      const arg = x.arguments[0];
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "from" && arg && ts.isStringLiteralLike(arg)) return arg.text;
      x = x.expression;
    } else if (ts.isPropertyAccessExpression(x)) {
      x = x.expression;
    } else return null;
  }
}

/** Keys an object-literal payload (or array of them) names. */
function payloadKeys(arg: ts.Expression | undefined): string[] {
  if (!arg) return [];
  const a = unwrap(arg);
  if (ts.isArrayLiteralExpression(a)) return a.elements.flatMap((e) => payloadKeys(e as ts.Expression));
  if (!ts.isObjectLiteralExpression(a)) return [];
  const out: string[] = [];
  for (const p of a.properties) {
    if (ts.isShorthandPropertyAssignment(p)) out.push(p.name.text);
    else if (ts.isPropertyAssignment(p)) {
      const n = p.name;
      if (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) out.push(n.text);
      else if (ts.isComputedPropertyName(n) && ts.isStringLiteralLike(n.expression)) out.push(n.expression.text);
    }
  }
  return out;
}

export function scanProfileWrites(file: string, text: string): { writes: number; offenders: string[] } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let writes = 0;
  const offenders: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && writtenTable(n) === "profiles") {
      writes++;
      const hit = payloadKeys(n.arguments[0]).filter((k) => (COLUMNS as readonly string[]).includes(k));
      if (hit.length) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        offenders.push(`${file}:${line} writes ${hit.join(", ")}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { writes, offenders };
}

function clientFiles(): string[] {
  return walkSource([SRC]).filter((f) => {
    const r = relative(REPO, f);
    return !/\.(test|spec)\.tsx?$/.test(r) && !r.startsWith("src/test/") && r !== "src/integrations/supabase/types.ts";
  });
}

// ── 2. grants ───────────────────────────────────────────────────────────────

const quoted = (body: string) => [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

/** GRANT statements in `sql` (comments blanked) that give UPDATE on either column of profiles. */
export function reGrants(sql: string): string[] {
  const code = blankSqlComments(sql);
  const out: string[] = [];
  for (const m of code.matchAll(/\bGRANT\s+([^;]*?)\s+ON\s+(?:TABLE\s+)?(?:public\.)?"?profiles"?\s+TO\s+([^;]*)/gi)) {
    const privs = m[1];
    const grantees = m[2];
    if (!/\b(authenticated|anon|public)\b/i.test(grantees)) continue;
    if (/\bALL\b/i.test(privs) && !/\(/.test(privs)) { out.push(m[0].trim()); continue; }
    const upd = /\bUPDATE\b\s*(\(([^)]*)\))?/i.exec(privs);
    if (!upd) continue;
    const cols = upd[2];
    if (!cols || COLUMNS.some((c) => new RegExp(`\\b${c}\\b`, "i").test(cols))) out.push(m[0].trim());
  }
  return out;
}

describe("profiles.ban_status / auto_suspended_until are server-written only (Q304)", () => {
  const files = clientFiles();
  const results = files.map((f) => scanProfileWrites(relative(REPO, f), readFileSync(f, "utf8")));
  const writes = results.reduce((n, r) => n + r.writes, 0);
  const offenders = results.flatMap((r) => r.offenders);

  it("the scan reads the real client tree (a scan that finds nothing cannot fail)", () => {
    expect(files.length).toBeGreaterThan(500);
    // Every `.from("profiles").update/upsert(...)` in src/ — the population the
    // column check below runs over.
    expect(writes).toBeGreaterThan(8);
  });

  it("the detectors fire on both sides", () => {
    const bad = `supabase.from("profiles").update({ ban_status: "active" }).eq("user_id", id);`;
    const bad2 = `await supabase.from("profiles").upsert([{ user_id, "auto_suspended_until": null }]);`;
    const ok = `supabase.from("profiles").update({ bio: "x" }).eq("user_id", id); supabase.from("user_bans").update({ ban_status: "x" });`;
    const commented = `// supabase.from("profiles").update({ ban_status: "active" })\nconst x = 1;`;
    expect(scanProfileWrites("a.ts", bad).offenders).toHaveLength(1);
    expect(scanProfileWrites("a.ts", bad2).offenders).toHaveLength(1);
    expect(scanProfileWrites("a.ts", ok).offenders).toEqual([]);
    expect(scanProfileWrites("a.ts", commented).offenders).toEqual([]);

    expect(reGrants("GRANT UPDATE (bio, ban_status) ON public.profiles TO authenticated;")).toHaveLength(1);
    expect(reGrants("GRANT UPDATE ON public.profiles TO authenticated;")).toHaveLength(1);
    expect(reGrants("GRANT ALL ON TABLE public.profiles TO anon;")).toHaveLength(1);
    expect(reGrants("GRANT UPDATE (bio) ON public.profiles TO authenticated;")).toEqual([]);
    expect(reGrants("GRANT UPDATE (ban_status) ON public.profiles TO service_role;")).toEqual([]);
    expect(reGrants("-- GRANT UPDATE (ban_status) ON public.profiles TO authenticated;")).toEqual([]);
  });

  it("no client code updates either column on profiles", () => {
    expect(offenders, "route it through setProfileBanStatus (src/lib/adminBanStatus.ts) / admin-user-actions").toEqual([]);
  });

  it("the Q304 migration exists and revokes by role name", () => {
    expect(migrationFiles(MIGRATIONS)).toContain(Q304);
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, Q304), "utf8"));
    expect(sql).toMatch(/REVOKE\s+UPDATE\s*\(\s*ban_status\s*,\s*auto_suspended_until\s*\)\s+ON\s+public\.profiles\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
  });

  it("the NEWEST profiles_locked_update_columns() locks both columns, and the newest sync still subtracts it", () => {
    const defs = effectiveDefs(MIGRATIONS);
    const locked = defs.get("profiles_locked_update_columns");
    expect(locked, "profiles_locked_update_columns has no migration definition").toBeTruthy();
    const body = blankSqlComments(locked!.stmt);
    expect(quoted(body)).toEqual(expect.arrayContaining([...COLUMNS]));
    const sync = defs.get("sync_profiles_update_grants");
    expect(sync).toBeTruthy();
    expect(blankSqlComments(sync!.stmt)).toMatch(/profiles_locked_update_columns\(\)/);
    expect(blankSqlComments(sync!.stmt)).toMatch(/NOT\s*\(\s*a\.attname::text\s*=\s*ANY\s*\(\s*v_locked\s*\)\s*\)/i);
  });

  it("no migration at or after Q304 re-grants UPDATE on either column", () => {
    const later = migrationFiles(MIGRATIONS).filter((f) => f >= Q304);
    expect(later[0]).toBe(Q304);
    const hits = later.flatMap((f) => reGrants(readFileSync(join(MIGRATIONS, f), "utf8")).map((g) => `${f}: ${g}`));
    expect(hits, "ban_status / auto_suspended_until are server-only (Q304)").toEqual([]);
  });
});
