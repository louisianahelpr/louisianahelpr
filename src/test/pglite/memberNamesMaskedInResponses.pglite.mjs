#!/usr/bin/env node
/**
 * PGlite proof for 20261021131322_member_names_first_and_initial.sql: members never see each other's
 * last names, not even in a network response.
 *
 *   node src/test/pglite/memberNamesMaskedInResponses.pglite.mjs
 *   LH_PROOF_REVERT=1 node src/test/pglite/memberNamesMaskedInResponses.pglite.mjs   # must FAIL
 *
 * The migration is applied 3x (replay-safety), then:
 *  1. formatName parity: member_display_name(x, NULL) is formatName(x) (src/lib/utils.ts, imported, not
 *     copied) for fixed cases (spaces, tabs, newlines, no-break and ideographic spaces, U+FEFF, U+0085,
 *     a single name, an empty name, hyphenated and multi-part names, accents, Arabic, CJK, an emoji
 *     initial) and 600 generated names; the whitespace set is compared code point by code point over the
 *     whole BMP; formatName(sql(x)) === formatName(x) and sql(sql(x)) === sql(x) for every case, so an
 *     installed client that formats the value again still shows "First L.".
 *  2. every inventoried reader, run under the real roles (SET ROLE + JWT claims):
 *       get_safe_profiles, search_profiles_by_name, get_my_saved_helpers, get_quotes_for_request,
 *       get_public_profile_reviews, helpr_task_view, nudge_confirm, record_backout_notice,
 *       notify_message_recipient
 *     member A reading B gets "Bea T." (or "Bea" where the reader shows a first name only); A reading A
 *     gets A's full name; an admin and the service role get B's full name; anon gets "Bea T.".
 *     A member searching B's surname finds nobody; an admin does.
 *  3. grants: display_name_for_viewer has no EXECUTE for PUBLIC, anon or authenticated; each restated
 *     function's ACL is what prod had.
 * Red: LH_PROOF_REVERT=1 re-creates the ten functions as they were before this migration (their
 * effective definitions), and the proof fails.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import { formatName } from "../../lib/utils.ts"; // Node >= 23 strips the types; the real function, not a copy

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261021131322_member_names_first_and_initial.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
/**
 * md5(prosrc) on prod, 2026-10-21, before this migration. The definition loaded below is the newest
 * CREATE before this file; the hash proves it is what prod runs (no later rewrite changed it).
 */
