#!/usr/bin/env node
/**
 * PGlite proof for 20261026023246_account_pause.sql (board 120).
 *
 *   node src/test/pglite/accountPause.pglite.mjs
 *
 * Migration applied 3x (replay). auth.uid(), require_feature(), feature_enabled_for_user(),
 * is_caller_banned() and declutter_notify() are stubs (the notify stub records each call).
 * Checks:
 *  - pause (service role): only the member's LIVE items come down (status paused + paused_by_account),
 *    reserved/sold and other sellers' items untouched; open offers on them voided with an event and a
 *    notice to the buyer; profiles.paused_at set; refused when the switch is off for the member;
 *  - resume: only the items the pause took down go back live; an item the member paused by hand stays
 *    paused; paused_at cleared; a banned member is refused;
 *  - account_is_paused: true for a paused member, false otherwise and signed out;
 *  - grants: apply is service_role only; resume and is_paused for authenticated; none for anon/PUBLIC.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const SQL = readFileSync(new URL("../../../supabase/migrations/20261026023246_account_pause.sql", import.meta.url).pathname, "utf8");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1), OTHER = U(2), BUYER = U(3);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, description text);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF coalesce(current_setting('test.feature', true), '') <> 'on' THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF; END $$;
  CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.feature', true), '') = 'on' $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.banned', true), '') = 'yes' $$;
  CREATE TABLE public.notices (user_id uuid, type text, title text, message text, link text);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_type, p_title, p_message, p_link) $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, title text, status text, updated_at timestamptz);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, status text, closed_at timestamptz, updated_at timestamptz);
  CREATE TABLE public.declutter_offer_events (id serial PRIMARY KEY, offer_id uuid, actor_side text, action text);
  INSERT INTO public.profiles VALUES ('${ME}', 'Me Mine'), ('${OTHER}', 'Oth Er');
  INSERT INTO public.declutter_items (id, seller_id, title, status) VALUES
    ('${U(101)}', '${ME}', 'Lamp', 'live'), ('${U(102)}', '${ME}', 'Chair', 'live'), ('${U(103)}', '${ME}', 'Desk', 'reserved'),
    ('${U(104)}', '${ME}', 'Rug', 'paused'), ('${U(105)}', '${OTHER}', 'Fan', 'live');
  INSERT INTO public.declutter_offers (item_id, buyer_id, status) VALUES ('${U(101)}', '${BUYER}', 'open'), ('${U(105)}', '${BUYER}', 'open');
`);
for (let i = 0; i < 3; i++) await db.exec(SQL);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const as = (uid, feature = "on", banned = "no") => db.exec(`SET test.uid = '${uid ?? ""}'; SET test.feature = '${feature}'; SET test.banned = '${banned}'`);
const raises = async (sql, re) => { try { await db.query(sql); return false; } catch (e) { return re.test(String(e.message)); } };
const items = async () => Object.fromEntries((await db.query(`SELECT id, status, paused_by_account FROM public.declutter_items ORDER BY id`)).rows.map((r) => [r.id, `${r.status}${r.paused_by_account ? "*" : ""}`]));

check("the switch row exists at testers", (await db.query(`SELECT audience FROM public.feature_switches WHERE key = 'account_pause'`)).rows[0]?.audience === "testers");
await as(null, "off");
check("pause refused when the switch is off for the member", await raises(`SELECT public.account_pause_apply('${ME}')`, /feature_disabled/));
await as(null);
const took = (await db.query(`SELECT public.account_pause_apply('${ME}') AS n`)).rows[0].n;
let st = await items();
check("pause: my 2 live items down and marked; reserved, hand-paused and others' untouched", took === 2 && st[U(101)] === "paused*" && st[U(102)] === "paused*" && st[U(103)] === "reserved" && st[U(104)] === "paused" && st[U(105)] === "live", { took, st });
const offers = (await db.query(`SELECT item_id, status FROM public.declutter_offers ORDER BY item_id`)).rows;
check("pause: the open offer on my item voided (event + notice to the buyer); the other seller's offer still open",
  offers.find((o) => o.item_id === U(101))?.status === "voided" && offers.find((o) => o.item_id === U(105))?.status === "open" &&
  (await db.query(`SELECT count(*)::int AS c FROM public.declutter_offer_events WHERE action = 'void'`)).rows[0].c === 1 &&
  (await db.query(`SELECT count(*)::int AS c FROM public.notices WHERE user_id = '${BUYER}' AND title = 'Item paused'`)).rows[0].c === 1, offers);
check("pause: my profile is marked paused", (await db.query(`SELECT paused_at IS NOT NULL AS p FROM public.profiles WHERE user_id = '${ME}'`)).rows[0].p === true);

await as(OTHER);
check("account_is_paused: true for me, read by another member", (await db.query(`SELECT public.account_is_paused('${ME}') AS p`)).rows[0].p === true);
check("account_is_paused: false for an unpaused member", (await db.query(`SELECT public.account_is_paused('${OTHER}') AS p`)).rows[0].p === false);
await as(null);
check("account_is_paused: false signed out", (await db.query(`SELECT public.account_is_paused('${ME}') AS p`)).rows[0].p === false);

await as(ME, "on", "yes");
check("resume: a banned member is refused", await raises(`SELECT public.account_resume()`, /account_restricted/));
await as(ME);
const back = (await db.query(`SELECT public.account_resume() AS n`)).rows[0].n;
st = await items();
check("resume: only the 2 the pause took down go live; the hand-paused one stays paused", back === 2 && st[U(101)] === "live" && st[U(102)] === "live" && st[U(104)] === "paused" && st[U(103)] === "reserved", { back, st });
check("resume: paused_at cleared", (await db.query(`SELECT paused_at IS NULL AS c FROM public.profiles WHERE user_id = '${ME}'`)).rows[0].c === true);
await as(ME, "off");
check("resume refused when the switch is off", await raises(`SELECT public.account_resume()`, /feature_disabled/));

const acl = async (fn) => (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = '${fn}'`)).rows[0].a;
const applyAcl = await acl("account_pause_apply");
check("account_pause_apply: service_role only", /service_role=X/.test(applyAcl) && !/authenticated=X/.test(applyAcl) && !/anon=/.test(applyAcl) && !/(^|\{|,)=X/.test(applyAcl), applyAcl);
for (const fn of ["account_resume", "account_is_paused"]) {
  const a = await acl(fn);
  check(`${fn}: authenticated, no anon or PUBLIC`, /authenticated=X/.test(a) && !/anon=/.test(a) && !/(^|\{|,)=X/.test(a), a);
}
console.log(`\n${n - fails}/${n} passed (migration applied 3x)`);
process.exit(fails ? 1 : 0);
