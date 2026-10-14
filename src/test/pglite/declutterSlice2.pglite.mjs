#!/usr/bin/env node
/**
 * PGlite proof for 20261014200728_declutter_slice2_followups (Declutter
 * slice 2, docs/specs/declutter-auctions.md), on top of slice 1
 * (20261014193955_declutter_foundation, applied once, as prod will have it).
 *
 *   node src/test/pglite/declutterSlice2.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSlice2.pglite.mjs     # RED: every check fails
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterSlice2.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs: roles + prod's default function ACL (anon/authenticated
 * EXECUTE on every new function, so a REVOKE that forgets anon is caught),
 * auth.users/auth.uid(), storage.objects (bucket_id, name, owner, owner_id:
 * the live columns, read 2026-10-14), profiles (the gate columns, live types),
 * user_roles/has_role, test_accounts, admin_audit_log, user_blocks. The five helpers
 * the migration calls (is_caller_banned, member_under_18,
 * helper_award_block_reason, contact_leak_reason, are_users_blocked) are NOT re-typed: their
 * NEWEST definitions are read out of supabase/migrations. Then
 * 20261012031120_hidden_feature_switches.sql, then the migration 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE1 = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");
const MIGRATION = readFileSync(
  process.env.MIGRATION_PATH ?? `${MIG_DIR}20261014200728_declutter_slice2_followups.sql`,
  "utf8",
);
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261014193955") && !x.startsWith("20261014200728")).sort()) {
    const sql = readFileSync(`${MIG_DIR}${f}`, "utf8");
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
  return found;
}

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
-- Storage as live: RLS on, the client role holds the table privilege, the policies decide.
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
CREATE POLICY "read all (test)" ON storage.objects FOR SELECT TO authenticated USING (true);
CREATE TABLE public.user_blocks (blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, is_seed boolean DEFAULT false,
  stripe_account_id text, stripe_payouts_enabled boolean DEFAULT false, date_of_birth date,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
`;

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const SELLER = U(1), BUYER = U(2), ORDINARY = U(3), MINOR = U(4), BANNED = U(5), STRUCK = U(6), NOPAYOUT = U(7), ADMIN = U(8);

const db = new PGlite();
await db.exec(SCHEMA);
for (const name of ["is_caller_banned", "member_under_18", "helper_award_block_reason", "contact_leak_reason", "are_users_blocked"]) {
  await db.exec(newestDefinition(name).stmt);
}
// Their live ACLs (only the client-visible ones matter to an invoker).
await db.exec(`
  REVOKE ALL ON FUNCTION public.member_under_18(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.is_caller_banned() FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;`);
await db.exec(SWITCHES);
await db.exec(`
  INSERT INTO auth.users (id) SELECT ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 8) g;
  INSERT INTO public.profiles (user_id, stripe_account_id, stripe_payouts_enabled, date_of_birth, ban_status) VALUES
    ('${SELLER}',   'acct_s', true,  '1990-01-01', 'active'),
    ('${BUYER}',    'acct_b', true,  '1991-01-01', 'active'),
    ('${ORDINARY}', 'acct_o', true,  '1992-01-01', 'active'),
    ('${MINOR}',    'acct_m', true,  (now() - interval '15 years')::date, 'active'),
    ('${BANNED}',   'acct_x', true,  '1990-01-01', 'banned'),
    ('${STRUCK}',   'acct_t', true,  '1990-01-01', 'active'),
    ('${NOPAYOUT}', NULL,     false, '1990-01-01', 'active'),
    ('${ADMIN}',    'acct_a', true,  '1980-01-01', 'active');
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');
  INSERT INTO public.test_accounts (user_id) VALUES ('${SELLER}'), ('${BUYER}'), ('${MINOR}'), ('${BANNED}'), ('${STRUCK}'), ('${NOPAYOUT}');`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

// Slice 1 as prod will hold it, switched on for testers, then slice 2 3x.
await db.exec(SLICE1);
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter';
               UPDATE public.profiles SET is_seed = true WHERE user_id = '${SELLER}';`);
const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

/** Run `sql` as `role` with auth.uid() = uid. Returns rows or { error, code }. */
async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
const refused = (r, re, code) => !Array.isArray(r) && re.test(r.error) && (code === undefined || r.code === code);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const createSql = (title = "Oak rocking chair", area = "Mid-City, Baton Rouge", floor = 2000, price = 4000) =>
  `SELECT public.declutter_create_item('${title}', 'Solid oak, a little worn.', 'furniture', 4, 'large', ${price}, ${floor},
     '${area}', '1234 Example St, Baton Rouge, LA 70806', 30.451234, -91.154321) AS id`;