const PROD_MD5 = {
  member_display_name: "b4678b9af76804be84d062195b8ecdb4", get_safe_profiles: "34c087ed67b640c08063246ac06bf491",
  search_profiles_by_name: "66b5542a2421a35a238d73cf63f0ebad", get_my_saved_helpers: "80e0813d9111414508c0275b506b5256",
  get_quotes_for_request: "6335802f0f51a167a6d46cabc044f218", get_public_profile_reviews: "6bcc6f29fc41358f1e5e46e2aecec479",
  helpr_task_view: "946df27d41fd3767751ab1ba8197c36e", nudge_confirm: "02aef75de0b1de165c4725ac57930d48",
  record_backout_notice: "71a437162a1f4c0a9b6154d0917a23eb", notify_message_recipient: "f7c6be343626deb38e6978b005b50229",
};
/** The newest CREATE FUNCTION statement for `name` in a migration before this one (any dollar-quote tag). */
function fnStmt(name) {
  let last = null;
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql") && x < THIS).sort()) {
    const sql = readFileSync(DIR + f, "utf8");
    for (const m of sql.matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?"?${name}"?\\s*\\(`, "gi"))) {
      const rest = sql.slice(m.index);
      const open = /\bAS\s+(\$\w*\$)/i.exec(rest);
      if (!open) continue;
      const end = rest.indexOf(open[1], open.index + open[0].length);
      last = { stmt: `${rest.slice(0, end + open[1].length)};`, body: rest.slice(open.index + open[0].length, end) };
    }
  }
  if (!last) throw new Error(`no migration before ${THIS} defines ${name}`);
  const md5 = createHash("md5").update(last.body).digest("hex");
  if (PROD_MD5[name] && PROD_MD5[name] !== md5) throw new Error(`${name}: the newest text (md5 ${md5}) is not prod's (${PROD_MD5[name]})`);
  return last.stmt;
}
/** The inventory this migration restates (plus the rule itself). */
const RESTATED = [
  "member_display_name", "get_safe_profiles", "search_profiles_by_name", "get_my_saved_helpers", "get_quotes_for_request",
  "get_public_profile_reviews", "helpr_task_view", "nudge_confirm", "record_backout_notice", "notify_message_recipient",
];

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1), B = U(2), ADMIN = U(3), D = U(4), JOB = U(50), JOB2 = U(51), REQ = U(60), QUOTE = U(61), TASK = U(70);
const A_NAME = "Andre Jean Landry";
const B_NAME = "Bea\u00a0Thibodeaux"; // a no-break space: the first-name readers split on ' ' only
const D_NAME = "Dee\tLaFleur"; // a tab: notify_message_recipient split on ' ' only

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
  CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
  CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
  CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, full_name text, avatar_url text, bio text, location text, skills text,
    hourly_rate numeric, subscription_tier text, subscription_expires_at timestamptz, portfolio_urls text[], created_at timestamptz DEFAULT now(),
    idv_status text, stripe_account_id text, stripe_payouts_enabled boolean, is_licensed boolean, license_status text, is_insured boolean,
    insurance_status text, business_name text, email_verified boolean DEFAULT true, ban_status text, anonymized_at timestamptz,
    parish text DEFAULT 'Lafayette', is_seed boolean DEFAULT false, available_until timestamptz);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, category text DEFAULT 'moving', status public.job_status NOT NULL DEFAULT 'open',
    customer_id uuid, helper_id uuid, is_group_job boolean DEFAULT false, parent_job_id uuid, helper_confirmed_at timestamptz,
    helper_dayof_confirmed_at timestamptz, poster_confirmed_at timestamptz, direct_offer_status text, offered_to_helper_id uuid,
    payment_status text DEFAULT 'escrow', cancelled_by uuid, poster_completed_at timestamptz, helper_completed_at timestamptz,
    updated_at timestamptz DEFAULT now());
  CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reviewer_id uuid, reviewee_id uuid, job_id uuid, rating int,
    status text, feedback text, feedback_visible_at timestamptz, response_text text, response_at timestamptz, created_at timestamptz DEFAULT now());
  CREATE TABLE public.profile_search_rate_log (searcher_id uuid, created_at timestamptz DEFAULT now());
  CREATE TABLE public.favorite_helpers (customer_id uuid, helper_id uuid, created_at timestamptz DEFAULT now(), private_note text);
  CREATE TABLE public.job_quote_requests (id uuid PRIMARY KEY, poster_id uuid);
  CREATE TABLE public.job_quotes (id uuid PRIMARY KEY, request_id uuid, quoter_id uuid, price_cents int, note text, available_note text,
    photo_paths text[], last_offer_side text, respond_until timestamptz, status text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.job_quote_offers (quote_id uuid, by_side text, price_cents int, note text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, title text, message text, type text, link text, job_id uuid,
    read boolean DEFAULT false, created_at timestamptz DEFAULT now());
  CREATE TABLE public.backout_notices (id serial PRIMARY KEY, job_id uuid, user_id uuid, actor_name text, backout_kind text);
  CREATE TABLE public.messages (id serial PRIMARY KEY, sender_id uuid, receiver_id uuid, job_id uuid, content text, attachment_url text,
    flagged_hidden boolean DEFAULT false, team_thread_user_id uuid);
  CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, helpr_id uuid, customer_id uuid, pickup_contact_id uuid, source_kind text, source_id uuid,
    status text, size text, title text, pickup_area text, dropoff_area text, trip_miles numeric, pay_cents int, fee_cents int,
    open_until timestamptz, latest_pickup_at timestamptz, pickup_slot_start timestamptz, accepted_at timestamptz, picked_up_at timestamptz,
    delivered_at timestamptz, confirmed_at timestamptz, confirmed_by uuid, pickup_address text, pickup_lat numeric, pickup_lng numeric,
    dropoff_address text, dropoff_lat numeric, dropoff_lng numeric, pickup_photo_path text, dropoff_photo_path text);

  -- Stubs for gates this proof is not about (each is proven by its own proof).
  CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.seed_review_hidden(uuid, uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.quote_require_member() RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.quote_display_status(text, timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.job_payment_is_funded(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT $1 IN ('escrow','payout_pending','released') $$;
  CREATE FUNCTION public.backout_notice_text(p_kind text, p_name text, p_title text, OUT title text, OUT message text)
    LANGUAGE sql AS $$ SELECT 'Back out', coalesce(p_name, 'They') || ' backed out of ' || coalesce(p_title, 'a job') $$;
  CREATE FUNCTION public.send_backout_email(uuid, uuid, text, text, text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  -- The real role helpers, as the migrations leave them.
  ${fnStmt("is_server_context")}
  ${fnStmt("has_role")}

  INSERT INTO public.profiles (user_id, full_name) VALUES ('${A}', '${A_NAME}'), ('${B}', E'Bea\\u00a0Thibodeaux'),
    ('${ADMIN}', 'Ada Admin'), ('${D}', E'Dee\\tLaFleur');
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.jobs (id, title, status, customer_id, helper_id, helper_confirmed_at) VALUES
    ('${JOB}', 'Paint fence', 'accepted', '${A}', '${B}', now()), ('${JOB2}', 'Move couch', 'accepted', '${A}', '${B}', now());
  INSERT INTO public.reviews (reviewer_id, reviewee_id, job_id, rating, status, feedback_visible_at)
    VALUES ('${B}', '${A}', '${JOB}', 5, 'published', now() - interval '1 day');
  INSERT INTO public.favorite_helpers (customer_id, helper_id) VALUES ('${A}', '${B}');
  INSERT INTO public.job_quote_requests VALUES ('${REQ}', '${A}');
  INSERT INTO public.job_quotes (id, request_id, quoter_id, price_cents, status) VALUES ('${QUOTE}', '${REQ}', '${B}', 5000, 'open');
  INSERT INTO public.helpr_tasks (id, helpr_id, customer_id, status, title) VALUES ('${TASK}', '${B}', '${A}', 'accepted', 'Haul');
`);

let replayErr = null;
try {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
} catch (e) {
  replayErr = e;
}
if (process.env.LH_PROOF_REVERT) {
  await db.exec(RESTATED.map(fnStmt).join("\n"));
}
await db.exec(`
  CREATE TRIGGER t_backout AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.record_backout_notice();
  CREATE TRIGGER t_msg AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.notify_message_recipient();
`);

let fails = 0, n = 0;
const check = (name, ok, got) => {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`);
};
check("the migration applies 3x (replay-safe)", replayErr === null, replayErr?.message);

// ── 1. formatName parity ──────────────────────────────────────────────────────────────────────────
const sqlName = async (x) => (await db.query("SELECT public.member_display_name($1, NULL) AS d", [x])).rows[0].d;
const NONE = "\u0000none";
/** formatName with "no name" as null, the server's spelling of it. */
const fmt = (x) => {
  const f = formatName(x, NONE);
  return f === NONE ? null : f;
};
const hasAstral = (s) => /[\u{10000}-\u{10FFFF}]/u.test(s ?? "");

// The whitespace set, code point by code point over the BMP (no NUL, no surrogates).
const sqlWs = (await db.query(`
  SELECT array_agg(c ORDER BY c) AS cs FROM generate_series(1, 65535) c
   WHERE (c < 55296 OR c > 57343) AND public.member_display_name('a' || chr(c) || 'b', NULL) = 'a b.'`)).rows[0].cs ?? [];
const jsWs = [];
for (let c = 1; c <= 0xffff; c++) {
  if (c >= 0xd800 && c <= 0xdfff) continue;
  if (formatName(`a${String.fromCharCode(c)}b`) === "a b.") jsWs.push(c);
}
check(`whitespace set equals formatName's over the BMP (${jsWs.length} code points)`, JSON.stringify(sqlWs) === JSON.stringify(jsWs),
  { sqlOnly: sqlWs.filter((c) => !jsWs.includes(c)).map((c) => c.toString(16)), jsOnly: jsWs.filter((c) => !sqlWs.includes(c)).map((c) => c.toString(16)) });

const FIXED = [
  ["Lexi Lombas", "Lexi L."], ["  Lexi   Lombas ", "Lexi L."], ["Lexi\tLombas", "Lexi L."], ["Lexi\t\tLombas\t", "Lexi L."],
  ["Lexi\nLombas", "Lexi L."], ["Lexi\r\nLombas", "Lexi L."], ["Lexi\u00a0Lombas", "Lexi L."], ["Lexi\u3000Lombas", "Lexi L."],
  ["Lexi\u2009Lombas", "Lexi L."], ["Lexi\ufeffLombas", "Lexi L."], ["\ufeffLexi Lombas\ufeff", "Lexi L."],
  ["Lexi\u0085Lombas", "Lexi\u0085Lombas"], ["Lexi\u200bLombas", "Lexi\u200bLombas"],
  ["Madonna", "Madonna"], ["  Madonna\t", "Madonna"], ["", null], ["   ", null], ["\t\n", null], [null, null],
  ["Mary Anne Beaumont", "Mary B."], ["Jean-Pierre De La Croix", "Jean-Pierre C."], ["Mary-Kate O'Neil", "Mary-Kate O."],
  ["élodie ñúñez", "élodie ñ."], ["Ünal Ölçer", "Ünal Ö."], ["محمد بن سلمان", "محمد س."], ["李 龙", "李 龙."],
  ["Nguyễn Văn Ịch", "Nguyễn Ị."], ["Lexi L.", "Lexi L."], ["Ann 🌶️", null /* astral initial: idempotence only */],
];
for (const [x, want] of FIXED) {
  const got = await sqlName(x);
  if (hasAstral(x)) {
    check(`astral initial ${JSON.stringify(x)}: formatName(sql) === formatName(raw)`, formatName(got) === formatName(x), got);
    continue;
  }
  check(`member_display_name(${JSON.stringify(x)}) = ${JSON.stringify(want)} = formatName`, got === want && got === fmt(x), { got, formatName: fmt(x) });
}

// 600 generated names (deterministic), mixing every whitespace kind with letters, accents, hyphens.
let seed = 20261021;
const rnd = (k) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % k);
const WS = [" ", "  ", "\t", "\n", "\r", "\u000b", "\f", "\u00a0", "\u1680", "\u2003", "\u2028", "\u202f", "\u205f", "\u3000", "\ufeff", "\u0085", "\u200b"];
const PARTS = ["Lexi", "Bea", "O'Neil", "Jean-Pierre", "é", "Ñúñez", "李", "محمد", "X", "de", "La", "Thibodeaux", "Ịch", "Mc-Donald"];
const generated = [];
for (let i = 0; i < 600; i++) {
  let s = rnd(3) === 0 ? WS[rnd(WS.length)] : "";
  const words = rnd(5);
  for (let w = 0; w < words; w++) s += (w ? WS[rnd(WS.length)] : "") + PARTS[rnd(PARTS.length)];
  if (rnd(3) === 0) s += WS[rnd(WS.length)];
  generated.push(s);
}
let mismatches = [];
let notIdempotent = [];
for (const x of [...generated, ...FIXED.map(([x]) => x)]) {
  const got = await sqlName(x);
  if (!hasAstral(x) && got !== fmt(x)) mismatches.push({ x, got, formatName: fmt(x) });
  if (formatName(got) !== formatName(x)) notIdempotent.push({ x, got });
  if (got !== null && (await sqlName(got)) !== got) notIdempotent.push({ x, got, twice: await sqlName(got) });
}
check(`600 generated names: member_display_name === formatName`, mismatches.length === 0, mismatches.slice(0, 3));
check("an installed client formatting the value again still shows it: formatName(sql(x)) === formatName(x), sql(sql(x)) === sql(x)",
  notIdempotent.length === 0, notIdempotent.slice(0, 3));

// ── 2. Every inventoried reader, under the real roles ─────────────────────────────────────────────
async function as(uid, role, sql, params) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);
                 SELECT set_config('request.jwt.claim.role', '${role}', false); SET ROLE ${role === "service_role" ? "service_role" : role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);");
  }
}
const SAFE = `SELECT user_id, full_name FROM public.get_safe_profiles(ARRAY['${A}', '${B}']::uuid[]) ORDER BY user_id`;
const safe = async (uid, role) => Object.fromEntries((await as(uid, role, SAFE)).map((r) => [r.user_id, r.full_name]));

