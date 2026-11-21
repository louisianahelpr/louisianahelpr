/**
 * Owner 2026-11-19: the referral $5 + $5 is earned once BOTH people have
 * completed a job OR a Declutter purchase or sale (audit 11-20 night #23).
 * Applies 20261027201034 then 20261121035500 (three times).
 *   node src/test/pglite/referralCountsDeclutter.pglite.mjs
 *   NEW_MIGRATION=skip ... (RED: a Declutter-only member never qualifies)
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const db = new PGlite();
let fail = 0;
const check = (n, ok, got = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `  (${got})`}`); if (!ok) fail++; };
await db.exec(`
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, helper_id uuid, customer_id uuid);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, buyer_id uuid, seller_id uuid,
    items_cents int NOT NULL DEFAULT 0, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.referrals (id serial, referrer_id uuid, referred_id uuid, referral_code_id uuid);
  CREATE TABLE public.referral_credits (id serial PRIMARY KEY, user_id uuid, amount numeric, reason text, referral_code_id uuid, referred_user_id uuid);
  CREATE UNIQUE INDEX referral_credits_one_per_reason ON public.referral_credits (user_id, referral_code_id, referred_user_id, reason);
  CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid);
  CREATE FUNCTION public.check_referral_bonus() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE TRIGGER check_referral_bonus_on_job AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.check_referral_bonus();
`);
await db.exec(mig("20261027201034_referral_bonus_needs_a_job_from_each.sql"));
if (process.env.NEW_MIGRATION !== "skip") {
  const sql = mig("20261121035500_referral_bonus_counts_declutter.sql");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
}
const U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const TAYLOR = U(1), ROCKY = U(2), OTHER = U(3), CODE = U(9);
await db.query(`INSERT INTO public.referrals (referrer_id, referred_id, referral_code_id) VALUES ($1, $2, $3)`, [TAYLOR, ROCKY, CODE]);
const credits = async () => (await db.query(`SELECT user_id, reason FROM public.referral_credits ORDER BY reason`)).rows;
const order = async (buyer, seller, cents, seed = false, to = "handed_over") => {
  const [{ id }] = (await db.query(`INSERT INTO public.declutter_orders (status, buyer_id, seller_id, items_cents, is_seed) VALUES ('paid', $1, $2, $3, $4) RETURNING id`, [buyer, seller, cents, seed])).rows;
  await db.query(`UPDATE public.declutter_orders SET status = $2 WHERE id = $1`, [id, to]);
};
const job = async (helper, customer) => {
  const [{ id }] = (await db.query(`INSERT INTO public.jobs (status, helper_id, customer_id) VALUES ('open', $1, $2) RETURNING id`, [helper, customer])).rows;
  await db.query(`UPDATE public.jobs SET status = 'completed' WHERE id = $1`, [id]);
};
await order(ROCKY, OTHER, 0);            // free item
await order(ROCKY, OTHER, 500, true);    // seeded demo order
await order(ROCKY, OTHER, 500, false, "refunded");
await job(OTHER, TAYLOR);                // the referrer has a completed job
let c = await credits();
check("a free item, a seeded order and a refunded order do not qualify", c.length === 0, JSON.stringify(c));
await order(ROCKY, OTHER, 500);          // the referred member buys on Declutter
c = await credits();
check("a Declutter purchase plus the friend's job pays both $5", c.length === 2
  && c.some((r) => r.user_id === ROCKY && r.reason === "first_job_bonus") && c.some((r) => r.user_id === TAYLOR && r.reason === "referrer_bonus"), JSON.stringify(c));
await order(OTHER, ROCKY, 700);
check("later orders never pay again", (await credits()).length === 2);
const n = (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE title = 'Referral bonus earned!' AND link = '/profile?tab=referral' AND message LIKE '%Declutter sale or purchase%'`)).rows[0]?.n;
check("each person is told once, with the Declutter wording", n === 2, String(n));
// Declutter on both sides: seller + buyer, no jobs at all.
const A = U(5), B = U(6);
await db.query(`INSERT INTO public.referrals (referrer_id, referred_id, referral_code_id) VALUES ($1, $2, $3)`, [A, B, U(8)]);
await order(OTHER, A, 900);
check("one side alone pays nobody", (await credits()).length === 2);
await order(B, OTHER, 900);
check("a sale by one and a purchase by the other pays both", (await credits()).length === 4);
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