const updateSql = (item, { title = "Oak rocker", area = "Mid-City, Baton Rouge", floor = 1500, price = 3000 } = {}) =>
  `SELECT public.declutter_update_draft('${item}', '${title}', 'Edited.', 'furniture', 3, 'small', ${price}, ${floor},
     '${area}', '1234 Example St, Baton Rouge, LA 70806', 30.451234, -91.154321) AS at`;
const path = (uid, item, n) => `${uid}/declutter/${item}/p${n}.jpg`;
const upload = async (uid, item, n) => {
  await svc(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('job-photos', '${path(uid, item, n)}', '${uid}', '{"mimetype": "image/jpeg", "size": 120000}')`);
  return as("authenticated", uid, `SELECT public.declutter_add_item_photo('${item}', '${path(uid, item, n)}') AS id`);
};
const delObj = async (uid, name) => {
  const r = await as("authenticated", uid, `DELETE FROM storage.objects WHERE bucket_id = 'job-photos' AND name = '${name}' RETURNING name`);
  return Array.isArray(r) ? r.length : r;
};
const readyToPublish = async (uid, item) => {
  for (let n = 0; n < 3; n++) await upload(uid, item, n);
  await as("authenticated", uid, `SELECT public.declutter_attest_item('${item}', true, true, true, true)`);
};
await as("authenticated", SELLER, `SELECT public.declutter_set_pickup_windows('[{"weekday":1,"starts":"17:00","ends":"19:00"}]')`);

// --- B16: is_seed, derived from the seller at birth
const item1 = one(await as("authenticated", SELLER, createSql()));
ok(typeof item1 === "string", "a tester seller creates a draft (slice 1 + 2 together)");
ok(one(await svc(`SELECT is_seed FROM public.declutter_items WHERE id = '${item1}'`)) === true,
  "a seed account's listing is born is_seed = true (B16)");
const npItem = one(await as("authenticated", NOPAYOUT, createSql("Bookshelf")));
ok(one(await svc(`SELECT is_seed FROM public.declutter_items WHERE id = '${npItem}'`)) === false,
  "a non-seed account's listing is born is_seed = false");

// --- area label is not an address (review note)
ok(refused(await as("authenticated", SELLER, createSql("Lamp", "55 Magnolia Dr, Baton Rouge")), /area_looks_like_address/, "22023"),
  "an area label with a house number and a street word is refused");
ok(refused(await as("authenticated", SELLER, createSql("Lamp", "Example St, Baton Rouge")), /area_looks_like_address/),
  "an area label naming the pickup address's own street is refused (no house number needed)");
ok(refused(await as("authenticated", SELLER, createSql("Lamp", "1234ExampleSt")), /area_looks_like_address/),
  "the pickup address squeezed together is refused");
for (const fine of ["River Road area", "Airline Hwy, Metairie", "70005 Metairie", "I-10 corridor, Baton Rouge"]) {
  ok(typeof one(await as("authenticated", SELLER, createSql("Rug", fine))) === "string", `a plain area "${fine}" is allowed`);
}
ok(refused(await as("authenticated", SELLER, createSql("Lamp", "near example st baton rouge 1234 Example St")), /area_looks_like_address/),
  "an area label holding the pickup address's first line is refused");
ok(typeof one(await as("authenticated", SELLER, createSql("Lamp", "St. Francisville"))) === "string",
  "a town with 'St.' in its name is allowed");
ok(typeof one(await as("authenticated", SELLER, createSql("Rug", "Metairie 70005"))) === "string",
  "a town with a ZIP code is allowed");

// --- B18: draft edit
ok(Array.isArray(await as("authenticated", SELLER, updateSql(item1))), "the seller edits their own draft");
const ed = await svc(`SELECT i.title, i.price_cents, i.current_price_cents, i.delivery_size, p.floor_price_cents
                        FROM public.declutter_items i JOIN public.declutter_item_private p ON p.item_id = i.id WHERE i.id = '${item1}'`);
ok(Array.isArray(ed) && ed[0]?.title === "Oak rocker" && ed[0]?.price_cents === 3000 && ed[0]?.current_price_cents === 3000
   && ed[0]?.delivery_size === "small" && ed[0]?.floor_price_cents === 1500,
  "the edit lands on the public row AND the private floor");
ok(refused(await as("authenticated", BUYER, updateSql(item1)), /item_not_found/, "P0002"), "someone else cannot edit the draft");
ok(refused(await as("authenticated", SELLER, updateSql(item1, { floor: 4000, price: 3000 })), /invalid_floor_price/),
  "an edit with the floor above the price is refused");
ok(refused(await as("authenticated", SELLER, updateSql(item1, { area: "55 Oak Lane" })), /area_looks_like_address/),
  "an edit cannot put an address in the area label");
ok(refused(await as("authenticated", SELLER, updateSql(item1, { title: "Call 225 555 1234" })), /Phone number detected/, "23514"),
  "an edit runs the contact-leak filter");
ok(refused(await as("authenticated", MINOR, updateSql(item1)), /under_18/), "an under-18 member cannot edit (selling gate)");
ok(refused(await as("anon", null, updateSql(item1)), /permission denied/), "anon cannot execute declutter_update_draft");

// --- B5: the storage DELETE policy
await readyToPublish(SELLER, item1);
ok(await delObj(SELLER, path(SELLER, item1, 0)) === 0, "an ATTACHED photo cannot be deleted from storage");
const photo0 = one(await svc(`SELECT id FROM public.declutter_item_photos WHERE storage_path = '${path(SELLER, item1, 0)}'`));
ok(one(await as("authenticated", SELLER, `SELECT public.declutter_remove_item_photo('${photo0}')`)) === path(SELLER, item1, 0),
  "removing a photo returns its path");
ok(await delObj(BUYER, path(SELLER, item1, 0)) === 0, "another member cannot delete the seller's unattached photo");
ok(await delObj(SELLER, path(SELLER, item1, 0)) === 1, "the seller deletes their own unattached photo (B5)");
await svc(`INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('job-photos', '${SELLER}/avatar.jpg', '${SELLER}'),
           ('avatars', '${SELLER}/declutter/x/y.jpg', '${SELLER}')`);
ok(await delObj(SELLER, `${SELLER}/avatar.jpg`) === 0, "the policy reaches only the declutter/ folder");
const otherBucket = await as("authenticated", SELLER, `DELETE FROM storage.objects WHERE bucket_id = 'avatars' RETURNING name`);
ok(Array.isArray(otherBucket) && otherBucket.length === 0, "the policy reaches only the job-photos bucket");
await upload(SELLER, item1, 0);

// --- B19: the AI gate on publish (a seller past the 3 admin-approved listings)
await svc(`INSERT INTO public.declutter_items (seller_id, title, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, status, admin_approved_at)
           SELECT '${SELLER}', 'Approved ' || g, 'misc', 3, 'small', 500, 500, 'Mid-City', 30.45, -91.15, 'completed', now() FROM generate_series(1, 3) g`);
ok(one(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${item1}')`)) === "pending_review",
  "a listing the AI never checked waits for an admin, even for a trusted seller (fail-safe)");
