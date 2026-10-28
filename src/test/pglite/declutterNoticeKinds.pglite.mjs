#!/usr/bin/env node
/**
 * PGlite proof for 20261028162048_declutter_notice_kinds (owner 2026-10-28, via the lead: in-app + push
 * for Declutter with on/off switches under a "Declutter" group).
 *
 *   node src/test/pglite/declutterNoticeKinds.pglite.mjs                  # BEFORE (the RED facts) then AFTER (3x replay)
 *   MUTANT=<name> node src/test/pglite/declutterNoticeKinds.pglite.mjs    # a planted defect: must FAIL
 *
 * World, prod-shaped where it matters (columns read from prod 2026-10-28, read-only): notifications with a
 * uuid id, the prod CHECK (20260903025724), notification_preferences, notification_type_pref_map with prod's
 * 18 rows, and the NEWEST repo bodies (md5-equal to prod's pg_proc.prosrc, read 2026-10-28) of
 * fan_out_push_on_notification, suppress_exact_duplicate_notification, declutter_notify,
 * declutter_price_drop_alert, declutter_pickup_remind, declutter_wanted_notify, declutter_wanted_alert_block.
 * Stubbed, and said so: net.http_post (records the request), vault, get_supabase_url/get_service_role_key,
 * are_users_blocked, feature_enabled_for_user, declutter_member_out, member_under_18, log_cron_defect (a table).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261028162048_declutter_notice_kinds.sql";
const MUTANT = process.env.MUTANT ?? "";

const MUTANTS = {
  // A notice that cannot be written takes the sale with it.
  nocatch: ["  EXCEPTION WHEN OTHERS THEN\n    -- The sale, offer or refund this notice reports", "  EXCEPTION WHEN division_by_zero THEN\n    -- The sale, offer or refund this notice reports"],
  // The old bigint: every price-drop alert rolls back.
  bigint: ["  v_notified uuid;", "  v_notified bigint;"],
  // Thirty drafts submitted at once: thirty notices.
  nodedupe: ["                  AND n.created_at > now() - interval '10 minutes') THEN", "                  AND false) THEN"],
  // Wanted still muted by Job offers.
  wantedcol: ["(SELECT np.declutter_wanted FROM public.notification_preferences np", "(SELECT np.new_offers FROM public.notification_preferences np"],
  // A member who muted price alerts is re-subscribed.
  backfill: ["        EXECUTE format('UPDATE public.notification_preferences SET %I = COALESCE(new_offers, true)', v_col);", "        NULL;"],
  // A replay overwrites a member's later choice.
  replay: ["    IF NOT EXISTS (SELECT 1 FROM information_schema.columns\n                    WHERE table_schema = 'public' AND table_name = 'notification_preferences'\n                      AND column_name = v_col) THEN\n      EXECUTE format('ALTER TABLE public.notification_preferences ADD COLUMN %I boolean NOT NULL DEFAULT true', v_col);",
           "    EXECUTE format('ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS %I boolean NOT NULL DEFAULT true', v_col);\n    IF true THEN"],
  // A Helpr's delivery work is filed under their own Declutter buying/selling.
  deliver: ["    WHEN p_link LIKE '/declutter?view=deliver%' OR p_link LIKE '/declutter?tab=deliver%' THEN p_type\n", ""],
  // Shops orders land in the Declutter group.
  shops: ["    WHEN p_link IS NULL OR p_link NOT LIKE '/declutter%' THEN p_type\n", ""],
  // The seed rule dropped.
  seed: ["     AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = p_user), false) THEN", "     AND false THEN"],
  // An approval (pending_review -> live) is told twice.
  fromdraft: ["     OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'draft') THEN", "     OR false THEN"],
  // The answer notice goes to the seller.
  answer: ["      PERFORM public.declutter_notify(NEW.asker_id, 'declutter_offers', 'The seller answered',", "      PERFORM public.declutter_notify(v_item.seller_id, 'declutter_offers', 'The seller answered',"],
  // Pickup reminders swallow their failure: the sweep's claim commits and the reminder is never retried.
  strict: ["  PERFORM public.declutter_notify_strict(p_user, 'declutter_pickups', p_title, p_message, p_link, p_other);", "  PERFORM public.declutter_notify(p_user, 'declutter_pickups', p_title, p_message, p_link, p_other);"],
  // One log row per member an hour: the second lost notice leaves no trace.
  ref: ["      COALESCE(p_user::text, '-') || ':' || COALESCE(p_title, '') || ':' || COALESCE(p_link, ''), SQLERRM,", "      p_user::text, SQLERRM,"],
  // The approval RPC's notice suppresses a straight-to-live seller's own.
  approvaldedupe: ["                  AND (n.link = '/declutter?tab=selling' OR n.link LIKE '/declutter/item/%')\n", ""],
  // A blocked pair is still told of an answer.
  block: ["    IF public.are_users_blocked(NEW.asker_id, v_item.seller_id) THEN", "    IF false THEN"],
  // Pickup email still gated by the Job updates switch.
  pickupmail: ["'type', 'declutter_pickups', 'link', p_link)", "'type', 'job_updates', 'link', p_link)"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( in the migrations BEFORE this one, any dollar tag. */
