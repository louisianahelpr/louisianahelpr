#!/usr/bin/env node
/**
 * PGlite proof for 20261004192943_messages_drop_realtime_topic_policy (docs/OPEN.md Q1168).
 *
 *   node src/test/pglite/messagesRealtimeTopicPolicyDropped.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/messagesRealtimeTopicPolicyDropped.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = public.messages' four live SELECT-relevant policies, verbatim
 * (pg_policies 2026-10-04): "Users can view their own messages", "Admins can
 * view all messages" and the row-blind "Users can subscribe to own channels".
 * realtime.topic() is stubbed as the live one reads it: the session setting
 * realtime.topic (NULL unless a channel join sets it). The question is what a
 * signed-in stranger reads once that setting is present.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261004192943_messages_drop_realtime_topic_policy.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const A = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const B = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const STRANGER = "f6cc3ebb-9478-473c-8eb8-62b406f0734f";
const ADMIN = "96c9899e-87a2-49e2-bbdd-268717d52aee";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA realtime;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('realtime.topic', true), '') $$;
GRANT USAGE ON SCHEMA auth, realtime, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), realtime.topic() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $f$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid);
GRANT SELECT ON public.jobs TO authenticated;
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, sender_id uuid, receiver_id uuid, content text, flagged_hidden boolean DEFAULT false);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.messages TO authenticated;
CREATE POLICY "Users can view their own messages" ON public.messages FOR SELECT TO authenticated
  USING (((( SELECT auth.uid() AS uid) = sender_id) OR ((( SELECT auth.uid() AS uid) = receiver_id) AND (COALESCE(flagged_hidden, false) = false))));
CREATE POLICY "Admins can view all messages" ON public.messages FOR SELECT TO authenticated
  USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Users can subscribe to own channels" ON public.messages FOR SELECT TO authenticated
  USING (((realtime.topic() ~ ('^(notifications|messages):'::text || (( SELECT auth.uid() AS uid))::text)) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM jobs
  WHERE (((realtime.topic() ~ ('^jobs:'::text || (jobs.id)::text)) OR (realtime.topic() ~ ('^job_tracking:'::text || (jobs.id)::text)) OR (realtime.topic() ~ ('^job_checkins:'::text || (jobs.id)::text))) AND ((jobs.customer_id = ( SELECT auth.uid() AS uid)) OR (jobs.helper_id = ( SELECT auth.uid() AS uid))))))));
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.messages (sender_id, receiver_id, content) VALUES ('${A}', '${B}', 'private one'), ('${B}', '${A}', 'private two');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function count(who, topic) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who}', false); SELECT set_config('realtime.topic', '${topic ?? ""}', false); SET ROLE authenticated;`);
  try { return (await db.query(`SELECT count(*)::int AS n FROM public.messages`)).rows[0].n; }
  finally { await db.exec("RESET ROLE"); }
}

check("R1 a stranger whose session carries a topic naming themselves reads none of the thread", (await count(STRANGER, `messages:${STRANGER}`)) === 0, `${await count(STRANGER, `messages:${STRANGER}`)} row(s)`);
check("L1 without a topic the stranger reads none (as before)", (await count(STRANGER, null)) === 0);
check("L2 each party still reads the thread", (await count(A, null)) === 2 && (await count(B, null)) === 2);
check("L3 an admin still reads every message (its own policy)", (await count(ADMIN, null)) === 2);
const left = (await db.query(`SELECT count(*)::int AS n FROM pg_policy WHERE polrelid = 'public.messages'::regclass AND pg_get_expr(polqual, polrelid) LIKE '%topic()%'`)).rows[0].n;
check("C1 no public.messages policy reads realtime.topic()", left === 0, `${left} left`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
