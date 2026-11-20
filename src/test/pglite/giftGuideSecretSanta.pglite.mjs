#!/usr/bin/env node
/**
 * PGlite proof for 20261120062334 (owner 2026-11-20, gift guides fun features): the Secret Santa drawer and the gift
 * planner's account copy.
 *   - secret_santa_create stores only a valid draw: refuses a self-match, a receiver drawn twice, a "can't draw" pair
 *     matched either way, too few or too many names, duplicate names, a bad budget or day; rate limited per address.
 *   - each token opens ONLY its own row (its giver name and its match), a wrong token or another group's code opens
 *     nothing, the stored hash is not the token, and an expired group opens nothing; the cleanup deletes it.
 *   - a test member's group is is_seed; a person attaches a wish list code through their own token only.
 *   - anon and authenticated cannot read the tables; the planner row is the member's own (RLS).
 *
 *   node src/test/pglite/giftGuideSecretSanta.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/giftGuideSecretSanta.pglite.mjs # RED
 *   MUTANT=<name> node ...                                                  # each must FAIL (see MUTANTS)
 *
 * Stubbed, and said so: auth.uid() reads the test.uid setting; is_test_member = a test_accounts list (its own proof:
 * testDataNeverCounts.pglite.mjs); request.headers carries the x-forwarded-for the rate limit reads.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_gift_guide_secret_santa_planner.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANTS = {
  selfMatch: ["OR p_gives_to[i] = i - 1 THEN", "THEN"],
  drawnTwice: ["IF (SELECT count(DISTINCT x) FROM unnest(p_gives_to) x) <> v_n THEN", "IF false THEN"],
  avoidOneWay: ["IF p_gives_to[v_avoid[i] + 1] = v_avoid[j] OR p_gives_to[v_avoid[j] + 1] = v_avoid[i] THEN", "IF p_gives_to[v_avoid[i] + 1] = v_avoid[j] THEN"],
  revealAnyToken: ["     AND me.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')\n     AND g.expires_at > now()\n$fn$;", "     AND g.expires_at > now()\n$fn$;"],
  revealExpired: ["     AND me.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')\n     AND g.expires_at > now()\n$fn$;", "     AND me.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')\n$fn$;"],
  plainToken: ["VALUES (v_code, i - 1, v_names[i], encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_gives_to[i]);", "VALUES (v_code, i - 1, v_names[i], v_token, p_gives_to[i]);"],
  noRateLimit: ["hit_at > now() - interval '1 hour') >= 10", "hit_at > now() - interval '1 hour') >= 100000"],
  seedNotMarked: ["COALESCE(public.is_test_member((SELECT auth.uid())), false), v_expires);", "false, v_expires);"],
  dupNames: ["IF lower(v_name) = ANY (SELECT lower(x) FROM unnest(v_names) x) THEN", "IF false THEN"],
  plannerOpen: ["FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));", "FOR SELECT TO authenticated USING (true);"],
  setListAnyToken: ["     AND me.group_code = p_code\n     AND me.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')\n     AND g.expires_at > now();", "     AND me.group_code = p_code\n     AND g.expires_at > now();"],
  noExpire: ["  DELETE FROM public.secret_santa_groups WHERE expires_at <= now();", "  PERFORM 1;"],
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
const ANN = U(1), BEN = U(2), TEST = U(3);

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_accounts WHERE user_id = p) $f$;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  INSERT INTO auth.users (id) VALUES ('${ANN}'), ('${BEN}'), ('${TEST}');
  INSERT INTO public.test_accounts VALUES ('${TEST}');
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let k = 0; k < 3; k++) await db.exec(mig);
}

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const err = async (sql, params = []) => {
  try { await db.query(sql, params); return null; } catch (e) { return String(e.message); }
};
const setAddr = (ip) => db.exec(`SELECT set_config('request.headers', '{"x-forwarded-for": "${ip}"}', false)`);
const asUid = (uid) => db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);

const NAMES = "ARRAY['Ann','Ben','Cal','Dee']::text[]";
const create = (gives, avoid = "'{}'::int[]", budget = "NULL", day = "NULL", names = NAMES) =>
  `SELECT public.secret_santa_create(${names}, ARRAY[${gives}]::int[], ${avoid}, ${budget}, ${day}) AS r`;

try {
  await setAddr("10.0.0.1");
  await asUid(null);
  // A valid draw: 0->1, 1->2, 2->3, 3->0; Ann and Dee can't draw each other? (0,3): 3 gives to 0, so not that pair.
  const ok = await q(create("1,2,3,0", "ARRAY[0,2]::int[]", "25", "NULL"));
  const g = ok[0]?.r;
  check(g && /^[a-f0-9]{10}$/.test(g.code) && g.tokens.length === 4, "a valid draw is stored: a 10-hex code and 4 tokens");
  check(g && g.tokens.every((t) => /^[a-f0-9]{64}$/.test(t)), "every token is 64 hex characters");

  check(/bad_draw/.test(await err(create("0,2,3,1")) ?? ""), "refuses a self-match (Ann draws Ann)");
  check(/bad_draw/.test(await err(create("1,0,0,2")) ?? ""), "refuses a receiver drawn twice");
  check(/draw_breaks_avoid/.test(await err(create("1,2,3,0", "ARRAY[0,1]::int[]")) ?? ""), "refuses a can't-draw pair matched (Ann gives to Ben)");
  check(/draw_breaks_avoid/.test(await err(create("1,2,3,0", "ARRAY[1,0]::int[]")) ?? ""), "refuses a can't-draw pair matched the other way round");
  check(/bad_avoid/.test(await err(create("1,2,3,0", "ARRAY[0]::int[]")) ?? ""), "refuses half a pair");
  check(/bad_group_size/.test(await err(create("1,0", "'{}'::int[]", "NULL", "NULL", "ARRAY['Ann','Ben']::text[]")) ?? ""), "refuses two names");
  check(/duplicate_name/.test(await err(create("1,2,0", "'{}'::int[]", "NULL", "NULL", "ARRAY['Ann','ann ','Cal']::text[]")) ?? ""), "refuses the same name twice (case and spaces ignored)");
  check(/bad_budget/.test(await err(create("1,2,3,0", "'{}'::int[]", "0")) ?? ""), "refuses a $0 budget");
  check(/bad_date/.test(await err(create("1,2,3,0", "'{}'::int[]", "NULL", "'2000-01-01'::date")) ?? ""), "refuses a day in the past");

  // Reveal: each token opens only its own row.
  const rev = async (code, tok) => (await q(`SELECT public.secret_santa_reveal($1, $2) AS r`, [code, tok]))[0].r;
  const names = ["Ann", "Ben", "Cal", "Dee"];
  const gives = [1, 2, 3, 0];
  let allOwn = true;
  for (let i = 0; i < 4; i++) {
    const r = await rev(g.code, g.tokens[i]);
    if (!r || r.name !== names[i] || r.match !== names[gives[i]] || r.budget !== 25 || r.size !== 4) allOwn = false;
    if (r && Object.keys(r).sort().join(",") !== "budget,exchange_on,match,match_wish_list,my_wish_list,name,size") allOwn = false;
  }
  check(allOwn, "each token opens only its own giver name and match (and the budget), nothing more");
  check((await rev(g.code, "f".repeat(64))) === null, "a wrong token opens nothing");
  check((await rev(g.code, g.tokens[0].slice(0, 63))) === null, "a cut-off token opens nothing");
  const other = (await q(create("2,3,0,1")))[0].r;
  check((await rev(other.code, g.tokens[0])) === null, "a token does not open another group");
  const stored = await q(`SELECT token_hash FROM public.secret_santa_people WHERE group_code = $1`, [g.code]);
  check(stored.every((s) => !g.tokens.includes(s.token_hash)), "the table keeps the hash, never the token");

  // Wish list: through one's own token; the match sees it.
  const setList = async (code, tok, list) => (await q(`SELECT public.secret_santa_set_wish_list($1, $2, $3) AS r`, [code, tok, list]))[0].r;
  check((await setList(g.code, g.tokens[1], "abcde12345")) === true, "Ben attaches his wish list through his own token");
  check((await rev(g.code, g.tokens[0])).match_wish_list === "abcde12345", "Ann (who draws Ben) sees Ben's wish list code");
  check((await rev(g.code, g.tokens[2])).match_wish_list === null, "Cal (who draws Dee) sees no list");
  check((await setList(g.code, "0".repeat(64), "zzzzz99999")) === false, "a wrong token attaches nothing");
  check((await rev(g.code, g.tokens[0])).match_wish_list === "abcde12345", "Ben's list is unchanged by a wrong token");
  check(/bad_wish_list/.test(await err(`SELECT public.secret_santa_set_wish_list($1, $2, 'Bad Code!')`, [g.code, g.tokens[1]]) ?? ""), "refuses a list code that is not one");

  // is_seed: a test member's group.
  await asUid(TEST);
  const t = (await q(create("1,2,3,0")))[0].r;
  check((await q(`SELECT is_seed FROM public.secret_santa_groups WHERE code = $1`, [t.code]))[0].is_seed === true, "a test member's group is is_seed");
  await asUid(ANN);
  const a = (await q(create("1,2,3,0")))[0].r;
  check((await q(`SELECT is_seed FROM public.secret_santa_groups WHERE code = $1`, [a.code]))[0].is_seed === false, "a real member's group is not is_seed");
  await asUid(null);

  // Rate limit: 10 stored groups per address per hour (4 already stored from 10.0.0.1; refused attempts roll back).
  let refused = 0;
  for (let k = 0; k < 7; k++) if (/rate_limited/.test(await err(create("1,2,3,0")) ?? "")) refused++;
  check(refused === 1, `the 11th group from one address in an hour is refused (refused ${refused} of 7)`);
  await setAddr("10.0.0.2");
  check((await err(create("1,2,3,0"))) === null, "another address still may");

  // Expiry: a group past its day opens nothing, and the cleanup deletes it.
  await db.exec(`UPDATE public.secret_santa_groups SET expires_at = now() - interval '1 minute' WHERE code = '${g.code}'`);
  check((await rev(g.code, g.tokens[1])) === null, "an expired group opens nothing");
  const ex = (await q(`SELECT public.secret_santa_expire() AS r`))[0].r;
  check(ex.groups === 1 && (await q(`SELECT count(*)::int AS n FROM public.secret_santa_people WHERE group_code = $1`, [g.code]))[0].n === 0, "the cleanup deletes the expired group and its people");
  const exp = await q(`SELECT (expires_at AT TIME ZONE 'America/Chicago') AS d FROM public.secret_santa_groups WHERE code = $1`, [other.code]);
  const d = new Date(exp[0].d);
  check(d.getUTCMonth() === 0 && d.getUTCDate() === 16, "a new group is kept until Jan 16 (deleted after Jan 15)");

  // Privileges: no browser role reads the Secret Santa tables.
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    const e = await err(`SELECT * FROM public.secret_santa_people`);
    await db.exec(`RESET ROLE`);
    check(e && /permission denied/.test(e), `${role} cannot read secret_santa_people`);
  }

  // Planner: own row only.
  await db.exec(`INSERT INTO public.gift_planner_plans (user_id, plan) VALUES ('${ANN}', '{"people":[]}'), ('${BEN}', '{"people":[{"name":"Mom"}]}')`);
  await asUid(ANN);
  await db.exec(`SET ROLE authenticated`);
  const seen = await q(`SELECT user_id FROM public.gift_planner_plans`);
  const cross = await err(`INSERT INTO public.gift_planner_plans (user_id, plan) VALUES ('${TEST}', '{}')`);
  await db.exec(`RESET ROLE`);
  check(seen.length === 1 && seen[0].user_id === ANN, "a member reads only their own planner");
  check(cross && /row-level security/.test(cross), "a member cannot write another member's planner");
  await asUid(null);
  await db.exec(`SET ROLE anon`);
  const anonPlan = await err(`SELECT * FROM public.gift_planner_plans`);
  await db.exec(`RESET ROLE`);
  check(anonPlan && /permission denied/.test(anonPlan), "anon cannot read planners");
} catch (e) {
  check(false, `threw: ${e.message}`);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
