#!/usr/bin/env node
/**
 * PGlite proof for 20261110195956_shops_paperwork_queue.sql (docs/NOT-LAUNCHED.md Q1952): a shop owner sends a food
 * permit / inflatable registration; an admin checks it; shop_badges.permit is true only for a CHECKED permit that has
 * not expired; shops_admin_paperwork is admin only and returns the sos_number; admins skip the shops switch.
 *
 *   node src/test/pglite/shopsPaperwork.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsPaperwork.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                            # red on a planted defect
 *
 * World: cut-down prod-shaped tables. Supabase's DEFAULT PRIVILEGES (EXECUTE on new functions to anon, authenticated,
 * service_role) are emulated, so a new function that forgets its REVOKE shows anon can run it. require_feature reads a
 * one-row switch table (off raises feature_disabled), so the admin bypass is measured, not assumed.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}20261110195956_shops_paperwork_queue.sql`, "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ADMIN = U(1), OWNER = U(2), MEMBER = U(3), ADMIN_OWNER = U(4), TEST_OWNER = U(5);
const SHOP = U(10), ADMIN_SHOP = U(13), TEST_SHOP = U(14);
const DOC = `${OWNER}/shop-permits/food_permit-1762800000000.pdf`;
const DOC2 = `${OWNER}/shop-permits/inflatable_registration-1762800000001.jpg`;
const ADMIN_DOC = `${ADMIN_OWNER}/shop-permits/food_permit-1762800000002.png`;
const TEST_DOC = `${TEST_OWNER}/shop-permits/food_permit-1762800000003.png`;
const OTHERS_DOC = `${MEMBER}/shop-permits/food_permit-1762800000004.pdf`;

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth; CREATE SCHEMA storage;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE storage.objects (bucket_id text, name text);
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT $1 IN ('${ADMIN}'::uuid, '${ADMIN_OWNER}'::uuid) $$;
  CREATE TABLE public.switch (on_ boolean);
  INSERT INTO public.switch VALUES (true);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql AS
    $$ BEGIN IF NOT (SELECT on_ FROM public.switch) THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF; END $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE TABLE public.test_subjects (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_subjects t WHERE t.user_id = p) $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, idv_status text, is_seed boolean DEFAULT false, license_url text, insurance_url text);
  CREATE TABLE public.helper_credentials (user_id uuid, credential_type text, status text, expiration_date date, document_url text);
  CREATE TABLE public.rental_properties (owner_id uuid, ownership_proof_path text, ownership_status text);
  CREATE TABLE public.maintenance_request_photos (tenant_id uuid, storage_path text);
  CREATE TABLE public.landlord_id_reviews (user_id uuid, images_deleted_at timestamptz, front_path text, back_path text);
  CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid NOT NULL, name text NOT NULL, area_label text NOT NULL DEFAULT 'Broussard',
    sos_number text, sos_verified_at timestamptz, sos_verified_by uuid, hidden_at timestamptz, hidden_by uuid, hidden_reason text,
    is_seed boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE FUNCTION public.shops_assert_owner_eligible() RETURNS uuid LANGUAGE plpgsql AS $$
    BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF; RETURN auth.uid(); END $$;
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
    message text NOT NULL, type text NOT NULL, link text);
  CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb, created_at timestamptz DEFAULT now());
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message, type, link) VALUES (p_user, p_title, p_message, p_type, p_link) $$;

  INSERT INTO public.profiles (user_id) VALUES ('${ADMIN}'), ('${OWNER}'), ('${MEMBER}'), ('${ADMIN_OWNER}'), ('${TEST_OWNER}');
  INSERT INTO auth.users SELECT user_id FROM public.profiles;
  INSERT INTO public.test_subjects VALUES ('${TEST_OWNER}');
  INSERT INTO public.shops (id, owner_id, name, sos_number) VALUES
    ('${SHOP}', '${OWNER}', 'Ruth''s Bakery', 'LA-123456'),
    ('${ADMIN_SHOP}', '${ADMIN_OWNER}', 'Admin Crafts', NULL),
    ('${TEST_SHOP}', '${TEST_OWNER}', 'Test Shop', 'LA-999');
  INSERT INTO storage.objects VALUES ('user-documents', '${DOC}'), ('user-documents', '${DOC2}'), ('user-documents', '${ADMIN_DOC}'),
    ('user-documents', '${TEST_DOC}'), ('user-documents', '${OTHERS_DOC}'), ('avatars', '${OWNER}/shop-permits/food_permit-1762800000009.pdf');
`);

// The prior state: the badge read as 20261021074131 left it (permit always false), so a skipped migration is red.
await db.exec(`
  CREATE FUNCTION public.shop_badges(p_shop_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS
    $$ SELECT jsonb_build_object('permit', false, 'registered', s.sos_verified_at IS NOT NULL) FROM public.shops s WHERE s.id = p_shop_id $$;
`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(SQL);
}

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
};
const as = async (uid, fn) => {
  await db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);
  try { return await fn(); } finally { await db.exec(`SELECT set_config('test.uid', '', false)`); }
};
const tryq = async (sql, params = []) => {
  try { return { rows: (await db.query(sql, params)).rows, err: null }; } catch (e) { return { rows: [], err: e.message }; }
};
const permitBadge = async (shop) => (await tryq(`SELECT public.shop_badges($1) AS b`, [shop])).rows[0]?.b?.permit;
const submit = (uid, kind, path, days) => as(uid, () => tryq(
  `SELECT public.shops_submit_permit($1, $2, (current_date + $3::int)) AS id`, [kind, path, days]));
const review = (uid, id, approve, note) => as(uid, () => tryq(`SELECT public.shops_admin_review_permit($1, $2, $3) AS s`, [id, approve, note]));
const paperwork = (uid) => as(uid, () => tryq(`SELECT public.shops_admin_paperwork() AS q`));

// 1. Nothing sent: no badge.
ok("no permit, no badge", (await permitBadge(SHOP)) === false);

// 2. Send checks.
const bad = [
  ["unknown kind", "liquor_license", DOC, 100, /invalid_permit_kind/],
  ["expired date", "food_permit", DOC, -1, /invalid_permit_expiry/],
  ["more than 5 years out", "food_permit", DOC, 1900, /invalid_permit_expiry/],
  ["someone else's document", "food_permit", OTHERS_DOC, 100, /invalid_permit_document/],
  ["a document of the other kind", "food_permit", DOC2, 100, /invalid_permit_document/],
  ["a path not uploaded", "food_permit", `${OWNER}/shop-permits/food_permit-1762800000099.pdf`, 100, /invalid_permit_document/],
  ["a path in another bucket", "food_permit", `${OWNER}/shop-permits/food_permit-1762800000009.pdf`, 100, /invalid_permit_document/],
];
for (const [name, kind, path, days, want] of bad) {
  const r = await submit(OWNER, kind, path, days);
  ok(`send refused: ${name}`, want.test(r.err ?? ""), r.err ?? "accepted");
}
const noShop = await submit(MEMBER, "food_permit", OTHERS_DOC, 100);
ok("a member with no shop is refused", /shop_not_found/.test(noShop.err ?? ""), noShop.err ?? "accepted");

const s1 = await submit(OWNER, "food_permit", DOC, 200);
ok("owner sends a food permit", !s1.err && s1.rows[0]?.id, s1.err ?? "");
const PERMIT = s1.rows[0]?.id;
ok("pending permit gives no badge", (await permitBadge(SHOP)) === false);
const mine = await as(OWNER, () => tryq(`SELECT * FROM public.shops_my_permits()`));
ok("owner reads own permit as pending", mine.rows.length === 1 && mine.rows[0].status === "pending" && !("reviewed_by" in mine.rows[0]),
  JSON.stringify(mine.rows));
const others = await as(MEMBER, () => tryq(`SELECT * FROM public.shops_my_permits()`));
ok("another member reads none of it", others.rows.length === 0, JSON.stringify(others.rows));

// 3. The table is not client-readable.
await db.exec(`SET ROLE authenticated`);
const direct = await tryq(`SELECT * FROM public.shop_permits`);
await db.exec(`RESET ROLE`);
ok("authenticated can't read shop_permits", /permission denied/.test(direct.err ?? ""), direct.err ?? "read");

// 4. The paperwork queue: admin only, sos_number for admins, test rows marked.
const q = await paperwork(ADMIN);
const pw = q.rows[0]?.q;
ok("admin reads the queue", !q.err && pw, q.err ?? "");
ok("queue lists the pending permit", pw?.permits?.some((p) => p.permit_id === PERMIT && p.document_path === DOC && p.is_seed === false));
ok("queue returns the SoS number to the admin", pw?.registrations?.some((r) => r.shop_id === SHOP && r.sos_number === "LA-123456"));
ok("queue marks a test account's shop is_seed", pw?.registrations?.find((r) => r.shop_id === TEST_SHOP)?.is_seed === true);
ok("a shop without a number is not listed", !pw?.registrations?.some((r) => r.shop_id === ADMIN_SHOP));
const qm = await paperwork(MEMBER);
ok("member is refused the queue", /not_admin/.test(qm.err ?? ""), qm.err ?? "read");
await db.exec(`SET ROLE anon`);
const qa = await tryq(`SELECT public.shops_admin_paperwork()`);
await db.exec(`RESET ROLE`);
ok("anon cannot run the queue", /permission denied/.test(qa.err ?? ""), qa.err ?? "ran");

// 5. Review rules.
const rm = await review(MEMBER, PERMIT, true, null);
ok("member can't review", /not_admin/.test(rm.err ?? ""), rm.err ?? "reviewed");
const rn = await review(ADMIN, PERMIT, false, "");
ok("turning down needs a reason", /reject_reason_required/.test(rn.err ?? ""), rn.err ?? "reviewed");
const sa = await submit(ADMIN_OWNER, "food_permit", ADMIN_DOC, 100);
const ro = await review(ADMIN_OWNER, sa.rows[0]?.id, true, null);
ok("an admin can't check their own shop's permit", /own_shop/.test(ro.err ?? ""), ro.err ?? "reviewed");

// 6. Checked: badge on; audited; owner told.
const ra = await review(ADMIN, PERMIT, true, null);
ok("admin checks the permit", ra.rows[0]?.s === "verified", ra.err ?? "");
ok("checked, unexpired permit shows the badge", (await permitBadge(SHOP)) === true);
const audit = await tryq(`SELECT count(*)::int n FROM public.admin_audit_log WHERE action = 'shop_permit_review' AND target_id = $1`, [SHOP]);
ok("the check is audited", audit.rows[0]?.n === 1);
const told = await tryq(`SELECT count(*)::int n FROM public.notifications WHERE user_id = $1 AND title = 'Permit on file'`, [OWNER]);
ok("the owner is told", told.rows[0]?.n === 1);
const after = (await paperwork(ADMIN)).rows[0]?.q;
ok("a checked permit leaves the queue", Array.isArray(after?.permits) && !after.permits.some((p) => p.permit_id === PERMIT), JSON.stringify(after?.permits));
const again = await review(ADMIN, PERMIT, false, "Blurry copy");
ok("a reviewed permit can't be reviewed again", /permit_already_reviewed/.test(again.err ?? ""), again.err ?? "reviewed");

// 7. Expired: the badge goes away on its own.
await tryq(`UPDATE public.shop_permits SET expires_on = current_date - 1 WHERE id = $1`, [PERMIT]);
ok("an expired checked permit shows no badge", (await permitBadge(SHOP)) === false);
await tryq(`UPDATE public.shop_permits SET expires_on = current_date WHERE id = $1`, [PERMIT]);
ok("a permit that expires today still shows", (await permitBadge(SHOP)) === true);

// 7b. The file behind a sent or checked permit is locked against the owner's update / delete (storage policies' test).
const locked = async (uid, path) => (await as(uid, () => tryq(`SELECT public.is_submitted_credential_object($1) AS l`, [path]))).rows[0]?.l;
ok("a checked permit's file is locked for its owner", (await locked(OWNER, DOC)) === true);
ok("another member's answer about it is false", (await locked(MEMBER, DOC)) === false);
// 8. A new copy goes back to pending (and the badge waits for the check).
const s2 = await submit(OWNER, "food_permit", DOC, 300);
ok("a new copy replaces the row", s2.rows[0]?.id === PERMIT, s2.err ?? "");
ok("a replaced permit waits again (no badge)", (await permitBadge(SHOP)) === false);

// 9. Turned down: no badge, the owner reads the note.
const rr = await review(ADMIN, PERMIT, false, "The copy is blurry.");
ok("admin turns it down", rr.rows[0]?.s === "rejected", rr.err ?? "");
ok("a turned-down permit shows no badge", (await permitBadge(SHOP)) === false);
const mine2 = await as(OWNER, () => tryq(`SELECT * FROM public.shops_my_permits()`));
ok("owner reads the note", mine2.rows[0]?.review_note === "The copy is blurry.", JSON.stringify(mine2.rows));

ok("a turned-down permit's file is free to replace or delete", (await locked(OWNER, DOC)) === false);

// 10. Switch off: admins still work, members meet the switch.
await db.exec(`UPDATE public.switch SET on_ = false`);
const hid = await as(ADMIN, () => tryq(`SELECT public.shops_admin_set_hidden($1, true, 'Selling things not allowed') AS h`, [SHOP]));
ok("switch off: an admin still hides a shop", hid.rows[0]?.h === true, hid.err ?? "");
const reg = await as(ADMIN, () => tryq(`SELECT public.shops_admin_check_registration($1, true) AS r`, [SHOP]));
ok("switch off: an admin still checks a registration", reg.rows[0]?.r === true, reg.err ?? "");
ok("switch off: an admin still reads the queue", !(await paperwork(ADMIN)).err);
const hm = await as(MEMBER, () => tryq(`SELECT public.shops_admin_set_hidden($1, false, null)`, [SHOP]));
ok("switch off: a member meets the switch", /feature_disabled/.test(hm.err ?? ""), hm.err ?? "ran");
const sm = await submit(OWNER, "inflatable_registration", DOC2, 100);
ok("switch off: an owner can't send", /feature_disabled/.test(sm.err ?? ""), sm.err ?? "sent");
await db.exec(`UPDATE public.switch SET on_ = true`);
const hm2 = await as(MEMBER, () => tryq(`SELECT public.shops_admin_set_hidden($1, false, null)`, [SHOP]));
ok("switch on: a member is not an admin", /not_admin/.test(hm2.err ?? ""), hm2.err ?? "ran");

// 11. Grants: anon runs none of the new functions; shop_badges stays internal.
const acl = await tryq(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u
  FROM pg_proc p WHERE p.proname IN ('shops_submit_permit','shops_my_permits','shops_admin_paperwork','shops_admin_review_permit','shop_badges')`);
ok("five functions exist", acl.rows.length === 5, JSON.stringify(acl.rows));
ok("anon runs none of them", acl.rows.every((r) => !r.a), JSON.stringify(acl.rows));
ok("shop_badges is not client-callable", acl.rows.find((r) => r.proname === "shop_badges")?.u === false);

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
