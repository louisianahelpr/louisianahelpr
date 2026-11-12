#!/usr/bin/env node
/**
 * PGlite proof for 20261112070000 (Q1948 L92, owner 11-12): "new from shops you follow". When a shop item goes LIVE for
 * the first time, each follower gets one shops_following notice; never again for that item; collapsed per shop per 24 h
 * while unread; never to the owner, a blocked follower, a follower with the shops switch off; never for a test item,
 * test shop or test owner, a paused shop or one not in good standing; and a failing notice never fails the listing.
 *
 *   node src/test/pglite/shopsFollowAlerts.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsFollowAlerts.pglite.mjs # RED
 *   MUTANT=<name> node ...                                                # each must FAIL (see MUTANTS)
 *
 * World: cut-down tables carrying the columns the trigger reads. Stubbed, and said so: is_test_subject =
 * profiles.is_seed (its own proof: adminAlertsSkipTestAccounts.pglite.mjs); are_users_blocked from a user_blocks table;
 * feature_enabled_for_user from a per-user off list; shop_state_ok = NOT shops.hidden (the real one also reads bans and
 * strikes; its own proof is in the shops slice-1 proofs). One stub throws for a marked shop to prove the catch.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_shops_follow_alerts.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANTS = {
  everyLive: ["  IF NEW.status IS DISTINCT FROM 'live' OR NEW.followers_told_at IS NOT NULL THEN", "  IF NEW.status IS DISTINCT FROM 'live' THEN"],
  noStamp: ["  NEW.followers_told_at := now();\n", ""],
  ownerTold: ["       AND f.user_id <> v_shop.owner_id\n       AND NOT public.are_users_blocked", "       AND NOT public.are_users_blocked"],
  noBlock: ["       AND NOT public.are_users_blocked(f.user_id, v_shop.owner_id)\n", ""],
  noSwitch: ["       AND public.feature_enabled_for_user('shops', f.user_id)\n", ""],
  seedItemTold: ["  IF coalesce(NEW.is_seed, false) THEN\n    RETURN NEW;\n  END IF;\n", ""],
  pausedTold: ["OR coalesce(v_shop.paused, false)", "OR false"],
  notSellingTold: [" OR NOT coalesce(v_shop.offers_selling, true)", ""],
  rewriteBlocked: ["       AND f.user_id <> v_shop.owner_id\n       AND NOT public.are_users_blocked(f.user_id, v_shop.owner_id)\n       AND public.feature_enabled_for_user('shops', f.user_id);", "       AND f.user_id <> v_shop.owner_id;"],
  testOwnerTold: [" OR public.is_test_subject(v_shop.owner_id) THEN", " THEN"],
  noCollapse: ["       AND NOT EXISTS (\n         SELECT 1 FROM public.notifications n", "       AND NOT EXISTS (\n         SELECT 1 FROM public.notifications n WHERE false AND"],
  noCatch: ["  EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'shop_items_tell_followers: %', SQLERRM;\n", ""],
  emailOn: ["email_shops_following boolean NOT NULL DEFAULT false;", "email_shops_following boolean NOT NULL DEFAULT true;"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}
// The noCollapse mutant leaves "WHERE false AND\n WHERE ..." — make it valid SQL.
mig = mig.replace("WHERE false AND\n          WHERE", "WHERE false AND");

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const MAKER = U(1), ANN = U(2), BEN = U(3), BLOCKED = U(4), OFF = U(5), SEEDOWNER = U(6);
const S = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const SHOP = S(1), PAUSED = S(2), HIDDEN = S(3), SEEDSHOP = S(4), TESTOWNED = S(5), BOOMSHOP = S(6);
let itemN = 0;
const newItem = () => `33333333-0000-0000-0000-${String(++itemN).padStart(12, "0")}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
  CREATE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p AND is_seed) $f$;
  CREATE TABLE public.user_blocks (a uuid, b uuid);
  CREATE FUNCTION public.are_users_blocked(x uuid, y uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.user_blocks WHERE (a = x AND b = y) OR (a = y AND b = x)) $f$;
  CREATE TABLE public.switch_off (user_id uuid);
  CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT k = 'shops' AND NOT EXISTS (SELECT 1 FROM public.switch_off WHERE user_id = u) $f$;
  CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text, paused boolean NOT NULL DEFAULT false, offers_selling boolean NOT NULL DEFAULT true,
    hidden boolean NOT NULL DEFAULT false, is_seed boolean NOT NULL DEFAULT false);
  CREATE FUNCTION public.shop_state_ok(p uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $f$
  BEGIN
    IF p = '${BOOMSHOP}' THEN RAISE EXCEPTION 'boom'; END IF;
    RETURN EXISTS (SELECT 1 FROM public.shops WHERE id = p AND NOT hidden);
  END $f$;
  CREATE TABLE public.shop_follows (user_id uuid, shop_id uuid, PRIMARY KEY (user_id, shop_id));
  CREATE TABLE public.shop_items (id uuid PRIMARY KEY, shop_id uuid, owner_id uuid, title text, status text NOT NULL DEFAULT 'draft',
    price_cents integer, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY);
  CREATE TABLE public.notification_type_pref_map (type text PRIMARY KEY, pref_column text, description text);
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text,
    type text, link text, actor_id uuid, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_type_check CHECK (type IN ('info')));
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig);
}

await db.exec(`
  INSERT INTO public.profiles (user_id, is_seed) VALUES ('${MAKER}', false), ('${ANN}', false), ('${BEN}', false),
    ('${BLOCKED}', false), ('${OFF}', false), ('${SEEDOWNER}', true);
  INSERT INTO public.shops (id, owner_id, name, paused, hidden, is_seed) VALUES
    ('${SHOP}', '${MAKER}', 'Mimi''s Kitchen', false, false, false),
    ('${PAUSED}', '${MAKER}', 'Paused Shop', true, false, false),
    ('${HIDDEN}', '${MAKER}', 'Hidden Shop', false, true, false),
    ('${SEEDSHOP}', '${MAKER}', 'Seed Shop', false, false, true),
    ('${TESTOWNED}', '${SEEDOWNER}', 'Test Owner Shop', false, false, false),
    ('${BOOMSHOP}', '${MAKER}', 'Boom Shop', false, false, false);
  INSERT INTO public.user_blocks VALUES ('${MAKER}', '${BLOCKED}');
  INSERT INTO public.switch_off VALUES ('${OFF}');
`);
for (const shop of [SHOP, PAUSED, HIDDEN, SEEDSHOP, TESTOWNED, BOOMSHOP]) {
  await db.exec(`INSERT INTO public.shop_follows VALUES ('${ANN}', '${shop}'), ('${BEN}', '${shop}'), ('${BLOCKED}', '${shop}'),
    ('${OFF}', '${shop}'), ('${MAKER}', '${shop}') ON CONFLICT DO NOTHING`);
}

const q = async (sql) => (await db.query(sql)).rows;
const told = async (user, shop) => (await q(`SELECT * FROM public.notifications WHERE user_id = '${user}' AND type = 'shops_following'
  AND link = '/shops/${shop}' ORDER BY created_at`));
const list = async (shop, title, { status = "live", seed = false, owner = MAKER } = {}) => {
  const id = newItem();
  try {
    await db.exec(`INSERT INTO public.shop_items (id, shop_id, owner_id, title, status, price_cents, is_seed)
      VALUES ('${id}', '${shop}', '${owner}', '${title}', '${status}', 1500, ${seed})`);
  } catch (e) { return { id, error: e.message }; }
  return { id };
};

try {
  // 1. Draft: nothing. Going live: each follower told once, with the shop's name and the item's title.
  const a = await list(SHOP, "King Cake", { status: "draft" });
  check((await told(ANN, SHOP)).length === 0, "a draft tells nobody");
  await db.exec(`UPDATE public.shop_items SET status = 'live' WHERE id = '${a.id}'`);
  const ann = await told(ANN, SHOP);
  check(ann.length === 1 && ann[0].title === "New from Mimi's Kitchen" && ann[0].message === "Mimi's Kitchen added King Cake.",
    "draft -> live: the follower is told \"New from Mimi's Kitchen: Mimi's Kitchen added King Cake.\"");
  check(ann[0]?.actor_id === MAKER, "the notice names the shop owner as its actor");
  check((await told(BEN, SHOP)).length === 1, "every follower is told");
  check((await told(MAKER, SHOP)).length === 0, "the owner following their own shop is not told");
  check((await told(BLOCKED, SHOP)).length === 0, "a follower on either side of a block with the owner is not told");
  check((await told(OFF, SHOP)).length === 0, "a follower whose shops switch is off is not told");
  const stamp = await q(`SELECT followers_told_at FROM public.shop_items WHERE id = '${a.id}'`);
  check(stamp[0]?.followers_told_at != null, "the item is stamped followers_told_at");

  // 2. Never again for the same item: re-review, withdraw/relist.
  await db.exec(`UPDATE public.notifications SET read = true`);
  await db.exec(`UPDATE public.shop_items SET status = 'pending_review' WHERE id = '${a.id}'`);
  await db.exec(`UPDATE public.shop_items SET status = 'live' WHERE id = '${a.id}'`);
  await db.exec(`UPDATE public.shop_items SET status = 'withdrawn' WHERE id = '${a.id}'`);
  await db.exec(`UPDATE public.shop_items SET status = 'live' WHERE id = '${a.id}'`);
  check((await told(ANN, SHOP)).length === 1, "an item back through review or relisted never tells the followers again");

  // 3. Collapse: while the notice is unread, a second new item rewrites it in place.
  await list(SHOP, "Pralines");
  let n = await told(ANN, SHOP);
  check(n.length === 2 && n[1].message === "Mimi's Kitchen added Pralines.", "after reading, the next new item is a new notice");
  await list(SHOP, "Boudin");
  n = await told(ANN, SHOP);
  check(n.length === 2 && n[1].message === "Mimi's Kitchen added new items." && n[1].read === false,
    "a second item while the notice is unread rewrites it (\"added new items\"), no second row");

  // 4. Inserted live (an item that passes its checks at once) tells too.
  await db.exec(`UPDATE public.notifications SET read = true`);
  await list(SHOP, "Gumbo");
  check((await told(BEN, SHOP)).length === 3, "an item inserted live tells the followers");

  // 5. Skips.
  await db.exec(`UPDATE public.notifications SET read = true`);
  await list(SHOP, "Seed Pie", { seed: true });
  check((await told(BEN, SHOP)).length === 3, "a test item (is_seed) tells nobody");
  await list(PAUSED, "Paused Item");
  check((await told(ANN, PAUSED)).length === 0, "a paused shop's new item tells nobody");
  await list(HIDDEN, "Hidden Item");
  check((await told(ANN, HIDDEN)).length === 0, "a shop not in good standing tells nobody");
  await list(SEEDSHOP, "Seed Shop Item");
  check((await told(ANN, SEEDSHOP)).length === 0, "a test shop tells nobody");
  await list(TESTOWNED, "Test Owner Item", { owner: SEEDOWNER });
  check((await told(ANN, TESTOWNED)).length === 0, "a test owner's shop tells nobody");

  const NOSELL = "22222222-0000-0000-0000-000000000007";
  await db.exec(`INSERT INTO public.shops (id, owner_id, name, offers_selling) VALUES ('${NOSELL}', '${MAKER}', 'No Sell', false);
    INSERT INTO public.shop_follows VALUES ('${ANN}', '${NOSELL}')`);
  await list(NOSELL, "No Sell Item");
  check((await told(ANN, NOSELL)).length === 0, "a shop with selling turned off tells nobody");

  // Rewrite respects a block made after the first notice: the old notice is not marked unread again.
  await db.exec(`UPDATE public.notifications SET read = true`);
  await list(SHOP, "Etouffee");
  await db.exec(`UPDATE public.notifications SET read = false WHERE user_id = '${BEN}' AND link = '/shops/${SHOP}'`);
  await db.exec(`UPDATE public.notifications SET read = true WHERE user_id = '${BEN}' AND message <> 'Mimi''s Kitchen added Etouffee.'`);
  await db.exec(`INSERT INTO public.user_blocks VALUES ('${BEN}', '${MAKER}')`);
  await list(SHOP, "Crawfish Pie");
  const benLast = (await told(BEN, SHOP)).at(-1);
  check(benLast?.message === "Mimi's Kitchen added Etouffee.", "a follower who blocked the owner since is not rewritten (\"added new items\")");
  await db.exec(`DELETE FROM public.user_blocks WHERE a = '${BEN}'`);

  // 6. A failing notice never fails the listing.
  const boom = await list(BOOMSHOP, "Boom Item");
  const landed = await q(`SELECT status FROM public.shop_items WHERE id = '${boom.id}'`);
  check(!boom.error && landed[0]?.status === "live", "a notice step that throws never fails the item going live");

  // 7. Switches and the pref map.
  const cols = await q(`SELECT column_name, column_default FROM information_schema.columns
    WHERE table_name = 'notification_preferences' AND column_name IN ('shops_following', 'email_shops_following') ORDER BY 1`);
  check(cols.length === 2 && cols.find((c) => c.column_name === "shops_following")?.column_default === "true"
    && cols.find((c) => c.column_name === "email_shops_following")?.column_default === "false",
    "push switch defaults ON, email switch defaults OFF");
  const map = await q(`SELECT pref_column FROM public.notification_type_pref_map WHERE type = 'shops_following'`);
  check(map[0]?.pref_column === "shops_following", "notification_type_pref_map points push at shops_following");

  // 8. Nobody calls the trigger function.
  const acl = await q(`SELECT has_function_privilege('authenticated', 'public.shop_items_tell_followers()', 'EXECUTE') AS a,
    has_function_privilege('anon', 'public.shop_items_tell_followers()', 'EXECUTE') AS b`);
  check(acl[0]?.a === false && acl[0]?.b === false, "authenticated and anon cannot EXECUTE the trigger function");
} catch (e) {
  check(false, `threw: ${e.message}`);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