function newestBefore(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < THIS).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, stmt: `${sql.slice(m.index, end + t[1].length)};` };
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found.stmt;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), MUTED = U(3), SEED = U(4), HELPR = U(5), WATCHER = U(6), SELLER2 = U(7), BROKEN = U(8), FRESH = U(9);
const USERS = [SELLER, BUYER, MUTED, SEED, HELPR, WATCHER, SELLER2, BROKEN, FRESH];

const PREF_MAP = [
  ["admin_alert", "system_alerts"], ["application", "job_applications"], ["expired", "job_updates"],
  ["financial_alerts", "financial_alerts"], ["info", "work_status"], ["job_match", "job_matches"],
  ["job_update", "job_updates"], ["job_updates", "job_updates"], ["message", "messages"], ["new_offers", "new_offers"],
  ["payment", "payments"], ["review", "reviews"], ["success", "work_status"], ["system_alert", "system_alerts"],
  ["transit_updates", "transit_updates"], ["verified", "system_alerts"], ["warning", "system_alerts"], ["work_status", "work_status"],
];

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create table public.profiles (user_id uuid primary key, is_seed boolean default false);
  create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text,
    type text, read boolean default false, link text, created_at timestamptz default now(), job_id uuid);
  alter table public.notifications add constraint notifications_type_check check (type in (
    'info', 'success', 'warning', 'job_update', 'application', 'review', 'payment', 'job_match', 'job_updates', 'work_status',
    'transit_updates', 'system_alert', 'new_offers', 'expired', 'financial_alerts', 'verified', 'message', 'admin_alert'));
  create table public.notification_dedupe_suppressions (id bigint generated always as identity, user_id uuid, type text, title text, link text, created_at timestamptz default now());
  create table public.notification_preferences (id uuid default gen_random_uuid(), user_id uuid primary key,
    job_applications boolean default true, job_updates boolean default true, messages boolean default true, payments boolean default true,
    reviews boolean default true, promotions boolean default true, system_alerts boolean default true, push_enabled boolean default true,
    email_job_updates boolean default true, email_payments boolean default true, new_offers boolean default true, email_new_offers boolean default true,
    transit_updates boolean default true, work_status boolean default true, financial_alerts boolean default true, job_matches boolean default true,
    email_enabled boolean default true, quiet_start time, quiet_end time);
  create table public.notification_type_pref_map (type text primary key, pref_column text not null, description text);
  insert into public.notification_type_pref_map (type, pref_column) values ${PREF_MAP.map(([t, c]) => `('${t}', '${c}')`).join(",")};
  create table public.error_logs (id bigint generated always as identity, severity text, message text, tags jsonb, context jsonb);
  create table public.defects (fn text, ref text, err text, ctx jsonb, at timestamptz default now());
  -- Prod's rule (20261004004835): one row per (function, ref) an hour.
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_context jsonb default '{}'::jsonb) returns void language sql as
    $f$ insert into public.defects (fn, ref, err, ctx) select p_fn, coalesce(nullif(p_ref, ''), 'run'), p_err, p_context
        where not exists (select 1 from public.defects d where d.fn = p_fn and d.ref = coalesce(nullif(p_ref, ''), 'run') and d.at > now() - interval '1 hour') $f$;
  create schema net; create table net.calls (url text, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $f$ insert into net.calls values (url, body) returning 1::bigint $f$;
  create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
  insert into vault.decrypted_secrets values ('supabase_url', 'https://x.test'), ('service_role_key', 'k');
  create function public.get_supabase_url() returns text language sql stable as $f$ select 'https://x.test' $f$;
  create function public.get_service_role_key() returns text language sql stable as $f$ select 'k' $f$;
  create table public.blocks (a uuid, b uuid);
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.blocks where (a = p1 and b = p2) or (a = p2 and b = p1)) $f$;
  create function public.feature_enabled_for_user(p_key text, p_user uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.declutter_member_out(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.member_under_18(p_user uuid) returns boolean language sql stable as $f$ select false $f$;
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, status text not null default 'draft', title text not null,
    price_cents integer not null default 5000, current_price_cents integer not null default 5000, is_seed boolean not null default false,
    seller_hidden boolean not null default false, updated_at timestamptz default now());
  create table public.declutter_questions (id uuid primary key default gen_random_uuid(), item_id uuid, asker_id uuid, question text, answer text,
    answered_at timestamptz, removed_at timestamptz, created_at timestamptz default now());
  create table public.declutter_watchlist (user_id uuid, item_id uuid, created_at timestamptz default now(), primary key (user_id, item_id));
  create table public.declutter_price_alerts (id uuid primary key default gen_random_uuid(), item_id uuid, user_id uuid, price_cents integer, sent_at timestamptz default now());
`);
// Prod's bodies, newest before this migration.
for (const fn of ["suppress_exact_duplicate_notification", "fan_out_push_on_notification", "declutter_notify",
  "declutter_price_drop_alert", "declutter_pickup_remind", "declutter_wanted_notify", "declutter_wanted_alert_block"]) {
  await db.exec(newestBefore(fn));
}
await db.exec(`
  create trigger suppress_exact_duplicate_notification before insert on public.notifications for each row execute function public.suppress_exact_duplicate_notification();
  create trigger notifications_fan_out_to_push after insert on public.notifications for each row execute function public.fan_out_push_on_notification();
  create trigger trg_declutter_items_price_drop_alert after update of current_price_cents on public.declutter_items for each row execute function public.declutter_price_drop_alert();
`);
await db.exec(`insert into auth.users values ${USERS.map((u) => `('${u}')`).join(",")};
  insert into public.profiles values ${USERS.map((u) => `('${u}', ${u === SEED})`).join(",")};
  insert into public.notification_preferences (user_id) values ${USERS.map((u) => `('${u}')`).join(",")};
  update public.notification_preferences set new_offers = false, email_new_offers = false, payments = false, email_job_updates = false where user_id = '${MUTED}';`);

const notes = async (u) => (await db.query(`select type, title, message, link from public.notifications where user_id = $1 order by created_at, id`, [u])).rows;
const pushesTo = async (u) => (await db.query(`select body from net.calls where url like '%send-push-notification' and body->>'user_id' = $1`, [u])).rows.map((r) => r.body);
const mailsTo = async (u) => (await db.query(`select body from net.calls where url like '%send-notification-email' and body->>'user_id' = $1`, [u])).rows.map((r) => r.body);
const notify = (u, type, title, link, other = null) =>
  db.query(`select public.declutter_notify($1, $2, $3, 'msg', $4, $5)`, [u, type, title, link, other]);
const reset = () => db.exec(`delete from public.notifications; delete from net.calls; delete from public.defects; delete from public.notification_dedupe_suppressions;`);

// ── BEFORE: the facts this migration fixes, on prod's bodies ──────────────────────────────────────────
await notify(MUTED, "new_offers", "New offer", "/declutter?view=offers");
const beforeOffer = await notes(MUTED);
console.log(`BEFORE  a Declutter offer is typed ${beforeOffer[0]?.type}; push to a member who muted Job offers: ${(await pushesTo(MUTED)).length}`);
await db.exec(`insert into public.declutter_items (id, seller_id, status, title) values ('${I(90)}', '${SELLER}', 'live', 'Before lamp');
  insert into public.declutter_watchlist (user_id, item_id) values ('${WATCHER}', '${I(90)}');
  update public.declutter_items set current_price_cents = 4000 where id = '${I(90)}';`);
const beforeDrop = (await notes(WATCHER)).length;
const beforeDefect = (await db.query(`select err from public.defects where fn = 'declutter_price_drop_alert'`)).rows[0]?.err;
console.log(`BEFORE  a watched price drop told the watcher ${beforeDrop} time(s); defect: ${beforeDefect}`);
await db.exec(`update public.declutter_items set status = 'draft' where id = '${I(90)}'; update public.declutter_items set status = 'pending_review' where id = '${I(90)}'`);
const beforeSubmit = (await notes(SELLER)).length;
console.log(`BEFORE  submitting a listing told the seller ${beforeSubmit} time(s)`);
await db.exec(`delete from public.declutter_watchlist; delete from public.declutter_items; delete from public.declutter_price_alerts;`);
await reset();

// ── AFTER: this migration, three times; a member's later choice survives the replays ─────────────────
await db.exec(mig);
await db.exec(`update public.notification_preferences set declutter_price_drops = true where user_id = '${FRESH}';
  update public.notification_preferences set new_offers = false where user_id = '${FRESH}';`);
await db.exec(mig);
await db.exec(mig);
const pref = async (u) => (await db.query(`select * from public.notification_preferences where user_id = $1`, [u])).rows[0];
const muted = await pref(MUTED), plain = await pref(BUYER), fresh = await pref(FRESH);
check(muted.declutter_price_drops === false && muted.declutter_wanted === false && muted.email_declutter_price_drops === false,
  "[backfill] a member who muted the switch price drops and Wanted rode (new_offers) stays muted for them");
check(muted.email_declutter_pickups === true && muted.declutter_pickups === true,
  "[defaults] pickup reminders are transactional: push and email start ON even for a member who muted Job updates email");
check(muted.declutter_offers === true && muted.declutter_sales === true && muted.declutter_pickups === true && muted.declutter_refunds === true && muted.declutter_listings === true,
  "[defaults] transactional Declutter kinds start ON, whatever the jobs switches say");
check(["declutter_listings", "declutter_offers", "declutter_sales", "declutter_pickups", "declutter_refunds", "declutter_price_drops", "declutter_wanted"]
  .every((c) => plain[c] === true && plain[`email_${c}`] === true), "[defaults] a member who muted nothing has all 14 Declutter columns on");
check(fresh.declutter_price_drops === true, "[replay] a choice made after the first run survives two more runs");
await db.exec(`insert into auth.users values ('${U(50)}'); insert into public.notification_preferences (user_id) values ('${U(50)}')`);
check((await pref(U(50))).declutter_offers === true && (await pref(U(50))).declutter_price_drops === true, "[defaults] a new member's row gets the column defaults");

let threw = false;
try { await db.exec(`insert into public.notifications (user_id, type, title) values ('${BUYER}', 'declutter_bogus', 'x')`); } catch { threw = true; }
check(threw, "[check] the CHECK still refuses an unknown type");
const map = (await db.query(`select type, pref_column from public.notification_type_pref_map where type like 'declutter%' order by 1`)).rows;
check(map.length === 7 && map.every((r) => r.pref_column === r.type), "[map] each Declutter type is gated by its own column");

// Routing.
await notify(MUTED, "new_offers", "New offer", "/declutter?view=offers");
let n = (await notes(MUTED)).at(-1);
check(n?.type === "declutter_offers", `[route] a new offer is declutter_offers (${n?.type})`);
check((await pushesTo(MUTED)).length === 1, "[push] it reaches a member who muted Job offers (the Declutter switch decides)");
await db.exec(`update public.notification_preferences set declutter_offers = false where user_id = '${BUYER}'`);
await notify(BUYER, "new_offers", "New counteroffer", "/declutter?view=offers");
check((await notes(BUYER)).length === 1 && (await pushesTo(BUYER)).length === 0, "[push] Declutter Offers off: the bell row lands, no push");
await db.exec(`update public.notification_preferences set declutter_offers = true where user_id = '${BUYER}'`);
const cases = [
  ["payment", "Buyer paid", "/declutter?view=cart", "declutter_sales"],
  ["new_offers", "Sold: waiting for the buyer to pay", "/declutter?view=offers", "declutter_sales"],
  ["job_updates", "Pickup in 1 hour", "/declutter?view=cart", "declutter_pickups"],
  ["warning", "You missed your pickup", "/declutter?view=cart", "declutter_pickups"],
  ["warning", "Refund request", "/declutter?view=selling", "declutter_refunds"],
  ["payment", "Refund on its way", "/declutter?view=cart", "declutter_refunds"],
  ["info", "Your listing needs a change", "/declutter?view=selling", "declutter_listings"],
  ["new_offers", "A seller has a match", "/declutter?view=offers", "declutter_wanted"],
  ["expired", "Offer expired", "/declutter?view=offers", "declutter_offers"],
  ["payment", "Some new sale step", "/declutter?view=sales", "declutter_sales"],
  ["new_offers", "New order", "/shops/orders", "new_offers"],
  ["payment", "Delivery done", "/declutter?view=deliver", "payment"],
  ["warning", "Job cancelled", "/jobs?job=1", "warning"],
  ["warning", "Declutter refund to decide", "/admin?view=declutter", "warning"],
  ["job_match", "New item matches your saved search", "/declutter/item/x", "job_match"],
];
for (const [type, title, link, want] of cases) {
  await reset();
  await notify(HELPR, type, title, link);
  const got = (await notes(HELPR))[0]?.type;
  check(got === want, `[route] ${type} "${title}" ${link} -> ${want} (${got})`);
}

// A notice never fails its event.
await reset();
await db.exec(`create function public.zz_fail() returns trigger language plpgsql as $f$ begin if new.user_id = '${BROKEN}' then raise exception 'boom'; end if; return new; end $f$;
  create trigger zz_fail before insert on public.notifications for each row execute function public.zz_fail()`);
let ok = true;
try {
  await db.exec(`begin; create temp table event_done (x int); select public.declutter_notify('${BROKEN}', 'payment', 'Buyer paid', 'm', '/declutter?view=cart'); insert into event_done values (1); commit;`);
} catch (e) { ok = false; console.log("   threw:", e.message); await db.exec("rollback").catch(() => {}); }
check(ok && (await db.query(`select count(*)::int n from event_done`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n === 1,
  "[safety] the event's transaction commits when its notice cannot be written");
check((await db.query(`select count(*)::int n from public.defects where fn = 'declutter_notify'`)).rows[0].n === 1, "[safety] the failed notice is logged for ops");
await db.query(`select public.declutter_notify($1, 'payment', 'Refund on its way', 'All $5.00 is coming back.', '/declutter?view=cart')`, [BROKEN])
  .catch((e) => console.log("   threw:", e.message));
const lost = (await db.query(`select ctx from public.defects where fn = 'declutter_notify' order by at`)).rows;
check(lost.length === 2 && lost[1].ctx.message === "All $5.00 is coming back." && lost[1].ctx.title === "Refund on its way",
  "[safety] a second, different lost notice to the same member inside the hour is logged too, with its message");
let strictThrew = false;
try { await db.query(`select public.declutter_pickup_remind($1, 'Pickup in 1 hour', 'm', '/declutter?view=cart', $2)`, [BROKEN, SELLER]); } catch { strictThrew = true; }
check(strictThrew, "[retry] a pickup reminder that cannot be written raises, so the sweep rolls its claim back and retries");
await db.exec(`drop trigger zz_fail on public.notifications`);

// Seed rule.
await reset();
await notify(BUYER, "new_offers", "New offer", "/declutter?view=offers", SEED);
check((await notes(BUYER)).length === 0, "[seed] a test counterpart never notifies a real member");
await notify(SEED, "new_offers", "New offer", "/declutter?view=offers", BUYER);
check((await notes(SEED)).length === 1, "[seed] a test member is still told");

// Dedupe: the same notice twice in 10 minutes is one row.
await reset();
await notify(BUYER, "payment", "Buyer paid", "/declutter?view=cart");
await notify(BUYER, "payment", "Buyer paid", "/declutter?view=cart");
check((await notes(BUYER)).length === 1, "[dedupe] an identical notice inside 10 minutes is written once");

// Listing submitted.
await reset();
await db.exec(`insert into public.declutter_items (id, seller_id, title) values ('${I(1)}', '${SELLER}', 'Oak dresser'), ('${I(2)}', '${SELLER}', 'Lamp'),
  ('${I(3)}', '${SELLER2}', 'Rug'), ('${I(4)}', '${SELLER2}', 'Chair'), ('${I(5)}', '${SEED}', 'Seed thing')`);
await db.exec(`update public.declutter_items set status = 'pending_review' where id = '${I(1)}'`);
let s = await notes(SELLER);
check(s.length === 1 && s[0].type === "declutter_listings" && s[0].title === "Listing sent for review"
  && s[0].message === `We're checking "Oak dresser" before buyers see it. We'll tell you when it's live.` && s[0].link === "/declutter?tab=selling",
  `[listed] submitting a draft tells the seller it is in review (${JSON.stringify(s[0] ?? null)})`);
