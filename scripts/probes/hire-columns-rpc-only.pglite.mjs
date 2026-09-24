#!/usr/bin/env node
/**
 * PGlite proof for 20260924042503_hire_columns_rpc_only (Q346).
 *
 *   node scripts/probes/hire-columns-rpc-only.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * Seats: the client is `SET ROLE authenticated` (what PostgREST does); the
 * hire RPC is a SECURITY DEFINER function owned by the superuser (as every live
 * hire RPC is owned by postgres); service_role is an edge function.
 *
 *   RED-BEFORE (schema without the migration): the four client doors land —
 *     poster PATCH helper_id+accepted, offered helper PATCH self+accepted,
 *     poster re-points offered_to_helper_id, poster INSERTs a crew row.
 *   AFTER (migration verbatim, applied 3x): all four refused with
 *     hire_requires_rpc; the definer RPC still hires (single + crew);
 *     service_role still writes; a client can still clear helper_id, clear an
 *     offer and edit an unrelated column.
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
  new URL("../../supabase/migrations/20260924042503_hire_columns_rpc_only.sql", import.meta.url).pathname,
  "utf8",
);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const P = "11111111-1111-1111-1111-111111111111"; // poster
const H = "22222222-2222-2222-2222-222222222222"; // helper
const X = "33333333-3333-3333-3333-333333333333"; // someone else
const J = (n) => `a0000000-0000-0000-0000-00000000000${n}`;

const SETUP = `
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
  CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled');
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status public.job_status DEFAULT 'open',
    title text, offered_to_helper_id uuid, direct_offer_status text);
  CREATE TABLE public.group_job_helpers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text DEFAULT 'accepted');
  GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
  GRANT SELECT, UPDATE ON public.jobs TO authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE ON public.group_job_helpers TO authenticated, service_role;
  CREATE FUNCTION public.hire_rpc(j uuid, h uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS
    $f$ UPDATE public.jobs SET helper_id = h, status = 'accepted' WHERE id = j $f$;
  CREATE FUNCTION public.crew_rpc(j uuid, h uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS
    $f$ INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES (j, h) $f$;
  GRANT EXECUTE ON FUNCTION public.hire_rpc(uuid, uuid), public.crew_rpc(uuid, uuid) TO authenticated;
`;
const SEED = `
  INSERT INTO public.jobs (id, customer_id, title) VALUES
    ('${J(1)}', '${P}', 'A'), ('${J(4)}', '${P}', 'D'), ('${J(5)}', '${P}', 'rpc'),
    ('${J(6)}', '${P}', 'crew'), ('${J(7)}', '${P}', 'sr');
  INSERT INTO public.jobs (id, customer_id, title, offered_to_helper_id, direct_offer_status) VALUES
    ('${J(2)}', '${P}', 'B', '${H}', 'pending'), ('${J(3)}', '${P}', 'C', '${H}', 'pending');
  INSERT INTO public.jobs (id, customer_id, title, helper_id, status) VALUES ('${J(8)}', '${P}', 'clear', '${H}', 'accepted');
`;

async function as(db, role, sql) {
  try {
    await db.exec(`SET ROLE ${role}; ${sql}; RESET ROLE;`);
    return "ok";
  } catch (e) {
    await db.exec("RESET ROLE");
    return String(e.message).split("\n")[0];
  }
}

async function run(label, migration, times) {
  const db = new PGlite();
  await db.exec(SETUP);
  for (let i = 0; i < times; i++) await db.exec(migration);
  await db.exec(SEED);
  const r = {
    A: await as(db, "authenticated", `UPDATE public.jobs SET helper_id='${H}', status='accepted' WHERE id='${J(1)}'`),
    B: await as(db, "authenticated", `UPDATE public.jobs SET helper_id='${H}', status='accepted' WHERE id='${J(2)}'`),
    B_statusOnly: await as(db, "authenticated", `UPDATE public.jobs SET status='accepted' WHERE id='${J(4)}'`),
    C: await as(db, "authenticated", `UPDATE public.jobs SET offered_to_helper_id='${X}' WHERE id='${J(3)}'`),
    D: await as(db, "authenticated", `INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${J(4)}', '${H}')`),
    rpc: await as(db, "authenticated", `SELECT public.hire_rpc('${J(5)}', '${H}')`),
    crew: await as(db, "authenticated", `SELECT public.crew_rpc('${J(6)}', '${H}')`),
    sr: await as(db, "service_role", `UPDATE public.jobs SET helper_id='${H}', status='accepted' WHERE id='${J(7)}'`),
    clearHelper: await as(db, "authenticated", `UPDATE public.jobs SET helper_id=NULL WHERE id='${J(8)}'`),
    clearOffer: await as(db, "authenticated", `UPDATE public.jobs SET offered_to_helper_id=NULL, direct_offer_status='withdrawn' WHERE id='${J(2)}'`),
    editTitle: await as(db, "authenticated", `UPDATE public.jobs SET title='renamed' WHERE id='${J(1)}'`),
    rePointCrew: await as(db, "authenticated", `UPDATE public.group_job_helpers SET helper_id='${X}' WHERE job_id='${J(6)}'`),
  };
  const rows = (await db.query(`SELECT id, helper_id, status::text, offered_to_helper_id FROM public.jobs ORDER BY id`)).rows;
  const crew = (await db.query(`SELECT count(*)::int n FROM public.group_job_helpers`)).rows[0].n;
  await db.close();
  console.log(`-- ${label}: ${JSON.stringify(r)} crewRows=${crew}`);
  return { r, rows: Object.fromEntries(rows.map((x) => [x.id, x])), crew };
}

const before = await run("RED-BEFORE (no migration)", "", 1);
check("before: all four client doors land", ["A", "B", "C", "D"].every((k) => before.r[k] === "ok"),
  JSON.stringify({ A: before.r.A, B: before.r.B, C: before.r.C, D: before.r.D }));

const after = await run("AFTER (migration verbatim, 3x)", MIGRATION, 3);
const refused = (v) => /hire_requires_rpc/.test(v);
check("after: A poster PATCH hire refused", refused(after.r.A), after.r.A);
check("after: B offered-helper PATCH self-hire refused", refused(after.r.B), after.r.B);
check("after: status-only flip to accepted refused", refused(after.r.B_statusOnly), after.r.B_statusOnly);
check("after: C offer re-point refused", refused(after.r.C), after.r.C);
check("after: D crew INSERT refused", refused(after.r.D), after.r.D);
check("after: crew helper_id re-point refused", refused(after.r.rePointCrew), after.r.rePointCrew);
check("after: A/B/C rows unchanged",
  after.rows[J(1)].helper_id === null && after.rows[J(1)].status === "open" &&
  after.rows[J(3)].offered_to_helper_id === H);
check("after: definer hire RPC still hires", after.r.rpc === "ok" && after.rows[J(5)].helper_id === H && after.rows[J(5)].status === "accepted", after.r.rpc);
check("after: definer crew RPC still inserts", after.r.crew === "ok" && after.crew === 1, after.r.crew);
check("after: service_role still writes", after.r.sr === "ok" && after.rows[J(7)].helper_id === H, after.r.sr);
check("after: client can clear helper_id", after.r.clearHelper === "ok" && after.rows[J(8)].helper_id === null, after.r.clearHelper);
check("after: client can withdraw an offer", after.r.clearOffer === "ok", after.r.clearOffer);
check("after: client can edit an unrelated column", after.r.editTitle === "ok", after.r.editTitle);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