let s = await safe(A, "authenticated");
check("get_safe_profiles: member A reading B gets 'Bea T.'", s[B] === "Bea T.", s);
check("get_safe_profiles: A reading A gets the full name", s[A] === A_NAME, s);
s = await safe(ADMIN, "authenticated");
check("get_safe_profiles: an admin gets B's full name", s[B] === B_NAME && s[A] === A_NAME, s);
s = await safe(null, "service_role");
check("get_safe_profiles: the service role gets B's full name", s[B] === B_NAME, s);
s = await safe(null, "anon");
check("get_safe_profiles: anon gets 'Bea T.' and 'Andre L.'", s[B] === "Bea T." && s[A] === "Andre L.", s);

const search = (uid, q) => as(uid, "authenticated", "SELECT user_id, full_name FROM public.search_profiles_by_name($1)", [q]);
let r = await search(A, "Thibo");
check("search_profiles_by_name: a member searching B's surname finds nobody", r.length === 0, r);
r = await search(A, "Bea");
check("search_profiles_by_name: a member finds B by first name, as 'Bea T.'", r.length === 1 && r[0].full_name === "Bea T.", r);
r = await search(D, "Andre L");
check("search_profiles_by_name: 'First L' still finds the member", r.length === 1 && r[0].full_name === "Andre L.", r);
r = await search(D, "Andre Landry");
const typedFull = r;
r = await search(D, "Andre Lxyz");
check("search_profiles_by_name: a typed full name finds 'Andre L.', and so does a wrong surname with the same initial (no confirmation)",
  typedFull.length === 1 && typedFull[0].full_name === "Andre L." && r.length === 1 && r[0].full_name === "Andre L.", { typedFull, r });
