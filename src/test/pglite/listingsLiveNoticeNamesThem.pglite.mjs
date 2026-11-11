#!/usr/bin/env node
/**
 * PGlite proof for 20261111200834_listings_live_notice_names_them.sql (F484): the rolled-up "Your listings are live"
 * notice names the seller's newest live listings (at most three, never more than the count); the count still leads,
 * so the next listing keeps counting; the first listing's own notice and the review roll-up do not move.
 *
 *   node src/test/pglite/listingsLiveNoticeNamesThem.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/listingsLiveNoticeNamesThem.pglite.mjs  # RED: no names, as on prod
 *
 * World: declutter_listing_submitted_notice from its newest earlier migration on prod's trigger (AFTER INSERT OR
 * UPDATE OF status); declutter_notify stubbed as a plain insert (its own chain is proven elsewhere,
 * declutterBunchOneNotice.pglite.mjs); log_cron_defect stubbed.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const MIG = "20261111200834_listings_live_notice_names_them.sql";
const NEW = process.env.MIGRATION_PATH ?? `${dir}${MIG}`;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

function newestBefore(fn, before) {
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?AS\\s+(\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1\\s*;`, "gi");
  let found = "";
  for (const f of files) {
    if (f >= before) break;
    for (const m of readFileSync(`${dir}${f}`, "utf8").matchAll(re)) found = m[0];
  }
  if (!found) throw new Error(`no definition of ${fn}`);
  return found;
}

const S = "11111111-1111-1111-1111-111111111111";
const S2 = "22222222-2222-2222-2222-222222222222";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.declutter_items (id uuid primary key default gen_random_uuid(), seller_id uuid, title text, status text, seller_hidden boolean default false,
  live_at timestamptz, created_at timestamptz not null default clock_timestamp());
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null,
  type text, link text, read boolean not null default false, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION public.declutter_notify(u uuid, t text, ti text, m text, l text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (u, t, ti, m, l) $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
await db.exec(newestBefore("declutter_listing_submitted_notice", MIG));
await db.exec(`GRANT EXECUTE ON FUNCTION public.declutter_listing_submitted_notice() TO anon, authenticated, service_role;
CREATE TRIGGER trg_declutter_items_submitted_notice AFTER INSERT OR UPDATE OF status ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_listing_submitted_notice();`);
if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`); if (!ok) fails++; };
const list = (seller, title, status = "live") => db.query(
  `INSERT INTO declutter_items (seller_id, title, status, live_at) VALUES ($1, $2, $3, CASE WHEN $3 = 'live' THEN clock_timestamp() END)`, [seller, title, status]);
const notices = async (u) => (await db.query(`SELECT title, message FROM notifications WHERE user_id = $1 ORDER BY created_at`, [u])).rows;

// An older listing from yesterday: never named in today's roll-up of 2.
await db.query(`INSERT INTO declutter_items (seller_id, title, status, live_at, created_at) VALUES ($1, 'Old vase', 'live', now() - interval '1 day', now() - interval '1 day')`, [S]);
await db.query(`DELETE FROM notifications`); // its own notice is yesterday's news
await list(S, "Lamp");
let r = await notices(S);
check("first listing keeps its own named notice", r.length === 1 && r[0].message === '"Lamp" is live. Buyers can see it now.', r);
await list(S, "Rug");
r = await notices(S);
check("2 listings name both, never the older one", r.length === 1 && r[0].title === "Your listings are live"
  && r[0].message === '2 listings are live, including "Rug" and "Lamp". Buyers can see them now.', r);
await list(S, "  ");
r = await notices(S);
check("3 listings name three; a blank title reads Your item", r[0]?.message === '3 listings are live, including "Your item", "Rug" and "Lamp". Buyers can see them now.', r);
for (const t of ["Chair", "Desk"]) await list(S, t);
r = await notices(S);
check("5 listings: the count keeps going and the three newest are named", r.length === 1
  && r[0].message === '5 listings are live, including "Desk", "Chair" and "Your item". Buyers can see them now.', r);

await list(S2, "Bike", "pending_review");
await list(S2, "Helmet", "pending_review");
r = await notices(S2);
check("the review roll-up is unchanged", r.length === 1 && r[0].message === "2 listings are being checked before buyers see them. We'll tell you when they're live.", r);

const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'declutter_listing_submitted_notice'`)).rows[0]?.a ?? "";
check("anon and authenticated cannot execute", !/\banon=/.test(acl) && !/\bauthenticated=/.test(acl), acl);

console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
