#!/usr/bin/env node
/**
 * PGlite proof for 20261027204745_declutter_price_drop_alerts (Q2429, owner 2026-10-27: watchers are
 * told when an item's price drops or it becomes Free; one notice per drop, rate-limited, never to the
 * seller).
 *
 *   node src/test/pglite/declutterPriceDropAlerts.pglite.mjs                  # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/declutterPriceDropAlerts.pglite.mjs    # a planted defect: must FAIL
 *
 * World: declutter_items / declutter_item_private / declutter_watchlist / notifications / profiles
 * with the columns the trigger and the sweep read. Stubbed, and said so: are_users_blocked (a table),
 * net.http_post (records the email request) and vault.decrypted_secrets.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261027204745_declutter_price_drop_alerts.sql";
const MUTANT = process.env.MUTANT ?? "";

const MUTANTS = {
  seller: ["       AND wl.user_id IS DISTINCT FROM NEW.seller_id\n", "\n"],
  ratelimit: ["       AND (v_free OR NOT EXISTS (SELECT 1 FROM public.declutter_price_alerts a\n                                   WHERE a.item_id = NEW.id AND a.user_id = wl.user_id AND a.sent_at > now() - interval '3 days'))\n", "\n"],
  daycap: ["             WHERE a.user_id = wl.user_id AND a.sent_at > now() - interval '1 day') < 5", "             WHERE a.user_id = wl.user_id AND a.sent_at > now() - interval '1 day') < 500"],
  seed: ["       AND (NOT NEW.is_seed OR COALESCE(wp.is_seed, false))\n", "\n"],
  blocked: ["       AND NOT public.are_users_blocked(wl.user_id, NEW.seller_id)\n", "\n"],
  isolation: ["    EXCEPTION WHEN OTHERS THEN\n      -- A price change never fails because a watcher could not be told; the defect is logged where ops sees it (review #2).\n      RAISE WARNING 'declutter_price_drop_alert: item % watcher % not told: %', NEW.id, w.user_id, SQLERRM;\n      PERFORM public.log_cron_defect('declutter_price_drop_alert', NEW.id::text, SQLERRM,\n        jsonb_build_object('watcher', w.user_id, 'step', 'notice'));\n", ""],
  // A failed email takes the bell and the ledger with it.
  email: ["        EXCEPTION WHEN OTHERS THEN\n          RAISE WARNING 'declutter_price_drop_alert: item % watcher % email not queued: %', NEW.id, w.user_id, SQLERRM;\n          PERFORM public.log_cron_defect('declutter_price_drop_alert', NEW.id::text, SQLERRM,\n            jsonb_build_object('watcher', w.user_id, 'step', 'email'));\n", ""],
  // A hidden seller's listing alerts its watchers.
  hidden: ["  IF NEW.status <> 'live' OR NEW.seller_hidden OR NEW.current_price_cents >= OLD.current_price_cents THEN", "  IF NEW.status <> 'live' OR NEW.current_price_cents >= OLD.current_price_cents THEN"],
  sweepnotice: ["    v_n := v_n + 1;\n  END LOOP;", "    v_n := v_n + 1;\n    INSERT INTO public.notifications (user_id, type, title, message, link)\n    SELECT w.user_id, 'info', 'Price dropped', 'x', 'y' FROM public.declutter_watchlist w WHERE w.item_id = r.id;\n  END LOOP;"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), W1 = U(2), W2 = U(3), BLOCKED = U(4), SEEDW = U(5), BUSY = U(6), BROKEN = U(7);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users (id uuid primary key);
  grant usage on schema public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false);
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, status text not null default 'live', title text not null,
    price_cents integer not null, current_price_cents integer not null, is_seed boolean not null default false, sale_mode text not null default 'offers',
    live_at timestamptz default now() - interval '2 days', last_price_drop_on date, price_dropped_at timestamptz, updated_at timestamptz default now(),
    seller_hidden boolean not null default false);
  create table public.defects (fn text, ref text, err text, ctx jsonb);
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_context jsonb default '{}'::jsonb) returns void language sql as
    $f$ insert into public.defects values (p_fn, p_ref, p_err, p_context) $f$;
  create table public.declutter_item_private (item_id uuid primary key, floor_price_cents integer not null, drop_stop_cents integer);
  create table public.declutter_watchlist (user_id uuid, item_id uuid, created_at timestamptz default now(), primary key (user_id, item_id));
  create table public.notifications (id bigint generated always as identity primary key, user_id uuid, type text, title text, message text, link text);
  create table public.blocks (a uuid, b uuid);
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.blocks where (a = p1 and b = p2) or (a = p2 and b = p1)) $f$;
  create schema net; create table net.calls (body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $f$ insert into net.calls values (body) returning 1::bigint $f$;
  create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
  insert into vault.decrypted_secrets values ('supabase_url', 'https://x.test'), ('service_role_key', 'k');
`);
for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

const users = [SELLER, W1, W2, BLOCKED, SEEDW, BUSY, BROKEN];
await db.exec(`insert into auth.users values ${users.map((u) => `('${u}')`).join(",")};
  insert into public.profiles values ${users.map((u) => `('${u}', ${u === SEEDW})`).join(",")};
  insert into public.blocks values ('${SELLER}', '${BLOCKED}');`);
async function item(n, o = {}) {
  await db.query(`insert into public.declutter_items (id, seller_id, title, price_cents, current_price_cents, is_seed, status) values ($1, $2, $3, $4, $4, $5, $6)`,
    [I(n), SELLER, o.title ?? `Item ${n}`, o.price ?? 5000, o.seed ?? false, o.status ?? "live"]);
  await db.query(`insert into public.declutter_item_private values ($1, $2, $3)`, [I(n), o.floor ?? 1000, null]);
  for (const u of o.watchers ?? []) await db.query(`insert into public.declutter_watchlist (user_id, item_id) values ($1, $2)`, [u, I(n)]);
}
const notes = async (u) => (await db.query(`select title, message, link, type from public.notifications where user_id = $1 order by id`, [u])).rows;
const setPrice = (n, cents) => db.query(`update public.declutter_items set current_price_cents = $2 where id = $1`, [I(n), cents]);

await item(1, { title: "Oak dresser", watchers: [W1, W2, SELLER, BLOCKED] });
await setPrice(1, 4000);
const w1 = await notes(W1);
check(w1.length === 1 && w1[0].message === '"Oak dresser" dropped to $40.00.' && w1[0].title === "Price dropped" && w1[0].link === `/declutter/item/${I(1)}` && w1[0].type === "new_offers",
  `[alert] a watcher is told when the seller cuts the price (${JSON.stringify(w1[0] ?? null)})`);
check((await notes(W2)).length === 1, "[alert] every watcher is told");
check((await notes(SELLER)).length === 0, "[seller] never the seller, even watching their own item");
check((await notes(BLOCKED)).length === 0, "[blocked] never a member blocked with the seller");
const mails = (await db.query(`select body from net.calls`)).rows.map((r) => r.body);
check(mails.length === 2 && mails.every((b) => b.type === "new_offers" && /dropped to \$40\.00/.test(b.message)), "[email] each told watcher gets the email request (per their preferences)");

await setPrice(1, 3500);
check((await notes(W1)).length === 1, "[rate] a second drop inside 3 days is not sent again");
await setPrice(1, 0);
const freeNote = (await notes(W1)).at(-1);
check((await notes(W1)).length === 2 && freeNote.title === "Now free" && freeNote.message === '"Oak dresser" is now free.', "[free] becoming Free is always sent");
await db.exec(`update public.declutter_price_alerts set sent_at = now() - interval '4 days'`);
await db.exec(`update public.declutter_items set current_price_cents = 3000 where id = '${I(1)}'`); // a raise: nothing
check((await notes(W1)).length === 2, "[alert] a price going up tells nobody");
await setPrice(1, 2500);
check((await notes(W1)).length === 3, "[rate] after 3 days the next drop is sent");

await item(2, { status: "reserved", watchers: [W1] });
await setPrice(2, 4000);
check((await notes(W1)).length === 3, "[alert] a drop on an item that is not live tells nobody");

await item(3, { seed: true, watchers: [W2, SEEDW] });
await setPrice(3, 4000);
check((await notes(SEEDW)).length === 1 && (await notes(W2)).filter((n) => n.link.endsWith(I(3))).length === 0, "[seed] a test listing alerts only test watchers");

// At most 5 price notices per watcher a day, across items.
for (let n = 10; n < 17; n++) await item(n, { watchers: [BUSY] });
for (let n = 10; n < 17; n++) await setPrice(n, 4000);
check((await notes(BUSY)).length === 5, `[cap] at most 5 a day per watcher (${(await notes(BUSY)).length})`);

// One watcher's failing notice never stops the price change, nor the others' notices.
await db.exec(`create function public.zz_fail() returns trigger language plpgsql as $f$ begin if new.user_id = '${BROKEN}' then raise exception 'boom'; end if; return new; end $f$;
  create trigger zz_fail before insert on public.notifications for each row execute function public.zz_fail()`);
await item(20, { watchers: [BROKEN, W2] });
let ok = true;
try { await setPrice(20, 4000); } catch { ok = false; }
const price20 = (await db.query(`select current_price_cents from public.declutter_items where id = $1`, [I(20)])).rows[0].current_price_cents;
check(ok && price20 === 4000, "[safety] the price change goes through when a watcher cannot be told");
check((await db.query(`select count(*)::int as n from public.defects where fn = 'declutter_price_drop_alert' and ctx->>'step' = 'notice'`)).rows[0].n >= 1,
  "[defects] the failed notice is logged where ops sees it (log_cron_defect)");
check((await notes(W2)).some((n) => n.link.endsWith(I(20))), "[safety] the other watchers are still told");

await db.exec(`drop trigger zz_fail on public.notifications`);
// A failed email keeps the bell and the ledger (review #1).
await db.exec(`create or replace function net.http_post(url text, headers jsonb, body jsonb) returns bigint language plpgsql as $f$ begin raise exception 'pg_net down'; end $f$`);
await item(21, { title: "Vase", watchers: [W1] });
await setPrice(21, 4000);
const vase = (await notes(W1)).filter((n) => n.link.endsWith(I(21)));
const vaseLedger = (await db.query(`select count(*)::int as n from public.declutter_price_alerts where item_id = $1`, [I(21)])).rows[0].n;
check(vase.length === 1 && vaseLedger === 1, "[email] a failed email keeps the bell and the ledger");
check((await db.query(`select count(*)::int as n from public.defects where ctx->>'step' = 'email'`)).rows[0].n === 1, "[defects] the failed email is logged");
await db.exec(`create or replace function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $f$ insert into net.calls values (body) returning 1::bigint $f$`);
// A hidden seller's listing tells nobody (review #3).
await item(22, { watchers: [W1] });
await db.exec(`update public.declutter_items set seller_hidden = true where id = '${I(22)}'`);
await setPrice(22, 4000);
check((await notes(W1)).filter((n) => n.link.endsWith(I(22))).length === 0, "[hidden] a hidden seller's listing alerts nobody");
// The evening sweep: one drop, one notice (from the trigger), no second 'info' notice.
await db.exec(`delete from public.declutter_watchlist where item_id <> '${I(30)}'`);
await item(30, { title: "Lamp", price: 2000, floor: 500, watchers: [W2] });
const before = (await notes(W2)).length;
await db.exec(`select public.declutter_price_drop_sweep()`);
const added = (await notes(W2)).slice(before);
check(added.length === 1 && added[0].message === '"Lamp" dropped to $19.00.' && added[0].type === "new_offers" && added[0].link === `/declutter/item/${I(30)}`,
  `[sweep] the evening drop tells the watcher exactly once (${JSON.stringify(added)})`);

const acl = (await db.query(`select coalesce(relacl::text, '') as a from pg_class where relname = 'declutter_price_alerts'`)).rows[0].a;
check(!/authenticated=|anon=/.test(acl), `[grants] the ledger is service-role only (${acl})`);

console.log(failures === 0 ? `\nALL PASS${MUTANT ? ` (MUTANT=${MUTANT}: expected FAIL)` : " (3x replay)"}` : `\n${failures} FAIL${MUTANT ? ` (MUTANT=${MUTANT})` : ""}`);
process.exit(failures === 0 ? 0 : 1);
