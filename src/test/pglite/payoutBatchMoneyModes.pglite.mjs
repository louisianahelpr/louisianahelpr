#!/usr/bin/env node
/**
 * Q2088 (PGlite proof for 20261103102100_payout_batch_money_modes): Admin -> Payout Batches labels a batch by where
 * its money sits, as release-payout pays it (jobMoneyMode, kind 'payout'): the stored cs_test_/cs_live_ session
 * prefix first, otherwise test only when every party (poster, Helpr, crew) is in test_accounts.
 *   (a) a seed Helpr hired on a REAL poster's job: live (the old is_seed label said test);
 *   (b) a seed Helpr not enrolled in test_accounts, enrolled poster: live;
 *   (c) both enrolled: test;  (d) both enrolled but a cs_live_ session: live;  (e) a real pair with a cs_test_ session: test;
 *   (f) a crew member not enrolled: live;  (g) a batch with a test job and a live job: mixed;
 *   (h) a non-admin gets no rows; anon cannot execute; the file replays 3x.
 *
 *   node src/test/pglite/payoutBatchMoneyModes.pglite.mjs                       # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/payoutBatchMoneyModes.pglite.mjs    # RED: the function is absent
 *
 * Stubbed, said so: the tables reduced to the columns read; has_role reads a test table; auth.uid() reads the
 * request.jwt.claim.sub setting. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/20261103102100_payout_batch_money_modes.sql", import.meta.url).pathname;
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `efefefef-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(99);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`);
await db.exec(`
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.admins (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT r = 'admin' AND EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = u) $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, payment_status text, helper_id uuid, customer_id uuid, stripe_session_id text);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.disputes (job_id uuid, status text, execution_status text);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
INSERT INTO public.admins VALUES ('${ADMIN}');
`);
if (!skip) { const sql = readFileSync(MIG, "utf8"); for (let k = 1; k <= 3; k++) await db.exec(sql); }

const q = async (s, p = []) => (await db.query(s, p)).rows;
const job = (helper, poster, session = null) => q(`INSERT INTO public.jobs (status, payment_status, helper_id, customer_id, stripe_session_id) VALUES ('completed', 'escrow', $1, $2, $3) RETURNING id`, [helper, poster, session]);
const enrol = (...ids) => Promise.all(ids.map((id) => q(`INSERT INTO public.test_accounts VALUES ($1) ON CONFLICT DO NOTHING`, [id])));
async function modesAs(uid, role = "authenticated") {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE ${role};`);
    return { rows: await q(`SELECT helper_id, money_mode FROM public.admin_payout_batch_money_modes()`) };
  } catch (e) { return { error: e.message }; } finally { await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`); }
}

// (a) seed Helpr H1 (enrolled) on a real poster's job.
await enrol(U(1)); await job(U(1), U(2));
// (b) Helpr H3 not enrolled, poster enrolled.
await enrol(U(4)); await job(U(3), U(4));
// (c) both enrolled.
await enrol(U(5), U(6)); await job(U(5), U(6));
// (d) both enrolled, cs_live_ session.
await enrol(U(7), U(8)); await job(U(7), U(8), "cs_live_abc");
// (e) real pair, cs_test_ session.
await job(U(9), U(10), "cs_test_abc");
// (f) both enrolled, a crew member not.
await enrol(U(11), U(12)); const f = (await job(U(11), U(12)))[0].id; await q(`INSERT INTO public.group_job_helpers VALUES ($1, $2)`, [f, U(13)]);
// (g) Helpr H14: one test job, one live job.
await enrol(U(14), U(15)); await job(U(14), U(15)); await job(U(14), U(16));

const res = await modesAs(ADMIN);
const mode = (h) => res.rows?.find((r) => r.helper_id === h)?.money_mode;
check(!res.error, "the function runs for an admin", res.error);
check(mode(U(1)) === "live", "(a) a seed Helpr on a real poster's job is real money", mode(U(1)));
check(mode(U(3)) === "live", "(b) a seed Helpr missing from test_accounts is real money", mode(U(3)));
check(mode(U(5)) === "test", "(c) every party enrolled: test", mode(U(5)));
check(mode(U(7)) === "live", "(d) a cs_live_ session decides: live", mode(U(7)));
check(mode(U(9)) === "test", "(e) a cs_test_ session decides: test", mode(U(9)));
check(mode(U(11)) === "live", "(f) an unenrolled crew member makes it real money", mode(U(11)));
check(mode(U(14)) === "mixed", "(g) a batch of a test job and a live job is mixed", mode(U(14)));
check((res.rows?.length ?? 0) > 5, "reads a real inventory (floor)", String(res.rows?.length));
const other = await modesAs(U(50));
check(!other.error && other.rows.length === 0, "(h) a non-admin gets no rows", JSON.stringify(other));
const anon = await modesAs(U(50), "anon");
check(/permission denied/.test(anon.error ?? ""), "(h) anon cannot execute it", JSON.stringify(anon));

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
