#!/usr/bin/env node
/**
 * PGlite proof for 20260923232809_banned_blocker_keeps_block (docs/OPEN.md
 * Q301): a banned caller who shares a live job with the person they block
 * keeps the block; the settle step is skipped instead of rolling it back.
 *
 *   node src/test/pglite/bannedBlockerKeepsBlock.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/bannedBlockerKeepsBlock.pglite.mjs   # RED
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). The fixture
 * stubs auth.uid() and is_caller_banned() off GUCs and puts a ban gate on
 * jobs UPDATE that raises account_restricted, as enforce_ban_gate does.
 * Applies the previous definition (20260923075415), then the new migration 3x.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const PREV = "20260923075415_block_settle_fee_follows_commitment.sql";
const Q301 = "20260923232809_banned_blocker_keeps_block.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.banned', true), '') = 'on' $$;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','revision_requested','completed','cancelled');
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid, reason text, UNIQUE (blocker_id, blocked_id));
CREATE TABLE public.notifications (id serial, user_id uuid, title text, message text, type text, link text);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, budget numeric, date_needed date, start_time time,
  customer_id uuid, helper_id uuid, helper_confirmed_at timestamptz, helper_completed_at timestamptz,
  status public.job_status, cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text,
  late_cancellation boolean, cancellation_fee numeric, cancellation_fee_status text);
CREATE FUNCTION public.job_hours_until_start(d date, t time, n timestamptz) RETURNS numeric LANGUAGE sql AS $$ SELECT 100::numeric $$;
CREATE FUNCTION public.cancellation_fee_percent(c boolean, h numeric) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.is_late_cancellation(c boolean, h numeric) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.ban_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF public.is_caller_banned() THEN RAISE EXCEPTION 'account_restricted'; END IF; RETURN NEW; END $$;
CREATE TRIGGER enforce_ban_gate BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.ban_gate();
`);

const ME = "00000000-0000-0000-0000-00000000000a";
const THEM = "00000000-0000-0000-0000-00000000000b";
const JOB = "00000000-0000-0000-0000-000000000001";
const reset = async () => {
  await db.exec(`DELETE FROM public.user_blocks; DELETE FROM public.jobs; DELETE FROM public.notifications;
    INSERT INTO public.jobs (id, title, budget, customer_id, helper_id, helper_confirmed_at, status)
    VALUES ('${JOB}', 'Shared job', 50, '${ME}', '${THEM}', now(), 'accepted');`);
};
const call = async (banned) => {
  await db.exec(`SELECT set_config('test.uid', '${ME}', false); SELECT set_config('test.banned', '${banned ? "on" : "off"}', false);`);
  try {
    const r = await db.query(`SELECT public.block_user_and_settle('${THEM}'::uuid, 'test') AS r`);
    return { ok: true, r: r.rows[0].r };
  } catch (e) {
    return { ok: false, err: String(e.message ?? e) };
  }
};
const blocks = async () => (await db.query(`SELECT count(*)::int n FROM public.user_blocks WHERE blocker_id='${ME}' AND blocked_id='${THEM}'`)).rows[0].n;
const jobStatus = async () => (await db.query(`SELECT status::text s FROM public.jobs`)).rows[0].s;

await db.exec(mig(PREV));
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig(Q301));
}

await reset();
const banned = await call(true);
check("banned caller: the call succeeds", banned.ok, banned.err);
check("banned caller: the user_blocks row exists after", (await blocks()) === 1);
check("banned caller: the shared job is left alone", (await jobStatus()) === "accepted");
check("banned caller: the result says the settle was skipped", banned.r?.settle_skipped === "account_restricted", JSON.stringify(banned.r ?? null));

await reset();
const normal = await call(false);
check("unbanned caller: still blocks and cancels the shared job", normal.ok && (await blocks()) === 1 && (await jobStatus()) === "cancelled", normal.err);
check("unbanned caller: the settled list names the job", Array.isArray(normal.r?.settled) && normal.r.settled.length === 1);

const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.block_user_and_settle(uuid,text)', 'EXECUTE') a`)).rows[0].a;
check("anon cannot execute", acl === false);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
