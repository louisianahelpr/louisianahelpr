#!/usr/bin/env node
/**
 * PGlite proof for 20261030154707_declutter_wanted_email (D4-11): Wanted notices queue an email under the Wanted type.
 *
 *   node src/test/pglite/declutterWantedEmail.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterWantedEmail.pglite.mjs # RED: the previous bodies
 *   MUTANT=<name> node src/test/pglite/declutterWantedEmail.pglite.mjs      # a planted defect: must FAIL
 *
 * Stubbed, said so: the membership, block and distance helpers answer from small tables or a constant; declutter_notify
 * records the bell row; net.http_post records the email body and can be told to fail; the notifications table has a
 * trigger standing in for the seed boundary (drops a row for a member listed in seed_blocked). declutter_wanted_reply,
 * declutter_wanted_notify and declutter_wanted_email are the real bodies.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261030154707_declutter_wanted_email.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The reply notice sends no email.
  replySilent: [`PERFORM public.declutter_wanted_email(w.user_id, 'A seller has a match', v_message, '/declutter?tab=buying');`, `NULL;`],
  // A test seller's reply emails a real member.
  replySeed: [`IF NOT (COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = v_uid), false)`, `IF true OR NOT (COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = v_uid), false)`],
  // An alert whose bell row was dropped still emails.
  notifyUnguarded: [`IF v_id IS NOT NULL THEN\n    PERFORM public.declutter_wanted_email`, `IF true THEN\n    PERFORM public.declutter_wanted_email`],
  // The email goes out under another type, so the Wanted email switch would not decide it.
  wrongType: [`'type', 'declutter_wanted', 'link', p_link`, `'type', 'new_offers', 'link', p_link`],
  // The bell link back to the either-side address.
  oldLink: [`'A seller has a match', v_message, '/declutter?tab=buying', v_uid);`, `'A seller has a match', v_message, '/declutter?view=offers', v_uid);`],
  // A failed email undoes the offer.
  noCatch: [`EXCEPTION WHEN OTHERS THEN\n  -- The bell row and the offer already stand; a lost email is recorded where ops reads.\n  RAISE WARNING 'declutter_wanted_email: to % not queued: %', p_user, SQLERRM;\n  PERFORM public.log_cron_defect('declutter_wanted_email', COALESCE(p_user::text, '-') || ':' || COALESCE(p_title, ''), SQLERRM);\n`, ``],
  // The email keeps the raw "$12.00" the bell does not show.
  rawPrice: [`'message', public.declutter_price_words(p_message)`, `'message', p_message`],
};
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I = (n) => `44444444-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), SELLER = U(2), TEST_SELLER = U(3), POSTER2 = U(4), DROPPED = U(5), POSTER3 = U(6);

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth; create schema net; create schema vault;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table net.calls (body jsonb); create table net.fail (on_ boolean);
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language plpgsql as $$
begin
  if exists (select 1 from net.fail) then raise exception 'net is down'; end if;
  insert into net.calls values (body); return 1;
end $$;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('supabase_url','http://x'),('service_role_key','k');
create function public.require_feature(k text) returns void language sql as $$ select $$;
create function public.is_caller_banned() returns boolean language sql as $$ select false $$;
create function public.declutter_assert_member(p boolean) returns uuid language sql as $$ select auth.uid() $$;
create function public.declutter_seller_out(u uuid) returns boolean language sql as $$ select false $$;
create function public.declutter_member_out(u uuid) returns boolean language sql as $$ select false $$;
create function public.declutter_seller_hidden(u uuid) returns boolean language sql as $$ select false $$;
create function public.member_under_18(u uuid) returns boolean language sql as $$ select false $$;
create function public.are_users_blocked(a uuid, b uuid) returns boolean language sql as $$ select false $$;
create function public.seed_hidden_from_caller() returns boolean language sql as $$ select false $$;
create function public.seed_hidden_for(u uuid) returns boolean language sql as $$ select false $$;
create function public.declutter_miles(a numeric, b numeric, c numeric, d numeric) returns numeric language sql as $$ select 1::numeric $$;
create function public.declutter_price_words(m text) returns text language sql as $$ select regexp_replace(m, '\\.00\\y', '', 'g') $$;
create table public.defects (fn text, ref text, msg text);
create function public.log_cron_defect(f text, r text, m text) returns void language sql as $$ insert into public.defects values (f, r, m) $$;
create table public.profiles (user_id uuid primary key, is_seed boolean default false);
insert into public.profiles values ('${POSTER}', false), ('${SELLER}', false), ('${TEST_SELLER}', true), ('${POSTER2}', false), ('${DROPPED}', false), ('${POSTER3}', false);
create table public.bell (user_id uuid, kind text, title text, message text, link text);
create function public.declutter_notify(u uuid, k text, t text, m text, l text, a uuid) returns void language sql as $$ insert into public.bell values (u, k, t, m, l) $$;
create table public.seed_blocked (user_id uuid);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, message text, link text);
create function public.fake_seed_boundary() returns trigger language plpgsql as $$
begin if exists (select 1 from public.seed_blocked s where s.user_id = new.user_id) then return null; end if; return new; end $$;
create trigger fake_seed_boundary before insert on public.notifications for each row execute function public.fake_seed_boundary();
create table public.declutter_items (id uuid primary key, seller_id uuid, status text default 'live', sale_mode text default 'offers', current_price_cents int,
  title text, is_seed boolean default false, area_lat numeric default 30, area_lng numeric default -92);
create table public.declutter_wanted (id uuid primary key default gen_random_uuid(), user_id uuid, public boolean default true, status text default 'open',
  expires_at timestamptz default now() + interval '30 days', max_price_cents int, radius_miles int default 25, area_lat numeric default 30, area_lng numeric default -92, is_seed boolean default false);
create table public.declutter_offers (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, amount_cents int, awaiting text,
  status text default 'open', respond_by timestamptz, counter_count int default 0, wanted_id uuid, created_at timestamptz default now());
create table public.declutter_offer_events (offer_id uuid, actor_side text, action text, amount_cents int);
`);

await db.exec(definitionBefore("declutter_wanted_reply", THIS));
await db.exec(definitionBefore("declutter_wanted_notify", THIS));
if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const as = (u) => db.exec(`select set_config('t.uid', '${u}', false)`);
const mails = async (u) => q(`select body from net.calls where body->>'user_id' = $1`, [u]);
const reply = async (poster, seller, itemN, cents = 1200) => {
  const w = (await q(`insert into public.declutter_wanted (user_id, max_price_cents) values ($1, 5000) returning id`, [poster]))[0].id;
  await q(`insert into public.declutter_items (id, seller_id, current_price_cents, title) values ($1, $2, 5000, $3)`, [I(itemN), seller, `Mug ${itemN}`]);
  await as(seller);
  return (await q(`select public.declutter_wanted_reply($1, $2, $3) id`, [w, I(itemN), cents]))[0].id;
};

// 1. A real seller's reply: bell and email, same words, the buyer's tab.
await reply(POSTER, SELLER, 1);
const m1 = await mails(POSTER);
const b1 = (await q(`select * from public.bell where user_id = $1`, [POSTER]))[0];
check(m1.length === 1, `a reply queues one email (${m1.length})`);
check(m1[0]?.body.type === "declutter_wanted", `the email is the Wanted type, so email_declutter_wanted decides it (${m1[0]?.body.type})`);
check(m1[0]?.body.title === "A seller has a match", `the email has the notice's title`);
check(m1[0]?.body.message?.includes('"Mug 1" for $12,') && !m1[0]?.body.message?.includes("$12.00"), `the email reads the price as the bell shows it (${m1[0]?.body.message})`);
check(b1?.link === "/declutter?tab=buying", `the bell opens Buying (${b1?.link})`);
check(m1[0]?.body.link === "/declutter?tab=buying", `the email opens Buying (${m1[0]?.body.link})`);

// 2. A test seller's reply never mails a real member.
await reply(POSTER2, TEST_SELLER, 2);
check((await mails(POSTER2)).length === 0, "a test seller's reply emails no real member");

// 3. The match alerts: email beside the bell, nothing when the boundary dropped the row.
await q(`select public.declutter_wanted_notify($1, 'A match for what you want', '"Lamp" was just listed near you for $5.', '/declutter/item/x')`, [SELLER]);
const m3 = await mails(SELLER);
check(m3.length === 1 && m3[0].body.type === "declutter_wanted", `a match alert queues one Wanted email (${m3.length})`);
await q(`insert into public.seed_blocked values ($1)`, [DROPPED]);
const n = (await q(`select public.declutter_wanted_notify($1, 'A match for what you want', 'm', '/x') n`, [DROPPED]))[0].n;
check(n === 0 && (await mails(DROPPED)).length === 0, `a dropped bell row sends no email and counts 0 (${n})`);

// 4. A failed email undoes nothing and is on record.
await q(`insert into net.fail values (true)`);
let threw = "";
try { await reply(POSTER3, SELLER, 3); } catch (e) { threw = e.message; }
const offers = (await q(`select count(*)::int n from public.declutter_offers where buyer_id = $1`, [POSTER3]))[0].n;
check(!threw && offers === 1, `the offer stands when the email fails (${threw || "no error"}, ${offers})`);
const defects = (await q(`select * from public.defects where fn = 'declutter_wanted_email'`)).length;
check(defects === 1, `the lost email is on record (${defects})`);
await q(`delete from net.fail`);

// 5. Grants.
if (!skip) {
  const acl = (await q(`select has_function_privilege('anon', 'public.declutter_wanted_email(uuid,text,text,text)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_wanted_email(uuid,text,text,text)', 'EXECUTE') u,
    has_function_privilege('service_role', 'public.declutter_wanted_email(uuid,text,text,text)', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && acl.s, `the helper is service_role only (anon ${acl.a}, authenticated ${acl.u}, service_role ${acl.s})`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
