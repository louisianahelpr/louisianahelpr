#!/usr/bin/env node
/**
 * PGlite proof for 20261021142959_declutter_seller_hidden_column (Q1852).
 *
 *   npx tsx src/test/pglite/declutterSellerHiddenColumn.pglite.mjs [--replay] [--before]
 *
 * The four hidden-state functions (declutter_seller_hidden, declutter_seller_out,
 * declutter_member_out, member_under_18, declutter_active_strike_count), the
 * email gate (refuse_unconfirmed_email_write + session_email_unconfirmed), the
 * foreign keys and the items read policy are PROD's, read live 2026-10-21 with
 * pg_get_functiondef / pg_get_constraintdef / pg_policies (read-only), and
 * pasted below verbatim, with prod's EXECUTE grants. --before leaves the
 * migration out and the RED checks must FAIL; without it the migration is
 * applied (3x with --replay) and every check must PASS. Reads run under the
 * REAL authenticated role with RLS on.
 *
 *   R1 a member cannot call declutter_seller_hidden at all (no per-person
 *      banned / under-18 / strikes yes-no)                                  RED before
 *   R2 the read policy no longer calls a client-executable helper          RED before
 *   R3 declutter_delivery_quote (prod body before; the review's must-fix) answers
 *      a member with nothing in their cart the SAME way for a banned seller
 *      and an ordinary one (no out / not-out oracle by any uuid)            RED before
 *   K4 a buyer with the seller's item in their cart still gets a quote, and
 *      still gets item_not_found once that seller is banned
 *   K1 a member still cannot see a banned seller's live item (before and after)
 *   K2 a member still sees an ordinary seller's live item
 *   K3 a hidden seller still sees their own items
 * After only (the column has to stay right as the seller's state changes):
 *   A1 backfill: a seller banned before the migration is hidden by it
 *   A2 ban -> hidden at once; unban -> shown at once
 *   A3 3 strikes -> hidden; one removed -> shown
 *   A4 business-like flag set -> hidden; cleared (deleted) -> shown
 *   A5 a member saving their OWN under-18 birthday (authenticated, who cannot
 *      execute declutter_seller_out) -> hidden; corrected -> shown
 *   A6 a time-based ending (temp ban runs out with no write) stays hidden
 *      (safe direction) until the sweep, which shows it again
 *   A7 a new item from a hidden seller starts hidden; a writer cannot set
 *      seller_hidden false (the BEFORE trigger recomputes it)
 *   A8 an unconfirmed-email member saving a profile field that is not an input
 *      is not refused by the items email gate (the refresh fires no items UPDATE;
 *      on prod every input table carries the same session-keyed gate, so an
 *      input write it reaches was already accepted upstream)
 *   A9 deleting the auth.users row of a seller with items, strikes, a flag
 *      and a profile cascades without an error and leaves no row behind
 *   A10 the sweep reports what it changed, and a second run changes nothing
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261021142959_declutter_seller_hidden_column.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");

let failures = 0;
let redFailures = 0;
const check = (name, ok, detail = "", red = false) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) {
    failures++;
    if (red) redFailures++;
  }
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MEMBER = U(1), OK_SELLER = U(2), BANNED = U(3), STRIKER = U(4), BIZ = U(5), KID = U(6), TEMP = U(7), UNCONF = U(8), GONE = U(9);
const OK_ITEM = U(101), BANNED_ITEM = U(102), STRIKER_ITEM = U(103), BIZ_ITEM = U(104), KID_ITEM = U(105), TEMP_ITEM = U(106), GONE_ITEM = U(107);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ban_status text, auto_suspended_until timestamptz, date_of_birth date, display_name text, is_seed boolean DEFAULT false);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL, title text, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.declutter_strikes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.declutter_items(id) ON DELETE SET NULL, removed_at timestamptz,
  given_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now() + interval '180 days');
CREATE TABLE public.declutter_seller_flags (user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, business_like boolean NOT NULL DEFAULT false);
CREATE FUNCTION public.feature_enabled_for(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
-- declutter_delivery_quote's neighbours (their own proofs: declutterDelivery.pglite.mjs); only the ORDER of its checks is tested here.
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, item_id uuid,
  status text NOT NULL DEFAULT 'in_cart', checkout_by timestamptz NOT NULL DEFAULT now() + interval '1 day');
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_assert_member(boolean) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_delivery_compute(p_buyer uuid, p_seller uuid, p_lines uuid[],
  OUT road_miles numeric, OUT size text, OUT delivery_cents integer, OUT base_cents integer, OUT per_mile_cents integer,
  OUT size_cents integer, OUT dropoff_area text)
  LANGUAGE sql STABLE AS $$ SELECT 3.0::numeric, 'small'::text, 1300, 1000, 100, 0, 'Baton Rouge'::text $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

-- PROD (pg_get_functiondef, read 2026-10-21), verbatim.
CREATE OR REPLACE FUNCTION public.declutter_active_strike_count(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::integer
    FROM public.declutter_strikes s
   WHERE s.user_id = p_user_id
     AND s.removed_at IS NULL
     AND s.expires_at > now();
$function$;
CREATE OR REPLACE FUNCTION public.declutter_member_out(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.user_id = p_user
               AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
               AND (p.ban_status <> 'temp_banned'
                    OR p.auto_suspended_until IS NULL
                    OR p.auto_suspended_until > now()))
    OR public.declutter_active_strike_count(p_user) >= 3);
$function$;
CREATE OR REPLACE FUNCTION public.member_under_18(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT (p.date_of_birth + interval '18 years') > (now() AT TIME ZONE 'America/Chicago')::date
       FROM public.profiles p
      WHERE p.user_id = p_user_id
        AND p.date_of_birth IS NOT NULL
      LIMIT 1),
    false)
$function$;
CREATE OR REPLACE FUNCTION public.declutter_seller_out(p_seller uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_seller IS NOT NULL AND (
    public.declutter_member_out(p_seller)
    OR COALESCE(public.member_under_18(p_seller), false)
    OR EXISTS (SELECT 1 FROM public.declutter_seller_flags f WHERE f.user_id = p_seller AND f.business_like));
$function$;
CREATE OR REPLACE FUNCTION public.declutter_seller_hidden(p_seller uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.declutter_items i
                  WHERE i.seller_id = p_seller AND i.status IN ('live', 'reserved'))
     AND public.declutter_seller_out(p_seller);
$function$;
CREATE OR REPLACE FUNCTION public.session_email_unconfirmed()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND coalesce(auth.role(), '') = 'authenticated'
     AND NOT EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.id = auth.uid()
          AND u.email_confirmed_at IS NOT NULL
     )
$function$;
CREATE OR REPLACE FUNCTION public.refuse_unconfirmed_email_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF public.session_email_unconfirmed() THEN
    RAISE EXCEPTION 'email_unconfirmed'
      USING ERRCODE = '42501',
            HINT = 'Confirm your email address before making changes. See /signup-pending.';
  END IF;
  RETURN NULL;
END;
$function$;
-- PROD (pg_get_functiondef 2026-10-21, md5 b990cc354064c864beaf0af320c92447), verbatim.
CREATE OR REPLACE FUNCTION public.declutter_delivery_quote(p_seller_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  q record;
BEGIN
  PERFORM public.require_feature('declutter');
  v_uid := public.declutter_assert_member(true);
  IF p_seller_id IS NULL OR public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO q FROM public.declutter_delivery_compute(v_uid, p_seller_id, NULL);
  RETURN jsonb_build_object('road_miles', q.road_miles, 'size', q.size, 'delivery_cents', q.delivery_cents,
    'base_cents', q.base_cents, 'per_mile_cents', q.per_mile_cents, 'size_cents', q.size_cents,
    'dropoff_area', q.dropoff_area);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_delivery_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_quote(uuid) TO authenticated, service_role;
-- PROD grants (pg_proc.proacl 2026-10-21): only declutter_seller_hidden is executable by authenticated.
REVOKE ALL ON FUNCTION public.declutter_active_strike_count(uuid), public.declutter_member_out(uuid), public.member_under_18(uuid),
  public.declutter_seller_out(uuid), public.declutter_seller_hidden(uuid), public.session_email_unconfirmed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_hidden(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.declutter_seller_out(uuid), public.member_under_18(uuid) TO service_role;
-- PROD statement-level email gates.
CREATE TRIGGER zz_refuse_unconfirmed_email_write BEFORE INSERT OR DELETE OR UPDATE ON public.declutter_items FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_unconfirmed_email_write();
CREATE TRIGGER zz_refuse_unconfirmed_email_write BEFORE INSERT OR DELETE OR UPDATE ON public.declutter_strikes FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_unconfirmed_email_write();
CREATE TRIGGER zz_refuse_unconfirmed_email_write BEFORE INSERT OR DELETE OR UPDATE ON public.declutter_seller_flags FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_unconfirmed_email_write();
-- PROD items read policy (pg_policies qual, 2026-10-21).
ALTER TABLE public.declutter_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items FOR SELECT TO authenticated
  USING ((seller_id = ( SELECT auth.uid() AS uid)) OR ((status = ANY (ARRAY['live'::text, 'reserved'::text])) AND ( SELECT feature_enabled_for('declutter'::text) AS feature_enabled_for) AND (NOT declutter_seller_hidden(seller_id)) AND ((NOT is_seed) OR (NOT ( SELECT seed_hidden_in_discovery() AS seed_hidden_in_discovery)))));
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT ON public.declutter_items TO authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

INSERT INTO auth.users (id, email_confirmed_at) VALUES
  ('${MEMBER}', now()), ('${OK_SELLER}', now()), ('${BANNED}', now()), ('${STRIKER}', now()), ('${BIZ}', now()),
  ('${KID}', now()), ('${TEMP}', now()), ('${UNCONF}', NULL), ('${GONE}', now());
INSERT INTO public.profiles (user_id, ban_status) VALUES
  ('${MEMBER}', NULL), ('${OK_SELLER}', NULL), ('${BANNED}', 'banned'), ('${STRIKER}', NULL), ('${BIZ}', NULL),
  ('${KID}', NULL), ('${TEMP}', NULL), ('${UNCONF}', NULL), ('${GONE}', NULL);
INSERT INTO public.declutter_items (id, seller_id, status, title) VALUES
  ('${OK_ITEM}', '${OK_SELLER}', 'live', 'Oak dresser'), ('${BANNED_ITEM}', '${BANNED}', 'live', 'Lamp'),
  ('${STRIKER_ITEM}', '${STRIKER}', 'live', 'Chair'), ('${BIZ_ITEM}', '${BIZ}', 'live', 'Bulk tees'),
  ('${KID_ITEM}', '${KID}', 'live', 'Bike'), ('${TEMP_ITEM}', '${TEMP}', 'live', 'Rug'), ('${GONE_ITEM}', '${GONE}', 'live', 'Desk');
`;

const db = new PGlite();
await db.exec(SCHEMA);
if (!BEFORE) for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);

async function as(uid, sql, role = "authenticated") {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  try {
    return { rows: (await db.query(sql)).rows, err: null };
  } catch (e) {
    return { rows: [], err: String(e.message) };
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);");
  }
}
/** Server-side write (no member session: the admin tools, sweeps and service role). */
const srv = (sql) => db.exec(sql);
const visible = async (uid) => (await as(uid, "SELECT id FROM public.declutter_items WHERE status IN ('live','reserved')")).rows.map((r) => r.id);
const sees = async (item) => (await visible(MEMBER)).includes(item);

