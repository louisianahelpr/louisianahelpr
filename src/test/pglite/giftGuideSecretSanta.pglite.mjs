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
 *   - secret_santa_cancel (20261121011706, holiday audit C2): only the full set of a group's tokens deletes it (one
 *     person's link, a duplicate, a made-up token, another group's tokens, NULLs, an expired group: no); after a
 *     cancel every old link opens nothing. CANCEL=skip -> RED; MUTANT=cancelOneToken|cancelExpired -> RED.
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
  lowGlobalCap: ["     OR v_hour_total >= 20000 THEN", "     OR v_hour_total >= 300 THEN"],
  dayBucket: ["  v_bucket := md5('secret-santa:' || COALESCE(v_addr, 'no-address'));", "  v_bucket := md5('secret-santa:' || COALESCE(v_addr, 'no-address') || ':' || clock_timestamp()::text);"],
  fullIpv6: ["      v_addr := 'v6net:' || host(network(set_masklen(v_addr::inet, 64)));", "      v_addr := v_addr;"],
  noSurgeLog: ["  IF v_hour_total >= 1000 AND NOT EXISTS (", "  IF false AND NOT EXISTS ("],
  linkNames: ["       OR v_name ~* '(://", "       OR v_name ~* '(NEVER"],
  phoneNames: ["       OR length(regexp_replace(v_name, '[^0-9]', '', 'g')) >= 7 THEN", "       THEN"],
  bigBudget: ["  IF p_budget IS NOT NULL AND (p_budget < 1 OR p_budget > 500) THEN", "  IF p_budget IS NOT NULL AND (p_budget < 1 OR p_budget > 10000) THEN"],
  noExpiryCap: ["  v_expires := least(v_expires, now() + interval '90 days');", "  v_expires := v_expires;"],
  noDayExpiry: ["    v_expires := greatest(v_expires, ((p_exchange_on + 31)::timestamp AT TIME ZONE 'America/Chicago'));", "    v_expires := v_expires;"],
  seedNotMarked: ["COALESCE(public.is_test_member((SELECT auth.uid())), false), v_expires);", "false, v_expires);"],
  dupNames: ["IF lower(v_name) = ANY (SELECT lower(x) FROM unnest(v_names) x) THEN", "IF false THEN"],
  plannerOpen: ["FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));", "FOR SELECT TO authenticated USING (true);"],
  setListAnyToken: ["     AND me.group_code = p_code\n     AND me.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')\n     AND g.expires_at > now();", "     AND me.group_code = p_code\n     AND g.expires_at > now();"],
  noExpire: ["  DELETE FROM public.secret_santa_groups WHERE expires_at <= now();", "  PERFORM 1;"],
};
// Holiday audit C2 (20261121011706): the organizer cancels a draw by presenting EVERY person's token.
const CANCEL_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_secret_santa_cancel.sql"));
if (!CANCEL_FILE) throw new Error("cancel migration not found");
const CANCEL_MUTANTS = {
  cancelOneToken: ["  IF v_matched <> v_size THEN\n    RETURN false;\n  END IF;", "  IF v_matched < 1 THEN\n    RETURN false;\n  END IF;"],
  cancelExpired: [" WHERE g.code = p_code AND g.expires_at > now() FOR UPDATE;", " WHERE g.code = p_code FOR UPDATE;"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
let cancelMig = readFileSync(MIG_DIR + CANCEL_FILE, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const inCancel = MUTANT in CANCEL_MUTANTS;
  const m = inCancel ? CANCEL_MUTANTS[MUTANT] : MUTANTS[MUTANT];
  const src = inCancel ? cancelMig : mig;
  if (!m || src.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  if (inCancel) cancelMig = cancelMig.replace(m[0], m[1]);
  else mig = mig.replace(m[0], m[1]);
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
  CREATE TABLE public.error_logs (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, user_id uuid, severity text, message text,
    tags jsonb, context jsonb, created_at timestamptz NOT NULL DEFAULT now());
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let k = 0; k < 3; k++) await db.exec(mig);
}
// CANCEL=skip: RED for the cancel checks below.
let cancelApplied = 0;
if (process.env.CANCEL !== "skip") {
  for (let k = 0; k < 3; k++) {
    try { await db.exec(cancelMig); cancelApplied++; } catch (e) { console.log(`apply ${CANCEL_FILE} ${k + 1} failed: ${e.message}`); }
  }
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
  check((await setList(g.code, g.tokens[1], "abcde1234567")) === true, "Ben attaches his wish list through his own token");
  check((await rev(g.code, g.tokens[0])).match_wish_list === "abcde1234567", "Ann (who draws Ben) sees Ben's wish list code");
  check((await rev(g.code, g.tokens[2])).match_wish_list === null, "Cal (who draws Dee) sees no list");
  check((await setList(g.code, "0".repeat(64), "zzzzz9999999")) === false, "a wrong token attaches nothing");
  check((await rev(g.code, g.tokens[0])).match_wish_list === "abcde1234567", "Ben's list is unchanged by a wrong token");
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

  // Security review of #4791. Item 5: the window is a rolling hour on the address alone (no day in the bucket): 10 hits
  // 30 minutes ago from 10.0.0.7 (yesterday's date or today's, the same bucket) refuse the next.
  await db.exec(`INSERT INTO public.secret_santa_hits (bucket, hit_at) SELECT md5('secret-santa:10.0.0.7'), now() - interval '30 minutes' FROM generate_series(1, 10)`);
  await setAddr("10.0.0.7");
  check(/rate_limited/.test(await err(create("1,2,3,0")) ?? ""), "the per-address hour is a rolling hour on the address alone");
  // Item 3: an IPv6 /64 is one address: ten different addresses in one /64 fill it, the eleventh is refused.
  let v6refused = 0;
  for (let k = 1; k <= 11; k++) {
    await setAddr(`2001:db8:1:2::${k.toString(16)}`);
    if (/rate_limited/.test(await err(create("1,2,3,0")) ?? "")) v6refused++;
  }
  check(v6refused === 1, `an IPv6 /64 counts as one address (refused ${v6refused} of 11)`);
  await setAddr("2001:db8:1:3::1");
  check((await err(create("1,2,3,0"))) === null, "the next /64 still may");
  // Item 3: no low global refusal; past 1000 in an hour, one warning for the team and the draw still goes ahead.
  await db.exec(`INSERT INTO public.secret_santa_hits (bucket, hit_at) SELECT md5('flood:' || i), now() - interval '5 minutes' FROM generate_series(1, 1200) i`);
  await setAddr("10.0.0.50");
  check((await err(create("1,2,3,0"))) === null, "1200 groups in the hour from other addresses refuse nobody");
  await setAddr("10.0.0.51");
  check((await err(create("1,2,3,0"))) === null, "a second family still may");
  const surge = await q(`SELECT severity, tags->>'kind' AS kind FROM public.error_logs`);
  check(surge.length === 1 && surge[0].severity === "warning" && surge[0].kind === "secret-santa-surge", `one surge warning per hour (${surge.length})`);
  await db.exec(`DELETE FROM public.secret_santa_hits WHERE bucket LIKE '%' AND hit_at < now() - interval '4 minutes'`);

  // Item 4: names that are links, emails or phone numbers are refused; invisible and direction characters stripped.
  await setAddr("10.0.0.60");
  const nm = (n) => create("1,2,0", "'{}'::int[]", "NULL", "NULL", `ARRAY['Ann','Ben',${n}]::text[]`);
  check(/bad_name/.test(await err(nm("'Claim your gift: bit.ly/x'")) ?? ""), "refuses a name with a link");
  check(/bad_name/.test(await err(nm("'https://evil.example'")) ?? ""), "refuses a name with a scheme");
  check(/bad_name/.test(await err(nm("'me@mail.com'")) ?? ""), "refuses an email");
  check(/bad_name/.test(await err(nm("'Call 337-555-0100'")) ?? ""), "refuses a phone number");
  check(/bad_name/.test(await err(nm("'Cal the very long name over thirty chars'")) ?? ""), "refuses a name over 30 characters");
  const inv = (await q(nm(`'Cal' || chr(8238) || chr(8203)`)))[0].r;
  const storedName = (await q(`SELECT name FROM public.secret_santa_people WHERE group_code = $1 AND slot = 2`, [inv.code]))[0].name;
  check(storedName === "Cal", `invisible and direction characters are stripped (${JSON.stringify(storedName)})`);
  check(/check constraint|violates/.test(await err(`INSERT INTO public.secret_santa_people (group_code, slot, name, token_hash, gives_to) VALUES ('${inv.code}', 9, 'x' || chr(8238), '${"e".repeat(64)}', 0)`) ?? ""), "the table itself refuses a direction character");
  check(/bad_budget/.test(await err(create("1,2,3,0", "'{}'::int[]", "501")) ?? ""), "refuses a budget over $500");
  check((await err(create("1,2,3,0", "'{}'::int[]", "500"))) === null, "a $500 budget is fine");

  // Item 7: kept until the later of Jan 15 and the exchange day + 30 days, never more than 90 days after it is made.
  await setAddr("10.0.0.70");
  const expiresFor = async (day) => {
    const r = (await q(create("1,2,3,0", "'{}'::int[]", "NULL", day)))[0].r;
    return new Date((await q(`SELECT expires_at FROM public.secret_santa_groups WHERE code = $1`, [r.code]))[0].expires_at).getTime();
  };
  const nowMs = Date.now();
  const nextJan16 = (await q(`SELECT CASE WHEN make_timestamptz(extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::int, 1, 16, 0, 0, 0, 'America/Chicago') > now()
      THEN make_timestamptz(extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::int, 1, 16, 0, 0, 0, 'America/Chicago')
      ELSE make_timestamptz(extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::int + 1, 1, 16, 0, 0, 0, 'America/Chicago') END AS t`))[0].t;
  const cap = nowMs + 90 * 86400000;
  const noDay = await expiresFor("NULL");
  check(Math.abs(noDay - Math.min(new Date(nextJan16).getTime(), cap)) < 120000, "no exchange day: the coming Jan 16, at most 90 days");
  const far = await expiresFor("(now() AT TIME ZONE 'America/Chicago')::date + 80");
  check(Math.abs(far - cap) < 120000, "an exchange day 80 days out: capped at 90 days after it was made");
  check(/bad_date/.test(await err(create("1,2,3,0", "'{}'::int[]", "NULL", "(now() AT TIME ZONE 'America/Chicago')::date + 95")) ?? ""), "refuses an exchange day past the 90 days");

  // Cancel (holiday audit C2): only the organizer, who holds every token, can turn a draw off before a redraw.
  check(cancelApplied === 3, `${CANCEL_FILE} applies 3 times (replay-safe)`);
  await setAddr("10.0.0.80");
  const c = (await q(create("1,2,3,0")))[0].r;
  const cancel = async (code, toks) => (await q(`SELECT public.secret_santa_cancel($1, $2::text[]) AS r`, [code, toks]))[0].r;
  check((await cancel(c.code, [c.tokens[0]])) === false, "one person's own link cannot cancel the draw");
  check((await cancel(c.code, [c.tokens[0], c.tokens[1], c.tokens[2]])) === false, "three of four tokens cannot cancel the draw");
  check((await cancel(c.code, [c.tokens[0], c.tokens[0], c.tokens[1], c.tokens[2]])) === false, "a token given twice does not count as two people");
  check((await cancel(c.code, [c.tokens[0], c.tokens[1], c.tokens[2], "f".repeat(64)])) === false, "a made-up token cannot stand in for a person");
  check((await cancel(other.code, c.tokens)) === false, "one group's tokens cannot cancel another group");
  check((await cancel(c.code, null)) === false && (await cancel(null, c.tokens)) === false, "a NULL code or token list cancels nothing");
  const twoD = (await q(`SELECT public.secret_santa_cancel($1, ARRAY[[$2, $3], [$4, $2], [$3, $4]]::text[]) AS r`, [c.code, c.tokens[0], c.tokens[1], c.tokens[2]]))[0].r;
  check(twoD === false, "a 2-D token array cancels nothing (lh-authz-rls note)");
  check((await rev(c.code, c.tokens[2]))?.match === "Dee", "after the refused cancels, every link still works");
  const exp = (await q(create("1,2,3,0")))[0].r;
  await db.exec(`UPDATE public.secret_santa_groups SET expires_at = now() - interval '1 minute' WHERE code = '${exp.code}'`);
  check((await cancel(exp.code, exp.tokens)) === false, "an expired group is not cancelled (the cleanup removes it)");
  await db.exec(`DELETE FROM public.secret_santa_groups WHERE code = '${exp.code}'`);
  check((await cancel(c.code, c.tokens)) === true, "the organizer, holding every token, cancels the draw");
  check((await rev(c.code, c.tokens[0])) === null && (await rev(c.code, c.tokens[3])) === null, "after a cancel, every old link opens nothing");
  check((await q(`SELECT count(*)::int AS n FROM public.secret_santa_people WHERE group_code = $1`, [c.code]))[0].n === 0, "the cancelled group's people are deleted with it");
  check((await cancel(c.code, c.tokens)) === false, "cancelling twice is a no-op");
  const cacl = (await q(`SELECT coalesce(array_to_string(proacl, ','), '') AS a, prosecdef FROM pg_proc WHERE oid = 'public.secret_santa_cancel(text,text[])'::regprocedure`))[0];
  check(/(^|,)anon=X/.test(cacl.a) && !/(^|,)=X/.test(cacl.a) && cacl.prosecdef === true, `secret_santa_cancel: anon may run it (signed-out drawer), PUBLIC may not (${cacl.a})`);

  // Expiry: a group past its day opens nothing, and the cleanup deletes it.
  await db.exec(`UPDATE public.secret_santa_groups SET expires_at = now() - interval '1 minute' WHERE code = '${g.code}'`);
  check((await rev(g.code, g.tokens[1])) === null, "an expired group opens nothing");
  const ex = (await q(`SELECT public.secret_santa_expire() AS r`))[0].r;
  check(ex.groups === 1 && (await q(`SELECT count(*)::int AS n FROM public.secret_santa_people WHERE group_code = $1`, [g.code]))[0].n === 0, "the cleanup deletes the expired group and its people");

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
