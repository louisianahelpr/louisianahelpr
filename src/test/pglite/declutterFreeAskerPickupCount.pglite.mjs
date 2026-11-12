#!/usr/bin/env node
/**
 * PGlite proof for 20261112053500 (F359d, the asker half): the giver's list of people asking for a free item
 * (declutter_free_requests_for_item) carries pickup_count, how many Declutter pickups each asker completed AS A BUYER:
 * handed_over orders only, no test order, no test seller, not from the asker's own second account (same phone). NULL
 * across a block or a ban and for a test asker. Names, the block filter and item_not_found are unchanged.
 *
 *   node src/test/pglite/declutterFreeAskerPickupCount.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFreeAskerPickupCount.pglite.mjs # RED: no pickup_count
 *   MUTANT=anyStatus|seedOrder|testSeller|samePerson|noHide|testAsker|gone|sellerSide node ...  # each must FAIL
 *
 * World: the PREVIOUS declutter_free_requests_for_item (20261112023218) created first; declutter_names_hidden
 * (20261112010100), member_display_name (20261021131322), is_test_member (20261030015205) and
 * profile_review_same_person (20261105165059) VERBATIM; then this migration 3x. Stubbed, and said so: are_users_blocked
 * reads user_blocks either way; get_public_profile_stats returns no rows; normalize_phone_for_ban keeps digits.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_free_asker_pickup_count.sql"));
if (!THIS) throw new Error("migration not found");
function fnFrom(file, head) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.indexOf(head);
  if (s < 0) throw new Error(`${head} not in ${file}`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s);
  return t.slice(s, t.indexOf(`${tag};`, open + tag.length + 4) + tag.length + 1);
}
const memberDisplayName = fnFrom("20261021131322_member_names_first_and_initial.sql", "CREATE OR REPLACE FUNCTION public.member_display_name");
const namesHidden = fnFrom("20261112010100_declutter_names_hidden_across_block_or_ban.sql", "CREATE OR REPLACE FUNCTION public.declutter_names_hidden(");
const isTestMember = fnFrom("20261030015205_test_data_never_counts.sql", "CREATE OR REPLACE FUNCTION public.is_test_member");
const samePerson = fnFrom("20261105165059_public_profile_full.sql", "CREATE OR REPLACE FUNCTION public.profile_review_same_person");
const prev = fnFrom("20261112023218_declutter_free_requests_hide_banned_requester_name.sql", "CREATE OR REPLACE FUNCTION public.declutter_free_requests_for_item(");

const MUTANTS = {
  anyStatus: ["                         AND o.status = 'handed_over'\n", ""],
  seedOrder: ["                         AND o.is_seed IS NOT TRUE\n", ""],
  testSeller: ["                         AND NOT public.is_test_member(o.seller_id)\n", ""],
  samePerson: ["\n                         AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id)) END", ") END"],
  noHide: ["CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) OR public.is_test_member(r.requester_id)\n", "CASE WHEN public.is_test_member(r.requester_id)\n"],
  testAsker: ["CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) OR public.is_test_member(r.requester_id)\n", "CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id)\n"],
  gone: ["\n                     OR p.anonymized_at IS NOT NULL THEN NULL", " THEN NULL"],
  sellerSide: ["                       WHERE o.buyer_id = r.requester_id\n", "                       WHERE o.seller_id = r.requester_id\n"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
// SAM gives away I1. Askers: ANN (2 real pickups + noise), BOB (none, but he SOLD twice), DEE (banned, 1 pickup),
// TIA (a test account, 1 pickup), BLK (SAM blocked him: row dropped). Sellers: S1, S2 clean, TS a test seller,
// ANN2 Ann's own second account (same phone).
const SAM = U(1), ANN = U(2), BOB = U(3), DEE = U(4), TIA = U(5), BLK = U(6), S1 = U(7), S2 = U(8), TS = U(9), ANN2 = U(10), GUS = U(11);
const I1 = "22222222-0000-0000-0000-000000000001", I2 = "22222222-0000-0000-0000-000000000002";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, phone text, ban_status text,
    auto_suspended_until timestamptz, is_seed boolean NOT NULL DEFAULT false, anonymized_at timestamptz);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, buyer_id uuid,
    status text NOT NULL, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.declutter_free_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, requester_id uuid,
    status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT clock_timestamp(), pickup_at timestamptz);
  CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.user_blocks x WHERE (x.blocker_id = a AND x.blocked_id = b) OR (x.blocker_id = b AND x.blocked_id = a)) $f$;
  CREATE FUNCTION public.get_public_profile_stats(ids uuid[]) RETURNS TABLE(avg_rating numeric, review_count integer) LANGUAGE sql STABLE AS
    $f$ SELECT NULL::numeric, NULL::integer WHERE false $f$;
  CREATE FUNCTION public.normalize_phone_for_ban(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') $f$;
  ${memberDisplayName}
  ${namesHidden}
  ${isTestMember}
  ${samePerson}
  INSERT INTO public.profiles (user_id, full_name, phone, ban_status, is_seed) VALUES
    ('${SAM}', 'Sam Seller', NULL, NULL, false), ('${ANN}', 'Ann Savoie', '+1 (337) 555-0101', NULL, false),
    ('${BOB}', 'Bob Guidry', NULL, NULL, false), ('${DEE}', 'Dee Dupre', NULL, 'banned', false),
    ('${TIA}', 'Tia Test', NULL, NULL, false), ('${BLK}', 'Blake Block', NULL, NULL, false),
    ('${S1}', 'Sue One', NULL, NULL, false), ('${S2}', 'Sid Two', NULL, NULL, false), ('${TS}', 'Ted Seed', NULL, NULL, true),
    ('${ANN2}', 'Ann Second', '13375550101', NULL, false);
  INSERT INTO public.profiles (user_id, full_name, anonymized_at) VALUES ('${GUS}', NULL, now());
  INSERT INTO public.test_accounts VALUES ('${TIA}');
  INSERT INTO public.user_blocks VALUES ('${SAM}', '${BLK}');
  INSERT INTO public.declutter_items VALUES ('${I1}', '${SAM}'), ('${I2}', '${S1}');
  INSERT INTO public.declutter_orders (seller_id, buyer_id, status, is_seed) VALUES
    ('${S1}', '${ANN}', 'handed_over', false), ('${S2}', '${ANN}', 'handed_over', false),
    ('${S1}', '${ANN}', 'paid', false), ('${S2}', '${ANN}', 'handed_over', true),
    ('${TS}', '${ANN}', 'handed_over', false), ('${ANN2}', '${ANN}', 'handed_over', false),
    ('${BOB}', '${S1}', 'handed_over', false), ('${BOB}', '${S2}', 'handed_over', false),
    ('${S1}', '${DEE}', 'handed_over', false), ('${S1}', '${TIA}', 'handed_over', false), ('${S1}', '${BLK}', 'handed_over', false),
    ('${S1}', '${GUS}', 'handed_over', false);
  INSERT INTO public.declutter_free_requests (item_id, requester_id) VALUES
    ('${I1}', '${ANN}'), ('${I1}', '${BOB}'), ('${I1}', '${DEE}'), ('${I1}', '${TIA}'), ('${I1}', '${BLK}'), ('${I1}', '${GUS}');
  ${prev}
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

const list = async (uid, item) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return (await db.query(`SELECT * FROM public.declutter_free_requests_for_item('${item}')`)).rows; }
  catch (e) { return { error: String(e.message ?? e) }; }
};
const rows = await list(SAM, I1);
const row = (u) => (Array.isArray(rows) ? rows.find((r) => r.requester_id === u) : undefined);
check(Array.isArray(rows) && rows.length > 0 && "pickup_count" in rows[0], "the list has a pickup_count column");
check(row(ANN)?.pickup_count === 2, `an asker's real pickups count; not paid-only, test, test-seller or own-account orders -> ${row(ANN)?.pickup_count}`);
check(row(BOB)?.pickup_count === 0, `pickups are counted as the BUYER (Bob only sold) -> ${row(BOB)?.pickup_count}`);
check(row(DEE) !== undefined && row(DEE).pickup_count === null, `a banned asker has no count -> ${row(DEE)?.pickup_count}`);
check(row(TIA) !== undefined && row(TIA).pickup_count === null, `a test asker has no count -> ${row(TIA)?.pickup_count}`);
check(row(GUS) !== undefined && row(GUS).pickup_count === null, `a deleted (anonymised) asker has no count -> ${row(GUS)?.pickup_count}`);
check(Array.isArray(rows) && rows.length === 5 && row(BLK) === undefined, "the blocked asker's row is still dropped");
check(row(ANN)?.display_name === "Ann S." && row(DEE)?.display_name === "A neighbor", "names unchanged (banned reads A neighbor)");
const other = await list(ANN, I1);
check(!Array.isArray(other) && /item_not_found/.test(other.error), "a non-giver still gets item_not_found");
const grants = (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_free_requests_for_item(uuid)', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.declutter_free_requests_for_item(uuid)', 'EXECUTE') AS auth`)).rows[0];
check(grants.anon === false && grants.auth === true, `grants: anon no, authenticated yes -> ${JSON.stringify(grants)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
