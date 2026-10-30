#!/usr/bin/env node
/**
 * PGlite proof for 20261030170443_declutter_question_kind.sql (Q2488): question notices get their own kind, and its switch mutes only questions.
 *
 *   node src/test/pglite/declutterQuestionKind.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterQuestionKind.pglite.mjs # RED: the previous bodies
 *   MUTANT=<name> node src/test/pglite/declutterQuestionKind.pglite.mjs      # a planted defect: must FAIL
 *
 * REAL bodies, read from the newest definition before this migration: fan_out_push_on_notification, declutter_notify,
 * declutter_notify_strict, declutter_notice_link, declutter_notice_type, declutter_question_notice, job_reminder_kind,
 * declutter_notice_names_item, declutter_price_words. The real trigger on declutter_questions fires them.
 * Stubbed, said so: job_reminder_types (empty: no Declutter notice is a job reminder), are_users_blocked (a table), log_cron_defect (a table), net.http_post (records the request), vault,
 * get_supabase_url, get_service_role_key. The tables hold only the columns those bodies read, and the CHECK is prod's.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261030170443_declutter_question_kind.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The new push column does not start from the member's Offers choice.
  noPushCopy: ["UPDATE public.notification_preferences SET declutter_questions = declutter_offers WHERE declutter_offers IS FALSE;", "NULL;"],
  // The email twin does not either.
  noEmailCopy: ["UPDATE public.notification_preferences SET email_declutter_questions = email_declutter_offers WHERE email_declutter_offers IS FALSE;", "NULL;"],
  // A replay overwrites a later choice.
  replayCopy: ["AND column_name = 'declutter_questions') THEN\n    ALTER TABLE public.notification_preferences ADD COLUMN declutter_questions boolean NOT NULL DEFAULT true;",
    "AND column_name = 'declutter_questions') THEN\n    ALTER TABLE public.notification_preferences ADD COLUMN declutter_questions boolean NOT NULL DEFAULT true;\n  END IF;\n  IF true THEN"],
  // The kind is gated by the Offers switch: muting Offers still loses questions.
  mapToOffers: ["('declutter_questions', 'declutter_questions', 'Declutter:", "('declutter_questions', 'declutter_offers', 'Declutter:"],
  // The CHECK refuses the new kind, so every question notice is lost to the defect log.
  noCheck: ["'declutter_wanted', 'declutter_questions'\n  ));", "'declutter_wanted'\n  ));"],
  // The new-question notice stays an Offers notice, by the sender and by the title list.
  askStaysOffers: ["public.declutter_notify(v_item.seller_id, 'declutter_questions', 'New question',", "public.declutter_notify(v_item.seller_id, 'declutter_offers', 'New question',"],
  // The answer notice stays an Offers notice.
  answerStaysOffers: ["public.declutter_notify(NEW.asker_id, 'declutter_questions', 'The seller answered',", "public.declutter_notify(NEW.asker_id, 'declutter_offers', 'The seller answered',"],
  // The writer loses the kind a caller chose.
  dropsKind: ["'declutter_wanted', 'declutter_questions') THEN p_type", "'declutter_wanted') THEN p_type"],
  // The titles are no longer mapped.
  noTitles: ["    WHEN p_title IN ('New question', 'The seller answered')\n      THEN 'declutter_questions'\n", ""],
  // The block rule is lost in the restatement.
  noBlock: ["    IF public.are_users_blocked(NEW.asker_id, v_item.seller_id) THEN", "    IF false THEN"],
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
const SELLER = U(1), ASKER = U(2), OFFERS_OFF = U(3), PLAIN = U(4), BLOCKED = U(5), EMAIL_OFF = U(6), LATER = U(7);
const USERS = [SELLER, ASKER, OFFERS_OFF, PLAIN, BLOCKED, EMAIL_OFF, LATER];
const ITEM = "44444444-0000-4000-8000-000000000001", ITEM2 = "44444444-0000-4000-8000-000000000002";

// notification_type_pref_map as prod holds it, read 2026-10-30.
const PREF_MAP = [
  ["admin_alert", "system_alerts"], ["application", "job_applications"], ["expired", "job_updates"],
  ["financial_alerts", "financial_alerts"], ["info", "work_status"], ["job_match", "job_matches"],
  ["job_update", "job_updates"], ["job_updates", "job_updates"], ["message", "messages"], ["new_offers", "new_offers"],
  ["payment", "payments"], ["review", "reviews"], ["success", "work_status"], ["system_alert", "system_alerts"],
  ["transit_updates", "transit_updates"], ["verified", "system_alerts"], ["warning", "system_alerts"], ["work_status", "work_status"],
  ["declutter_listings", "declutter_listings"], ["declutter_offers", "declutter_offers"], ["declutter_sales", "declutter_sales"],
  ["declutter_pickups", "declutter_pickups"], ["declutter_refunds", "declutter_refunds"],
  ["declutter_price_drops", "declutter_price_drops"], ["declutter_wanted", "declutter_wanted"],
];

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth; create schema net; create schema vault;
create table net.calls (url text, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ insert into net.calls values (url, body); select 1::bigint $$;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('supabase_url','https://x.test'),('service_role_key','k');
create function public.get_supabase_url() returns text language sql stable as $$ select 'https://x.test' $$;
create function public.get_service_role_key() returns text language sql stable as $$ select 'k' $$;
create table public.blocks (a uuid, b uuid);
create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as
  $$ select exists (select 1 from public.blocks where (a = p1 and b = p2) or (a = p2 and b = p1)) $$;
create table public.defects (fn text, ref text, msg text);
create function public.log_cron_defect(f text, r text, m text, c jsonb default null) returns void language sql as $$ insert into public.defects values (f, r, m) $$;
create table public.error_logs (severity text, message text, tags jsonb, context jsonb);
create table public.profiles (user_id uuid primary key, is_seed boolean default false);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, message text, link text, read boolean default false, job_id uuid, created_at timestamptz default now());
alter table public.notifications add constraint notifications_type_check check (type in (
  'info', 'success', 'warning', 'job_update', 'application', 'review', 'payment', 'job_match', 'job_updates', 'work_status',
  'transit_updates', 'system_alert', 'new_offers', 'expired', 'financial_alerts', 'verified', 'message', 'admin_alert',
  'declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups', 'declutter_refunds', 'declutter_price_drops', 'declutter_wanted'));
create table public.job_reminder_types (kind text, always_on boolean, pref_column text, match_type text, match_title text, match_message_like text);
create table public.notification_type_pref_map (type text primary key, pref_column text not null, description text);
insert into public.notification_type_pref_map (type, pref_column) values ${PREF_MAP.map(([t, c]) => `('${t}', '${c}')`).join(",")};
create table public.notification_preferences (id uuid default gen_random_uuid(), user_id uuid primary key,
  job_applications boolean default true, job_updates boolean default true, messages boolean default true, payments boolean default true,
  reviews boolean default true, promotions boolean default true, system_alerts boolean default true, push_enabled boolean default true,
  new_offers boolean default true, transit_updates boolean default true, work_status boolean default true, financial_alerts boolean default true, job_matches boolean default true,
  email_enabled boolean default true, quiet_start time, quiet_end time,
  declutter_listings boolean not null default true, declutter_offers boolean not null default true, declutter_sales boolean not null default true,
  declutter_pickups boolean not null default true, declutter_refunds boolean not null default true, declutter_price_drops boolean not null default true, declutter_wanted boolean not null default true,
  email_declutter_offers boolean not null default true);
create table public.declutter_items (id uuid primary key, seller_id uuid, title text);
create table public.declutter_questions (id uuid primary key default gen_random_uuid(), item_id uuid, asker_id uuid, question text, answer text, answered_at timestamptz, removed_at timestamptz);
insert into public.profiles (user_id) values ${USERS.map((u) => `('${u}')`).join(",")};
insert into public.notification_preferences (user_id) values ${USERS.map((u) => `('${u}')`).join(",")};
update public.notification_preferences set declutter_offers = false where user_id in ('${OFFERS_OFF}', '${LATER}');
update public.notification_preferences set email_declutter_offers = false where user_id in ('${EMAIL_OFF}', '${LATER}');
insert into public.declutter_items values ('${ITEM}', '${SELLER}', 'Blue lamp'), ('${ITEM2}', '${OFFERS_OFF}', 'Red chair');
`);

for (const fn of ["declutter_price_words", "declutter_notice_names_item", "declutter_notice_type", "declutter_notice_link",
  "declutter_notify_strict", "declutter_notify", "job_reminder_kind", "fan_out_push_on_notification", "declutter_question_notice"]) {
  await db.exec(definitionBefore(fn, THIS));
}
await db.exec(`
create trigger notifications_fan_out_to_push after insert on public.notifications for each row execute function public.fan_out_push_on_notification();
create trigger trg_declutter_questions_notice after insert or update of answered_at on public.declutter_questions for each row execute function public.declutter_question_notice();
`);

const q = async (s, p = []) => (await db.query(s, p)).rows;
let mig = "";
if (!skip) {
  mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  await db.exec(mig);
  check(true, "the migration applies (run 1)");
  // A choice made between runs must survive the replays.
  await db.exec(`update public.notification_preferences set declutter_questions = false, email_declutter_questions = false where user_id = '${PLAIN}'`);
  // Someone whose copy started off turns Questions back on: a replay that copies again would mute them.
  await db.exec(`update public.notification_preferences set declutter_questions = true, email_declutter_questions = true where user_id = '${LATER}'`);
  await db.exec(mig);
  check(true, "the migration applies (run 2)");
  await db.exec(mig);
  check(true, "the migration applies (run 3)");
  const plain = (await q(`select declutter_questions d, email_declutter_questions e from public.notification_preferences where user_id = $1`, [PLAIN]))[0];
  check(plain.d === false && plain.e === false, `a choice made after the first run survives two replays (${JSON.stringify(plain)})`);
  const later = (await q(`select declutter_questions d, email_declutter_questions e from public.notification_preferences where user_id = $1`, [LATER]))[0];
  check(later.d === true && later.e === true, `Questions turned back on after the first run stays on through two replays (${JSON.stringify(later)})`);
  await db.exec(`update public.notification_preferences set declutter_questions = true, email_declutter_questions = true where user_id = '${PLAIN}'`);
}

const col = async (u, c) => { try { return (await q(`select ${c} v from public.notification_preferences where user_id = $1`, [u]))[0].v; } catch { return "no column"; } };
const notes = (u) => q(`select type, title, link from public.notifications where user_id = $1 order by created_at, id`, [u]);
const pushes = async (u) => (await q(`select body from net.calls where url like '%send-push-notification' and body->>'user_id' = $1`, [u])).length;
const clear = () => db.exec(`delete from public.notifications; delete from net.calls;`);
const ask = (item, by) => q(`insert into public.declutter_questions (item_id, asker_id, question) values ($1, $2, 'Does it work?') returning id`, [item, by]);
const answer = (id) => q(`update public.declutter_questions set answer = 'Yes', answered_at = now() where id = $1`, [id]);

// 1. A member's choice carries over.
check((await col(OFFERS_OFF, "declutter_questions")) === false, "a member with Offers muted starts with Questions muted");
check((await col(OFFERS_OFF, "email_declutter_questions")) === true, "their email twin follows their email Offers switch, which is on");
check((await col(EMAIL_OFF, "email_declutter_questions")) === false, "a member with Offers email off starts with Questions email off");
check((await col(EMAIL_OFF, "declutter_questions")) === true, "their push switch follows their push Offers switch, which is on");
check((await col(SELLER, "declutter_questions")) === true && (await col(SELLER, "email_declutter_questions")) === true, "a member who muted nothing has both on");

// 2. A question is stored under its own kind and pushed.
await clear();
const [{ id: qid }] = await ask(ITEM, ASKER);
const asked = await notes(SELLER);
check(asked.length === 1 && asked[0].title === "New question" && asked[0].type === "declutter_questions", `"New question" is stored as declutter_questions (${asked[0]?.type})`);
check((await pushes(SELLER)) === 1, "it is pushed to the seller");
await answer(qid);
const answered = await notes(ASKER);
check(answered.length === 1 && answered[0].title === "The seller answered" && answered[0].type === "declutter_questions", `"The seller answered" is stored as declutter_questions (${answered[0]?.type})`);
check((await pushes(ASKER)) === 1, "it is pushed to the asker");
const lost = await q(`select fn, msg from public.defects`);
check(lost.length === 0, `no notice was lost to the defect log (${JSON.stringify(lost[0] ?? null)})`);

// 3. The switch mutes only questions: the owner's complaint, both ways.
await clear();
await db.exec(`update public.notification_preferences set declutter_questions = false, declutter_offers = true where user_id = '${SELLER}'`);
await ask(ITEM, ASKER);
check((await notes(SELLER)).length === 1 && (await pushes(SELLER)) === 0, "Questions off: the question's bell row lands, no push");
await q(`select public.declutter_notify($1, 'new_offers', 'New offer', 'm', '/declutter?tab=selling', null)`, [SELLER]);
check((await pushes(SELLER)) === 1, "Questions off: an offer is still pushed");

await clear();
await db.exec(`update public.notification_preferences set declutter_questions = true, declutter_offers = false where user_id = '${SELLER}'`);
await ask(ITEM, ASKER);
check((await pushes(SELLER)) === 1, "Offers off, Questions on: a question is still pushed");
await q(`select public.declutter_notify($1, 'new_offers', 'New offer', 'm', '/declutter?tab=selling', null)`, [SELLER]);
check((await pushes(SELLER)) === 1, "Offers off, Questions on: an offer is not pushed");

// 4. The writer's two routes, each alone.
const kind = async (t, title, link) => (await q(`select public.declutter_notice_type($1, $2, $3) k`, [t, title, link]))[0].k;
const byTitle = await kind("new_offers", "New question", "/declutter/item/1");
check(byTitle === "declutter_questions", `the title list maps "New question" (${byTitle})`);
const byTitle2 = await kind("new_offers", "The seller answered", "/declutter/item/1");
check(byTitle2 === "declutter_questions", `the title list maps "The seller answered" (${byTitle2})`);
const byCaller = await kind("declutter_questions", "New offer", "/declutter/item/1");
check(byCaller === "declutter_questions", `a caller's own declutter_questions beats the title lists (${byCaller})`);
const offerStill = await kind("new_offers", "New offer", "/declutter?tab=selling");
check(offerStill === "declutter_offers", `an offer is still declutter_offers (${offerStill})`);

// 5. The block rule and the removed-question rule came through the restatement.
await clear();
await db.exec(`insert into public.blocks values ('${SELLER}', '${BLOCKED}')`);
await ask(ITEM, BLOCKED);
check((await notes(SELLER)).length === 0, "a blocked pair is not told of a question");
await q(`insert into public.declutter_questions (item_id, asker_id, question, removed_at) values ($1, $2, 'gone', now())`, [ITEM, ASKER]);
check((await notes(SELLER)).length === 0, "a removed question tells nobody");

// 6. The CHECK still refuses an unknown kind, and the map has the kind on its own column.
let threw = false;
try { await db.exec(`insert into public.notifications (user_id, type, title) values ('${SELLER}', 'declutter_bogus', 'x')`); } catch { threw = true; }
check(threw, "the CHECK still refuses an unknown type");
const map = (await q(`select pref_column c from public.notification_type_pref_map where type = 'declutter_questions'`))[0]?.c;
check(map === "declutter_questions", `the kind is gated by its own column (${map})`);

// 7. Grants on what this migration restates.
if (!skip) {
  const acl = (await q(`select has_function_privilege('anon', 'public.declutter_notice_type(text,text,text)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_notice_type(text,text,text)', 'EXECUTE') u,
    has_function_privilege('anon', 'public.declutter_question_notice()', 'EXECUTE') a2,
    has_function_privilege('authenticated', 'public.declutter_question_notice()', 'EXECUTE') u2,
    has_function_privilege('service_role', 'public.declutter_notice_type(text,text,text)', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && !acl.a2 && !acl.u2 && acl.s, `grants as before: service_role only (${JSON.stringify(acl)})`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