r = await search(D, "Andre Mxyz");
check("search_profiles_by_name: a different initial does not match", r.length === 0, r);
r = await search(D, "\t\t");
check("search_profiles_by_name: a whitespace-only query matches nobody", r.length === 0, r);
r = await search(ADMIN, "Thibo");
check("search_profiles_by_name: an admin finds B by surname, with the full name", r.length === 1 && r[0].full_name === B_NAME, r);

r = await as(A, "authenticated", "SELECT helper_id, full_name FROM public.get_my_saved_helpers()");
check("get_my_saved_helpers: A's saved Helpr B is 'Bea T.'", r.length === 1 && r[0].full_name === "Bea T.", r);

r = await as(A, "authenticated", `SELECT quoter_id, quoter_name FROM public.get_quotes_for_request('${REQ}')`);
check("get_quotes_for_request: B's quote shows 'Bea T.'", r.length === 1 && r[0].quoter_name === "Bea T.", r);

r = await as(A, "authenticated", `SELECT reviewer_name FROM public.get_public_profile_reviews('${A}')`);
check("get_public_profile_reviews: B's review of A shows 'Bea T.'", r.length === 1 && r[0].reviewer_name === "Bea T.", r);
r = await as(ADMIN, "authenticated", `SELECT reviewer_name FROM public.get_public_profile_reviews('${A}')`);
check("get_public_profile_reviews: an admin sees the reviewer's full name", r.length === 1 && r[0].reviewer_name === B_NAME, r);

