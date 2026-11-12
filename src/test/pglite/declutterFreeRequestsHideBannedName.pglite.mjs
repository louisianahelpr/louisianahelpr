#!/usr/bin/env node
/**
 * PGlite proof for 20261112023218 (b1e review should-fix): the seller's free-item request list
 * (declutter_free_requests_for_item) no longer shows a BANNED requester's name: across a ban on either side (and a block,
 * whose row is already dropped) the name reads "A neighbor". A clean requester is still named; the row stays.
 *
 *   node src/test/pglite/declutterFreeRequestsHideBannedName.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFreeRequestsHideBannedName.pglite.mjs # RED: the previous body
 *   MUTANT=noHide|oneSide node ...                                                          # each must FAIL
 *
 * World: the PREVIOUS declutter_free_requests_for_item (20261103044956) created first, declutter_names_hidden VERBATIM
 * from 20261112010100, member_display_name VERBATIM from 20261021131322, then this migration 3x. Stubbed, and said so:
 * are_users_blocked reads user_blocks either way; get_public_profile_stats returns no rows.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_free_requests_hide_banned_requester_name.sql"));
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
const prev = fnFrom("20261103044956_shop_settings_declutter_wanted_not_found_is_404.sql", "CREATE OR REPLACE FUNCTION public.declutter_free_requests_for_item(");

const MUTANTS = {
  noHide: ["           CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) THEN 'A neighbor'\n", "           CASE WHEN false THEN 'A neighbor'\n"],
  oneSide: ["           CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) THEN 'A neighbor'\n", "           CASE WHEN public.declutter_names_hidden(v_uid, v_uid) THEN 'A neighbor'\n"],
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
// SAM gives away. ANN: clean. DEE: banned. TIM: temp ban that ran out (named). BOB: SAM blocked him (row dropped).
const SAM = U(1), ANN = U(2), DEE = U(3), TIM = U(4), BOB = U(5), PAT = U(6);
const I1 = "22222222-0000-0000-0000-000000000001", I2 = "22222222-0000-0000-0000-000000000002";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, ban_status text, auto_suspended_until timestamptz);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid);
  CREATE TABLE public.declutter_free_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, requester_id uuid,
    status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT clock_timestamp(), pickup_at timestamptz);
  CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.user_blocks x WHERE (x.blocker_id = a AND x.blocked_id = b) OR (x.blocker_id = b AND x.blocked_id = a)) $f$;
  CREATE FUNCTION public.get_public_profile_stats(ids uuid[]) RETURNS TABLE(avg_rating numeric, review_count integer) LANGUAGE sql STABLE AS
    $f$ SELECT NULL::numeric, NULL::integer WHERE false $f$;
  ${memberDisplayName}
  ${namesHidden}
  INSERT INTO public.profiles (user_id, full_name, ban_status, auto_suspended_until) VALUES
    ('${SAM}', 'Sam Seller', NULL, NULL), ('${ANN}', 'Ann Savoie', NULL, NULL), ('${DEE}', 'Dee Dupre', 'banned', NULL),
    ('${TIM}', 'Tim Thibodeaux', 'temp_banned', now() - interval '1 day'), ('${BOB}', 'Bob Boudreaux', NULL, NULL),
    ('${PAT}', 'Pat Prejean', 'temp_banned', now() + interval '1 day');
  INSERT INTO public.user_blocks VALUES ('${SAM}', '${BOB}');
  INSERT INTO public.declutter_items VALUES ('${I1}', '${SAM}'), ('${I2}', '${PAT}');
  INSERT INTO public.declutter_free_requests (item_id, requester_id) VALUES
    ('${I1}', '${ANN}'), ('${I1}', '${DEE}'), ('${I1}', '${TIM}'), ('${I1}', '${BOB}'), ('${I1}', '${PAT}'), ('${I2}', '${ANN}');
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
  try { return (await db.query(`SELECT requester_id, display_name FROM public.declutter_free_requests_for_item('${item}')`)).rows; }
  catch (e) { return { error: String(e.message ?? e) }; }
};
const rows = await list(SAM, I1);
const nameOf = (u) => (Array.isArray(rows) ? rows.find((r) => r.requester_id === u)?.display_name : undefined);
check(nameOf(ANN) === "Ann S.", `a clean requester is named -> ${nameOf(ANN)}`);
check(nameOf(DEE) === "A neighbor", `a banned requester reads "A neighbor" -> ${nameOf(DEE)}`);
check(nameOf(PAT) === "A neighbor", `a requester on a live temp ban reads "A neighbor" -> ${nameOf(PAT)}`);
check(nameOf(TIM) === "Tim T.", `a temp ban that ran out is named again -> ${nameOf(TIM)}`);
check(Array.isArray(rows) && rows.length === 4 && nameOf(BOB) === undefined, "the blocked requester's row is still dropped; the banned rows stay");
// A banned seller sees no requester's name.
const pat = await list(PAT, I2);
check(Array.isArray(pat) && pat.length === 1 && pat[0].display_name === "A neighbor", `a banned seller sees "A neighbor" -> ${JSON.stringify(pat)}`);
check(JSON.stringify(rows).search(/Dee|Pat|Bob/) < 0, "no banned or blocked requester's name in the list");
const other = await list(ANN, I1);
check(!Array.isArray(other) && /item_not_found/.test(other.error), "a non-seller still gets item_not_found");

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
