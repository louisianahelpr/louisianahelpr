#!/usr/bin/env node
/**
 * PGlite proof for 20261030174314_declutter_listings_one_summary_notice (Sell a bunch audit, finding 14): many
 * listings in a row are one notice and one push, and every listing is still told.
 *
 *   node src/test/pglite/declutterBunchOneNotice.pglite.mjs                  # BEFORE (the RED facts), then AFTER (3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBunchOneNotice.pglite.mjs  # RED: today's body
 *   MUTANT=<name> node src/test/pglite/declutterBunchOneNotice.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the newest repo bodies of the notice chain (declutter_notify, _strict, declutter_notice_type, _link,
 * declutter_price_words, declutter_notice_names_item, suppress_exact_duplicate_notification,
 * notifications_member_updates_read_only) and of the function being restated. Prod's triggers, read 2026-10-30.
 * Stubbed, and said so: the push and SMS fan-outs are one AFTER INSERT recorder (prod's are AFTER INSERT too, which
 * is what the proof relies on), log_cron_defect is a table.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261030174314_declutter_listings_one_summary_notice.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";

const MUTANTS = {
  // A notice the seller read is rewritten: the next listing is never pushed.
  readToo: ["       AND n.read = false\n", ""],
  // The window never slides: a long run splits into several notices.
  noSlide: ["             link = '/declutter?tab=selling',\n             created_at = now()", "             link = '/declutter?tab=selling'"],
  // The approval's own notice gets counted and rewritten.
  swallowApproval: ["OR (n.title = 'Your listing is live' AND n.link LIKE '/declutter/item/%')", "OR n.title = 'Your listing is live'"],
  // Every listing after the first says 2.
  noCount: ["COALESCE(substring(v_prior_message FROM '^([0-9]+) listings ')::integer, 1) + 1", "2"],
  // Live and in-review share one count.
  oneCount: ["ELSE n.title IN ('Listing sent for review', 'Listings sent for review')", "ELSE true"],
  // Another seller's notice is rewritten.
  anySeller: ["     WHERE n.user_id = NEW.seller_id\n", "     WHERE true\n"],
  // The old skip: later listings are dropped, not counted (what A3-4 removed).
  dropped: ["       WHERE id = v_prior;\n", "       WHERE id = v_prior AND false;\n"],
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
      found = `${sql.slice(m.index, end + t[1].length)};`;
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), OTHER = U(2);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false);
  insert into public.profiles values ('${SELLER}'), ('${OTHER}');
  create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text,
    type text, read boolean default false, link text, created_at timestamptz default now(), job_id uuid);
  create table public.notification_dedupe_suppressions (id bigint generated always as identity, user_id uuid, type text, title text, link text, created_at timestamptz default now());
  create table public.declutter_orders (id uuid primary key, buyer_id uuid, seller_id uuid);
  create table public.declutter_cart_items (id uuid primary key, order_id uuid, item_id uuid, created_at timestamptz default now());
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, status text not null default 'draft', title text not null);
  create table public.defects (fn text, ref text, err text);
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_context jsonb default '{}'::jsonb) returns void language sql as
    $f$ insert into public.defects values (p_fn, p_ref, p_err) $f$;
  create table public.pushes (user_id uuid, title text);
  create function public.record_push() returns trigger language plpgsql as $f$ begin insert into public.pushes values (NEW.user_id, NEW.title); return null; end $f$;
`);
for (const fn of ["declutter_notice_type", "declutter_notice_link", "declutter_price_words", "declutter_notice_names_item",
  "declutter_notify_strict", "declutter_notify", "suppress_exact_duplicate_notification", "notifications_member_updates_read_only",
  "declutter_listing_submitted_notice"]) {
  await db.exec(newestBefore(fn));
}
await db.exec(`
  create trigger aa_notifications_member_updates_read_only before update on public.notifications for each row execute function public.notifications_member_updates_read_only();
  create trigger suppress_exact_duplicate_notification before insert on public.notifications for each row execute function public.suppress_exact_duplicate_notification();
  create trigger notifications_fan_out_to_push after insert on public.notifications for each row execute function public.record_push();
  create trigger trg_declutter_items_submitted_notice after insert or update of status on public.declutter_items for each row execute function public.declutter_listing_submitted_notice();
`);

const notes = async (u) => (await db.query(`select type, title, message, link, read from public.notifications where user_id = $1 order by created_at, id`, [u])).rows;
const pushes = async (u) => (await db.query(`select title from public.pushes where user_id = $1`, [u])).rows.length;
const reset = () => db.exec(`delete from public.notifications; delete from public.pushes; delete from public.defects; delete from public.declutter_items; delete from public.notification_dedupe_suppressions;`);
let seq = 0;
/** One listing, in its own transaction as the app's are: a draft is made, then goes to `status`. */
async function list(seller, status, title = `Item ${seq + 1}`) {
  const id = I(++seq);
  await db.query(`insert into public.declutter_items (id, seller_id, title) values ($1, $2, $3)`, [id, seller, title]);
  await db.query(`update public.declutter_items set status = $2 where id = $1`, [id, status]);
  return id;
}
/** Time passes: every notice is this much older than it was. */
const age = (minutes) => db.exec(`update public.notifications set created_at = created_at - interval '${minutes} minutes'`);

// BEFORE: the fact this migration fixes, on the effective definition.
for (let i = 0; i < 5; i++) await list(SELLER, "live");
console.log(`BEFORE  5 listings in a row: ${(await notes(SELLER)).length} notices, ${await pushes(SELLER)} pushes`);
await reset();

if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(mig);
  check(true, "the migration applies 3 times");
}

