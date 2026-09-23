#!/usr/bin/env node
/**
 * A migration that redefines a function must keep every guard the function
 * already had.
 *
 * WHY. 20260915034822 (dispute settlement) re-created open_dispute_as from a
 * body older than 20260915025607, which had added
 * `RAISE EXCEPTION 'job_already_completed'`. Landing it would have silently
 * dropped that guard and re-opened disputes on completed jobs. Nothing checked
 * that a CREATE OR REPLACE carried the newest earlier body's refusals.
 *
 * HOW. Inventory from the migrations themselves, in version order. For every
 * `CREATE OR REPLACE FUNCTION <schema.name>` in a migration at or after
 * ENFORCED_FROM, find the newest EARLIER migration defining the same function
 * name, collect the terse error codes it raises (`RAISE EXCEPTION '<code>'`
 * where <code> is a lower_snake identifier — prose messages are not codes),
 * and require each to still appear in the new body. A code the new body drops
 * on purpose needs an entry in scripts/migration-raise-codes-allowlist.json
 * with a reason.
 *
 *   node scripts/check-migration-raise-codes.mjs            check, exit 1 on a dropped code
 *   node scripts/check-migration-raise-codes.mjs --json     machine-readable
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
export const ALLOWLIST_PATH = path.join(ROOT, "scripts/migration-raise-codes-allowlist.json");
/** History before this is settled; the rule applies to migrations from here on. */
export const ENFORCED_FROM = "20260915034822";

/**
 * Blank out SQL `--` line comments, leaving `--` inside single-quoted literals
 * alone and preserving every other character (so offsets and line numbers hold).
 *
 * WITHOUT THIS THE WHOLE CHECK IS SATISFIABLE BY A COMMENT. Measured
 * 2026-09-20 on 20260919195158: replacing the live
 * `RAISE EXCEPTION 'job_not_found' …` in enforce_job_tracking_arrival_gate with
 * `NULL; -- RAISE EXCEPTION 'job_not_found' …` deleted the guard and left this
 * check GREEN (5 passed) — both `raiseCodes` and the `body.includes('<code>')`
 * fallback read the dead comment as the live guard.
 */
export function stripSqlComments(sql) {
  let out = "";
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") out += sql[++i]; // '' is an escaped quote, still inside
        else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; out += ch; continue; }
    if (ch === "-" && sql[i + 1] === "-") {
      // Blank the comment rather than delete it, so byte offsets and line
      // numbers still line up with the original file.
      while (i < sql.length && sql[i] !== "\n") { out += sql[i] === "\t" ? "\t" : " "; i += 1; }
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Every function definition in one migration's SQL: { name, body }. */
export function functionDefinitions(rawSql) {
  // Comments are blanked (not deleted) first, so a commented-out RAISE cannot
  // stand in for the live one and every offset below still matches the file.
  const sql = stripSqlComments(rawSql);
  const out = [];
  const re = /create\s+or\s+replace\s+function\s+((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const name = m[1].replace(/"/g, "").toLowerCase();
    const qualified = name.includes(".") ? name : `public.${name}`;
    const asMatch = /\bAS\s+(\$[a-z_]*\$)/i.exec(sql.slice(m.index));
    if (!asMatch) continue;
    const bodyStart = m.index + asMatch.index + asMatch[0].length;
    const bodyEnd = sql.indexOf(asMatch[1], bodyStart);
    if (bodyEnd === -1) continue;
    out.push({ name: qualified, body: sql.slice(bodyStart, bodyEnd) });
    re.lastIndex = bodyEnd;
  }
  return out;
}

/** The terse codes a body raises: RAISE EXCEPTION 'lower_snake_code'. */
export function raiseCodes(body) {
  const codes = new Set();
  const re = /raise\s+exception\s+'([a-z][a-z0-9_]*)'/gi;
  let m;
  while ((m = re.exec(body))) if (/_/.test(m[1])) codes.add(m[1]);
  return codes;
}

export function loadAllowlist(p = ALLOWLIST_PATH) {
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8")).allowed ?? [];
}

/** [{ migration, function, code, previous }] for every dropped code. */
export function droppedCodes({ files, readFile = (f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"), enforcedFrom = ENFORCED_FROM, allowlist = loadAllowlist() } = {}) {
  const ordered = (files ?? fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f))).slice().sort();
  const latest = new Map(); // function name -> { migration, codes }
  const dropped = [];
  const allowed = new Set(allowlist.map((a) => `${a.migration}|${a.function}|${a.code}`));
  for (const file of ordered) {
    const version = file.slice(0, 14);
    const defs = functionDefinitions(readFile(file));
    for (const def of defs) {
      const prev = latest.get(def.name);
      if (prev && version >= enforcedFrom) {
        const now = raiseCodes(def.body);
        for (const code of prev.codes) {
          if (!now.has(code) && !def.body.includes(`'${code}'`) && !allowed.has(`${file}|${def.name}|${code}`)) {
            dropped.push({ migration: file, function: def.name, code, previous: prev.migration });
          }
        }
      }
    }
    // Updated after the whole file, so two definitions in one file compare
    // against the previous MIGRATION, and the last one in the file wins.
    for (const def of defs) latest.set(def.name, { migration: file, codes: raiseCodes(def.body) });
  }
  return dropped;
}

/**
 * TWO-WAY: allowlist entries that no longer excuse a drop — the migration is
 * gone, or with an EMPTY allowlist it would not be reported (the code was kept
 * after all, or the entry names the wrong function/code). A stale entry is a
 * standing permission for a future drop at the same key, so it fails.
 */
export function staleAllowlistEntries({ files, readFile, allowlist = loadAllowlist() } = {}) {
  const raw = new Set(
    droppedCodes({ files, readFile, allowlist: [] }).map((d) => `${d.migration}|${d.function}|${d.code}`),
  );
  return allowlist
    .map((a) => `${a.migration}|${a.function}|${a.code}`)
    .filter((k) => !raw.has(k));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dropped = droppedCodes();
  const stale = staleAllowlistEntries();
  for (const k of stale) {
    console.log(`::error::stale baseline entry ${k} — remove it (lower the baseline) from scripts/migration-raise-codes-allowlist.json: that migration no longer drops that code.`);
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(dropped, null, 2));
  } else {
    for (const d of dropped) {
      console.log(`::error::${d.migration} redefines ${d.function} without RAISE '${d.code}' (present in ${d.previous}). Keep the guard, or allowlist it with a reason in scripts/migration-raise-codes-allowlist.json.`);
    }
    console.log(`migration-raise-codes: ${dropped.length} dropped guard(s) (enforced from ${ENFORCED_FROM}).`);
  }
  process.exit(dropped.length || stale.length ? 1 : 0);
}
