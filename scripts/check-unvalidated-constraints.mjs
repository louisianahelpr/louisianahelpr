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

// Constraints deliberately left NOT VALID, each with the query that counts its
// violating rows. Two-way: a listed constraint that is now validated is a stale
// entry (exit 1), and one whose violators reached 0 must be VALIDATEd now (exit
// 1), so nothing sits here after its reason is gone.
// @two-way scripts/check-unvalidated-constraints.mjs:is listed in KNOWN_UNVALIDATED but is now validated
const KNOWN_UNVALIDATED = {
  // ST-002 (aaaed5cbe): one real user's availability row, Sunday 21:00-17:00.
  // Real account data is never edited by us; the editor now refuses the shape,
  // so the row is fixed when its owner next saves that day.
  "helper_availability.helper_availability_range_forward":
    "SELECT count(*)::int AS n FROM public.helper_availability WHERE NOT (is_available IS NOT TRUE OR start_time IS NULL OR end_time IS NULL OR start_time < end_time)",
};

async function liveRow(sql = SQL) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`${process.env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com"}/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
    return (await res.json())[0];
  }
  const out = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", sql], {
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
let failed = false;
for (const [key, countSql] of Object.entries(KNOWN_UNVALIDATED)) {
  if (!offenders.some((o) => `${o.tbl}.${o.conname}` === key)) {
    console.error(`::error::${key} is listed in KNOWN_UNVALIDATED but is now validated — drop the entry.`);
    failed = true; // stale entry
    continue;
  }
  let n;
  try {
    n = Number((await liveRow(countSql))?.n);
  } catch (e) {
    console.error(`::error::could not count violators of ${key}: ${e.message}`);
    process.exit(2);
  }
  if (!Number.isFinite(n)) {
    console.error(`::error::violator count for ${key} was unreadable — refusing to report clean.`);
    process.exit(2);
  }
  if (n === 0) {
    console.error(`::error::${key} has no violating rows left — ALTER TABLE ... VALIDATE CONSTRAINT and drop its KNOWN_UNVALIDATED entry.`);
    failed = true;
  } else {
    console.log(`known NOT VALID: ${key} (${n} violating row(s), left deliberately)`);
  }
}
const unexpected = offenders.filter((o) => !(`${o.tbl}.${o.conname}` in KNOWN_UNVALIDATED));
if (unexpected.length || failed) {
  for (const o of unexpected) {
    console.error(`::error::${o.tbl}.${o.conname} (${o.kind}) is NOT VALID — a row violates it, and the next UPDATE of that row will fail. Find it, fix the row, then ALTER TABLE ... VALIDATE CONSTRAINT.`);
  }
  process.exit(1);
}
console.log(`OK: every public constraint is validated, apart from ${Object.keys(KNOWN_UNVALIDATED).length} known and still-justified.`);