console.log(`${BEFORE ? "BEFORE (migration left out)" : `AFTER (applied ${REPLAY ? 3 : 1}x)`}`);

const direct = await as(MEMBER, `SELECT public.declutter_seller_hidden('${BANNED}') AS h`);
check("R1 a member cannot call declutter_seller_hidden (no per-person yes/no)", direct.err !== null && /permission denied/i.test(direct.err),
  direct.err ?? `answered ${JSON.stringify(direct.rows)}`, true);
const qual = (await db.query(`SELECT qual FROM pg_policies WHERE tablename = 'declutter_items' AND policyname = 'declutter items: seller or switched-on members read live'`)).rows[0]?.qual ?? "";
check("R2 the items read policy calls no client-executable helper", qual !== "" && !/declutter_seller_hidden/.test(qual) && /seller_hidden/.test(qual), qual, true);
const quote = async (uid, seller) => {
  const r = await as(uid, `SELECT public.declutter_delivery_quote('${seller}') AS q`);
  return r.err ? (/item_not_found|cart_empty|permission denied/.exec(r.err)?.[0] ?? r.err) : "quoted";
};
const qBanned = await quote(MEMBER, BANNED), qOk = await quote(MEMBER, OK_SELLER);
check("R3 the delivery quote answers an empty-cart member the same for a banned and an ordinary seller", qBanned === qOk && qOk === "cart_empty",
  `banned=${qBanned} ordinary=${qOk}`, true);