const item2 = one(await as("authenticated", SELLER, createSql("Table")));
await readyToPublish(SELLER, item2);
await svc(`UPDATE public.declutter_item_private SET ai_checked_at = now(), ai_flag_reason = 'looks like a car seat' WHERE item_id = '${item2}'`);
ok(one(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${item2}')`)) === "pending_review",
  "an AI-flagged listing waits for an admin (row 34)");
const item3 = one(await as("authenticated", SELLER, createSql("Chair")));
await readyToPublish(SELLER, item3);
await svc(`UPDATE public.declutter_item_private SET ai_checked_at = now() WHERE item_id = '${item3}'`);
await upload(SELLER, item3, 3);
ok(one(await svc(`SELECT ai_checked_at FROM public.declutter_item_private WHERE item_id = '${item3}'`)) === null,
  "adding a photo voids the AI check");
await svc(`UPDATE public.declutter_item_private SET ai_checked_at = now() WHERE item_id = '${item3}'`);
ok(one(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${item3}')`)) === "live",
  "a trusted seller's AI-checked, unflagged listing goes live");

// --- the AI verdict is recorded only through declutter_record_ai_check (review should-fix 1)
const item4 = one(await as("authenticated", SELLER, createSql("Bench")));
await readyToPublish(SELLER, item4);
const ids4 = await svc(`SELECT array_agg(id)::text AS a FROM public.declutter_item_photos WHERE item_id = '${item4}'`);
const t4 = await svc(`SELECT title, description, category FROM public.declutter_items WHERE id = '${item4}'`);
const recordSql = (ids, title = t4[0].title, flag = "NULL") =>
  `SELECT public.declutter_record_ai_check('${item4}', '${SELLER}', '${ids}'::uuid[], '${title}', '${t4[0].description}', '${t4[0].category}', ${flag})`;
ok(refused(await as("authenticated", SELLER, recordSql(one(ids4))), /permission denied/),
  "a member cannot record their own AI verdict (service role only)");
ok(refused(await svc(recordSql("{}")), /ai_check_stale/), "a verdict on a different photo set is refused (stale)");
ok(refused(await svc(recordSql(one(ids4), "Other title")), /ai_check_stale/), "a verdict on different text is refused (stale)");
ok(Array.isArray(await svc(recordSql(one(ids4)))), "a verdict on exactly the listing's photos and text is recorded");
ok(one(await svc(`SELECT ai_checked_at IS NOT NULL FROM public.declutter_item_private WHERE item_id = '${item4}'`)) === true,
  "the recorded verdict is on the private row");
// Review must-fix 3: editing the text voids the verdict and the confirmations.
await as("authenticated", SELLER, updateSql(item4, { title: "Vape pen kit", floor: 2000, price: 4000 }));
const v4 = await svc(`SELECT p.ai_checked_at, (SELECT count(*)::int FROM public.declutter_tax_attestations a WHERE a.item_id = '${item4}') AS att
                        FROM public.declutter_item_private p WHERE p.item_id = '${item4}'`);
ok(Array.isArray(v4) && v4[0]?.ai_checked_at === null && v4[0]?.att === 0,
  "editing the title voids the AI check and asks for the four confirmations again");
await as("authenticated", SELLER, `SELECT public.declutter_attest_item('${item4}', true, true, true, true)`);
ok(one(await as("authenticated", SELLER, `SELECT public.declutter_publish_item('${item4}')`)) === "pending_review",
  "an edited listing with no new AI check waits for an admin, even for a trusted seller");

// --- B8: admin review
const pend = await as("authenticated", ADMIN, `SELECT item_id, ai_flag_reason, array_length(photo_paths, 1) AS n FROM public.declutter_admin_pending_items()`);
ok(Array.isArray(pend) && pend.some((r) => r.item_id === item1) && pend.some((r) => r.item_id === item2 && r.ai_flag_reason === "looks like a car seat"),
  "an admin lists the pending listings with the AI's reason");
ok(refused(await as("authenticated", BUYER, `SELECT * FROM public.declutter_admin_pending_items()`), /not_admin/, "42501"),
  "a tester who is not an admin cannot list the queue");
ok(refused(await as("authenticated", BUYER, `SELECT public.declutter_admin_review_item('${item1}', true, NULL)`), /not_admin/, "42501"),
  "a tester who is not an admin cannot approve");
ok(refused(await as("authenticated", ADMIN, `SELECT public.declutter_admin_review_item('${item2}', false, '  ')`), /review_note_required/),
  "a rejection needs a reason");
ok(one(await as("authenticated", ADMIN, `SELECT public.declutter_admin_review_item('${item2}', false, 'Used car seats cannot be sold.')`)) === "rejected",
  "an admin rejects a flagged listing");
const rev = await as("authenticated", SELLER, `SELECT * FROM public.declutter_my_item_review('${item2}')`);
ok(Array.isArray(rev) && rev[0]?.review_note === "Used car seats cannot be sold." && rev[0]?.ai_flagged === true,
  "the seller reads the admin's reason");
ok(refused(await as("authenticated", BUYER, `SELECT * FROM public.declutter_my_item_review('${item2}')`), /item_not_found/, "P0002"),
  "nobody else reads the review note");
// Review must-fix 2: approval re-checks the seller.
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${SELLER}'`);
ok(refused(await as("authenticated", ADMIN, `SELECT public.declutter_admin_review_item('${item1}', true, NULL)`), /seller_not_eligible/),
  "an admin cannot approve the listing of a seller banned since it was submitted");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${SELLER}'`);
ok(one(await as("authenticated", ADMIN, `SELECT public.declutter_admin_review_item('${item1}', true, NULL)`)) === "live",
  "an admin approves a pending listing");
const npPending = one(await svc(`INSERT INTO public.declutter_items (seller_id, title, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, status)
           VALUES ('${NOPAYOUT}', 'Shelf', 'misc', 3, 'small', 500, 500, 'Mid-City', 30.45, -91.15, 'pending_review') RETURNING id`));
ok(refused(await as("authenticated", ADMIN, `SELECT public.declutter_admin_review_item('${npPending}', true, NULL)`), /seller_not_eligible/),
  "an admin cannot approve the listing of a seller whose payout setup is not done");
// Review must-fix 1: never their own.
const adminItem = one(await svc(`INSERT INTO public.declutter_items (seller_id, title, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, status)
           VALUES ('${ADMIN}', 'Admin lamp', 'misc', 3, 'small', 500, 500, 'Mid-City', 30.45, -91.15, 'pending_review') RETURNING id`));
await svc(`INSERT INTO public.declutter_item_private (item_id, seller_id, floor_price_cents, pickup_address, pickup_lat, pickup_lng)
           VALUES ('${adminItem}', '${ADMIN}', 500, '9 Admin Way, Baton Rouge', 30.45, -91.15)`);
ok(refused(await as("authenticated", ADMIN, `SELECT public.declutter_admin_review_item('${adminItem}', true, NULL)`), /own_listing/, "42501"),
  "an admin cannot approve their own listing");
const appr = await svc(`SELECT status, admin_approved_at IS NOT NULL AS a, live_at IS NOT NULL AS l FROM public.declutter_items WHERE id = '${item1}'`);
ok(Array.isArray(appr) && appr[0]?.status === "live" && appr[0]?.a && appr[0]?.l, "approval sets live, admin_approved_at and live_at");
ok(refused(await as("authenticated", ADMIN, `SELECT public.declutter_admin_review_item('${item1}', true, NULL)`), /item_not_pending/),
  "a listing is reviewed once");
ok(one(await svc(`SELECT count(*)::int FROM public.admin_audit_log WHERE target_id IN ('${item1}', '${item2}') AND action LIKE 'declutter_listing_%'`)) === 2,
  "each decision is in admin_audit_log");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'`);
ok(refused(await as("authenticated", ADMIN, `SELECT * FROM public.declutter_admin_pending_items()`), /feature_disabled/),
  "switch off: even an admin's queue is refused");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);

// --- B20: withdraw
await as("authenticated", BUYER, `SELECT public.declutter_set_watch('${item1}', true)`);
ok(refused(await as("authenticated", BUYER, `SELECT public.declutter_withdraw_item('${item1}')`), /item_not_found/, "P0002"),
  "someone else cannot withdraw the listing");
const wPaths = one(await as("authenticated", SELLER, `SELECT public.declutter_withdraw_item('${item1}')`));
ok(Array.isArray(wPaths) && wPaths.length === 3, "withdrawing a live listing returns its photo paths");
const wRow = await svc(`SELECT status, (SELECT count(*)::int FROM public.declutter_item_photos WHERE item_id = '${item1}') AS photos,
                         (SELECT count(*)::int FROM public.declutter_watchlist WHERE item_id = '${item1}') AS watchers
                        FROM public.declutter_items WHERE id = '${item1}'`);
ok(Array.isArray(wRow) && wRow[0]?.status === "withdrawn" && wRow[0]?.photos === 0 && wRow[0]?.watchers === 0,
  "a withdrawn listing keeps its row, loses its photo rows and watchers");
ok(Array.isArray(wPaths) && await delObj(SELLER, wPaths[0]) === 1, "the withdrawn listing's photos can then be deleted from storage");
const dPaths = one(await as("authenticated", NOPAYOUT, `SELECT public.declutter_withdraw_item('${npItem}')`));
ok(Array.isArray(dPaths) && one(await svc(`SELECT count(*)::int FROM public.declutter_items WHERE id = '${npItem}'`)) === 0,
  "withdrawing a draft deletes it");
ok(refused(await as("authenticated", SELLER, `SELECT public.declutter_withdraw_item('${item1}')`), /item_not_editable/),
  "a withdrawn listing cannot be withdrawn again");
// Review should-fix 2: a rejected listing's photos can be detached too.
const rPaths = one(await as("authenticated", SELLER, `SELECT public.declutter_withdraw_item('${item2}')`));
const r2 = await svc(`SELECT status, (SELECT count(*)::int FROM public.declutter_item_photos WHERE item_id = '${item2}') AS photos FROM public.declutter_items WHERE id = '${item2}'`);
ok(Array.isArray(rPaths) && rPaths.length === 3 && r2[0]?.status === "rejected" && r2[0]?.photos === 0,
  "a rejected listing's photos are detached (status stays rejected)");
ok(Array.isArray(rPaths) && await delObj(SELLER, rPaths[0]) === 1, "and the seller can then delete them from storage");
const minorItem = one(await svc(`INSERT INTO public.declutter_items (seller_id, title, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, status)
           VALUES ('${MINOR}', 'Old one', 'misc', 3, 'small', 500, 500, 'Mid-City', 30.45, -91.15, 'live') RETURNING id`));
ok(Array.isArray(one(await as("authenticated", MINOR, `SELECT public.declutter_withdraw_item('${minorItem}')`))),
  "an under-18 member may still take their own listing down");

// --- grants
const anonExec = await svc(`SELECT string_agg(p.proname, ',') AS f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'declutter%' AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
ok(Array.isArray(anonExec) && one(anonExec) === null && !skip, "anon can EXECUTE no Declutter function");
const authInternal = await svc(`SELECT string_agg(p.proname, ',') AS f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('declutter_area_label_problem', 'declutter_items_seed_from_seller', 'declutter_photos_void_ai_check', 'declutter_record_ai_check')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
ok(Array.isArray(authInternal) && one(authInternal) === null && !skip, "authenticated can EXECUTE none of the new internal helpers");
const exp = await svc(`SELECT prosrc, has_function_privilege('authenticated', oid, 'EXECUTE') AS a, has_function_privilege('anon', oid, 'EXECUTE') AS n
                        FROM pg_proc WHERE oid = to_regprocedure('public.export_my_data(uuid)')`);
ok(Array.isArray(exp) && exp.length === 1 && exp[0].a === false && exp[0].n === false
   && ["declutter_items", "declutter_item_private", "declutter_item_photos", "declutter_pickup_windows", "declutter_questions",
       "declutter_watchlist", "declutter_tax_attestations", "declutter_strikes", "declutter_seller_flags"].every((s) => exp[0].prosrc.includes(`'${s}'`)),
  "export_my_data has the nine Declutter sections and stays service_role only (B9)");
const writes = await svc(`SELECT string_agg(c.relname || ':' || r.rolname || ':' || pr.p, ',') AS w
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) pr(p)
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'declutter%' AND c.relkind = 'r'
    AND has_table_privilege(r.rolname, c.oid, pr.p)`);
ok(Array.isArray(writes) && one(writes) === null, "still no client role can write any Declutter table (RPCs only)");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
