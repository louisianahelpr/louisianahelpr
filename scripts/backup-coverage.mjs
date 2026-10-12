#!/usr/bin/env node
/**
 * Prove the nightly data dump holds every table that has rows on prod
 * (nightly-red #2668). Logic and the measured history: scripts/lib/backupCoverage.mjs.
 *
 *   node scripts/backup-coverage.mjs count <out.json>
 *       env SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF
 *       Exact row count of every public/auth table (read-only SQL through the
 *       Management API). Run once right before and once right after the dump.
 *
 *   node scripts/backup-coverage.mjs verify <before.json> <after.json> <data.sql>
 *       Exit 1 when a table had rows before AND after the dump but data.sql has
 *       no INSERT for it, when a MUST_HAVE_ROWS table is empty on prod, or when
 *       an EXCLUDED_TABLES entry is stale. Prints table names and counts only,
 *       never row contents.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { COUNT_SQL, countsFrom, dumpedTables, checkCoverage } from "./lib/backupCoverage.mjs";

const [mode, ...args] = process.argv.slice(2);

async function mgmtSql(query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error("needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

if (mode === "count") {
  const [out] = args;
  if (!out) throw new Error("usage: backup-coverage.mjs count <out.json>");
  const counts = countsFrom(await mgmtSql(COUNT_SQL));
  writeFileSync(out, JSON.stringify(Object.fromEntries(counts), null, 1));
  const withRows = [...counts.values()].filter((n) => n > 0).length;
  console.log(`counted ${counts.size} tables on prod, ${withRows} with rows -> ${out}`);
} else if (mode === "verify") {
  const [beforeF, afterF, dataF] = args;
  if (!dataF) throw new Error("usage: backup-coverage.mjs verify <before.json> <after.json> <data.sql>");
  const load = (f) => countsFrom(Object.entries(JSON.parse(readFileSync(f, "utf8"))).map(([t, n]) => ({ t, n })));
  const r = checkCoverage({ before: load(beforeF), after: load(afterF), dumped: dumpedTables(readFileSync(dataF, "utf8")) });
  console.log(`${"table".padEnd(48)} ${"before".padStart(7)} ${"after".padStart(7)}  dump verdict`);
  for (const l of r.lines) console.log(l);
  for (const n of r.notes) console.log(`::notice::${n}`);
  console.log(`tables with rows on prod: ${r.withRows}; in data.sql: ${r.covered}`);
  if (r.problems.length) {
    for (const p of r.problems) console.log(`::error::${p}`);
    process.exit(1);
  }
} else {
  console.error("usage: backup-coverage.mjs count <out.json> | verify <before.json> <after.json> <data.sql>");
  process.exit(2);
}