r = await as(A, "authenticated", `SELECT public.helpr_task_view('${TASK}') ->> 'helpr_first_name' AS f`);
check("helpr_task_view: the customer sees the Helpr's first name 'Bea' only", r[0]?.f === "Bea", r);

r = await as(B, "authenticated", `SELECT public.nudge_confirm('${JOB}') AS res`);
const nudge = (await db.query(`SELECT message FROM public.notifications WHERE user_id = '${A}' AND title = 'Please confirm'`)).rows[0];
check("nudge_confirm: A's notice names B as 'Bea' only", r[0]?.res === "sent" && nudge?.message?.startsWith('Bea asked you to confirm "Paint fence"'), { r, nudge });

// B backs out of a booked job: the trigger runs as the table owner, with B's claims.
await db.exec(`SELECT set_config('request.jwt.claim.sub', '${B}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);
  UPDATE public.jobs SET helper_id = NULL, status = 'open' WHERE id = '${JOB2}';
  SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
const notice = (await db.query(`SELECT actor_name, backout_kind FROM public.backout_notices WHERE job_id = '${JOB2}'`)).rows[0];
check("record_backout_notice: A's back-out notice names B as 'Bea' only", notice?.actor_name === "Bea" && notice.backout_kind === "helper_cancelled", notice);

await db.exec(`INSERT INTO public.messages (sender_id, receiver_id, job_id, content) VALUES ('${D}', '${A}', '${JOB}', 'Hello')`);
const msg = (await db.query(`SELECT title FROM public.notifications WHERE user_id = '${A}' AND type = 'message'`)).rows[0];
check("notify_message_recipient: a tab in the sender's name still gives 'Dee L.'", msg?.title === "Dee L.", msg);

// ── 3. Grants ─────────────────────────────────────────────────────────────────────────────────────
const acl = async (sig) => (await db.query(`SELECT coalesce(proacl::text, '') AS a FROM pg_proc WHERE oid = '${sig}'::regprocedure`)).rows[0].a;
const has = (a, role) => new RegExp(`(^|[{,])${role}=X`).test(a);
const pub = (a) => /(^|[{,])=X/.test(a);
let a = await acl("public.display_name_for_viewer(text, uuid)");
check("display_name_for_viewer: no EXECUTE for PUBLIC, anon or authenticated", !pub(a) && !has(a, "anon") && !has(a, "authenticated") && has(a, "service_role"), a);
a = await acl("public.get_safe_profiles(uuid[])");
check("get_safe_profiles: anon + authenticated, not PUBLIC (prod's proacl)", !pub(a) && has(a, "anon") && has(a, "authenticated"), a);
for (const sig of ["public.search_profiles_by_name(text)", "public.get_my_saved_helpers()", "public.get_quotes_for_request(uuid)",
  "public.get_public_profile_reviews(uuid, integer, integer)", "public.helpr_task_view(uuid)", "public.nudge_confirm(uuid)", "public.member_display_name(text, text)"]) {
  a = await acl(sig);
  check(`${sig}: authenticated only, not PUBLIC or anon`, !pub(a) && !has(a, "anon") && has(a, "authenticated"), a);
}
for (const sig of ["public.record_backout_notice()", "public.notify_message_recipient()"]) {
  a = await acl(sig);
  check(`${sig}: no client role may call the trigger function`, !pub(a) && !has(a, "anon") && !has(a, "authenticated"), a);
}

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