check("K1 a member cannot see a banned seller's live item", !(await sees(BANNED_ITEM)));
check("K2 a member sees an ordinary seller's live item", await sees(OK_ITEM));
check("K3 a hidden seller still sees their own items", (await visible(BANNED)).includes(BANNED_ITEM));

if (!BEFORE) {
  await srv(`INSERT INTO public.declutter_cart_items (buyer_id, seller_id, item_id) VALUES ('${MEMBER}', '${OK_SELLER}', '${OK_ITEM}'), ('${MEMBER}', '${BANNED}', '${BANNED_ITEM}')`);
  const kOk = await quote(MEMBER, OK_SELLER), kBanned = await quote(MEMBER, BANNED);
  await srv("DELETE FROM public.declutter_cart_items");
  check("K4 a buyer with the seller's item in their cart gets a quote; with a banned seller's, item_not_found", kOk === "quoted" && kBanned === "item_not_found",
    `ok=${kOk} banned=${kBanned}`);
  const col = async (item) => (await db.query(`SELECT seller_hidden FROM public.declutter_items WHERE id = '${item}'`)).rows[0]?.seller_hidden;
  check("A1 backfill: a seller banned before the migration is hidden by it", (await col(BANNED_ITEM)) === true && (await col(OK_ITEM)) === false);

  await srv(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${OK_SELLER}'`);
  const afterBan = await sees(OK_ITEM);
  await srv(`UPDATE public.profiles SET ban_status = NULL WHERE user_id = '${OK_SELLER}'`);
  check("A2 ban hides at once; unban shows at once", afterBan === false && (await sees(OK_ITEM)) === true, `after ban visible=${afterBan}`);

  await srv(`INSERT INTO public.declutter_strikes (user_id) VALUES ('${STRIKER}'), ('${STRIKER}')`);
  const two = await sees(STRIKER_ITEM);
  await srv(`INSERT INTO public.declutter_strikes (user_id, item_id) VALUES ('${STRIKER}', '${STRIKER_ITEM}')`);
  const three = await sees(STRIKER_ITEM);
  await srv(`UPDATE public.declutter_strikes SET removed_at = now() WHERE id = (SELECT id FROM public.declutter_strikes WHERE user_id = '${STRIKER}' LIMIT 1)`);
  check("A3 2 strikes shown, 3 strikes hidden, one removed shown again", two === true && three === false && (await sees(STRIKER_ITEM)) === true,
    `two=${two} three=${three}`);

  await srv(`INSERT INTO public.declutter_seller_flags (user_id, business_like) VALUES ('${BIZ}', true)`);
  const flagged = await sees(BIZ_ITEM);
  await srv(`DELETE FROM public.declutter_seller_flags WHERE user_id = '${BIZ}'`);
  check("A4 business-like flag hides; clearing it shows", flagged === false && (await sees(BIZ_ITEM)) === true, `flagged visible=${flagged}`);

  const kidSave = await as(KID, `UPDATE public.profiles SET date_of_birth = (now()::date - interval '15 years')::date WHERE user_id = '${KID}' RETURNING user_id`);
  const kidHidden = await sees(KID_ITEM);
  const kidFix = await as(KID, `UPDATE public.profiles SET date_of_birth = DATE '1990-01-01' WHERE user_id = '${KID}' RETURNING user_id`);
  check("A5 a member saving their own under-18 birthday hides their items; correcting it shows them",
    kidSave.err === null && kidSave.rows.length === 1 && kidHidden === false && kidFix.err === null && (await sees(KID_ITEM)) === true,
    `save=${kidSave.err} hidden-visible=${kidHidden} fix=${kidFix.err}`);

  await srv(`UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() + interval '1 day' WHERE user_id = '${TEMP}'`);
  const suspended = await sees(TEMP_ITEM);
  // Time passes: the suspension runs out with NO write (simulated by moving the date with the triggers off).
  await srv(`ALTER TABLE public.profiles DISABLE TRIGGER USER; UPDATE public.profiles SET auto_suspended_until = now() - interval '1 minute' WHERE user_id = '${TEMP}'; ALTER TABLE public.profiles ENABLE TRIGGER USER;`);
  const stale = await sees(TEMP_ITEM);
  const sweep1 = (await db.query("SELECT public.declutter_seller_hidden_sweep() AS r")).rows[0].r;
  const swept = await sees(TEMP_ITEM);
  check("A6 a suspension that runs out stays hidden (safe side) until the sweep shows it", suspended === false && stale === false && swept === true,
    `suspended=${suspended} stale=${stale} swept=${swept}`);
  const sweep2 = (await db.query("SELECT public.declutter_seller_hidden_sweep() AS r")).rows[0].r;
  check("A10 the sweep reports what it changed; a second run changes nothing",
    sweep1?.shown === 1 && sweep1?.hidden === 0 && sweep2?.shown === 0 && sweep2?.hidden === 0,
    `${JSON.stringify(sweep1)} then ${JSON.stringify(sweep2)}`);

  await srv(`INSERT INTO public.declutter_items (id, seller_id, status, title) VALUES ('${U(108)}', '${BANNED}', 'live', 'Mirror')`);
  const newHidden = await col(U(108));
  await srv(`UPDATE public.declutter_items SET seller_hidden = false WHERE id = '${BANNED_ITEM}'`);
  check("A7 a hidden seller's new item starts hidden; nobody can set seller_hidden false",
    newHidden === true && (await col(BANNED_ITEM)) === true && !(await sees(BANNED_ITEM)), `new=${newHidden}`);

  const unconf = await as(UNCONF, `UPDATE public.profiles SET display_name = 'Pat' WHERE user_id = '${UNCONF}' RETURNING user_id`);
  check("A8 an unconfirmed member's profile save is not refused by the items email gate", unconf.err === null && unconf.rows.length === 1, unconf.err ?? "");

  await srv(`INSERT INTO public.declutter_strikes (user_id, item_id) VALUES ('${GONE}', '${GONE_ITEM}'), ('${GONE}', NULL), ('${GONE}', NULL);
             INSERT INTO public.declutter_seller_flags (user_id, business_like) VALUES ('${GONE}', true);`);
  let delErr = null;
  try {
    await srv(`DELETE FROM auth.users WHERE id = '${GONE}'`);
  } catch (e) {
    delErr = String(e.message);
  }
  const left = (await db.query(`SELECT (SELECT count(*) FROM public.declutter_items WHERE seller_id = '${GONE}') + (SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${GONE}')
    + (SELECT count(*) FROM public.declutter_seller_flags WHERE user_id = '${GONE}') + (SELECT count(*) FROM public.profiles WHERE user_id = '${GONE}') AS n`)).rows[0].n;
  check("A9 deleting a hidden seller's account cascades cleanly", delErr === null && Number(left) === 0, delErr ?? `left=${left}`);
}

console.log(`\n${failures} failure(s)${BEFORE ? `, ${redFailures} of them RED checks (expected: every RED check fails before)` : ""}`);
if (BEFORE) process.exit(redFailures === 3 && failures === 3 ? 0 : 1);
process.exit(failures === 0 ? 0 : 1);