// One listing is what it always was.
const first = await list(SELLER, "live", "Oak dresser");
let s = await notes(SELLER);
check(s.length === 1 && s[0].title === "Your listing is live" && s[0].message === '"Oak dresser" is live. Buyers can see it now.'
  && s[0].link === `/declutter/item/${first}` && s[0].type === "declutter_listings", `one listing: its own named notice (${JSON.stringify(s[0] ?? null)})`);
check((await pushes(SELLER)) === 1, "  with its one push");

// Fifty in a row: one notice, one push, and the count says all of them.
for (let i = 0; i < 49; i++) await list(SELLER, "live");
s = await notes(SELLER);
check(s.length === 1, `50 listings in a row: one notice (${s.length})`);
check((await pushes(SELLER)) === 1, `  and one push (${await pushes(SELLER)})`);
check(s[0]?.title === "Your listings are live" && s[0]?.message === "50 listings are live. Buyers can see them now." && s[0]?.link === "/declutter?tab=selling",
  `  saying all 50, opening Selling (${JSON.stringify(s[0] ?? null)})`);
await reset();

// In review counts on its own, and never mixes with live.
await list(SELLER, "live", "Lamp");
await list(SELLER, "pending_review", "Rug");
s = await notes(SELLER);
check(s.length === 2 && s.some((n) => n.title === "Listing sent for review" && n.message.includes('"Rug"')), "one sent for review: its own named notice, beside the one that went live");
await list(SELLER, "pending_review");
await list(SELLER, "pending_review");
s = await notes(SELLER);
const review = s.find((n) => n.title === "Listings sent for review");
const live = s.find((n) => n.title === "Your listing is live");
check(s.length === 2 && review?.message.startsWith("3 listings are being checked") && review?.link === "/declutter?tab=selling", `3 in review are one notice (${JSON.stringify(review ?? null)})`);
check(live?.message === '"Lamp" is live. Buyers can see it now.', "  and one going live is its own, not counted with them");
check((await pushes(SELLER)) === 2, `  one push each (${await pushes(SELLER)})`);
await reset();

// A notice the seller read is left alone: the next listing is news.
await list(SELLER, "live", "Chair");
await db.exec(`update public.notifications set read = true`);
await list(SELLER, "live", "Table");
s = await notes(SELLER);
check(s.length === 2 && s.some((n) => n.message === '"Table" is live. Buyers can see it now.') && s.some((n) => n.message === '"Chair" is live. Buyers can see it now.'),
  `after the seller read it, the next listing gets its own notice (${JSON.stringify(s.map((n) => n.message))})`);
check((await pushes(SELLER)) === 2, "  with its own push");
await reset();

// The window slides from the last listing: a long run is still one notice; a real gap starts a new one.
await list(SELLER, "live");
for (let i = 0; i < 3; i++) { await age(9); await list(SELLER, "live"); }
s = await notes(SELLER);
check(s.length === 1 && s[0].message.startsWith("4 listings are live"), `listings 9 minutes apart, over 27 minutes: one notice (${s.length}: ${s[0]?.message})`);
await age(11);
await list(SELLER, "live", "Later");
s = await notes(SELLER);
check(s.length === 2 && s.some((n) => n.message === '"Later" is live. Buyers can see it now.'), "11 minutes after the last one: a new notice");
check((await pushes(SELLER)) === 2, "  with a push");
await reset();

// The approval RPC's own notice is never counted or rewritten.
await db.query(`select public.declutter_notify($1, 'info', 'Your listing is live', $2, '/declutter?tab=selling')`, [SELLER, '"Sofa" is approved. Buyers can see it now.']);
await list(SELLER, "live", "Mirror");
s = await notes(SELLER);
check(s.length === 2 && s.some((n) => n.message === '"Sofa" is approved. Buyers can see it now.') && s.some((n) => n.message === '"Mirror" is live. Buyers can see it now.'), `the approval's notice stands; a listing beside it gets its own (${s.length})`);
await reset();

// Each seller's own.
await list(SELLER, "live");
await list(OTHER, "live");
await list(OTHER, "live");
check((await notes(SELLER)).length === 1 && (await notes(SELLER))[0].title === "Your listing is live", "another seller's listings never touch this seller's notice");
check((await notes(OTHER))[0]?.message.startsWith("2 listings are live"), "  and they count on their own");
await reset();

// A listing an approval moves from review to live, or an edit of a live one, is not told here (unchanged).
const moved = await list(SELLER, "pending_review");
await db.query(`update public.declutter_items set status = 'live' where id = $1`, [moved]);
s = await notes(SELLER);
check(s.length === 1 && s[0].title === "Listing sent for review", "in review -> live is not told here (the review RPC tells it)");
await reset();

// A notice that cannot be written never stops the listing, and is on record.
await db.exec(`create function public.boom() returns trigger language plpgsql as $f$ begin raise exception 'boom'; end $f$;
  create trigger boom before update on public.notifications for each row execute function public.boom();`);
await list(SELLER, "live");
const failedId = await list(SELLER, "live");
const row = (await db.query(`select status from public.declutter_items where id = $1`, [failedId])).rows[0];
const defects = (await db.query(`select fn from public.defects`)).rows;
check(row?.status === "live", "a summary that can't be written: the listing is still live");
check(defects.length === 1 && defects[0].fn === "declutter_listing_submitted_notice", `  and it is logged (${defects.length})`);
await db.exec(`drop trigger boom on public.notifications; drop function public.boom();`);

// Nobody can call it.
const acl = (await db.query(`select proacl::text as a from pg_proc where proname = 'declutter_listing_submitted_notice'`)).rows[0]?.a ?? "";
check(!/(^|[{,])=X|anon=|authenticated=/.test(acl), `not executable by PUBLIC, anon or authenticated (${acl})`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
