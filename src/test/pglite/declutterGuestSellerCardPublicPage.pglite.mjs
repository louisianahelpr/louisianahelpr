#!/usr/bin/env node
/**
 * PGlite proof for 20261120185250 (Declutter item page polish, owner 11-20 item 6): declutter_guest_seller_card adds
 * `handle` and `member_since`, both only for a seller who has a public /u page (handle_for_user not NULL), so the
 * signed-out card can link to that page and say "Member since Mar 2025" without telling a guest anything the public
 * page does not already show. Everything else is the 20261112002528 card, unchanged.
 *
 *   node src/test/pglite/declutterGuestSellerCardPublicPage.pglite.mjs              # after (3x replay): ALL PASS
 *   MUTANT=sinceAlways node ...  # member_since without the public-page test: must FAIL
 *   MUTANT=rawHandle node ...    # p.handle instead of handle_for_user: must FAIL
 *   MUTANT=bannedToo node ...    # drops the ban test from the WHERE: must FAIL
 *
 * World: profiles (with handle, created_at and private columns), declutter_items, an empty declutter_orders,
 * test_accounts; member_display_name, is_test_member and handle_for_user VERBATIM from their newest migrations;
 * identity_is_verified, get_public_profile_stats, declutter_open_to_guests, declutter_member_out, member_under_18 and
 * profile_review_same_person stubbed (the orders table is empty, so the pickup count is 0 for everyone).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_guest_seller_card_public_page.sql"));
if (!THIS) throw new Error("migration not found");
const fnFrom = (file, head, end = "$fn$;") => {
  const text = readFileSync(MIG_DIR + file, "utf8");
  const s = text.indexOf(head);
  if (s < 0) throw new Error(`${head} not found in ${file}`);
  return text.slice(s, text.indexOf(end, s) + end.length);
};
const memberDisplayName = fnFrom("20261021131322_member_names_first_and_initial.sql", "CREATE OR REPLACE FUNCTION public.member_display_name");
const isTestMember = fnFrom("20261030015205_test_data_never_counts.sql", "CREATE OR REPLACE FUNCTION public.is_test_member");
const handleForUser = fnFrom("20261105171316_handle_for_user.sql", "CREATE OR REPLACE FUNCTION public.handle_for_user", "$function$;");

const MUTANTS = {
  sinceAlways: ["CASE WHEN h.handle IS NOT NULL THEN p.created_at END AS member_since", "p.created_at AS member_since"],
  rawHandle: ["h.handle AS handle,", "p.handle AS handle,"],
  bannedToo: ["AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))", ""],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const ANN = "11111111-0000-0000-0000-000000000001"; // public page "ann-s"
const BOB = "11111111-0000-0000-0000-000000000002"; // no handle
const KID = "11111111-0000-0000-0000-000000000003"; // handle, but member_under_18 -> no public page
const OUT = "11111111-0000-0000-0000-000000000004"; // handle, but out of Declutter -> no public page
const BANNED = "11111111-0000-0000-0000-000000000005";
const I = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
  CREATE FUNCTION public.identity_is_verified(p_idv_status text, p_stripe_identity_verified boolean) RETURNS boolean
    LANGUAGE sql IMMUTABLE AS $f$ SELECT p_idv_status IS NOT DISTINCT FROM 'verified' AND p_stripe_identity_verified IS NOT NULL $f$;
  CREATE FUNCTION public.declutter_open_to_guests() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
  GRANT EXECUTE ON FUNCTION public.declutter_open_to_guests() TO anon, authenticated;
  CREATE TABLE public.profiles (
    user_id uuid PRIMARY KEY, full_name text, email text, phone text, avatar_url text, handle text,
    idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false, email_verified boolean NOT NULL DEFAULT true,
    ban_status text, anonymized_at timestamptz, is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL);
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.profiles FROM PUBLIC, anon;
  CREATE TABLE public.declutter_items (
    id uuid PRIMARY KEY, seller_id uuid, status text, seller_hidden boolean NOT NULL DEFAULT false,
    is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.declutter_orders (seller_id uuid, buyer_id uuid, status text, is_seed boolean);
  CREATE FUNCTION public.profile_review_same_person(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT a = b $f$;
  CREATE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
    RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric)
    LANGUAGE sql STABLE AS $f$
      SELECT u, CASE WHEN u = '${ANN}' THEN 3 ELSE 0 END, CASE WHEN u = '${ANN}' THEN 4.70 END FROM unnest(p_user_ids) u $f$;
  REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC, anon;
  CREATE FUNCTION public.declutter_member_out(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT p = '${OUT}' $f$;
  CREATE FUNCTION public.member_under_18(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT p = '${KID}' $f$;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  ${isTestMember}
  ${memberDisplayName}
  ${handleForUser}
  INSERT INTO public.profiles (user_id, full_name, email, phone, avatar_url, handle, idv_status, ban_status, created_at) VALUES
    ('${ANN}', 'Ann Savoie', 'ann.savoie@example.com', '+13375550101', 'https://x/avatars/ann.jpg', 'ann-s', 'verified', NULL, '2025-03-10T12:00:00Z'),
    ('${BOB}', 'Bob Broussard', 'bob@example.com', NULL, NULL, NULL, NULL, NULL, '2024-01-05T12:00:00Z'),
    ('${KID}', 'Kit Young', 'kit@example.com', NULL, NULL, 'kit-y', NULL, NULL, '2026-01-05T12:00:00Z'),
    ('${OUT}', 'Oz Out', 'oz@example.com', NULL, NULL, 'oz-o', NULL, NULL, '2026-02-05T12:00:00Z'),
    ('${BANNED}', 'Ban Ned', 'b@example.com', NULL, NULL, 'ban-n', NULL, 'permanently_banned', '2026-02-05T12:00:00Z');
  INSERT INTO public.declutter_items (id, seller_id, status) VALUES
    ('${I(1)}', '${ANN}', 'live'), ('${I(2)}', '${BOB}', 'live'), ('${I(3)}', '${KID}', 'live'),
    ('${I(4)}', '${OUT}', 'live'), ('${I(5)}', '${BANNED}', 'live'), ('${I(6)}', '${ANN}', 'sold');
`);

let applyError = null;
for (let i = 0; i < 3; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x3 -> ${applyError ?? "ok"}`);

async function as(uid, sql) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE ${uid ? "authenticated" : "anon"}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', true);`);
    const r = await db.query(sql);
    await db.exec("COMMIT");
    return { rows: r.rows, fields: r.fields.map((f) => f.name) };
  } catch (e) {
    await db.exec("ROLLBACK");
    return { error: String(e.message ?? e) };
  }
}
const card = (item, uid = null) => as(uid, `SELECT * FROM public.declutter_guest_seller_card('${item}')`);
const iso = (v) => (v instanceof Date ? v.toISOString() : v);

const ann = await card(I(1));
check(!ann.error && ann.rows.length === 1, `a guest gets Ann's card -> ${ann.error ?? ann.rows.length}`);
check(JSON.stringify(ann.fields) === JSON.stringify(["display_name", "avg_rating", "review_count", "id_checked", "pickup_count", "handle", "member_since"]),
  `exactly seven fields -> ${ann.error ?? ann.fields?.join(",")}`);
const a = ann.rows?.[0] ?? {};
check(a.display_name === "Ann S." && Number(a.avg_rating) === 4.7 && a.review_count === 3, `name and rating unchanged -> ${JSON.stringify(a)}`);
check(a.handle === "ann-s", `a seller with a public page gives its handle -> ${a.handle}`);
check(iso(a.member_since) === "2025-03-10T12:00:00.000Z", `and that page's member_since -> ${iso(a.member_since)}`);
const body = JSON.stringify(ann.rows ?? []);
for (const secret of ["Savoie", "ann.savoie@example.com", "+13375550101", "avatars", ANN]) check(!body.includes(secret), `the response holds no "${secret}"`);

for (const [n, who] of [[2, "no handle"], [3, "under 18 (no public page)"], [4, "out of Declutter (no public page)"]]) {
  const x = await card(I(n));
  const r = x.rows?.[0] ?? {};
  check(!x.error && x.rows.length === 1 && r.handle === null && r.member_since === null,
    `${who}: the card shows, with no handle and no member_since -> ${x.error ?? JSON.stringify(r)}`);
}
for (const [n, why] of [[5, "banned seller"], [6, "sold listing"]]) {
  const x = await card(I(n));
  check(!x.error && x.rows.length === 0, `no row: ${why} -> ${x.error ?? x.rows.length}`);
}
const member = await card(I(1), BOB);
check(!member.error && member.rows[0]?.handle === "ann-s", `a member gets the same card -> ${member.error ?? JSON.stringify(member.rows)}`);
const direct = await as(null, "SELECT created_at FROM public.profiles");
check(/permission denied/.test(direct.error ?? ""), `anon still cannot read profiles directly -> ${direct.error ?? "ALLOWED"}`);
const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_guest_seller_card(uuid)', 'EXECUTE') AS a,
  (SELECT prosecdef FROM pg_proc WHERE proname = 'declutter_guest_seller_card') AS d`)).rows[0] ?? {};
check(acl.a === true && acl.d === true, `anon may call it, SECURITY DEFINER -> ${JSON.stringify(acl)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
