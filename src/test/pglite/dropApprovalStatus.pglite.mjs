#!/usr/bin/env node
/**
 * PGlite proof for 20260923205943_drop_profiles_approval_status (docs/OPEN.md Q288).
 *
 *   node src/test/pglite/dropApprovalStatus.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/dropApprovalStatus.pglite.mjs   # RED: the old state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Old state = the column as the migrations leave it before Q288: NOT NULL,
 * DEFAULT 'approved' (20260923172405) and CHECK profiles_approval_status_no_denied
 * (20260923153703, ADD statement read from that file, not retyped). The new
 * migration is applied THREE times (replay safety), then once more on a
 * database whose profiles table never had the column.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20260923205943_drop_profiles_approval_status.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the OLD state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const addCheck = /ALTER TABLE public\.profiles\s+ADD CONSTRAINT profiles_approval_status_no_denied\s+CHECK \(approval_status IN \('pending', 'approved'\)\);/.exec(
  mig("20260923153703_retire_denied_approval_status.sql"),
);
if (!addCheck) throw new Error("could not read the CHECK from 20260923153703");

const db = new PGlite();
await db.exec(`
  CREATE TABLE public.profiles (
    user_id uuid PRIMARY KEY,
    email_verified boolean NOT NULL DEFAULT false,
    approval_status text NOT NULL DEFAULT 'approved'
  );
  ${addCheck[0]}
  INSERT INTO public.profiles (user_id, email_verified) VALUES
    ('11111111-0000-0000-0000-000000000001', true),
    ('11111111-0000-0000-0000-000000000002', false);
`);

if (MODE !== "skip") {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(NEW);
      check(`migration applies (run ${i})`, true);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
}

const col = await db.query(
  `SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'approval_status'`,
);
check("profiles.approval_status is gone", col.rows[0].n === 0, `columns named approval_status: ${col.rows[0].n}`);

const con = await db.query(
  `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'profiles_approval_status_no_denied'`,
);
check("CHECK profiles_approval_status_no_denied is gone", con.rows[0].n === 0, `constraints: ${con.rows[0].n}`);

const rows = await db.query(`SELECT count(*)::int AS n FROM public.profiles`);
check("no profile row lost", rows.rows[0].n === 2, `rows: ${rows.rows[0].n}`);

try {
  await db.exec(`INSERT INTO public.profiles (user_id) VALUES ('11111111-0000-0000-0000-000000000003')`);
  check("a new profile inserts without the column", true);
} catch (e) {
  check("a new profile inserts without the column", false, e.message);
}

const bare = new PGlite();
await bare.exec(`CREATE TABLE public.profiles (user_id uuid PRIMARY KEY);`);
try {
  await bare.exec(NEW);
  check("no-op on a profiles table that never had the column", true);
} catch (e) {
  check("no-op on a profiles table that never had the column", false, e.message);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
