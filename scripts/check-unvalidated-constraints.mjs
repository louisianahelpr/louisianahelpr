#!/usr/bin/env node
/**
 * LIVE: no constraint in `public` may be left NOT VALID.
 *
 * Why (2026-09-23, review of 20260923042014): migrations add CHECKs as
 * `NOT VALID` and then `VALIDATE`, turning a failed VALIDATE into a WARNING so
 * a deploy is not blocked by one bad legacy row. That WARNING scrolls past in
 * the deploy log. The constraint then stays NOT VALID, and because Postgres
 * checks a CHECK against the whole NEW row on every UPDATE, the next edit of
 * ANY column on that bad row fails with an opaque check_violation — a support
 * ticket nobody can explain. Nothing read pg_constraint.convalidated, so this
 * state was invisible. It is a hole only if it exists; this says whether it
 * does, on every deploy (db-deploy.yml) and every night (db-drift-detect.yml).
 *
 * Usage: node scripts/check-unvalidated-constraints.mjs [--inject-fake]
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF, else `supabase db query --linked`.
 * Exit 1 on an offender, 2 if it could not look.
 */
import { execFileSync } from "node:child_process";

const SQL = `
SELECT (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = 'public')::int AS public_constraints,
       coalesce((SELECT json_agg(o) FROM (
         SELECT c.conrelid::regclass::text AS tbl, c.conname, c.contype::text AS kind
           FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = 'public' AND NOT c.convalidated
          ORDER BY 1, 2) o), '[]'::json) AS unvalidated`;

async function liveRow() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: SQL, read_only: true }),
    });
    if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
    return (await res.json())[0];
  }
  const out = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", SQL], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  return (json.rows ?? json)[0];
}

let row;
try {
  row = await liveRow();
} catch (e) {
  console.error(`::error::could not read the live catalog: ${e.message}`);
  process.exit(2);
}
const total = Number(row?.public_constraints ?? 0);
const offenders = typeof row?.unvalidated === "string" ? JSON.parse(row.unvalidated) : row?.unvalidated ?? [];
if (process.argv.includes("--inject-fake")) offenders.push({ tbl: "zz_fake", conname: "zz_fake_check", kind: "c" });

// Prod has hundreds of public constraints; zero means the read failed.
if (total < 50) {
  console.error(`::error::read only ${total} public constraints — refusing to report clean.`);
  process.exit(2);
}
console.log(`Checked ${total} public constraints.`);
if (offenders.length) {
  for (const o of offenders) {
    console.error(`::error::${o.tbl}.${o.conname} (${o.kind}) is NOT VALID — a row violates it, and the next UPDATE of that row will fail. Find it, fix the row, then ALTER TABLE ... VALIDATE CONSTRAINT.`);
  }
  process.exit(1);
}
console.log("OK: every public constraint is validated.");
