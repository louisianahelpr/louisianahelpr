#!/usr/bin/env node
/**
 * PGlite proof for 20260916030711_scope_direct_offer_policies_to_open_jobs.
 *
 *   node scripts/probes/direct-offer-policy-scope.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * Isolates the two direct-offer RLS policies on a minimal jobs table. A job is
 * ASSIGNED + funded (status=in_progress, helper_id=A) but a poster has RE-ARMED
 * a direct offer to a second account B (offered_to_helper_id=B, pending). As B:
 *   RED-BEFORE (old policy: offered_to=me AND pending): B can SELECT the job and
 *     UPDATE its status — a non-party writing a live assigned job.
 *   AFTER (adds status='open' AND helper_id IS NULL): the row is invisible to B,
 *     so SELECT returns 0 and the UPDATE matches 0 rows.
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20260916030711_scope_direct_offer_policies_to_open_jobs.sql", import.meta.url).pathname,
  "utf8",
);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const A = "11111111-1111-1111-1111-111111111111"; // assigned helper
const B = "22222222-2222-2222-2222-222222222222"; // re-armed offer target (non-party)

const SETUP = `
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='job_status') THEN
    CREATE TYPE job_status AS ENUM ('open','accepted','in_progress','completed','cancelled'); END IF; END $$;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status job_status NOT NULL DEFAULT 'open',
    helper_id uuid,
    customer_id uuid,
    offered_to_helper_id uuid,
    direct_offer_status text
  );
  ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
  GRANT SELECT, UPDATE ON public.jobs TO authenticated;
  -- OLD (pre-fix) policy shapes:
  CREATE POLICY "Targeted helper can respond to direct offer" ON public.jobs FOR UPDATE TO authenticated
    USING (offered_to_helper_id = (SELECT auth.uid()) AND direct_offer_status = 'pending');
  CREATE POLICY "Targeted helper can view direct offer" ON public.jobs FOR SELECT TO authenticated
    USING (offered_to_helper_id IS NOT NULL AND offered_to_helper_id = (SELECT auth.uid()) AND direct_offer_status = 'pending');
`;

const asB = async (db) => {
  await db.exec("SET ROLE authenticated");
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${B}', false)`);
};
const asSuper = async (db) => { await db.exec("RESET ROLE"); };

async function run(db) {
  // Assigned + funded job, offer RE-ARMED to B.
  await db.exec(`INSERT INTO public.jobs (id, status, helper_id, customer_id, offered_to_helper_id, direct_offer_status)
                 VALUES ('33333333-3333-3333-3333-333333333333','in_progress','${A}','44444444-4444-4444-4444-444444444444','${B}','pending')`);
  await asB(db);
  const sel = await db.query(`SELECT id FROM public.jobs`);
  const upd = await db.query(`UPDATE public.jobs SET status='open' WHERE id='33333333-3333-3333-3333-333333333333'`);
  await asSuper(db);
  return { sawRows: sel.rows.length, updated: upd.affectedRows ?? 0 };
}

// ── RED-BEFORE: old policies ────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(SETUP);
  const r = await run(db);
  check("RED-BEFORE non-party B can SEE the assigned job", r.sawRows === 1, `saw ${r.sawRows}`);
  check("RED-BEFORE non-party B can UPDATE status on the assigned job", r.updated === 1, `updated ${r.updated}`);
  await db.close();
}

// ── AFTER: migration applied ────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(SETUP);
  await db.exec(MIGRATION);
  const r = await run(db);
  check("AFTER non-party B cannot SEE the assigned job", r.sawRows === 0, `saw ${r.sawRows}`);
  check("AFTER non-party B cannot UPDATE the assigned job", r.updated === 0, `updated ${r.updated}`);
  // Sanity: an OPEN, unassigned re-offer to B is still reachable (legit accept path).
  await db.exec(`INSERT INTO public.jobs (id, status, helper_id, customer_id, offered_to_helper_id, direct_offer_status)
                 VALUES ('55555555-5555-5555-5555-555555555555','open',NULL,'44444444-4444-4444-4444-444444444444','${B}','pending')`);
  await asB(db);
  const openSel = await db.query(`SELECT id FROM public.jobs`);
  await asSuper(db);
  check("AFTER B can still SEE an OPEN unassigned offer (legit path intact)", openSel.rows.length === 1, `saw ${openSel.rows.length}`);
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
