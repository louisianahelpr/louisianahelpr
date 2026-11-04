#!/usr/bin/env node
/**
 * PGlite proof for 20261104060659_notification_actor_face.sql (Q2037 faces).
 *
 *   node src/test/pglite/notificationActorFace.pglite.mjs                    # AFTER: migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/notificationActorFace.pglite.mjs # RED: column only, no triggers
 *
 * auth.uid() reads request.jwt.claim.sub as Supabase's does; has_role reads user_roles. Checks:
 *  - a member's action that notifies the other party of a job stamps the member as actor;
 *  - a member cannot stamp someone else's face (a forged actor_id is overwritten);
 *  - an admin's notice, a notice to oneself, and a non-job notice carry no actor;
 *  - service role (no auth.uid()) may set an actor on a job notice, never on a non-job notice;
 *  - the purge (anonymized_at set) clears the departed member's actor_id on other members' rows; replay-safe;
 *  - deleting the profile row nulls it too (ON DELETE SET NULL);
 *  - the trigger functions are not executable by PUBLIC/anon/authenticated.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = readFileSync(new URL("../../../supabase/migrations/20261104060659_notification_actor_face.sql", import.meta.url).pathname, "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: column only, no triggers (expect FAILs)");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), HELPR = U(2), ADMIN = U(3), CREW2 = U(4), J1 = U(91), CREWJOB = U(92);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, full_name text, anonymized_at timestamptz);
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
  CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
  CREATE TABLE public.user_blocks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), blocker_id uuid NOT NULL, blocked_id uuid NOT NULL,
    reason text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (blocker_id, blocked_id));
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, title text, message text, type text, link text,
    job_id uuid, read boolean DEFAULT false);
  INSERT INTO public.profiles (user_id, full_name) VALUES ('${POSTER}', 'Pat Poster'), ('${HELPR}', 'Hal Helpr'), ('${ADMIN}', 'Ada Admin'), ('${CREW2}', 'Cy Crew');
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
`);
if (SKIP) await db.exec(`ALTER TABLE public.notifications ADD COLUMN actor_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL;`);
else for (let i = 0; i < 3; i++) await db.exec(MIG);

let fails = 0, passes = 0;
const check = (name, ok) => { if (ok) { passes++; console.log(`PASS ${name}`); } else { fails++; console.log(`FAIL ${name}`); } };
const as = async (uid, sql) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  const r = await db.query(sql);
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  return r.rows;
};
const ins = (uid, to, job, actor = null) =>
  as(uid, `INSERT INTO public.notifications (user_id, title, job_id, actor_id) VALUES ('${to}', 't', ${job ? `'${job}'` : "NULL"}, ${actor ? `'${actor}'` : "NULL"}) RETURNING actor_id`);

check("a Helpr applying stamps the Helpr on the poster's notice", (await ins(HELPR, POSTER, J1))[0].actor_id === HELPR);
check("a forged actor_id from a member is overwritten with the caller", (await ins(HELPR, POSTER, J1, ADMIN))[0].actor_id === HELPR);
check("an admin's notice carries no face", (await ins(ADMIN, HELPR, J1))[0].actor_id === null);
check("a notice to oneself carries no face", (await ins(POSTER, POSTER, J1, HELPR))[0].actor_id === null);
check("a non-job notice carries no face", (await ins(HELPR, POSTER, null, HELPR))[0].actor_id === null);
check("service role may name the actor on a job notice", (await ins(null, POSTER, J1, HELPR))[0].actor_id === HELPR);
check("service role cannot put a face on a non-job notice", (await ins(null, POSTER, null, HELPR))[0].actor_id === null);

// block_user_and_settle on a crew job, in ONE transaction as the RPC runs it: the user_blocks row first, then the
// crew notices ("A Helpr left your crew" to the poster, "You're off this crew" to the Helpr) and "Job cancelled".
{
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${CREW2}', false);`);
  await db.exec("BEGIN");
  await db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${CREW2}', '${POSTER}');`);
  const left = (await db.query(`INSERT INTO public.notifications (user_id, title, job_id) VALUES ('${POSTER}', 'A Helpr left your crew', '${CREWJOB}') RETURNING actor_id`)).rows[0];
  const cancelled = (await db.query(`INSERT INTO public.notifications (user_id, title, job_id) VALUES ('${POSTER}', 'Job cancelled', '${CREWJOB}') RETURNING actor_id`)).rows[0];
  await db.exec("COMMIT");
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${POSTER}', false);`);
  await db.exec("BEGIN");
  await db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${POSTER}', '${HELPR}');`);
  const off = (await db.query(`INSERT INTO public.notifications (user_id, title, job_id) VALUES ('${HELPR}', 'You''re off this crew', '${CREWJOB}') RETURNING actor_id`)).rows[0];
  await db.exec("COMMIT");
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  check("block-and-settle: the poster's crew notice shows no face (Helpr blocked the poster)", left.actor_id === null);
  check("block-and-settle: the poster's 'Job cancelled' shows no face", cancelled.actor_id === null);
  check("block-and-settle: the blocked Helpr's 'off this crew' shows no face (poster blocked them)", off.actor_id === null);
  check("a third member with no block still gets a face", (await ins(CREW2, HELPR, CREWJOB))[0].actor_id === CREW2);
  await db.exec(`DELETE FROM public.user_blocks;`);
}

const before = (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE actor_id = '${HELPR}'`)).rows[0].n;
await db.exec(`UPDATE public.profiles SET full_name = NULL, anonymized_at = now() WHERE user_id = '${HELPR}' AND anonymized_at IS NULL;`);
const after = (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE actor_id = '${HELPR}'`)).rows[0].n;
check(`the purge clears the departed member's face (${before} -> ${after})`, before >= 3 && after === 0);

await ins(POSTER, HELPR, J1);
await db.exec(`DELETE FROM public.profiles WHERE user_id = '${POSTER}';`);
check("deleting the profile nulls actor_id", (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE actor_id = '${POSTER}'`)).rows[0].n === 0);

for (const fn of ["notifications_stamp_actor", "clear_departed_member_notification_actor"]) {
  const r = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = '${fn}'`)).rows[0];
  const acl = r?.a ?? "";
  check(`${fn} not executable by PUBLIC/anon/authenticated`, !!r && !/(^|[{,])=X|anon=|authenticated=/.test(acl));
}

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
