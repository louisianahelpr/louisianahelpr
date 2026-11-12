#!/usr/bin/env node
/**
 * PGlite proof for 20261112002528 (F359d, owner 11-11 ~5:00 PM): the seller's completed pickup COUNT.
 *   - declutter_seller_pickup_count(seller): signed-in callers only; counts the seller's handed_over orders, leaving out
 *     test orders (is_seed), test buyers (is_test_member), the seller's own second account (same phone) and every
 *     other status; NULL for a seller who is not a public member or is a test member. An integer, nothing else.
 *   - declutter_guest_seller_card(item): the same count as a fifth field; the WHERE (who a guest may see) unchanged.
 *
 *   node src/test/pglite/declutterSellerPickupCount.pglite.mjs                    # after (3x replay): ALL PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerPickupCount.pglite.mjs # the before: must FAIL
 *   MUTANT=anyStatus|seedOrder|testBuyer|samePerson|testSeller|noCaller|guestAnyStatus|guestTestBuyer node ...  # each must FAIL
 *
 * World: profiles, declutter_items, declutter_orders and test_accounts with the columns read; member_display_name,
 * is_test_member and profile_review_same_person VERBATIM from their newest migrations; the guest card's own
 * migration (20261111205821) applied first, as on prod; declutter_open_to_guests, get_public_profile_stats and
 * normalize_phone_for_ban stubbed.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_seller_pickup_count.sql"));
if (!THIS) throw new Error("migration not found");
const fnFrom = (file, head, end = "$fn$;") => {
  const text = readFileSync(MIG_DIR + file, "utf8");
  const s = text.indexOf(head);
  if (s < 0) throw new Error(`${head} not found in ${file}`);
  return text.slice(s, text.indexOf(end, s) + end.length);
};
const memberDisplayName = fnFrom("20261021131322_member_names_first_and_initial.sql", "CREATE OR REPLACE FUNCTION public.member_display_name");
const isTestMember = fnFrom("20261030015205_test_data_never_counts.sql", "CREATE OR REPLACE FUNCTION public.is_test_member");
const samePerson = fnFrom("20261105165059_public_profile_full.sql", "CREATE OR REPLACE FUNCTION public.profile_review_same_person", "$function$;");
const guestCardBefore = readFileSync(MIG_DIR + "20261111205821_declutter_guest_seller_card.sql", "utf8");

const PICK = "  SELECT (SELECT count(*)::integer";
const MUTANTS = {
  anyStatus: ["           WHERE o.seller_id = p.user_id\n             AND o.status = 'handed_over'", "           WHERE o.seller_id = p.user_id"],
  seedOrder: ["             AND o.is_seed IS NOT TRUE\n             AND o.buyer_id IS NOT NULL\n             AND NOT public.is_test_member(o.buyer_id)\n             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id))\n    FROM public.profiles p",
              "             AND o.buyer_id IS NOT NULL\n             AND NOT public.is_test_member(o.buyer_id)\n             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id))\n    FROM public.profiles p"],
  testBuyer: ["             AND NOT public.is_test_member(o.buyer_id)\n             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id))\n    FROM public.profiles p",
              "             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id))\n    FROM public.profiles p"],
  samePerson: ["             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id))\n    FROM public.profiles p", ")\n    FROM public.profiles p"],
  testSeller: ["     AND p.is_seed IS NOT TRUE\n     AND NOT public.is_test_member(p.user_id);", ";"],
  noCaller: ["     AND (SELECT auth.uid()) IS NOT NULL\n", ""],
  guestAnyStatus: ["           WHERE o.seller_id = p.user_id\n             AND o.status = 'handed_over'\n             AND o.is_seed IS NOT TRUE\n             AND o.buyer_id IS NOT NULL\n             AND NOT public.is_test_member(o.buyer_id)\n             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id)) AS pickup_count",
                   "           WHERE o.seller_id = p.user_id\n             AND o.is_seed IS NOT TRUE\n             AND o.buyer_id IS NOT NULL\n             AND NOT public.is_test_member(o.buyer_id)\n             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id)) AS pickup_count"],
  guestTestBuyer: ["             AND NOT public.is_test_member(o.buyer_id)\n             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id)) AS pickup_count",
                   "             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id)) AS pickup_count"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (!mig.includes(PICK)) throw new Error("count select not found");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const ANN = U(1), BOB = U(2), BANNED = U(3), LISTED = U(4), SEEDP = U(5), GONE = U(6);
const B1 = U(11), B2 = U(12), B3 = U(13), TESTB = U(14), SEEDB = U(15), ANN2 = U(16);
const I = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const O = (n) => `33333333-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
  CREATE FUNCTION public.declutter_open_to_guests() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
  GRANT EXECUTE ON FUNCTION public.declutter_open_to_guests() TO anon, authenticated;
  CREATE FUNCTION public.normalize_phone_for_ban(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') $f$;
  CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, full_name text, email text, phone text, avatar_url text,
    idv_status text, email_verified boolean NOT NULL DEFAULT true, ban_status text, anonymized_at timestamptz,
    is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
  CREATE TABLE public.declutter_items (
    id uuid PRIMARY KEY, seller_id uuid, status text, seller_hidden boolean NOT NULL DEFAULT false,
    is_seed boolean NOT NULL DEFAULT false);
  REVOKE ALL ON public.declutter_items FROM PUBLIC, anon, authenticated;
  CREATE TABLE public.declutter_orders (
    id uuid PRIMARY KEY, seller_id uuid, buyer_id uuid, status text NOT NULL, is_seed boolean NOT NULL DEFAULT false,
    handed_over_at timestamptz, total_cents integer NOT NULL DEFAULT 0);
  REVOKE ALL ON public.declutter_orders FROM PUBLIC, anon, authenticated;
  CREATE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
    RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric)
    LANGUAGE sql STABLE AS $f$ SELECT u, 0, NULL::numeric FROM unnest(p_user_ids) u $f$;
  REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC, anon;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  INSERT INTO public.test_accounts VALUES ('${LISTED}'), ('${TESTB}');
  ${isTestMember}
  REVOKE ALL ON FUNCTION public.is_test_member(uuid) FROM PUBLIC, anon, authenticated;
  ${memberDisplayName}
  REVOKE ALL ON FUNCTION public.member_display_name(text, text) FROM PUBLIC, anon;
  ${samePerson}
  REVOKE ALL ON FUNCTION public.profile_review_same_person(uuid, uuid) FROM PUBLIC, anon, authenticated;
  INSERT INTO public.profiles (user_id, full_name, email, phone, ban_status, anonymized_at, is_seed) VALUES
    ('${ANN}', 'Ann Savoie', 'ann@example.com', '+1 (337) 555-0101', NULL, NULL, false),
    ('${BOB}', 'Bob Guidry', 'bob@example.com', '+13375550102', NULL, NULL, false),
    ('${BANNED}', 'Carl Banned', 'c@example.com', NULL, 'permanently_banned', NULL, false),
    ('${LISTED}', 'Gus Listed', 'g@example.com', NULL, NULL, NULL, false),
    ('${SEEDP}', 'Fay Seed', 'f@example.com', NULL, NULL, NULL, true),
    ('${GONE}', 'Eve Gone', 'e@example.com', NULL, NULL, now(), false),
    ('${B1}', 'Buyer One', 'b1@example.com', '+13375550111', NULL, NULL, false),
    ('${B2}', 'Buyer Two', 'b2@example.com', NULL, NULL, NULL, false),
    ('${B3}', 'Buyer Three', 'b3@example.com', NULL, NULL, NULL, false),
    ('${TESTB}', 'Test Buyer', 'tb@example.com', NULL, NULL, NULL, false),
    ('${SEEDB}', 'Seed Buyer', 'sb@example.com', NULL, NULL, NULL, true),
    ('${ANN2}', 'Ann Second', 'ann2@example.com', '+1 337 555 0101', NULL, NULL, false);
  INSERT INTO public.declutter_items (id, seller_id, status) VALUES
    ('${I(1)}', '${ANN}', 'live'), ('${I(2)}', '${BOB}', 'live'), ('${I(3)}', '${LISTED}', 'live'), ('${I(4)}', '${ANN}', 'sold');
  INSERT INTO public.declutter_orders (id, seller_id, buyer_id, status, is_seed, handed_over_at) VALUES
    ('${O(1)}', '${ANN}', '${B1}', 'handed_over', false, now() - interval '3 days'),   -- counts
    ('${O(2)}', '${ANN}', '${B2}', 'handed_over', false, now() - interval '20 days'),  -- counts
    ('${O(3)}', '${ANN}', '${B3}', 'handed_over', false, now()),                       -- counts (a free pickup is an order too)
    ('${O(4)}', '${ANN}', '${B1}', 'paid', false, NULL),                               -- not handed over yet
    ('${O(5)}', '${ANN}', '${B2}', 'refunded', false, NULL),                           -- refunded
    ('${O(6)}', '${ANN}', '${B3}', 'expired', false, NULL),
    ('${O(7)}', '${ANN}', '${B1}', 'awaiting_payment', false, NULL),
    ('${O(8)}', '${ANN}', '${B2}', 'handed_over', true, now()),                        -- a test order
    ('${O(9)}', '${ANN}', '${TESTB}', 'handed_over', false, now()),                    -- a buyer in test_accounts
    ('${O(10)}', '${ANN}', '${SEEDB}', 'handed_over', false, now()),                   -- an is_seed buyer
    ('${O(11)}', '${ANN}', '${ANN2}', 'handed_over', false, now()),                    -- Ann's own second account (same phone)
    ('${O(12)}', '${ANN}', NULL, 'handed_over', false, now()),                         -- a buyer whose account is gone
    ('${O(13)}', '${LISTED}', '${B1}', 'handed_over', false, now()),                   -- a test seller's sale
    ('${O(14)}', '${BANNED}', '${B1}', 'handed_over', false, now());
`);
// As on prod: the guest card exists before this migration.
await db.exec(guestCardBefore);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

async function as(role, uid, sql) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', true);`);
    const r = await db.query(sql);
    await db.exec("COMMIT");
    return { rows: r.rows, fields: r.fields.map((f) => f.name) };
  } catch (e) {
    await db.exec("ROLLBACK");
    return { error: String(e.message ?? e) };
  }
}
const count = (seller, uid = BOB, role = "authenticated") => as(role, uid, `SELECT public.declutter_seller_pickup_count('${seller}') AS n`);

const ann = await count(ANN);
check(!ann.error && ann.rows[0]?.n === 3, `Ann: 3 completed handovers (no test order, test buyer, own account, gone buyer or other status) -> ${ann.error ?? ann.rows[0]?.n}`);
check(!ann.error && JSON.stringify(ann.fields) === '["n"]' && Number.isInteger(ann.rows[0]?.n), `a bare integer, no dates, items or names -> ${ann.error ?? JSON.stringify(ann.rows)}`);
const self = await count(ANN, ANN);
check(!self.error && self.rows[0]?.n === 3, `the seller sees the same number -> ${self.error ?? self.rows[0]?.n}`);
const bob = await count(BOB, ANN);
check(!bob.error && bob.rows[0]?.n === 0, `a seller with no handovers -> 0 -> ${bob.error ?? bob.rows[0]?.n}`);
for (const [who, why] of [[LISTED, "a seller in test_accounts"], [SEEDP, "an is_seed seller"], [BANNED, "a banned seller"], [GONE, "a deleted seller"], ["11111111-0000-0000-0000-000000000099", "an unknown id"]]) {
  const x = await count(who);
  check(!x.error && x.rows[0]?.n === null, `no count: ${why} -> ${x.error ?? x.rows[0]?.n}`);
}
const nosub = await count(ANN, null);
check(!nosub.error && nosub.rows[0]?.n === null, `authenticated with no caller id -> NULL -> ${nosub.error ?? nosub.rows[0]?.n}`);
const anon = await count(ANN, null, "anon");
check(/permission denied/.test(anon.error ?? ""), `anon cannot call the member count -> ${anon.error ?? "ALLOWED"}`);

const guest = await as("anon", null, `SELECT * FROM public.declutter_guest_seller_card('${I(1)}')`);
check(!guest.error && JSON.stringify(guest.fields) === JSON.stringify(["display_name", "avg_rating", "review_count", "id_checked", "pickup_count"]),
  `the guest card: the four fields plus pickup_count, nothing else -> ${guest.error ?? guest.fields.join(",")}`);
check(!guest.error && guest.rows[0]?.pickup_count === 3 && guest.rows[0]?.display_name === "Ann S.", `a guest sees Ann's 3 pickups -> ${guest.error ?? JSON.stringify(guest.rows[0])}`);
const gbob = await as("anon", null, `SELECT pickup_count FROM public.declutter_guest_seller_card('${I(2)}')`);
check(!gbob.error && gbob.rows[0]?.pickup_count === 0, `a guest sees 0 for Bob -> ${gbob.error ?? JSON.stringify(gbob.rows)}`);
for (const [item, why] of [[I(3), "a test seller's listing"], [I(4), "a sold listing"]]) {
  const x = await as("anon", null, `SELECT * FROM public.declutter_guest_seller_card('${item}')`);
  check(!x.error && x.rows.length === 0, `still no guest card: ${why} -> ${x.error ?? x.rows.length}`);
}
const body = JSON.stringify(guest.rows ?? []);
for (const secret of [ANN, B1, "Buyer", "Savoie", "handed_over", "ann@example.com"]) check(!body.includes(secret), `the guest card holds no "${secret}"`);

const direct = await as("authenticated", BOB, "SELECT count(*) FROM public.declutter_orders");
check(/permission denied/.test(direct.error ?? ""), `members still cannot read orders directly -> ${direct.error ?? "ALLOWED"}`);
const acl = (await db.query(`SELECT to_regprocedure('public.declutter_seller_pickup_count(uuid)') IS NULL AS gone`)).rows[0].gone ? {}
  : (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_seller_pickup_count(uuid)', 'EXECUTE') AS anon,
       has_function_privilege('authenticated', 'public.declutter_seller_pickup_count(uuid)', 'EXECUTE') AS auth,
       has_function_privilege('anon', 'public.declutter_guest_seller_card(uuid)', 'EXECUTE') AS guest,
       (SELECT prosecdef FROM pg_proc WHERE proname = 'declutter_seller_pickup_count') AS definer`)).rows[0];
check(acl.anon === false && acl.auth === true && acl.guest === true && acl.definer === true, `grants: member count authenticated only, guest card anon, SECURITY DEFINER -> ${JSON.stringify(acl)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
