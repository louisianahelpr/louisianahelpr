#!/usr/bin/env node
/**
 * Create a new Supabase migration with a version that CANNOT collide.
 *
 * Three version collisions happened across parallel lanes in a single day.
 * Every one of them failed `supabase db push` with
 *   duplicate key value violates unique constraint "schema_migrations_pkey"
 * which rolls the whole migration back and costs a red deploy plus a
 * fix-forward commit. The cause was always the same: a human typed a
 * plausible-looking timestamp (or copied a neighbouring file's) instead of
 * stamping the clock.
 *
 * Usage:  npm run migration:new -- <slug> ["one-line summary"]
 *
 * The slug becomes the filename suffix; the summary (optional) seeds the
 * header. The script REFUSES to write if the stamped version already exists,
 * and bumps by one second up to a small bound so two lanes running in the same
 * second still both get a file rather than one silently overwriting the other.
 */
import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");

const [rawSlug, ...summaryParts] = process.argv.slice(2);
if (!rawSlug) {
  console.error(
    "usage: npm run migration:new -- <slug> [\"one-line summary\"]\n" +
      "  e.g. npm run migration:new -- lock_jobs_price_column",
  );
  process.exit(1);
}

const slug = rawSlug
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");
if (!slug) {
  console.error(`Slug "${rawSlug}" has no usable characters.`);
  process.exit(1);
}

/** UTC stamp, matching the house format `YYYYMMDDHHMMSS`. */
function stamp(date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

const existing = new Set(
  readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, 14)),
);

let version = null;
const base = Date.now();
for (let i = 0; i < 120; i++) {
  const candidate = stamp(new Date(base + i * 1000));
  if (!existing.has(candidate)) {
    version = candidate;
    break;
  }
}
if (!version) {
  console.error(
    "Refusing to create a migration: every version in the next two minutes is\n" +
      "already taken in supabase/migrations/. That should be impossible — look\n" +
      "for back-dated or future-dated files before retrying.",
  );
  process.exit(1);
}

const filename = `${version}_${slug}.sql`;
const path = resolve(migrationsDir, filename);
if (existsSync(path)) {
  // Belt and braces: the version scan above already ruled this out.
  console.error(`Refusing to overwrite existing migration: ${filename}`);
  process.exit(1);
}

const summary = summaryParts.join(" ").trim();

const body = `-- ${summary || "TODO: say, in plain language, WHAT was broken and WHY this fixes it."}
--
-- House style: the header explains the problem a reader would otherwise have
-- to reconstruct from the SQL. Name the symptom, the blast radius, and the
-- decision you made. Delete this paragraph once you have written that.
--
-- REPLAY-SAFETY: a from-scratch rebuild runs every migration in timestamp
-- order, so this file must be safe to run against a database that does not yet
-- contain objects defined by LATER migrations. Guard DDL accordingly:
--   IF to_regprocedure('public.some_fn(uuid)') IS NOT NULL THEN ... END IF;
-- and prefer CREATE ... IF NOT EXISTS / CREATE OR REPLACE throughout.

`;

writeFileSync(path, body, "utf8");
console.log(`supabase/migrations/${filename}`);