check((await pushesTo(SELLER)).length === 1, "[listed] ...with a push");
await db.exec(`update public.declutter_items set status = 'pending_review' where id = '${I(2)}'`);
check((await notes(SELLER)).length === 1, "[listed] a second listing inside 10 minutes adds no second notice (moving-out sale)");
// The approval RPC's own "live" notice (Selling tab link) must not swallow this one.
await notify(SELLER2, "info", "Your listing is live", "/declutter?view=selling");
await db.exec(`update public.declutter_items set status = 'live' where id = '${I(3)}'`);
s = (await notes(SELLER2)).filter((n) => n.link !== "/declutter?view=selling");
check(s.length === 1 && s[0].title === "Your listing is live" && s[0].link === `/declutter/item/${I(3)}` && s[0].message === '"Rug" is live. Buyers can see it now.',
  "[listed] a trusted seller's draft that goes straight live is told it is live");
await db.exec(`update public.declutter_items set status = 'live' where id = '${I(1)}'`);
check((await notes(SELLER)).length === 1, "[listed] an approval (in review -> live) is not told again here (the review RPC tells it)");
await db.exec(`update public.declutter_items set status = 'paused' where id = '${I(3)}'; update public.declutter_items set status = 'live' where id = '${I(3)}'`);
check((await notes(SELLER2)).length === 2, "[listed] a relist (paused -> live) sends nothing");
await db.exec(`update public.declutter_items set title = 'Rug 2' where id = '${I(3)}'`);
check((await notes(SELLER2)).length === 2, "[listed] an edit that does not submit sends nothing");

