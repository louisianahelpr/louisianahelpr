#!/usr/bin/env node
/**
 * A table or view created by a migration newer than 20260915101101 must grant
 * its own privileges, and a table must enable RLS, in that same migration.
 *
 * Why (2026-09-15). Until 20260915101101 prod's default privileges gave anon
 * and authenticated SELECT/INSERT/UPDATE/DELETE on every relation postgres
 * created in public. That is how public.open_jobs_browse, an owner-run view
 * that bypasses jobs RLS, became writable by anyone with the anon key: a
 * DROP+CREATE re-granted writes an earlier migration had revoked. The default
 * is gone now, so a new relation starts with NO client access — and a table
 * that relied on the old default (job_pets, thread_archives,
 * notification_dedupe_suppressions all did) would ship unreadable, or someone
 * would "fix" that with a blanket grant. This makes the author write the grant,
 * next to the CREATE, where a reviewer reads it.
 *
 * Rule, per migration file whose version is newer than CUTOFF:
 *   CREATE [UNLOGGED] TABLE [IF NOT EXISTS] [public.]x   (also CREATE TABLE ... AS)
 *     -> a `GRANT ... ON [TABLE] [public.]x ... TO ...` after it in the file
 *     -> `ALTER TABLE [IF EXISTS] [ONLY] [public.]x ENABLE ROW LEVEL SECURITY` after it
 *   CREATE [OR REPLACE] [MATERIALIZED] VIEW [IF NOT EXISTS] [public.]x
 *     -> a `GRANT ... ON [TABLE] [public.]x ... TO ...` after it in the file
 * A server-only relation still states it: `GRANT ALL ON public.x TO service_role;`.
 * Comments are stripped first, so a commented-out GRANT does not count. Only
 * schema public (or unqualified) is judged; TEMP tables are ignored.
 *
 * Usage:
 *   node scripts/check-migration-relation-grants.mjs <file.sql> [...]   # CI: changed migrations
 *   node scripts/check-migration-relation-grants.mjs --all               # every migration in the tree
 * Exit 1 on a violation.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

export const CUTOFF = "20260915101101";
const MIGRATIONS_DIR = "supabase/migrations";

/** Remove -- and block comments, leaving string literals intact. */
export function stripComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const QNAME = String.raw`(?:"?([a-z_][a-z0-9_$]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_$]*)"?`;
// Full regex-metacharacter escape (backslash first, via the character class),
// so a relation name is matched literally when spliced into a RegExp. Names
// here are already constrained to [a-z0-9_$] by QNAME, but escape the whole
// metacharacter set — incl. backslash — so the escaper is correct for any input.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Violations for one migration's SQL text. */
export function violationsFor(sqlText) {
  const sql = stripComments(sqlText);
  const out = [];
  const creates = [];
  const tableRe = new RegExp(String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QNAME}`, "gi");
  const viewRe = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${QNAME}`, "gi");
  const inPublic = (schema) => !schema || schema.toLowerCase() === "public";
  let m;
  while ((m = tableRe.exec(sql))) if (inPublic(m[1])) creates.push({ kind: "table", name: m[2].toLowerCase(), at: m.index });
  while ((m = viewRe.exec(sql))) if (inPublic(m[2])) creates.push({ kind: m[1] ? "materialized view" : "view", name: m[3].toLowerCase(), at: m.index });
  // `CREATE TEMP TABLE` never reaches tableRe (TEMP sits between CREATE and TABLE).
  for (const c of creates) {
    const after = sql.slice(c.at);
    const name = esc(c.name);
    const grant = new RegExp(String.raw`\bgrant\s[^;]*?\bon\s+(?:table\s+)?(?:"?public"?\s*\.\s*)?"?${name}"?(?![a-z0-9_$])[^;]*\bto\b`, "i");
    if (!grant.test(after)) {
      out.push(`${c.kind} public.${c.name}: no GRANT after its CREATE (new relations get no client privileges by default since ${CUTOFF})`);
    }
    if (c.kind === "table") {
      const rls = new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"?public"?\s*\.\s*)?"?${name}"?\s+enable\s+row\s+level\s+security`, "i");
      if (!rls.test(after)) out.push(`table public.${c.name}: no ALTER TABLE ... ENABLE ROW LEVEL SECURITY after its CREATE`);
    }
  }
  return out;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const files = args.includes("--all")
    ? (existsSync(MIGRATIONS_DIR) ? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).map((f) => join(MIGRATIONS_DIR, f)) : [])
    : args.filter((a) => a.endsWith(".sql"));
  let judged = 0;
  const failures = [];
  for (const file of files) {
    const version = basename(file).split("_")[0];
    if (!(version > CUTOFF)) continue;
    judged++;
    for (const v of violationsFor(readFileSync(file, "utf8"))) failures.push(`${file}: ${v}`);
  }
  if (failures.length) {
    console.error("❌ New relation(s) without their own grants / RLS:\n");
    for (const f of failures) console.error(`   • ${f}`);
    console.error(
      `\nSince ${CUTOFF} a table or view created in public gets NO privileges for anon or\n` +
        "authenticated (service_role still gets them). Grant exactly what the client needs, in the\n" +
        "same migration, after the CREATE:\n" +
        "   ALTER TABLE public.x ENABLE ROW LEVEL SECURITY;\n" +
        "   GRANT SELECT, INSERT, UPDATE, DELETE ON public.x TO authenticated;   -- plus policies\n" +
        "   GRANT SELECT ON public.x_view TO anon, authenticated;                -- views: SELECT only\n" +
        "   GRANT ALL ON public.server_only_table TO service_role;               -- server-only, said out loud\n" +
        "(a serial column also needs GRANT USAGE ON SEQUENCE public.x_id_seq TO authenticated)",
    );
    process.exit(1);
  }
  console.log(`✅ ${judged} migration(s) newer than ${CUTOFF} checked (${files.length} given): every new table/view grants its own privileges; every new table enables RLS.`);
}
