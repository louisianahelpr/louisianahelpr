#!/usr/bin/env node
/**
 * Apply a bad migration once, then its revert N times, in PGlite (CLAUDE.md:
 * "execute migrations locally with PGlite ... apply 3x for replay-safety").
 * Used by scripts/rollback/rollback.mjs (migration path); docs/RUNBOOK-rollback.md.
 *
 *   node scripts/rollback/pglite-apply.mjs <bad.sql> <revert.sql> [times=3]
 *
 * pglite is not a dependency: npm i @electric-sql/pglite in ~/.lh-pglite (or
 * set PGLITE_DIR). A stub prelude supplies the roles and auth.uid() most
 * migrations reference; a migration that needs real prod tables needs a
 * prod-shaped schema dump prepended with --prelude <file.sql>.
 */
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const preIdx = argv.indexOf("--prelude");
const prelude = preIdx >= 0 ? readFileSync(argv.splice(preIdx, 2)[1], "utf8") : "";
const [bad, revert, timesRaw] = argv;
if (!bad || !revert) {
  console.error("usage: pglite-apply.mjs <bad.sql> <revert.sql> [times=3] [--prelude schema.sql]");
  process.exit(2);
}
const times = Number(timesRaw || 3);
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
const db = new PGlite();
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
`);
if (prelude) await db.exec(prelude);
const t0 = Date.now();
await db.exec(readFileSync(bad, "utf8"));
console.log(`applied bad migration ${bad}`);
for (let i = 1; i <= times; i++) {
  await db.exec(readFileSync(revert, "utf8"));
  console.log(`applied revert ${i}/${times}`);
}
console.log(`PGlite OK in ${Date.now() - t0}ms`);
