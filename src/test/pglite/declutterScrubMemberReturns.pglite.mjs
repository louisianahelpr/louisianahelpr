#!/usr/bin/env node
/**
 * PGlite proof for 20261102035139_declutter_scrub_member_returns (Q1933): at account deletion, declutter_scrub_member
 * also clears the deleted buyer's return address, words and photos on their settled refund requests, and the words and
 * photos a deleted member wrote as the OTHER side of a problem; everything it cleared before still clears, and rows of
 * members who stay are untouched.
 *
 *   node src/test/pglite/declutterScrubMemberReturns.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterScrubMemberReturns.pglite.mjs # RED: the old scrub leaves them
 *   MUTANT=<name> node src/test/pglite/declutterScrubMemberReturns.pglite.mjs      # a planted defect: must FAIL
 *
 * Real: declutter_scrub_member's previous body (its newest CREATE before this file) for the RED run, and the
 * return-way CHECK copied from 20261030071818. Stubbed, said so: declutter_orders, declutter_handovers,
 * declutter_order_deliveries, helpr_tasks, declutter_reviews, declutter_problems and declutter_refund_requests reduced
 * to the columns the scrub reads. Supabase's default anon/authenticated EXECUTE grant on new functions is emulated.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102035139_declutter_scrub_member_returns.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The return address is kept.
  keepAddress: ["         return_address = NULL, return_lat = NULL, return_lng = NULL\n", "         return_lat = return_lat\n"],
  // The SELLER's leaving scrubs the buyer's request too.
  eitherParty: ["   WHERE q.order_id = o.id AND o.buyer_id = p_user_id\n", "   WHERE q.order_id = o.id AND (o.buyer_id = p_user_id OR o.seller_id = p_user_id)\n"],
  // The other-side answer is left.
  keepOtherSide: ["     SET other_side_note = NULL, other_side_photo_paths = '{}'\n", "     SET other_side_note = other_side_note\n"],
  // The reporter's leaving wipes the other party's answer.
  reporterWipesAnswer: ["     AND p.reporter_id IS DISTINCT FROM p_user_id\n", "     AND true\n"],
  // The old delivery-row scrub dropped in the restate.
  lostDelivery: ["   WHERE d.order_id = o.id AND o.buyer_id = p_user_id AND d.dropoff_address IS DISTINCT FROM 'Removed: account deleted';", "   WHERE false;"],
};
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `cccccccc-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), STAY_B = U(3), STAY_S = U(4);
const O1 = U(10), O2 = U(11), O3 = U(12);
const REMOVED = "Removed: this member deleted their account.";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid);
CREATE TABLE public.declutter_handovers (order_id uuid, set_out_note text);
CREATE TABLE public.declutter_order_deliveries (order_id uuid PRIMARY KEY, dropoff_address text NOT NULL, dropoff_area text NOT NULL,
  dropoff_lat numeric NOT NULL, dropoff_lng numeric NOT NULL);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, customer_id uuid, pickup_contact_id uuid,
  pickup_address text NOT NULL, pickup_area text NOT NULL, pickup_lat numeric NOT NULL, pickup_lng numeric NOT NULL,
  dropoff_address text NOT NULL, dropoff_area text NOT NULL, dropoff_lat numeric NOT NULL, dropoff_lng numeric NOT NULL);
CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reviewer_id uuid, stars int, comment text, tags text[] NOT NULL DEFAULT '{}');
CREATE TABLE public.declutter_problems (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, reporter_id uuid,
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 1000), photo_paths text[] NOT NULL DEFAULT '{}',
  other_side_note text CHECK (other_side_note IS NULL OR char_length(btrim(other_side_note)) BETWEEN 1 AND 1000),
  other_side_photo_paths text[] NOT NULL DEFAULT '{}', decision text);
CREATE TABLE public.declutter_refund_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE,
  status text NOT NULL, note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 1000),
  photo_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_paths) <= 3), refund_cents integer,
  return_way text, return_day date, return_at timestamptz, return_address text, return_lat numeric, return_lng numeric,
  return_photo_path text, return_dropped_off_at timestamptz,
  CONSTRAINT declutter_refund_requests_return_way CHECK (
    CASE
      WHEN return_way IS NULL THEN return_day IS NULL AND return_at IS NULL AND return_address IS NULL AND return_lat IS NULL
                     AND return_lng IS NULL AND return_photo_path IS NULL AND return_dropped_off_at IS NULL
      WHEN return_way = 'drop_off' THEN return_day IS NOT NULL AND return_at IS NULL AND return_address IS NULL
                     AND return_lat IS NULL AND return_lng IS NULL
                     AND ((return_photo_path IS NULL) = (return_dropped_off_at IS NULL))
      WHEN return_way = 'collect' THEN return_day IS NOT NULL AND return_at IS NOT NULL
                     AND ((return_address IS NULL) = (return_lat IS NULL)) AND ((return_lat IS NULL) = (return_lng IS NULL))
                     AND (return_address IS NULL OR char_length(btrim(return_address)) BETWEEN 1 AND 300)
                     AND (return_lat IS NULL OR (return_lat BETWEEN -90 AND 90 AND return_lng BETWEEN -180 AND 180))
                     AND return_photo_path IS NULL AND return_dropped_off_at IS NULL
      ELSE false
    END));
`);
await db.exec(definitionBefore("declutter_scrub_member", THIS));
await db.exec(`REVOKE ALL ON FUNCTION public.declutter_scrub_member(uuid) FROM PUBLIC, anon, authenticated;`);

if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const one = async (s, p = []) => (await q(s, p))[0];
// O1: BUYER bought from SELLER; a settled collect return with the buyer's address, words and photos; a problem the
// SELLER reported that the buyer answered; a delivery row. O2: STAY_B bought from BUYER (BUYER is the seller there);
// STAY_B's request and a problem BUYER reported, answered by STAY_B. O3: two members who stay.
await q(`INSERT INTO public.declutter_orders VALUES ($1, $2, $3), ($4, $5, $2), ($6, $5, $7)`, [O1, BUYER, SELLER, O2, STAY_B, O3, STAY_S]);
await q(`INSERT INTO public.declutter_order_deliveries VALUES ($1, '12 Home St', 'Mid City', 30.45, -91.18)`, [O1]);
await q(`INSERT INTO public.declutter_refund_requests (order_id, status, note, photo_paths, refund_cents, return_way, return_day, return_at,
  return_address, return_lat, return_lng) VALUES
  ($1, 'agreed', 'Arrived cracked', '{a.jpg,b.jpg}', 2500, 'collect', current_date, now(), '12 Home St, Baton Rouge', 30.45, -91.18),
  ($2, 'agreed', 'Wrong size', '{c.jpg}', 1000, 'collect', current_date, now(), '9 Stay Ave', 30.40, -91.10),
  ($3, 'declined', 'Not what I wanted', '{}', NULL, NULL, NULL, NULL, NULL, NULL, NULL)`, [O1, O2, O3]);
await q(`INSERT INTO public.declutter_problems (order_id, reporter_id, note, other_side_note, other_side_photo_paths, decision) VALUES
  ($1, $2, 'Buyer never came', 'I came at 5, nobody there', '{d.jpg}', 'seller_fault'),
  ($3, $4, 'Buyer kept it', 'I returned it on time', '{e.jpg}', 'no_fault')`, [O1, SELLER, O2, BUYER]);

const rep = await one(`SELECT public.declutter_scrub_member($1) AS r`, [BUYER]);
const r1 = await one(`SELECT * FROM public.declutter_refund_requests WHERE order_id = $1`, [O1]);
check(r1.return_address === null && r1.return_lat === null && r1.return_lng === null,
  `[fix] the deleted buyer's return address and point are cleared (${r1.return_address})`);
check(r1.note === REMOVED && r1.photo_paths.length === 0, `[fix] and their request's words and photos (${r1.note})`);
check(r1.status === "agreed" && r1.refund_cents === 2500 && r1.return_way === "collect", "the request keeps its outcome and money");
const p1 = await one(`SELECT * FROM public.declutter_problems WHERE order_id = $1`, [O1]);
check(p1.other_side_note === null && p1.other_side_photo_paths.length === 0, `[fix] the buyer's answer to the seller's report is cleared (${p1.other_side_note})`);
check(p1.note === "Buyer never came" && p1.decision === "seller_fault", "the staying reporter's words and the decision stay");
const p2 = await one(`SELECT * FROM public.declutter_problems WHERE order_id = $1`, [O2]);
check(p2.other_side_note === "I returned it on time" && p2.other_side_photo_paths.length === 1,
  "a staying member's answer to the leaving member's report stays");
check(p2.note === REMOVED, "the leaving reporter's own words still go (as before)");
const r2 = await one(`SELECT * FROM public.declutter_refund_requests WHERE order_id = $1`, [O2]);
check(r2.return_address === "9 Stay Ave" && r2.note === "Wrong size", "a staying buyer's request on the leaving member's sale is untouched");
const r3 = await one(`SELECT * FROM public.declutter_refund_requests WHERE order_id = $1`, [O3]);
check(r3.note === "Not what I wanted", "a sale between two members who stay is untouched");
const d1 = await one(`SELECT dropoff_address FROM public.declutter_order_deliveries WHERE order_id = $1`, [O1]);
check(d1.dropoff_address === "Removed: account deleted", "the delivery-row address still clears (restated verbatim)");
check(skip || (rep.r.refund_requests_scrubbed === 1 && rep.r.problem_answers_scrubbed === 1), `[fix] the report counts them (${JSON.stringify(rep.r)})`);
const again = await one(`SELECT public.declutter_scrub_member($1) AS r`, [BUYER]);
check(skip || (again.r.refund_requests_scrubbed === 0 && again.r.problem_answers_scrubbed === 0), "a second run changes nothing");

const acl = await one(`SELECT has_function_privilege('anon', 'public.declutter_scrub_member(uuid)', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.declutter_scrub_member(uuid)', 'EXECUTE') u,
  has_function_privilege('service_role', 'public.declutter_scrub_member(uuid)', 'EXECUTE') s`);
check(!acl.a && !acl.u && acl.s, `grants: anon ${acl.a} authenticated ${acl.u} service ${acl.s}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
