#!/usr/bin/env node
/**
 * PGlite proof for 20260926034721_are_users_blocked_party_only (Q348).
 *
 *   node scripts/probes/are-users-blocked-party.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * FIXTURE. A blocked B. C is a third party. H is unrelated to both.
 *   RED-BEFORE (the live body, pg_get_functiondef 2026-09-26): C asks
 *     are_users_blocked(A, B) by RPC and learns TRUE.
 *   AFTER (migration verbatim, applied 3x):
 *     - C gets NULL for (A, B) and for (A, H): the same answer for a blocked
 *       and an unblocked pair, so nothing leaks;
 *     - A and B each still get TRUE, in either argument order; A gets FALSE
 *       for (A, H) (a rule that answers nothing is not a fix);
 *     - a server context (no JWT) still gets TRUE;
 *     - a SECURITY DEFINER caller owned by the migration role (the accept_*
 *       shape) still sees the block when the signed-in user is a party;
 *     - the live "Helpers can create applications" policy still refuses B's
 *       application to A's job, and still admits H's;
 *     - proacl: no PUBLIC/anon EXECUTE; authenticated keeps it.
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
  new URL("../../supabase/migrations/20260926034721_are_users_blocked_party_only.sql", import.meta.url).pathname,
  "utf8",
);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const H = "55555555-5555-5555-5555-555555555555";
const JOB = "44444444-4444-4444-4444-444444444444";

const SETUP = `
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub','')::uuid $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'role','') $$;
  GRANT USAGE ON SCHEMA public TO authenticated, anon;

  CREATE TABLE public.user_blocks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id uuid NOT NULL, blocked_id uuid NOT NULL, UNIQUE (blocker_id, blocked_id));
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid);
  CREATE TABLE public.applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, helper_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending');

  -- Live shapes (pg_get_functiondef on prod, 2026-09-26).
  CREATE OR REPLACE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid)
   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $function$
    SELECT EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = _user_a AND blocked_id = _user_b)
         OR (blocker_id = _user_b AND blocked_id = _user_a)
    );
  $function$;
  CREATE OR REPLACE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS
    $$ SELECT auth.uid() IS NULL
          AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
          AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
  CREATE OR REPLACE FUNCTION public.get_job_customer_id(_job_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
    $$ SELECT customer_id FROM public.jobs WHERE id = _job_id $$;
  -- The accept_* shape: a definer that checks the block between the poster
  -- (the signed-in user) and a helper.
  CREATE OR REPLACE FUNCTION public.definer_checks_block(p_helper uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
    BEGIN RETURN public.are_users_blocked(p_helper, auth.uid()); END $$;
  REVOKE ALL ON FUNCTION public.are_users_blocked(uuid, uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.are_users_blocked(uuid, uuid) TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.definer_checks_block(uuid), public.get_job_customer_id(uuid), public.is_server_context() TO authenticated;

  ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
  GRANT SELECT, INSERT ON public.applications TO authenticated;
  CREATE POLICY "Helpers can create applications" ON public.applications FOR INSERT TO authenticated
    WITH CHECK (((SELECT auth.uid()) = helper_id) AND (status = 'pending')
                AND (NOT are_users_blocked(helper_id, get_job_customer_id(job_id))));
  CREATE POLICY "own" ON public.applications FOR SELECT TO authenticated USING ((SELECT auth.uid()) = helper_id);

  INSERT INTO public.jobs VALUES ('${JOB}', '${A}');
  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${A}', '${B}');
`;

async function as(db, who, sql, params = []) {
  try {
    await db.exec("BEGIN");
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: "authenticated" })]);
    await db.exec("SET LOCAL ROLE authenticated");
    const r = await db.query(sql, params);
    await db.exec("COMMIT");
    return { ok: true, rows: r.rows, err: null };
  } catch (e) {
    await db.exec("ROLLBACK").catch(() => {});
    return { ok: false, rows: [], err: String(e?.message ?? e) };
  }
}
const ask = async (db, who, x, y) => {
  const r = await as(db, who, `SELECT public.are_users_blocked($1, $2) AS b`, [x, y]);
  return r.ok ? r.rows[0].b : `ERR ${r.err}`;
};
const apply = (db, who) =>
  as(db, who, `INSERT INTO public.applications (job_id, helper_id) VALUES ($1, $2) RETURNING id`, [JOB, who]);

// ── RED-BEFORE ──────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(SETUP);
  const v = await ask(db, C, A, B);
  check("RED-BEFORE a third party learns that A and B are blocked", v === true, String(v));
  await db.close();
}

// ── AFTER, migration applied 3x ─────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(SETUP);
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIGRATION);
      check(`AFTER migration apply #${i} succeeds (replay-safe)`, true);
    } catch (e) {
      check(`AFTER migration apply #${i} succeeds (replay-safe)`, false, String(e?.message ?? e));
    }
  }
  const cBlocked = await ask(db, C, A, B);
  const cFree = await ask(db, C, A, H);
  check("AFTER a third party gets NULL for a blocked pair", cBlocked === null, String(cBlocked));
  check("AFTER ...and the same NULL for an unblocked pair (nothing leaks)", cFree === null, String(cFree));
  check("AFTER party A still sees the block (A, B)", (await ask(db, A, A, B)) === true);
  check("AFTER party A still sees the block in reverse order (B, A)", (await ask(db, A, B, A)) === true);
  check("AFTER party B still sees the block", (await ask(db, B, A, B)) === true);
  check("AFTER party A gets FALSE for an unblocked pair (A, H)", (await ask(db, A, A, H)) === false);
  const server = (await db.query(`SELECT public.are_users_blocked($1, $2) AS b`, [A, B])).rows[0].b;
  check("AFTER a server context (no JWT) still sees the block", server === true, String(server));
  const viaDefiner = await as(db, A, `SELECT public.definer_checks_block($1) AS b`, [B]);
  check("AFTER a DEFINER caller (accept_* shape) still sees the block for a party", viaDefiner.rows[0]?.b === true, viaDefiner.err ?? String(viaDefiner.rows[0]?.b));
  const b = await apply(db, B);
  check("AFTER the applications INSERT policy still refuses the blocked helper", !b.ok, b.err ?? "LANDED");
  const h = await apply(db, H);
  check("AFTER ...and still admits an unrelated helper", h.ok, h.err ?? "landed");
  const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'are_users_blocked'`)).rows[0].a;
  check("AFTER proacl has no PUBLIC (=X) or anon EXECUTE", !/(^|[{,])=X/.test(acl) && !/anon=/.test(acl), acl);
  check("AFTER proacl keeps authenticated", /authenticated=X/.test(acl), acl);
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
