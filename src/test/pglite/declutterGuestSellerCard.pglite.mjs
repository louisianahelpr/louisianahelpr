#!/usr/bin/env node
/**
 * PGlite proof for 20261111205821 (F227/F319, owner 11-11): declutter_guest_seller_card gives a guest exactly four
 * fields for a guest-readable listing's seller ("Ann S.", star average, review count, ID checked) and nothing else:
 * no row for a listing a guest cannot read, no surname, email, phone, photo or user id in the response.
 *
 *   node src/test/pglite/declutterGuestSellerCard.pglite.mjs                    # after (3x replay): ALL PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterGuestSellerCard.pglite.mjs # the before: must FAIL
 *   MUTANT=anyStatus node ...    # drops the live/reserved test: must FAIL
 *   MUTANT=fullName node ...     # returns the raw full_name: must FAIL
 *   MUTANT=guestsClosed node ... # drops the open-to-guests test: must FAIL
 *   MUTANT=bannedToo node ...    # drops the ban test: must FAIL
 *   MUTANT=hiddenToo node ...    # drops the seller_hidden test: must FAIL
 *   MUTANT=testAccount node ...  # drops the is_test_member test: must FAIL
 *   MUTANT=blankName node ...    # drops the has-a-name test: must FAIL
 *
 * World: profiles and declutter_items with the columns the function reads plus the private ones it must not return
 * (email, phone, avatar_url); member_display_name run VERBATIM from its newest migration (20261021131322);
 * is_test_member VERBATIM from 20261030015205; declutter_open_to_guests and get_public_profile_stats stubbed (the stub
 * returns extra columns, which must not leak). Because the stats function is a stub, this proof does not show the
 * rating equals the member card's: that holds because both read get_public_profile_stats (src/lib/declutter/api.ts
 * fetchSellerRating), a fact of the code, not of this run.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_guest_seller_card.sql"));
if (!THIS) throw new Error("migration not found");
const NAMES = readFileSync(MIG_DIR + "20261021131322_member_names_first_and_initial.sql", "utf8");
const nameFnStart = NAMES.indexOf("CREATE OR REPLACE FUNCTION public.member_display_name");
const memberDisplayName = NAMES.slice(nameFnStart, NAMES.indexOf("$fn$;", nameFnStart) + 5);
if (nameFnStart < 0 || !memberDisplayName.includes("parts[1]")) throw new Error("member_display_name not found");
const TESTM = readFileSync(MIG_DIR + "20261030015205_test_data_never_counts.sql", "utf8");
const testFnStart = TESTM.indexOf("CREATE OR REPLACE FUNCTION public.is_test_member");
const isTestMember = TESTM.slice(testFnStart, TESTM.indexOf("$fn$;", testFnStart) + 5);
if (testFnStart < 0 || !isTestMember.includes("test_accounts")) throw new Error("is_test_member not found");

const MUTANTS = {
  anyStatus: ["AND i.status IN ('live', 'reserved')", ""],
  fullName: ["public.member_display_name(p.full_name, NULL)::text AS display_name", "p.full_name AS display_name"],
  guestsClosed: ["AND (SELECT public.declutter_open_to_guests())", ""],
  bannedToo: ["AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))", ""],
  hiddenToo: ["AND NOT i.seller_hidden", ""],
  testAccount: ["AND NOT public.is_test_member(p.user_id)", ""],
  blankName: ["AND public.member_display_name(p.full_name, NULL) IS NOT NULL;", ";"],
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
const ANN = "11111111-0000-0000-0000-000000000001";
const BOB = "11111111-0000-0000-0000-000000000002";
const BANNED = "11111111-0000-0000-0000-000000000003";
const UNVERIFIED = "11111111-0000-0000-0000-000000000004";
const GONE = "11111111-0000-0000-0000-000000000005";
const SEEDP = "11111111-0000-0000-0000-000000000006";
const LISTED = "11111111-0000-0000-0000-000000000007"; // in test_accounts, is_seed false
const BLANK = "11111111-0000-0000-0000-000000000008"; // a name of spaces only
const I = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
  CREATE TABLE public.guest_switch (open boolean);
  INSERT INTO public.guest_switch VALUES (true);
  CREATE FUNCTION public.declutter_open_to_guests() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT open FROM public.guest_switch $f$;
  GRANT EXECUTE ON FUNCTION public.declutter_open_to_guests() TO anon, authenticated;
  CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, full_name text, email text, phone text, avatar_url text,
    idv_status text, email_verified boolean NOT NULL DEFAULT true, ban_status text, anonymized_at timestamptz,
    is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.profiles FROM PUBLIC, anon;
  CREATE TABLE public.declutter_items (
    id uuid PRIMARY KEY, seller_id uuid, status text, seller_hidden boolean NOT NULL DEFAULT false,
    is_seed boolean NOT NULL DEFAULT false);
  REVOKE ALL ON public.declutter_items FROM PUBLIC, anon;
  -- The stats stub answers like the real one (its public review figures) and with columns the card must not pass on.
  CREATE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
    RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric, completed_jobs_total integer,
                  is_id_verified boolean, has_stripe_account boolean)
    LANGUAGE sql STABLE AS $f$
      SELECT u, CASE WHEN u = '${ANN}' THEN 2 ELSE 0 END, CASE WHEN u = '${ANN}' THEN 4.50 END, 7, true, true
        FROM unnest(p_user_ids) u $f$;
  REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC, anon;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  INSERT INTO public.test_accounts VALUES ('${LISTED}');
  ${isTestMember}
  REVOKE ALL ON FUNCTION public.is_test_member(uuid) FROM PUBLIC, anon, authenticated;
  ${memberDisplayName}
  REVOKE ALL ON FUNCTION public.member_display_name(text, text) FROM PUBLIC, anon;
  INSERT INTO public.profiles (user_id, full_name, email, phone, avatar_url, idv_status, email_verified, ban_status, anonymized_at, is_seed) VALUES
    ('${ANN}', '  Ann Marie  Savoie ', 'ann.savoie@example.com', '+13375550101', 'https://x/avatars/ann.jpg', 'verified', true, NULL, NULL, false),
    ('${BOB}', 'Bob', 'bob@example.com', '+13375550102', 'https://x/avatars/bob.jpg', 'requires_input', true, NULL, NULL, false),
    ('${BANNED}', 'Carl Banned', 'c@example.com', NULL, NULL, 'verified', true, 'permanently_banned', NULL, false),
    ('${UNVERIFIED}', 'Dee Unverified', 'd@example.com', NULL, NULL, 'verified', false, NULL, NULL, false),
    ('${GONE}', 'Eve Gone', 'e@example.com', NULL, NULL, 'verified', true, NULL, now(), false),
    ('${SEEDP}', 'Fay Seed', 'f@example.com', NULL, NULL, 'verified', true, NULL, NULL, true),
    ('${LISTED}', 'Gus Listed', 'g@example.com', NULL, NULL, 'verified', true, NULL, NULL, false),
    ('${BLANK}', '   ', 'h@example.com', NULL, NULL, 'verified', true, NULL, NULL, false);
  INSERT INTO public.declutter_items (id, seller_id, status, seller_hidden, is_seed) VALUES
    ('${I(1)}', '${ANN}', 'live', false, false),
    ('${I(2)}', '${ANN}', 'reserved', false, false),
    ('${I(3)}', '${ANN}', 'sold', false, false),
    ('${I(4)}', '${ANN}', 'withdrawn', false, false),
    ('${I(5)}', '${ANN}', 'draft', false, false),
    ('${I(6)}', '${ANN}', 'live', true, false),
    ('${I(7)}', '${ANN}', 'live', false, true),
    ('${I(8)}', '${BOB}', 'live', false, false),
    ('${I(9)}', '${BANNED}', 'live', false, false),
    ('${I(10)}', '${UNVERIFIED}', 'live', false, false),
    ('${I(11)}', '${GONE}', 'live', false, false),
    ('${I(12)}', '${SEEDP}', 'live', false, false),
    ('${I(13)}', '${LISTED}', 'live', false, false),
    ('${I(14)}', '${BLANK}', 'live', false, false);
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

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

const live = await card(I(1));
check(!live.error && live.rows.length === 1, `a guest gets one row for a live listing -> ${live.error ?? live.rows.length}`);
check(JSON.stringify(live.fields) === JSON.stringify(["display_name", "avg_rating", "review_count", "id_checked"]),
  `exactly four fields, nothing else -> ${live.error ?? live.fields.join(",")}`);
const r = live.rows?.[0] ?? {};
check(r.display_name === "Ann S.", `first name + last initial ("Ann S.") -> ${JSON.stringify(r.display_name)}`);
check(Number(r.avg_rating) === 4.5 && r.review_count === 2, `the rating and its count -> ${r.avg_rating} / ${r.review_count}`);
check(r.id_checked === true, `the ID-checked badge -> ${r.id_checked}`);
const body = JSON.stringify(live.rows ?? []);
for (const secret of ["Savoie", "Marie", "ann.savoie@example.com", "+13375550101", "avatars", ANN, "has_stripe", "completed"]) {
  check(!body.includes(secret), `the response holds no "${secret}"`);
}

const reserved = await card(I(2));
check(!reserved.error && reserved.rows.length === 1, `reserved (still guest-readable) -> ${reserved.error ?? reserved.rows.length}`);
for (const [n, why] of [[3, "sold"], [4, "withdrawn"], [5, "draft"], [6, "hidden seller"], [7, "test listing"],
  [9, "banned seller"], [10, "unverified seller"], [11, "deleted seller"], [12, "test seller"],
  [13, "seller in test_accounts (not is_seed)"], [14, "seller with a blank name"]]) {
  const x = await card(I(n));
  check(!x.error && x.rows.length === 0, `no row: ${why} -> ${x.error ?? x.rows.length}`);
}
const missing = await card("22222222-0000-0000-0000-000000000099");
check(!missing.error && missing.rows.length === 0, `no row: unknown item -> ${missing.error ?? missing.rows.length}`);

const bob = await card(I(8));
const b = bob.rows?.[0] ?? {};
check(!bob.error && b.display_name === "Bob" && b.avg_rating === null && b.review_count === 0 && b.id_checked === false,
  `one-word name, no reviews (no average), not ID checked -> ${bob.error ?? JSON.stringify(b)}`);
check(!bob.error && !JSON.stringify(bob.rows).includes("bob@example.com"), "Bob's email is not in the response");

const member = await card(I(1), BOB);
check(!member.error && member.rows[0]?.display_name === "Ann S.", `a member gets the same card -> ${member.error ?? member.rows.length}`);

await db.exec("UPDATE public.guest_switch SET open = false");
const closed = await card(I(1));
check(!closed.error && closed.rows.length === 0, `no row while Declutter is not open to guests -> ${closed.error ?? closed.rows.length}`);
await db.exec("UPDATE public.guest_switch SET open = true");

const direct = await as(null, "SELECT full_name FROM public.profiles");
check(/permission denied/.test(direct.error ?? ""), `anon still cannot read profiles directly -> ${direct.error ?? "ALLOWED"}`);
const stats = await as(null, `SELECT * FROM public.get_public_profile_stats(ARRAY['${ANN}'::uuid])`);
check(/permission denied/.test(stats.error ?? ""), `anon still cannot call the stats function -> ${stats.error ?? "ALLOWED"}`);
const acl = (await db.query(`SELECT to_regprocedure('public.declutter_guest_seller_card(uuid)') IS NULL AS gone`)).rows[0].gone ? {} : (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_guest_seller_card(uuid)', 'EXECUTE') AS a,
  (SELECT prosecdef FROM pg_proc WHERE proname = 'declutter_guest_seller_card') AS d`)).rows[0] ?? {};
check(acl.a === true && acl.d === true, `anon may call it, SECURITY DEFINER -> ${JSON.stringify(acl)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
