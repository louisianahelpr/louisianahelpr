#!/usr/bin/env node
/**
 * PGlite proof for 20261030225143 (Declutter posting audit 10-30 #8): Report and Block on a Wanted post, the admin
 * half, and the automatic check on Wanted photos.
 *
 *   node src/test/pglite/declutterWantedReportBlock.pglite.mjs                      # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterWantedReportBlock.pglite.mjs   # red: the checks need it
 *
 * block_user_and_settle here is the REAL migration text, with its small price helpers stubbed, so "a Wanted block
 * cancels nothing" is measured against the code that really cancels. The control (controlDirectBlockCancelsWithFee)
 * proves the fixture is a shared job a plain block does cancel with a fee. The stub world otherwise follows
 * declutterWantedMatchManage.pglite.mjs. pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261030225143_declutter_wanted_report_block_photo_check.sql`, "utf8");
const manage = readFileSync(`${MIG_DIR}20261030221255_declutter_wanted_match_and_manage.sql`, "utf8");
const photosMig = readFileSync(`${MIG_DIR}20261030064727_declutter_wanted_photos_and_replies.sql`, "utf8");
const settleMig = readFileSync(`${MIG_DIR}20261012124103_crew_block_slotless_share_by_hire_order.sql`, "utf8");
const displayName = readFileSync(`${MIG_DIR}20261021061341_member_display_name.sql`, "utf8")
  .match(/CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?AS (\$fn\$)[\s\S]*?\1;/)[0];
const pick = (src, name) => src.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\nAS (\\$[a-z_]*\\$)\\n[\\s\\S]*?\\n\\1;`))[0];
const db = new PGlite();
const P = "11111111-1111-4111-8111-111111111111"; // the poster
const S = "22222222-2222-4222-8222-222222222222"; // a member who sees the post
const X = "33333333-3333-4333-8333-333333333333"; // shares a job with the poster, with S as a clean control
const A = "44444444-4444-4444-8444-444444444444"; // an admin
const C = "55555555-5555-4555-8555-555555555555"; // on the poster's crew
const JOB = "a0000000-0000-4000-8000-000000000001", CREW = "a0000000-0000-4000-8000-000000000002", APP = "a0000000-0000-4000-8000-000000000003", OPENJOB = "a0000000-0000-4000-8000-000000000004";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('t.role', true), '') $$;
create schema storage; create table storage.objects(bucket_id text, name text, owner_id text, owner uuid, metadata jsonb);
create type app_role as enum ('admin', 'user');
create table off_keys(k text);
create function require_feature(k text) returns void language plpgsql as $$ begin if exists(select 1 from off_keys where off_keys.k = require_feature.k) then raise exception 'feature_disabled' using errcode='42501'; end if; end $$;
create function feature_enabled_for_user(k text, u uuid) returns boolean language sql as $$ select not exists(select 1 from off_keys where off_keys.k = $1) $$;
create table feature_switches(key text, audience text); insert into feature_switches values ('declutter','everyone'),('declutter_wanted','everyone');
create table bad(user_id uuid); create table outs(user_id uuid); create table seedhide(on_ boolean); insert into seedhide values (true);
create table testers(user_id uuid); create table minors(user_id uuid); create table user_roles(user_id uuid, role app_role);
insert into user_roles values ('${A}', 'admin');
create table user_blocks(blocker_id uuid, blocked_id uuid, reason text, primary key (blocker_id, blocked_id));
create function has_role(u uuid, r app_role) returns boolean language sql as $$ select exists(select 1 from user_roles x where x.user_id = u and x.role = r) $$;
create function is_server_context() returns boolean language sql stable as $$ select auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated') $$;
create function is_caller_banned() returns boolean language sql as $$ select exists(select 1 from bad where user_id = auth.uid()) $$;
create function declutter_assert_member(p boolean) returns uuid language plpgsql as $$ begin if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if; return auth.uid(); end $$;
create function are_users_blocked(a uuid, b uuid) returns boolean language sql as $$ select exists(select 1 from user_blocks where (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1)) $$;
create function declutter_member_out(u uuid) returns boolean language sql as $$ select exists(select 1 from outs where user_id = u) $$;
create function declutter_seller_out(u uuid) returns boolean language sql as $$ select exists(select 1 from outs where user_id = u) $$;
create function declutter_seller_hidden(u uuid) returns boolean language sql as $$ select false $$;
create function member_under_18(u uuid) returns boolean language sql as $$ select exists(select 1 from minors where user_id = u) $$;
create function seed_hidden_from_caller() returns boolean language sql as $$ select (select on_ from seedhide) and not exists(select 1 from testers where user_id = auth.uid()) $$;
create function seed_hidden_for(u uuid) returns boolean language sql as $$ select (select on_ from seedhide) and not exists(select 1 from testers where user_id = u) $$;
create function declutter_money_words(c int) returns text language sql as $$ select '$' || (c/100)::text $$;
create function declutter_wanted_snap_miles(a numeric, b numeric, c numeric, d numeric) returns int language sql as $$ select 1 $$;
create table cron_defects(src text, k text, msg text);
create function log_cron_defect(a text, b text, c text) returns void language sql as $$ insert into cron_defects values (a,b,c) $$;
create table notes(user_id uuid, title text, message text, link text);
create function declutter_wanted_alert_block(u uuid) returns text language sql as $$ select null::text $$;
create function declutter_wanted_notify(u uuid, t text, m text, l text) returns int language plpgsql as $$ begin insert into notes values (u,t,m,l); return 1; end $$;
create table profiles(user_id uuid primary key, full_name text, anonymized_at timestamptz, is_seed boolean default false);
insert into profiles values ('${P}', 'Pat Thibodeaux'), ('${S}', 'Sam Guidry'), ('${X}', 'Xan Broussard'), ('${A}', 'Ann Admin'), ('${C}', 'Cam Crew');
create table declutter_items(id uuid primary key, seller_id uuid, status text default 'live', current_price_cents int, title text, description text default '', category text, is_seed boolean default false,
  area_lat numeric(5,2) not null default 30.00, area_lng numeric(6,2) not null default -92.00, created_at timestamptz default now());
create table declutter_item_private(item_id uuid, floor_price_cents int);
create table declutter_item_photos(item_id uuid, storage_path text, position int);
create table declutter_wanted(id uuid primary key default gen_random_uuid(), user_id uuid, what text, category text, max_price_cents int, radius_miles smallint,
  area_lat numeric, area_lng numeric, status text default 'open', expires_at timestamptz default now() + interval '30 days', is_seed boolean default false,
  created_at timestamptz default now(), closed_at timestamptz, public boolean default false, photo_paths text[] not null default '{}',
  check ((status = 'closed') = (closed_at is not null)));
create table declutter_wanted_matches(wanted_id uuid, item_id uuid, seller_notified_at timestamptz, poster_notified_at timestamptz, primary key (wanted_id, item_id));
create table declutter_wanted_queue(item_id uuid primary key, attempts int default 0, queued_at timestamptz default now());
create table declutter_offers(id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, amount_cents int, awaiting text, status text default 'open',
  wanted_id uuid, created_at timestamptz default now());
create function declutter_wanted_match_item(p uuid) returns int language sql as $$ select 0 $$;
create table messages(id uuid primary key default gen_random_uuid(), sender_id uuid, receiver_id uuid, content text, attachment_url text);
create table reports(id uuid primary key default gen_random_uuid(), reporter_id uuid, reported_type text not null, reported_id uuid not null, reason text not null, description text,
  status text not null default 'pending', created_at timestamptz not null default now(), assigned_to uuid, reported_content text,
  constraint reports_reported_type_check check (reported_type = any (array['job','message','user','support','review','application','declutter_item'])));
create table admin_audit_log(admin_id uuid, action text, target_type text, target_id text, details jsonb);
-- What block_user_and_settle touches.
create table notifications(user_id uuid, title text, message text, type text, link text, job_id uuid);
create table jobs(id uuid primary key, title text, budget numeric, date_needed date, start_time time, customer_id uuid, helper_id uuid, helper_confirmed_at timestamptz, status text,
  helper_completed_at timestamptz, cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean, cancellation_fee numeric, cancellation_fee_status text,
  is_group_job boolean default false, helpers_needed int default 1, direct_offer_status text, direct_offer_expires_at timestamptz, offered_to_helper_id uuid);
create table group_job_helpers(id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, helper_confirmed_at timestamptz, helper_completed_at timestamptz, share_cents bigint, slot_no int, joined_at timestamptz default now());
create table applications(id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, status text, closed_reason text);
create table crew_block_fees(job_id uuid, helper_id uuid, slot_no int, share_basis_cents int, fee_percent int, fee_cents int, primary key (job_id, slot_no));
create table user_violations(user_id uuid, violation_type text, job_id uuid);
create function job_hours_until_start(d date, t time, n timestamptz) returns numeric language sql as $$ select 2::numeric $$;
create function cancellation_fee_percent(c boolean, h numeric) returns int language sql as $$ select case when c then 25 else 0 end $$;
create function is_late_cancellation(c boolean, h numeric) returns boolean language sql as $$ select c $$;
create function crew_fee_pays_unconfirmed() returns boolean language sql as $$ select false $$;
create function crew_slot_share_cents(b bigint, n int, i int) returns bigint language sql as $$ select b / greatest(n, 1) $$;
create function apply_cancellation_violation_consequence(j uuid) returns void language sql as $$ insert into user_violations select customer_id, 'cancel_with_helper', id from jobs where id = j $$;
create function apply_job_denial_consequence(u uuid, j uuid, d text) returns void language sql as $$ insert into user_violations values (u, 'job_denial', j) $$;
`);
await db.exec(displayName);
await db.exec(pick(readFileSync(`${MIG_DIR}20261016053541_declutter_wanted_price_hint.sql`, "utf8"), "declutter_miles"));
await db.exec(pick(photosMig, "declutter_add_wanted_photo"));
await db.exec(pick(settleMig, "block_user_and_settle"));
await db.exec(manage);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 1; i <= 3; i++) await db.exec(mig);
  await db.exec(`create trigger trg_report_message_party_and_copy before insert on reports for each row execute function report_message_party_and_copy()`);
}

const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false); select set_config('t.role', '${uid ? "authenticated" : "service_role"}', false)`); return db.query(sql); };
const fails = async (uid, sql, code) => { try { await as(uid, sql); return `NO ERROR (wanted ${code})`; } catch (e) { return String(e.message).includes(code) ? "ok" : `wrong: ${e.message}`; } };
const results = {};
const ok = (name, v) => { results[name] = v === true || v === "ok" ? "ok" : `RED ${JSON.stringify(v)}`; };
const safe = async (name, fn) => { try { ok(name, await fn()); } catch (e) { ok(name, String(e.message ?? e)); } };
const one = async (sql) => (await db.query(sql)).rows[0];
const post = async (poster = P, extra = {}) => {
  const row = { public: true, ...extra };
  const cols = Object.keys(row), vals = Object.values(row);
  const r = await one(`insert into declutter_wanted(user_id, what, category, max_price_cents, radius_miles, area_lat, area_lng${cols.map((c) => `, ${c}`).join("")})
    values ('${poster}', 'Oak dresser', 'furniture', 5000, 10, 30, -92${vals.map((v) => `, ${v}`).join("")}) returning id`);
  return r.id;
};
const browse = async (uid = S) => (await as(uid, `select id::text, photo_path, photo_paths from declutter_wanted_browse(30, -92)`)).rows;
const addPhoto = async (id, name, poster = P) => {
  const path = `${poster}/wanted/${id}/${name}.jpg`;
  await db.exec(`insert into storage.objects values ('job-photos', '${path}', '${poster}', '${poster}', '{"mimetype":"image/jpeg","size":"100"}')`);
  await as(poster, `select declutter_add_wanted_photo('${id}', '${path}')`);
  return path;
};
const record = (id, paths, flag, user = P) => as(null, `select declutter_record_wanted_ai_check('${id}', '${user}', array[${paths.map((p) => `'${p}'`).join(",")}]::text[], ${flag ? `'${flag}'` : "null"})`);
const autoReports = async (id) => (await db.query(`select * from reports where reported_id = '${id}' and reporter_id is null`)).rows;

// --- The shared-job fixture: a job with a committed Helpr, 2 hours out, where a plain block cancels with a fee. ---
await db.exec(`
insert into jobs(id, title, budget, date_needed, customer_id, helper_id, helper_confirmed_at, status) values ('${JOB}', 'Move a couch', 100, current_date, '${P}', '${X}', now(), 'accepted');
insert into jobs(id, title, budget, date_needed, customer_id, status, is_group_job, helpers_needed) values ('${CREW}', 'Crew move', 100, current_date + 5, '${P}', 'accepted', true, 2);
insert into group_job_helpers(job_id, helper_id, helper_confirmed_at, share_cents, slot_no) values ('${CREW}', '${C}', now(), 5000, 1);
insert into jobs(id, title, budget, date_needed, customer_id, status) values ('${OPENJOB}', 'Open job', 50, current_date + 5, '${P}', 'open');
insert into applications(id, job_id, helper_id, status) values ('${APP}', '${OPENJOB}', '${S}', 'pending');
`);
const jobState = () => one(`select status, cancellation_fee, cancellation_fee_status, late_cancellation from jobs where id = '${JOB}'`);

await safe("controlDirectBlockCancelsWithFee", async () => {
  await db.exec("begin");
  try {
    await as(X, `select block_user_and_settle('${P}', 'x')`);
    const j = await jobState();
    return j.status === "cancelled" && Number(j.cancellation_fee) === 25 && j.cancellation_fee_status === "pending" ? "ok" : j;
  } finally { await db.exec("rollback"); }
});
const wantedA = await post();

await safe("sharedJobBlockRefusedHelperSeat", () => fails(X, `select declutter_block_wanted_poster('${wantedA}')`, "wanted_block_shared_job"));
await safe("sharedJobUntouchedAfterRefusal", async () => {
  const j = await jobState();
  const blocks = await one(`select count(*)::int n from user_blocks`);
  const notes_ = await one(`select count(*)::int n from notifications`);
  return j.status === "accepted" && j.cancellation_fee === null && j.late_cancellation === null && blocks.n === 0 && notes_.n === 0 ? "ok" : { j, blocks, notes_ };
});
await safe("crewMemberBlockRefusedAndCrewIntact", async () => {
  const f = await fails(C, `select declutter_block_wanted_poster('${wantedA}')`, "wanted_block_shared_job");
  if (f !== "ok") return f;
  const g = await one(`select count(*)::int n from group_job_helpers where job_id = '${CREW}' and helper_id = '${C}'`);
  const b = await one(`select count(*)::int n from user_blocks`);
  return g.n === 1 && b.n === 0 ? "ok" : { g, b };
});
await safe("posterSeatBlockRefused", async () => {
  // The other seat: the blocker posted the shared job (a strike would apply), and the Wanted post is their Helpr's.
  const w = await post(X);
  await db.exec(`insert into jobs(id, title, budget, date_needed, customer_id, helper_id, helper_confirmed_at, status) values ('a0000000-0000-4000-8000-000000000009', 'Reverse', 100, current_date, '${P}', '${X}', now(), 'in_progress')`);
  const f = await fails(P, `select declutter_block_wanted_poster('${w}')`, "wanted_block_shared_job");
  const j = await one(`select status, cancellation_fee from jobs where id = 'a0000000-0000-4000-8000-000000000009'`);
  const v = await one(`select count(*)::int n from user_violations`);
  await db.exec(`delete from jobs where id = 'a0000000-0000-4000-8000-000000000009'; update declutter_wanted set removed_at = now(), status = 'closed', closed_at = now() where id = '${w}'`);
  return f === "ok" && j.status === "in_progress" && j.cancellation_fee === null && v.n === 0 ? "ok" : { f, j, v };
});
await safe("noSharedJobBlocks", async () => {
  const r = (await as(S, `select declutter_block_wanted_poster('${wantedA}') r`)).rows[0].r;
  const b = await one(`select count(*)::int n, min(reason) reason from user_blocks where blocker_id = '${S}' and blocked_id = '${P}'`);
  return r === "blocked" && b.n === 1 && b.reason === "Blocked from a Wanted post" ? "ok" : { r, b };
});
await safe("blockClosesPendingApplicationLikeAnyBlock", async () => (await one(`select status from applications where id = '${APP}'`)).status === "rejected");
await safe("blockedPostLeavesBrowse", async () => !(await browse(S)).some((w) => w.id === wantedA));
await safe("blockTwiceIsCalm", async () => (await as(S, `select declutter_block_wanted_poster('${wantedA}') r`)).rows[0].r === "blocked");
await db.exec(`delete from user_blocks`);
await safe("cannotBlockYourself", () => fails(P, `select declutter_block_wanted_poster('${wantedA}')`, "wanted_not_found"));
await safe("blockSignedOutRefused", () => fails(null, `select declutter_block_wanted_poster('${wantedA}')`, "not_authenticated"));
await safe("blockUnknownPostRefused", () => fails(S, `select declutter_block_wanted_poster('${OPENJOB}')`, "wanted_not_found"));
await safe("blockPrivatePostRefused", async () => fails(S, `select declutter_block_wanted_poster('${await post(P, { public: false })}')`, "wanted_not_found"));
await safe("blockSeedPostRefused", async () => fails(S, `select declutter_block_wanted_poster('${await post(P, { is_seed: true })}')`, "wanted_not_found"));
await safe("blockBannedCallerRefusedBeforeTheLookup", async () => {
  const before = await one(`select count(*)::int n from user_blocks`);
  await db.exec(`insert into bad values ('${S}')`);
  try {
    const real = await fails(S, `select declutter_block_wanted_poster('${await post(P)}')`, "account_restricted");
    const unknown = await fails(S, `select declutter_block_wanted_poster('${OPENJOB}')`, "account_restricted");
    const after = await one(`select count(*)::int n from user_blocks`);
    return real === "ok" && unknown === "ok" && after.n === before.n ? "ok" : { real, unknown, before, after };
  } finally { await db.exec(`delete from bad where user_id = '${S}'`); }
});
await safe("blockSwitchOffRefused", async () => {
  await db.exec(`insert into off_keys values ('declutter_wanted')`);
  const f = await fails(S, `select declutter_block_wanted_poster('${wantedA}')`, "feature_disabled");
  await db.exec(`delete from off_keys`);
  return f;
});

// --- Report. ---
const report = (uid, id, type = "declutter_wanted") => as(uid, `insert into reports(reporter_id, reported_type, reported_id, reason) values ('${uid}', '${type}', '${id}', 'Offensive') returning reported_content`);
await safe("reportCopiesThePost", async () => (await report(S, wantedA)).rows[0].reported_content === "Oak dresser");
await safe("reportOwnPostRefused", () => report(P, wantedA).then(() => "NO ERROR", (e) => String(e.message).includes("report_target_not_found") ? "ok" : e.message));
await safe("reportPrivatePostRefused", async () => { const w = await post(P, { public: false }); return report(S, w).then(() => "NO ERROR", (e) => String(e.message).includes("report_target_not_found") ? "ok" : e.message); });
await safe("reportSeedPostRefused", async () => { const w = await post(P, { is_seed: true }); return report(S, w).then(() => "NO ERROR", (e) => String(e.message).includes("report_target_not_found") ? "ok" : e.message); });
await safe("reportUnknownPostRefused", () => report(S, OPENJOB).then(() => "NO ERROR", (e) => String(e.message).includes("report_target_not_found") ? "ok" : e.message));
await safe("reportOtherTypesKeepNoCopy", async () => (await report(S, P, "user")).rows[0].reported_content === null);
await safe("reportMessageBranchUnchanged", async () => {
  const m = await one(`insert into messages(sender_id, receiver_id, content) values ('${P}', '${S}', 'hello there') returning id`);
  const copied = (await report(S, m.id, "message")).rows[0].reported_content === "hello there";
  const outsider = await report(X, m.id, "message").then(() => "NO ERROR", (e) => String(e.message).includes("report_not_allowed") ? "ok" : e.message);
  return copied && outsider === "ok" ? "ok" : { copied, outsider };
});

// --- The automatic photo check. ---
const wantedB = await post();
const p1 = await addPhoto(wantedB, "one");
await safe("photoHiddenUntilChecked", async () => { const w = (await browse()).find((x) => x.id === wantedB); return !!w && w.photo_path === null && w.photo_paths.length === 0 ? "ok" : w; });
await safe("addedPhotoStamped", async () => (await one(`select photo_added_at is not null a from declutter_wanted where id = '${wantedB}'`)).a);
await safe("posterStillSeesOwnPhoto", async () => (await as(P, `select photo_paths from declutter_my_wanted() where id = '${wantedB}'`)).rows[0].photo_paths.includes(p1));
const p2 = await addPhoto(wantedB, "two");
await safe("cleanCheckClearsOnlyWhatItJudged", async () => {
  await record(wantedB, [p1], null);
  const w = (await browse()).find((x) => x.id === wantedB);
  return w.photo_path === p1 && w.photo_paths.length === 1 ? "ok" : w;
});
await safe("removedPhotoCanNotBeCleared", async () => {
  await record(wantedB, [`${P}/wanted/${wantedB}/gone.jpg`], null);
  return (await one(`select cardinality(photos_cleared) n from declutter_wanted where id = '${wantedB}'`)).n === 1;
});
await safe("flagHoldsAndFilesOneReport", async () => {
  await record(wantedB, [p2], "Looks like a weapon");
  const r = await autoReports(wantedB);
  const w = (await browse()).find((x) => x.id === wantedB);
  return r.length === 1 && r[0].description === "Looks like a weapon" && r[0].reported_type === "declutter_wanted" && r[0].reason === "Automatic photo check" && !w.photo_paths.includes(p2) ? "ok" : { r, w };
});
await safe("wordsStayLiveWhileAPhotoIsHeld", async () => (await browse()).some((x) => x.id === wantedB));
await safe("flagNotWashedOffByAskingAgain", async () => {
  await record(wantedB, [p2], null);
  return !(await browse()).find((x) => x.id === wantedB).photo_paths.includes(p2);
});
await safe("secondFlagNoSecondReport", async () => { await record(wantedB, [p2], "Again"); return (await autoReports(wantedB)).length === 1; });
await safe("checkRefusesAnotherPersonsPost", () => record(wantedB, [p1], null, S).then(() => "NO ERROR", (e) => String(e.message).includes("wanted_not_found") ? "ok" : e.message));
await safe("testPostHeldButNeverReachesAdmin", async () => {
  const w = await post(P, { is_seed: true });
  const p = await addPhoto(w, "seed");
  await record(w, [p], "Flagged");
  const row = await one(`select photos_held from declutter_wanted where id = '${w}'`);
  return (await autoReports(w)).length === 0 && row.photos_held.includes(p);
});

// --- The sweep files a photo whose check never came back, and only that. ---
const wantedOld = await post(), wantedFresh = await post();
await addPhoto(wantedOld, "old"); await addPhoto(wantedFresh, "fresh");
await safe("oldPhotoStamped", () => db.exec(`update declutter_wanted set photo_added_at = now() - interval '2 hours' where id = '${wantedOld}'`).then(() => true));
await safe("sweepFilesAnUnfinishedCheck", async () => {
  await as(null, `select declutter_wanted_sweep()`);
  const r = await autoReports(wantedOld);
  return r.length === 1 && r[0].description === "The automatic photo check did not finish." ? "ok" : r;
});
await safe("sweepLeavesAFreshPhoto", async () => (await autoReports(wantedFresh)).length === 0);
await safe("sweepAgainNoSecondReport", async () => { await as(null, `select declutter_wanted_sweep()`); return (await autoReports(wantedOld)).length === 1; });
await safe("sweepHeldPhotoStaysHidden", async () => (await browse()).find((x) => x.id === wantedOld).photo_paths.length === 0);
await safe("sweepNoDefects", async () => (await one(`select count(*)::int n from cron_defects`)).n === 0);
await safe("sweepTestPostNeverReachesAdmin", async () => {
  const w = await post(P, { is_seed: true });
  await addPhoto(w, "seedold");
  await db.exec(`update declutter_wanted set photo_added_at = now() - interval '2 hours' where id = '${w}'`);
  await as(null, `select declutter_wanted_sweep()`);
  return (await autoReports(w)).length === 0;
});

// --- The admin half. ---
const reportB = (await autoReports(wantedB))[0]?.id;
await safe("adminReaderRefusesMember", () => fails(S, `select * from declutter_admin_reported_wanted(array['${wantedB}']::uuid[])`, "not_admin"));
await safe("adminReaderReadsThePost", async () => {
  const seed = await post(P, { is_seed: true });
  const rows = (await as(A, `select * from declutter_admin_reported_wanted(array['${wantedB}', '${seed}']::uuid[])`)).rows;
  const b = rows.find((r) => r.wanted_id === wantedB), s = rows.find((r) => r.wanted_id === seed);
  return b?.what === "Oak dresser" && b.poster_id === P && b.photos_held.includes(p2) && b.photo_paths.length === 2 && s?.is_seed === true && b.is_seed === false && b.removed === false ? "ok" : rows;
});
await safe("releaseRefusesMember", () => fails(S, `select declutter_admin_release_wanted_photos('${wantedB}', '${reportB}')`, "not_admin"));
await safe("releaseRefusesAnotherReport", async () => {
  const other = await one(`insert into reports(reported_type, reported_id, reason) values ('user', '${P}', 'x') returning id`);
  return fails(A, `select declutter_admin_release_wanted_photos('${wantedB}', '${other.id}')`, "report_not_for_post");
});
await safe("releaseShowsTheHeldPhoto", async () => {
  await as(A, `select declutter_admin_release_wanted_photos('${wantedB}', '${reportB}')`);
  const w = (await browse()).find((x) => x.id === wantedB);
  const r = await one(`select status from reports where id = '${reportB}'`);
  const a = await one(`select count(*)::int n from admin_audit_log where action = 'declutter_wanted_photos_released' and target_id = '${wantedB}'`);
  return w.photo_paths.includes(p2) && r.status === "resolved" && a.n === 1 ? "ok" : { w, r, a };
});
const reportOld = (await autoReports(wantedOld))[0]?.id;
await safe("takeDownRefusesMember", () => fails(S, `select declutter_admin_take_down_wanted('${wantedOld}', 'no', '${reportOld}')`, "not_admin"));
await safe("takeDownNeedsAReason", () => fails(A, `select declutter_admin_take_down_wanted('${wantedOld}', '  ', '${reportOld}')`, "review_note_required"));
await safe("takeDownRefusesAnotherReport", () => fails(A, `select declutter_admin_take_down_wanted('${wantedOld}', 'no', '${reportB}')`, "report_not_for_post"));
await safe("takeDownRefusesOwnPost", async () => fails(A, `select declutter_admin_take_down_wanted('${await post(A)}', 'no')`, "own_post"));
await safe("takeDownRemovesTellsAndLogs", async () => {
  await as(A, `select declutter_admin_take_down_wanted('${wantedOld}', 'Not allowed here', '${reportOld}')`);
  const gone = !(await browse()).some((x) => x.id === wantedOld);
  const mine = (await as(P, `select id from declutter_my_wanted() where id = '${wantedOld}'`)).rows.length === 0;
  const n = await one(`select message from notes where title = 'Your Wanted post was taken down'`);
  const a = await one(`select details from admin_audit_log where action = 'declutter_wanted_taken_down' and target_id = '${wantedOld}'`);
  const r = await one(`select status from reports where id = '${reportOld}'`);
  const row = await one(`select cardinality(photo_paths) kept, cardinality(photos_cleared) shown from declutter_wanted where id = '${wantedOld}'`);
  return gone && mine && n?.message.includes("Not allowed here") && a?.details.report_id === reportOld && r.status === "resolved" && row.kept === 1 && row.shown === 0 ? "ok" : { gone, mine, n, a, r, row };
});
await safe("takenDownPostCanNotBePostedAgain", () => fails(P, `select declutter_reopen_wanted('${wantedOld}')`, "wanted_not_found"));
await safe("takenDownPostCanNotBeBlockedThrough", () => fails(S, `select declutter_block_wanted_poster('${wantedOld}')`, "wanted_not_found"));

// Permissions.
await safe("grants", async () => {
  const rows = (await db.query(`select p.proname n, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u, has_function_privilege('service_role', p.oid, 'execute') s
    from pg_proc p where p.proname in ('declutter_block_wanted_poster','declutter_admin_reported_wanted','declutter_admin_take_down_wanted','declutter_admin_release_wanted_photos','declutter_record_wanted_ai_check','declutter_wanted_hold_photos')`)).rows;
  const serverOnly = new Set(["declutter_record_wanted_ai_check", "declutter_wanted_hold_photos"]);
  return rows.length === 6 && rows.every((r) => r.a === false && r.s === true && r.u === !serverOnly.has(r.n)) ? "ok" : rows;
});

const red = Object.entries(results).filter(([, v]) => v !== "ok");
console.log(JSON.stringify(results, null, 1));
console.log(red.length ? `RED ${red.length} of ${Object.keys(results).length}` : `ALL OK ${Object.keys(results).length}`);
process.exit(red.length ? 1 : 0);
