/**
 * Owner 2026-10-27: a referral pays NEITHER person until BOTH the referrer and
 * the referred member have a completed job of their own (posted or worked);
 * then both get $5 together, once. Applies 20261027201034 three times.
 *   node src/test/pglite/referralBothMustWork.pglite.mjs
 *   NEW_MIGRATION=skip ... (RED: the old trigger pays both on the referred member's first job)
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/20261027201034_referral_bonus_needs_a_job_from_each.sql", import.meta.url).pathname;
const db = new PGlite();
let fail = 0;
const check = (n, ok, got = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `  (${got})`}`); if (!ok) fail++; };
await db.exec(`
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, helper_id uuid, customer_id uuid);
  CREATE TABLE public.referrals (id serial, referrer_id uuid, referred_id uuid, referral_code_id uuid);
  CREATE TABLE public.referral_credits (id serial PRIMARY KEY, user_id uuid, amount numeric, reason text, referral_code_id uuid, referred_user_id uuid);
  CREATE UNIQUE INDEX referral_credits_one_per_reason ON public.referral_credits (user_id, referral_code_id, referred_user_id, reason);
  CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid);
  -- prod's check_referral_bonus before this change, reduced to its helper-side branch (pays both on the referred member's first job)
  CREATE FUNCTION public.check_referral_bonus() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE v record; BEGIN
    IF NOT (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') THEN RETURN NEW; END IF;
    FOR v IN SELECT * FROM public.referrals r WHERE r.referred_id IN (NEW.helper_id, NEW.customer_id) LOOP
      INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id) VALUES (v.referred_id, 5, 'first_job_bonus', v.referral_code_id, v.referrer_id) ON CONFLICT DO NOTHING;
      INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id) VALUES (v.referrer_id, 5, 'referrer_bonus', v.referral_code_id, v.referred_id) ON CONFLICT DO NOTHING;
    END LOOP; RETURN NEW; END $$;
  CREATE TRIGGER check_referral_bonus_on_job AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.check_referral_bonus();
`);
if (process.env.NEW_MIGRATION !== "skip") { const sql = readFileSync(MIG, "utf8"); for (let i = 0; i < 3; i++) await db.exec(sql); check("migration applies 3x", true); }
const U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const TAYLOR = U(1), ROCKY = U(2), POSTER = U(3), CODE = U(9);
await db.query(`INSERT INTO public.referrals (referrer_id, referred_id, referral_code_id) VALUES ($1, $2, $3)`, [TAYLOR, ROCKY, CODE]);
const credits = async () => (await db.query(`SELECT user_id, reason FROM public.referral_credits ORDER BY reason`)).rows;
const complete = async (helper, customer) => {
  const [{ id }] = (await db.query(`INSERT INTO public.jobs (status, helper_id, customer_id) VALUES ('open', $1, $2) RETURNING id`, [helper, customer])).rows;
  await db.query(`UPDATE public.jobs SET status = 'completed' WHERE id = $1`, [id]);
};
await complete(ROCKY, POSTER); // the referred member works a job; the referrer has none yet
let c = await credits();
check("the referred member's first job alone pays NOBODY", c.length === 0, JSON.stringify(c));
await complete(POSTER, TAYLOR); // the referrer now posts a job that completes
c = await credits();
check("once both have a completed job, both get $5 together", c.length === 2
  && c.some((r) => r.user_id === ROCKY && r.reason === "first_job_bonus") && c.some((r) => r.user_id === TAYLOR && r.reason === "referrer_bonus"), JSON.stringify(c));
await complete(ROCKY, TAYLOR);
check("later jobs never pay again", (await credits()).length === 2);
const n = (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE title = 'Referral bonus earned!'`)).rows[0]?.n;
check("each person is told once", n === 2, String(n));
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
