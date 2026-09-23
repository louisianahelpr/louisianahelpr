#!/usr/bin/env node
/**
 * migration-lint Rule 1: every table a migration creates must have RLS enabled
 * in the same migration.
 *
 *   node scripts/check-migration-rls.mjs <file.sql> [...]
 *
 * Exits non-zero on a violation.
 *
 * WHY THIS IS A SCRIPT AND NOT A GREP (Q118). Rule 1 used to be, inline in
 * migration-lint.yml:
 *     grep -ioE "create table (if not exists )?(public\.)?[a-z_]+"
 * and it had two false-positive shapes, both measured over the whole history:
 *   1. It read COMMENTS as DDL. A header "-- Replay-safe: CREATE TABLE IF NOT
 *      EXISTS, CREATE OR REPLACE ..." parsed as a table named "IF" (db-deploy
 *      run 35847561964), and "-- ... CREATE TABLE IF NOT EXISTS will not
 *      revisit" as a table named "will" (20260915034822).
 *   2. Its name class had no digits, so public.helper_w9_records was read as
 *      "helper_w", which never has RLS enabled (20260609180000).
 * Comments are now blanked first (see stripSqlComments) and names take digits,
 * `$` and double quotes. Everything that is NOT a comment is still read:
 * string literals and dollar-quoted bodies keep their text, so a CREATE TABLE
 * inside `EXECUTE '...'` or a function body is still a table this rule checks,
 * exactly as the grep treated it.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * Blank `--` line comments and `/* *\/` block comments (nested, as Postgres
 * nests them), keeping every other character. Not comments, and so kept
 * verbatim: '...' and E'...' string literals, "..." identifiers, and the
 * delimiters of dollar-quoted strings. A dollar-quoted body is itself scanned
 * with the same rules, because inside a PL/pgSQL or SQL function body `--` is a
 * comment too; the scan of a body is bounded by that body, so an unbalanced `'`
 * in a plain-text $$...$$ can only stop comment-stripping inside that body
 * (leaving more text to match, never less).
 */
export function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; continue; }
        i++;
      }
      out += " ";
      continue;
    }
    if (c === "'") {
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]) && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? "");
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      const end = sql.indexOf('"', i + 1);
      const j = end === -1 ? n : end + 1;
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === "$" && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? "")) {
      const m = DOLLAR_TAG.exec(sql.slice(i, i + 66));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const bodyEnd = close === -1 ? n : close;
        out += tag + stripSqlComments(sql.slice(i + tag.length, bodyEnd));
        if (close !== -1) out += tag;
        i = close === -1 ? n : close + tag.length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;
const CREATE_TABLE = new RegExp(
  String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:(${IDENT})\s*\.\s*)?(${IDENT})`,
  "gi",
);
const unquote = (s) => (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase());
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tables created in `sqlText` without ENABLE ROW LEVEL SECURITY in the same text. */
export function tablesWithoutRls(sqlText) {
  const sql = stripSqlComments(sqlText);
  const missing = [];
  const seen = new Set();
  for (const m of sql.matchAll(CREATE_TABLE)) {
    const schema = m[1] ? unquote(m[1]) : null;
    const name = unquote(m[2]);
    const key = `${schema ?? ""}.${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const schemaPart = schema
      ? String.raw`(?:"${esc(schema)}"|${esc(schema)})\s*\.\s*`
      : String.raw`(?:(?:"public"|public)\s*\.\s*)?`;
    const enable = new RegExp(
      String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${schemaPart}(?:"${esc(name)}"|${esc(name)})(?![a-z0-9_$])\s+enable\s+row\s+level\s+security`,
      "i",
    );
    if (!enable.test(sql)) missing.push(schema ? `${schema}.${name}` : name);
  }
  return missing;
}

function main(files) {
  let fail = 0;
  for (const file of files) {
    for (const t of tablesWithoutRls(readFileSync(file, "utf8"))) {
      console.log(`  ❌ ${file}: Table '${t}' created but RLS not enabled in same migration`);
      console.log(`     Add: ALTER TABLE ${t.includes(".") ? t : `public.${t}`} ENABLE ROW LEVEL SECURITY;`);
      fail = 1;
    }
  }
  if (fail) process.exit(1);
  console.log(`✅ Rule 1: every table created in ${files.length} migration(s) enables RLS in the same file.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const files = process.argv.slice(2).filter(Boolean);
  if (files.length === 0) {
    console.error("usage: node scripts/check-migration-rls.mjs <file.sql> [...]");
    process.exit(2);
  }
  main(files);
}