// Questions.
await reset();
await db.exec(`update public.declutter_items set status = 'live' where id = '${I(4)}'`);
await reset();
await db.query(`insert into public.declutter_questions (id, item_id, asker_id, question) values ($1, $2, $3, $4)`, [I(10), I(4), BUYER, "Is it solid wood?"]);
s = await notes(SELLER2);
check(s.length === 1 && s[0].type === "declutter_offers" && s[0].title === "New question" && s[0].message === 'Someone asked about "Chair": "Is it solid wood?"' && s[0].link === `/declutter/item/${I(4)}`,
  `[question] the seller is told of a new question (${JSON.stringify(s[0] ?? null)})`);
await db.query(`update public.declutter_questions set answer = 'Yes, oak.', answered_at = now() where id = $1`, [I(10)]);
s = await notes(BUYER);
check(s.length === 1 && s[0].title === "The seller answered" && s[0].message === 'About "Chair": "Yes, oak."', "[question] the asker is told of the answer");
check((await notes(SELLER2)).length === 1, "[question] the seller is not told of their own answer");
await db.query(`update public.declutter_questions set answer = 'Yes, solid oak.', answered_at = now() where id = $1`, [I(10)]);
check((await notes(BUYER)).length === 1, "[question] editing an answer does not tell the asker again");
await db.query(`insert into public.declutter_questions (id, item_id, asker_id, question) values ($1, $2, $3, $4)`, [I(11), I(4), WATCHER, "Still there?"]);
await db.exec(`insert into public.blocks values ('${SELLER2}', '${WATCHER}')`);
await db.query(`update public.declutter_questions set answer = 'Yes.', answered_at = now() where id = $1`, [I(11)]);
check((await notes(WATCHER)).length === 0, "[question] a block made since the question was asked: the asker is not told of the answer");
await db.exec(`delete from public.blocks`);
await reset();
await db.query(`insert into public.declutter_questions (item_id, asker_id, question) values ($1, $2, $3)`, [I(4), SEED, "Seed question?"]);
check((await notes(SELLER2)).length === 0, "[question] a test asker never notifies a real seller");
await db.query(`insert into public.declutter_questions (item_id, asker_id, question) values ($1, $2, $3)`, [I(4), BUYER, "x".repeat(300)]);
s = (await notes(SELLER2)).at(-1);
check(s.message.length < 200 && s.message.endsWith('..."'), "[question] a long question is cut short in the notice");

