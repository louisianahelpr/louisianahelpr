#!/usr/bin/env node
/**
 * Q719 — fail a push that edits the SQL of an already-applied migration.
 * See scripts/lib/appliedMigrationEdits.mjs for the rule and its exceptions.
 *
 *   node scripts/check-applied-migration-edits.mjs <base-sha> [head-sha] [--offline]
 *
 * "Applied" = the file's version is in prod's schema_migrations, read through
 * the Management API (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF). A file
 * that failed to deploy is not applied, so fixing it in place is allowed.
 * --offline treats every file present at <base-sha> as applied (the
 * upper bound; used to prove the check red on 42a7962cc without prod).
 * Exits non-zero on a finding (code one), or code two if it could not read prod.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { appliedEditFindings } from "./lib/appliedMigrationEdits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const offline = process.argv.includes("--offline");
const [base, head = "HEAD"] = process.argv.slice(2).filter((a) => a !== "--offline");
if (!base) {
  console.error("usage: check-applied-migration-edits.mjs <base-sha> [head-sha]");
  process.exit(2);
}
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });

const edits = git("diff", "--name-status", "--no-renames", "--diff-filter=MD", base, head, "--", "supabase/migrations/*.sql")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, file] = line.split("\t");
    return { file, before: git("show", `${base}:${file}`), after: status === "D" ? null : git("show", `${head}:${file}`) };
  });

async function appliedVersions() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required (or pass --offline)");
  const res = await fetch(`${process.env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com"}/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "select version from supabase_migrations.schema_migrations", read_only: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("schema_migrations came back empty; refusing to treat nothing as applied");
  return new Set(rows.map((r) => String(r.version)));
}

let applied = edits;
if (!offline) {
  let versions;
  try {
    versions = await appliedVersions();
  } catch (e) {
    console.log(`::error::could not read prod schema_migrations: ${e.message}`);
    process.exit(2);
  }
  applied = edits.filter((e) => versions.has(/(\d{14})_/.exec(e.file)?.[1]));
  for (const e of edits) if (!applied.includes(e) && e.after !== null) console.log(`not applied on prod, edit allowed: ${e.file}`);
}

const ACKS = join(ROOT, "scripts/audit/applied-migration-edits.json");
const acks = JSON.parse(readFileSync(ACKS, "utf8")).acknowledged;
const current = (file) => {
  if (head === "HEAD") return existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf8") : null;
  try { return git("show", `${head}:${file}`); } catch { return null; }
};

const findings = appliedEditFindings(applied, acks, current);
console.log(`Migrations modified in ${base}..${head}: ${edits.length}, applied: ${applied.length}${offline ? " (offline: present at base)" : ""}; acknowledgements: ${acks.length}`);
for (const f of findings) console.log(`::error::${f}`);
process.exit(findings.length ? 1 : 0);
