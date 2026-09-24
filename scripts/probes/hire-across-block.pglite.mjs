#!/usr/bin/env node
/**
 * PGlite proof for 20260924023314_hire_refused_across_block (Q345 items 1+3).
 *
 *   node scripts/probes/hire-across-block.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * FIXTURE (prod-shaped columns the three RPCs read/write). Poster P owns open
 * jobs; B blocked P; H is unrelated. B's application predates the block (seeded
 * directly, no trigger here: this probes the RPCs, C10 is Q341's probe).
 *
 *   RED-BEFORE (the migration with every `IF public.are_users_blocked(...)`
 *     block cut out, derived): P hires B through accept_application and
 *     accept_group_application; B accepts P's direct offer.
 *   AFTER (migration verbatim, applied 3x): all three raise applicant_blocked;
 *     H is still hired on each path; B can still DECLINE the offer.
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
  new URL("../../supabase/migrations/20260924023314_hire_refused_across_block.sql", import.meta.url).pathname,
  "utf8",
);
const CHECK = /\n\s*IF public\.are_users_blocked\([^\n]*\) THEN\n\s*RAISE EXCEPTION 'applicant_blocked'[^;]*;\n\s*END IF;/g;
const found = MIGRATION.match(CHECK)?.length ?? 0;
if (found !== 3) {
  console.error(`FAIL  expected 3 block checks in the migration, found ${found} — the probe would be vacuous.`);
  process.exit(2);
}
const BEFORE = MIGRATION.replace(CHECK, "");
if (/RAISE EXCEPTION 'applicant_blocked'/.test(BEFORE)) {
  console.error("FAIL  the excision left a check behind.");
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const P = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const H = "55555555-5555-5555-5555-555555555555";
const J1 = "a0000000-0000-0000-0000-000000000001"; // single, B applied
const J2 = "a0000000-0000-0000-0000-000000000002"; // single, H applied
const G1 = "a0000000-0000-0000-0000-000000000003"; // group, B + H applied
const O1 = "a0000000-0000-0000-0000-000000000004"; // direct offer to B
const O2 = "a0000000-0000-0000-0000-000000000005"; // direct offer to H
const O3 = "a0000000-0000-0000-0000-000000000006"; // direct offer to B (decline)

const SETUP = `
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE OR REPLACE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
    SELECT EXISTS (SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = _user_a AND blocked_id = _user_b) OR (blocker_id = _user_b AND blocked_id = _user_a)) $f$;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text, title text,
    is_group_job boolean DEFAULT false, helpers_needed int, response_deadline timestamptz,
    offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
    helper_confirmed_at timestamptz);
  CREATE TABLE public.applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
    message text, offer_message text, UNIQUE (job_id, helper_id));
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, UNIQUE (job_id, helper_id));
  CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid);
`;
const SEED = `
  INSERT INTO public.user_blocks VALUES ('${B}', '${P}');
  INSERT INTO public.jobs (id, customer_id, status, title) VALUES ('${J1}', '${P}', 'open', 'j1'), ('${J2}', '${P}', 'open', 'j2');
  INSERT INTO public.jobs (id, customer_id, status, title, is_group_job, helpers_needed) VALUES ('${G1}', '${P}', 'open', 'g1', true, 3);
  INSERT INTO public.jobs (id, customer_id, status, title, offered_to_helper_id, direct_offer_status) VALUES
    ('${O1}', '${P}', 'open', 'o1', '${B}', 'pending'), ('${O2}', '${P}', 'open', 'o2', '${H}', 'pending'),
    ('${O3}', '${P}', 'open', 'o3', '${B}', 'pending');
  INSERT INTO public.applications (id, job_id, helper_id, status) VALUES
    ('b0000000-0000-0000-0000-000000000001', '${J1}', '${B}', 'pending'),
    ('b0000000-0000-0000-0000-000000000002', '${J2}', '${H}', 'pending'),
    ('b0000000-0000-0000-0000-000000000003', '${G1}', '${B}', 'pending'),
    ('b0000000-0000-0000-0000-000000000004', '${G1}', '${H}', 'pending');
`;

async function attempt(db, as, sql) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${as}', false)`);
  try {
    await db.query(sql);
    return "ok";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
}

async function run(label, migration, times) {
  const db = new PGlite();
  await db.exec(SETUP);
  for (let i = 0; i < times; i++) await db.exec(migration);
  await db.exec(SEED);
  const r = {
    single: await attempt(db, P, `SELECT public.accept_application('b0000000-0000-0000-0000-000000000001', now() + interval '1 day')`),
    singleH: await attempt(db, P, `SELECT public.accept_application('b0000000-0000-0000-0000-000000000002', now() + interval '1 day')`),
    group: await attempt(db, P, `SELECT * FROM public.accept_group_application('b0000000-0000-0000-0000-000000000003')`),
    groupH: await attempt(db, P, `SELECT * FROM public.accept_group_application('b0000000-0000-0000-0000-000000000004')`),
    offer: await attempt(db, B, `SELECT public.respond_to_direct_offer('${O1}', true)`),
    offerH: await attempt(db, H, `SELECT public.respond_to_direct_offer('${O2}', true)`),
    decline: await attempt(db, B, `SELECT public.respond_to_direct_offer('${O3}', false)`),
  };
  const hired = (await db.query(`SELECT count(*)::int n FROM public.applications WHERE helper_id = '${B}' AND status = 'accepted'`)).rows[0].n;
  await db.close();
  console.log(`-- ${label}: ${JSON.stringify(r)} B-accepted=${hired}`);
  return { ...r, hired };
}

const before = await run("RED-BEFORE (block checks excised)", BEFORE, 1);
check("before: B is hired across the block on all three paths", before.single === "ok" && before.group === "ok" && before.offer === "ok" && before.hired === 3, `B-accepted=${before.hired}`);

const after = await run("AFTER (migration verbatim, 3x)", MIGRATION, 3);
check("after: accept_application refuses B", after.single === "applicant_blocked", after.single);
check("after: accept_group_application refuses B", after.group === "applicant_blocked", after.group);
check("after: respond_to_direct_offer(accept) refuses B", after.offer === "applicant_blocked", after.offer);
check("after: no row of B's became accepted", after.hired === 0, `B-accepted=${after.hired}`);
check("after: H is still hired on every path", after.singleH === "ok" && after.groupH === "ok" && after.offerH === "ok");
check("after: B can still decline an offer", after.decline === "ok", after.decline);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