// Price drops.
await reset();
await db.exec(`insert into public.declutter_watchlist (user_id, item_id) values ('${WATCHER}', '${I(4)}'), ('${MUTED}', '${I(4)}');
  update public.declutter_items set current_price_cents = 4000 where id = '${I(4)}'`);
s = await notes(WATCHER);
check(s.length === 1 && s[0].type === "declutter_price_drops" && s[0].title === "Price dropped", `[price] a watcher is told (${JSON.stringify(s[0] ?? null)}; defects ${JSON.stringify((await db.query("select err from public.defects")).rows)})`);
check((await db.query(`select count(*)::int n from public.declutter_price_alerts where user_id = '${WATCHER}'`)).rows[0].n === 1, "[price] the rate-limit ledger row is written");
check((await mailsTo(WATCHER)).some((b) => b.type === "declutter_price_drops"), "[price] the email request carries the Declutter type (its own email switch)");
check((await pushesTo(WATCHER)).length === 1 && (await pushesTo(MUTED)).length === 0, "[price] push follows the price-drop switch (backfilled off for the member who muted it)");

// Wanted.
const block = async (u) => (await db.query(`select public.declutter_wanted_alert_block($1) b`, [u])).rows[0].b;
check((await block(FRESH)) === null, "[wanted] muting Job offers no longer mutes Wanted matches");
await db.exec(`update public.notification_preferences set declutter_wanted = false where user_id = '${BUYER}'`);
check((await block(BUYER)) === "muted", "[wanted] the Wanted matches switch mutes them");
await reset();
await db.query(`select public.declutter_wanted_notify($1, 'A listing matches your Wanted post', 'm', '/declutter/item/x')`, [FRESH]);
check((await notes(FRESH))[0]?.type === "declutter_wanted", "[wanted] a Wanted match is typed declutter_wanted");

// Pickup reminders.
await reset();
await db.query(`select public.declutter_pickup_remind($1, 'Pickup in 1 hour', 'm', '/declutter?view=cart', $2)`, [BUYER, SELLER]);
check((await notes(BUYER))[0]?.type === "declutter_pickups", "[pickup] the reminder is typed declutter_pickups");
check((await mailsTo(BUYER))[0]?.type === "declutter_pickups", "[pickup] its email request carries declutter_pickups (its own email switch)");

// Who may call.
for (const sig of ["public.declutter_notify(uuid, text, text, text, text, uuid)", "public.declutter_notice_type(text, text, text)"]) {
  const r = (await db.query(`select has_function_privilege('anon', '${sig}', 'execute') a, has_function_privilege('authenticated', '${sig}', 'execute') b`)).rows[0];
  check(!r.a && !r.b, `[grants] ${sig} is not callable by anon or authenticated`);
}

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
