/**
 * The PGlite world for the handover-photo proofs (anti-lying #1 "at the address", #2 "live camera"): every place a
 * Declutter handover photo is taken, at its newest definition.
 *
 * The chain is the safe-meetup proof's (src/test/pglite/declutterSafeMeetup.pglite.mjs: slices 1-4, the later
 * Declutter money migrations, seller delivery, payout-owed, the Free section), then 20261027204500 (safe meetup),
 * 20261027205028 (pickup reminders, its email call stubbed as in its own proof) and 20261028225038 (porch pick a
 * day), each once. The caller then applies its own migration 3x. pglite is not a dependency (CLAUDE.md): loaded
 * from ~/.lh-pglite.
 *
 * storage.objects gets prod's created_at (the storage server's own upload time; the slice harness lacks it).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "./slice3Harness.mjs";

export const MIG_DIR = new URL("../../supabase/migrations/", import.meta.url).pathname;
const DELIVERY_FILE = "20261027153244_declutter_seller_delivery.sql";
const OWED_FILE = "20261027163240_payout_setup_only_when_owed.sql";
const FREE_FILE = "20261027170717_declutter_free_section.sql";
const MEETUP_FILE = "20261027204500_declutter_safe_meetup.sql";
const REMINDERS_FILE = "20261027205028_declutter_pickup_reminders.sql";
const PORCH_DAY_FILE = "20261028225038_declutter_porch_pick_a_day.sql";
const LATER_ON_PROD = [
  "20261021181118_helpr_delivery_payout_round_down.sql",
  "20261021185418_declutter_delivery_raise_pay.sql",
  "20261021204947_declutter_sales_outlive_a_deleted_party.sql",
];
const SETUP_FEE_FILE = "20261026154738_declutter_setup_fee_once.sql";
const REFUND_141D_FILE = "20261026155251_declutter_refund_requests.sql";
const BEFORE = [
  "20261017055500_declutter_refund_hand_settle.sql",
  "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql",
  "20261017055505_declutter_helpr_delivery.sql",
  NO_QR_FILE,
  "20261018184535_declutter_delivery_no_dropoff_code.sql",
  "20261017060455_declutter_seller_out_pays_fee.sql",
  "20261020024605_shipping_s1_data_model.sql",
  "20261020064354_declutter_manage_listing.sql",
];

export async function buildHandoverWorld() {
  const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
  const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
      file_size_limit bigint, allowed_mime_types text[]);
    INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
  const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 },
    ...[...BEFORE, ...LATER_ON_PROD, SETUP_FEE_FILE, REFUND_141D_FILE].map((file) => ({ file, times: 1 }))];
  const stmts = setupStatements({ times: 1, times3b: 1, extra });
  stmts.splice(1, 0, `
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
    CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
    CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
    CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
      AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;`);
  stmts.splice(2, 0, `
    CREATE OR REPLACE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text,
      p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
      p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
    BEGIN
      INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
      VALUES (p_user, p_violation_type, p_description, p_job_id, p_rungs[least(p_prior_count, array_length(p_rungs, 1) - 1) + 1]);
      RETURN jsonb_build_object('action', p_rungs[least(p_prior_count, array_length(p_rungs, 1) - 1) + 1]);
    END $$;
    REVOKE ALL ON FUNCTION public.apply_consequence_ladder(uuid, text, text, uuid, int, text[], text[], jsonb, boolean, int, boolean, text, text) FROM PUBLIC, anon, authenticated;`);
  const feeAt = stmts.indexOf(readFileSync(`${MIG_DIR}${SETUP_FEE_FILE}`, "utf8"));
  if (feeAt < 0) throw new Error("setup-fee migration not in the chain");
  stmts.splice(feeAt, 0, `
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_fee_paid boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS onboarding_fee_charged_at timestamptz;
    CREATE TABLE IF NOT EXISTS public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      onboarding_fee_cents integer NOT NULL DEFAULT 200);
    INSERT INTO public.platform_settings (onboarding_fee_cents) VALUES (200);
    CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
    CREATE TABLE IF NOT EXISTS public.payout_send_marks (payout_kind text NOT NULL CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop')),
      payout_id uuid NOT NULL, marked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (payout_kind, payout_id));
    CREATE OR REPLACE FUNCTION public.member_display_name(p_full_name text, p_fallback text DEFAULT 'A neighbor')
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
      SELECT CASE WHEN v.t = '' THEN p_fallback
                  WHEN array_length(v.parts, 1) > 1 THEN v.parts[1] || ' ' || left(v.parts[array_length(v.parts, 1)], 1) || '.'
                  ELSE v.parts[1] END
        FROM (SELECT x.t, regexp_split_to_array(x.t, '\\s+') AS parts
                FROM (SELECT regexp_replace(coalesce(p_full_name, ''), '^\\s+|\\s+$', '', 'g') AS t) x) v
    $fn$;`);
  for (const sql of stmts) await db.exec(sql);
  await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true`);
  await db.exec(CARDS_SQL);
  await db.exec(readFileSync(`${MIG_DIR}${DELIVERY_FILE}`, "utf8"));
  // 20261027163240 (payout setup only when owed): its Declutter listing bodies, on stubs of the tables it reads.
  const owed = readFileSync(`${MIG_DIR}${OWED_FILE}`, "utf8");
  const fnSql = (name) => {
    const m = [...owed.matchAll(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
    const open = /\bAS\s+(\$\w*\$)/i.exec(owed.slice(m.index));
    const close = owed.indexOf(open[1], m.index + open.index + open[0].length);
    return owed.slice(m.index, owed.indexOf(";", close) + 1);
  };
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid, payment_status text);
    CREATE TABLE IF NOT EXISTS public.group_job_helpers (job_id uuid, helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.job_accept_pending (job_id uuid, helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.cancellation_fee_transfers (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.crew_cancellation_fee_shares (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.crew_block_fees (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.payout_transfers (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, status text, captured_at timestamptz);
    CREATE TABLE IF NOT EXISTS public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid);
    CREATE OR REPLACE FUNCTION public.job_payment_is_funded(s text) RETURNS boolean LANGUAGE sql IMMUTABLE
      AS $$ SELECT s IN ('escrow', 'payout_pending') $$;`);
  for (const n of ["declutter_publish_item", "declutter_relist_listing", "payout_setup_hire_allowed"]) await db.exec(fnSql(n));
  await db.exec(readFileSync(`${MIG_DIR}${FREE_FILE}`, "utf8"));
  await db.exec(`CREATE OR REPLACE FUNCTION public.seed_hidden_for(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    REVOKE ALL ON FUNCTION public.seed_hidden_for(uuid) FROM PUBLIC, anon, authenticated;`);
  await db.exec(readFileSync(`${MIG_DIR}${MEETUP_FILE}`, "utf8"));
  await db.exec(`CREATE SCHEMA IF NOT EXISTS net; CREATE SCHEMA IF NOT EXISTS vault;
    CREATE TABLE IF NOT EXISTS net.calls (id serial PRIMARY KEY, url text, body jsonb);
    CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
      RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id::bigint $$;
    CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (name text, decrypted_secret text);
    CREATE TABLE IF NOT EXISTS public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL DEFAULT 'error',
      message text NOT NULL, tags jsonb NOT NULL DEFAULT '{}', context jsonb NOT NULL DEFAULT '{}');`);
  await db.exec(readFileSync(`${MIG_DIR}${REMINDERS_FILE}`, "utf8"));
  await db.exec(readFileSync(`${MIG_DIR}${PORCH_DAY_FILE}`, "utf8"));
  await db.exec(`ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now()`);

  const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
  const run = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
  const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
  async function me(uid, sql) {
    try {
      await db.exec(uid ? `SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;` : `SET ROLE anon;`);
      return (await db.query(sql)).rows;
    } catch (e) {
      return { error: String(e.message ?? e), code: e.code };
    } finally {
      await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
    }
  }
  const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
  return { db, svc, run, one, me, refused, liveItemSql, USERS };
}
