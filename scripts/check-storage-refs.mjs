#!/usr/bin/env node
/**
 * DR-004, after a database restore: which rows point at a Storage file that
 * does not exist?
 *
 * Storage files are in no database backup (docs/runbooks/restore-from-backup.md
 * §4). A restore brings back profiles.avatar_url, profiles.license_url,
 * jobs.proof_after_urls, messages.attachment_url, ... and each one may now name
 * a file that was deleted after the backup was taken (account purge, the weekly
 * orphan sweep, a user removing a photo) or that never existed in the project
 * being restored into. This reads every column in
 * scripts/lib/storageRefs.mjs STORAGE_REFERENCE_COLUMNS, lists the Storage
 * folders those values name, and reports each reference whose object is not
 * there. It is the inverse of scripts/storage-orphan-sweep.mjs (which finds
 * files whose row is gone).
 *
 * READ-ONLY: GET on PostgREST and POST /storage/v1/object/list (a listing).
 * It never writes a row or touches an object. Paced (--pace-ms, default 150)
 * and time-boxed (20 s per request).
 *
 * Usage:
 *   node scripts/check-storage-refs.mjs [--json <file>] [--pace-ms N]
 * Env: SUPABASE_URL or SUPABASE_PROJECT_REF, SUPABASE_SERVICE_ROLE_KEY.
 *      Point them at the RESTORED project, not the old one.
 * Exit: 0 every reference resolves to an existing object in this project;
 *       1 missing / other-project / unresolved references (listed);
 *       2 could not measure (a read failed, or nothing was read).
 */
import { writeFileSync } from "node:fs";
import { STORAGE_REFERENCE_COLUMNS, foldersToList, gradeReferences, referencesFromRows } from "./lib/storageRefs.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const JSON_OUT = opt("json", null);
const PACE_MS = Number(opt("pace-ms", "150"));

const unmeasured = (msg) => {
  console.error(`::error::check-storage-refs: ${msg}`);
  process.exit(2);
};

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = (
  process.env.SUPABASE_URL || (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : "")
).replace(/\/+$/, "");
if (!KEY || !BASE) unmeasured("could not read: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL/SUPABASE_PROJECT_REF are required");
const PROJECT_HOST = new URL(BASE).host;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(method, path, body) {
  await sleep(PACE_MS);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${text.slice(0, 160)}`);
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error(`${method} ${path.split("?")[0]} did not return an array`);
    return data;
  } finally {
    clearTimeout(t);
  }
}

// 1. Every reference, every column. PostgREST caps each page (db-max-rows,
// measured 2026-09-01 in supabase/functions/money-reconciliation/index.ts).
const refs = [];
const perColumn = [];
for (const col of STORAGE_REFERENCE_COLUMNS) {
  let rows = 0;
  const before = refs.length;
  for (let offset = 0; ; offset += 1000) {
    let page;
    try {
      page = await req("GET", `/rest/v1/${col.table}?select=id,${col.column}&${col.column}=not.is.null&order=id.asc&limit=1000&offset=${offset}`);
    } catch (e) {
      unmeasured(`could not read ${col.table}.${col.column}: ${e.message}`);
    }
    rows += page.length;
    refs.push(...referencesFromRows(col, page));
    // Stop on an EMPTY page, not a short one: a lowered db-max-rows would make
    // a short page mid-table and a partial read would look complete.
    if (page.length === 0) break;
  }
  perColumn.push({ column: `${col.table}.${col.column}`, rows, refs: refs.length - before });
}
if (refs.length === 0) {
  unmeasured(`read ${STORAGE_REFERENCE_COLUMNS.length} columns and found no storage references at all — refusing to report clean (a restored prod has avatars, proof photos and attachments)`);
}

// 2. List every folder those references name (one level, paged by 100).
const listed = new Map();
const listFailures = [];
for (const { bucket, dir } of foldersToList(refs, PROJECT_HOST)) {
  const names = new Set();
  try {
    for (let offset = 0; ; offset += 100) {
      const page = await req("POST", `/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
        prefix: dir,
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      // Files carry an id; sub-folders come back with id null.
      for (const o of page) if (o && o.id) names.add(o.name);
      if (page.length < 100) break;
    }
    listed.set(`${bucket}/${dir}`, names);
  } catch (e) {
    listFailures.push(`${bucket}/${dir}: ${e.message}`);
  }
}

// 3. Grade.
const g = gradeReferences(refs, listed, PROJECT_HOST);
const line = (r) => `  ${r.table}.${r.column} id=${r.id}: ${typeof r.value === "string" ? r.value : JSON.stringify(r.value)}`;

console.log(`Storage references in ${PROJECT_HOST}: ${refs.length} across ${perColumn.filter((c) => c.refs).length} column(s).`);
for (const c of perColumn) console.log(`  ${c.column.padEnd(38)} ${String(c.rows).padStart(5)} row(s) ${String(c.refs).padStart(5)} ref(s)`);
console.log(
  `Checked ${g.checked}: ${g.present} present, ${g.missing.length} MISSING. ` +
    `${g.foreign.length} on another project, ${g.unresolved.length} unresolved, ${g.external} external URL(s), ${g.inline} inline data: value(s).`,
);
if (g.missing.length) console.log(`\nMISSING (the row names a file that is not in Storage):\n${g.missing.map(line).join("\n")}`);
if (g.foreign.length) console.log(`\nON ANOTHER PROJECT (the URL's host is not ${PROJECT_HOST}):\n${g.foreign.map(line).join("\n")}`);
if (g.unresolved.length) console.log(`\nUNRESOLVED (cannot tell which object this is):\n${g.unresolved.map(line).join("\n")}`);

if (JSON_OUT) {
  const strip = (r) => ({ table: r.table, column: r.column, id: r.id, value: r.value });
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      { project: PROJECT_HOST, perColumn, missing: g.missing.map(strip), foreign: g.foreign.map(strip), unresolved: g.unresolved.map(strip), listFailures },
      null,
      2,
    ),
  );
}

if (listFailures.length || g.unlisted.length) {
  unmeasured(`could not list ${listFailures.length} folder(s), so ${g.unlisted.length} reference(s) are unchecked:\n  ${listFailures.slice(0, 20).join("\n  ")}`);
}
if (g.missing.length || g.foreign.length || g.unresolved.length) {
  console.error(`::error::${g.missing.length} missing, ${g.foreign.length} other-project and ${g.unresolved.length} unresolved storage reference(s) — see the lists above.`);
  process.exit(1);
}
console.log("OK — every storage reference resolves to an object in this project.");
