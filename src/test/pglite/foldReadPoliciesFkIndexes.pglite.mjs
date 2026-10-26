#!/usr/bin/env node
/**
 * PGlite proof for 20261026002027_index_unindexed_foreign_keys_fold_two_read_policies: the eight foreign-key
 * indexes exist after it (and it is replay-safe, 3x), and each folded read policy shows EXACTLY the rows the two
 * live policies it replaces showed, to an admin, the poster, a crew member / party, and a stranger.
 * The "before" policies are the live ones (pg_policies read on prod 2026-10-26).
 *
 *   node src/test/pglite/foldReadPoliciesFkIndexes.pglite.mjs
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const { PGlite } = await import(`${process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261026002027_index_unindexed_foreign_keys_fold_two_read_policies.sql", import.meta.url).pathname, "utf8");
let failures = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); if (!ok) failures++; };
const ADMIN = "a0000000-0000-4000-8000-000000000001", POSTER = "a0000000-0000-4000-8000-000000000002", HELPR = "a0000000-0000-4000-8000-000000000003", OTHER = "a0000000-0000-4000-8000-000000000004";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u AND role = r) $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid);
CREATE TABLE public.group_job_helpers (id serial PRIMARY KEY, job_id uuid, helper_id uuid);
CREATE TABLE public.refund_requests (id serial PRIMARY KEY, requester_id uuid, responder_id uuid);
CREATE TABLE public.disputes (id serial, agreed_helper_id uuid REFERENCES auth.users(id), agreed_poster_id uuid REFERENCES auth.users(id));
CREATE TABLE public.job_approval_escalations (id serial, resolved_by uuid REFERENCES auth.users(id));
CREATE TABLE public.provider_payments (id serial, payer_id uuid REFERENCES auth.users(id));
CREATE TABLE public.provider_payouts (id serial, payee_user_id uuid REFERENCES auth.users(id));
CREATE TABLE public.support_replies (id serial, admin_id uuid REFERENCES auth.users(id));
CREATE TABLE public.payout_setup_reminders (id serial, job_id uuid REFERENCES public.jobs(id));
CREATE TABLE public.connect_account_retirements (id serial, user_id uuid REFERENCES auth.users(id));
ALTER TABLE public.group_job_helpers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON public.group_job_helpers, public.refund_requests, public.jobs TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
-- The two LIVE pairs (pg_policies, prod 2026-10-26).
CREATE POLICY "Admins can view group helpers" ON public.group_job_helpers FOR SELECT TO authenticated USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Job participants can view group helpers" ON public.group_job_helpers FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IN ( SELECT jobs.customer_id FROM jobs WHERE (jobs.id = group_job_helpers.job_id))) OR (( SELECT auth.uid() AS uid) = helper_id)));
CREATE POLICY "refund requests admin read" ON public.refund_requests FOR SELECT TO authenticated USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "refund requests parties read" ON public.refund_requests FOR SELECT TO authenticated USING (((requester_id = ( SELECT auth.uid() AS uid)) OR (responder_id = ( SELECT auth.uid() AS uid))));
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs VALUES ('b0000000-0000-4000-8000-000000000001', '${POSTER}'), ('b0000000-0000-4000-8000-000000000002', '${OTHER}');
INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('b0000000-0000-4000-8000-000000000001', '${HELPR}'), ('b0000000-0000-4000-8000-000000000002', '${OTHER}'), ('b0000000-0000-4000-8000-000000000001', '${OTHER}');
INSERT INTO public.refund_requests (requester_id, responder_id) VALUES ('${POSTER}', '${HELPR}'), ('${OTHER}', '${POSTER}'), ('${OTHER}', '${OTHER}');
`);
const seen = async (uid) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.uid', '${uid}', false);`);
  try {
    const g = (await db.query(`SELECT id FROM public.group_job_helpers ORDER BY id`)).rows.map((r) => r.id).join(",");
    const r = (await db.query(`SELECT id FROM public.refund_requests ORDER BY id`)).rows.map((r) => r.id).join(",");
    return `gjh[${g}] rr[${r}]`;
  } finally { await db.exec("RESET ROLE"); }
};
const before = {};
for (const [n, u] of Object.entries({ ADMIN, POSTER, HELPR, OTHER })) before[n] = await seen(u);
const unindexed = async () => (await db.query(`SELECT count(*)::int n FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`)).rows[0].n;
const fksBefore = await unindexed();
check("RED before: the eight foreign keys have no covering index", fksBefore === 8, String(fksBefore));
for (let i = 0; i < 3; i++) await db.exec(NEW);
check("the migration applies three times", true);
for (const [n, u] of Object.entries({ ADMIN, POSTER, HELPR, OTHER })) {
  const after = await seen(u);
  check(`${n} sees exactly the same rows`, after === before[n], `${before[n]} -> ${after}`);
}
check("the admin sees every row (the fold kept the admin branch)", before.ADMIN === "gjh[1,2,3] rr[1,2,3]", before.ADMIN);
const pol = (await db.query(`SELECT tablename, count(*)::int n FROM pg_policies WHERE cmd = 'SELECT' AND tablename IN ('group_job_helpers','refund_requests') GROUP BY 1 ORDER BY 1`)).rows;
check("one SELECT policy per table (multiple_permissive_policies -2)", JSON.stringify(pol) === JSON.stringify([{ tablename: "group_job_helpers", n: 1 }, { tablename: "refund_requests", n: 1 }]), JSON.stringify(pol));
const fks = (await db.query(`SELECT count(*)::int n FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`)).rows[0].n;
check("no foreign key is left without a covering index", fks === 0, `${fks} unindexed`);
const idx = (await db.query(`SELECT count(*)::int n FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE ANY (ARRAY['%agreed_helper_id_idx','%agreed_poster_id_idx','%resolved_by_idx','%payer_id_idx','%payee_user_id_idx','%admin_id_idx','%job_id_idx','%retirements_user_id_idx'])`)).rows[0].n;
check("exactly the eight indexes exist", idx === 8, String(idx));
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
