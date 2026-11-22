#!/usr/bin/env node
/**
 * PGlite proof for 20261121221514_wish_link_requests (owner 2026-11-21: "we see the list, create the links if we don't
 * have it, and send - they buy with our link"; "someone can just type in ideas ... and we find a link"):
 *   - wish_link_request_add keeps a pasted shop link or typed idea (https public links only, words stripped and never a
 *     link), returns the same row for the same gift on the same list, marks our own Amazon link done at once, reuses a
 *     link we already made for the same page, is rate limited and is_seed by the usual rule.
 *   - wish_link_requests_get answers status + our link only (never the words, pasted link or list name).
 *   - The admin queue/fill/dismiss refuse anyone but an admin, leave test rows out, write admin_audit_log, and a fill
 *     reaches every other open row for the same page.
 *   - gift_wish_lists_share takes {"r": id} refs (existing requests only, each once); gift_wish_list_get reads them back
 *     with the words and our link once made, never the pasted link.
 *   - The daily prune removes requests older than 180 days; anon/authenticated hold no table privilege.
 *
 *   node src/test/pglite/wishLinkRequests.pglite.mjs                    # ALL PASS (new migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/wishLinkRequests.pglite.mjs # RED
 *   MUTANT=<name> node ...                                              # each must FAIL (see MUTANTS)
 *
 * World: auth.users, auth.uid() from the test.uid setting, is_test_member (a test_accounts list), has_role (a roles
 * list), admin_audit_log, the real unconfirmed-email gate functions (20260927234313, auth.role() from test.role), and
 * the two gift wish list migrations before this one.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const files = readdirSync(MIG_DIR);
const BASE = files.find((f) => f.endsWith("_gift_wish_lists.sql"));
const SHARE = files.find((f) => f.endsWith("_gift_wish_lists_share.sql"));
const THIS = files.find((f) => f.endsWith("_wish_link_requests.sql"));
if (!BASE || !SHARE || !THIS) throw new Error("migration not found");

const MUTANTS = {
  httpOk: ["     AND p_url ~ '^https://([A-Za-z0-9-]+\\.)+[A-Za-z]{2,}(/[^[:space:]]*)?$'\n", "     AND p_url ~ '^https?://'\n"],
  localOk: ["     AND lower(split_part(substring(p_url FROM 9), '/', 1)) !~ '\\.(local|internal|test|localhost|lan|home|corp)$'\n", ""],
  wordsLinkOk: ["     OR v_words ~* '(https?:|www\\.|\\.[a-z]{2,}/|\\m[a-z0-9-]+\\.[a-z]{2,}\\M)'\n", ""],
  wordsPhoneOk: ["     OR regexp_replace(v_words, '[\\s().+-]', '', 'g') ~ '[0-9]{7,}' THEN", "     THEN"],
  noHourly: ["     OR (SELECT count(*) FROM public.gift_wish_list_hits WHERE bucket = v_bucket AND hit_at > now() - interval '1 hour') >= 120 THEN", "     THEN"],
  dedupeDismissed: ["     AND r.status <> 'dismissed'\n", ""],
  getNoDismissFlag: [",\n                                                             'd', q.status = 'dismissed')", ")"],
  noStrip: ["  v_words := btrim(regexp_replace(COALESCE(p_words, ''), '[[:cntrl:]\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]', '', 'g'));", "  v_words := btrim(COALESCE(p_words, ''));"],
  noDedupe: ["  IF FOUND THEN\n    RETURN jsonb_build_object('id', v_row.id, 'link',", "  IF false THEN\n    RETURN jsonb_build_object('id', v_row.id, 'link',"],
  noRateLimit: ["hit_at > now() - interval '10 minutes') >= 30\n", "hit_at > now() - interval '10 minutes') >= 30000\n"],
  noAmazonOurs: ["    IF v_url ~ '^https://www\\.amazon\\.com/dp/[A-Z0-9]{10}\\?tag=louisianahelpr-20$' THEN", "    IF false THEN"],
  noReuse: ["       WHERE r.url_key = v_key AND r.status = 'filled'\n", "       WHERE false\n"],
  getLeaksWords: ["    SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status,\n", "    SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'words', r.words,\n"],
  getOpenLink: ["                                        'link', CASE WHEN r.status = 'filled' THEN r.affiliate_url END))", "                                        'link', r.url))"],
  adminListOpen: ["    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';\n  END IF;\n  -- Test data never shows", "    NULL;\n  END IF;\n  -- Test data never shows"],
  adminSeedShown: ["            WHERE NOT x.is_seed\n", ""],
  fillNoAuth: ["    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';\n  END IF;\n  IF NOT public.wish_link_url_ok(v_url) THEN", "    NULL;\n  END IF;\n  IF NOT public.wish_link_url_ok(v_url) THEN"],
  dismissNoAuth: ["    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';\n  END IF;\n  UPDATE public.wish_link_requests SET status = 'dismissed'", "    NULL;\n  END IF;\n  UPDATE public.wish_link_requests SET status = 'dismissed'"],
  fillNoUrlCheck: ["  IF NOT public.wish_link_url_ok(v_url) THEN\n    RAISE EXCEPTION 'invalid_url' USING ERRCODE = '22023';\n  END IF;\n  UPDATE public.wish_link_requests\n     SET status = 'filled', affiliate_url = v_url, filled_at = now()\n   WHERE id = p_id", "  UPDATE public.wish_link_requests\n     SET status = 'filled', affiliate_url = v_url, filled_at = now()\n   WHERE id = p_id"],
  fillNoSpread: ["     WHERE url_key = v_row.url_key AND id <> p_id AND status = 'open';", "     WHERE false;"],
  fillNoAudit: ["  VALUES ((SELECT auth.uid()), 'wish_link_fill', 'wish_link_request', p_id::text,\n          jsonb_build_object('affiliate_url', v_url, 'also_filled', v_also));", "  SELECT NULL, NULL, NULL, NULL, NULL WHERE false;"],
  shareUnknownR: ["         WHERE NOT (e ? 'r') OR EXISTS (SELECT 1 FROM public.wish_link_requests q WHERE q.id::text = e->>'r')\n", ""],
  shareCollapsesR: ["        SELECT DISTINCT ON (COALESCE(e->>'i', 'r:' || (e->>'r'))) e->>'g' AS g, e->>'i' AS i, e->>'r' AS r, n", "        SELECT DISTINCT ON (e->>'i') e->>'g' AS g, e->>'i' AS i, e->>'r' AS r, n"],
  getPastedLink: ["'h', CASE WHEN q.status = 'filled' THEN q.affiliate_url END,", "'h', COALESCE(q.affiliate_url, q.url),"],
  noPrune: ["  DELETE FROM public.wish_link_requests r WHERE r.created_at < now() - interval '180 days';", "  SELECT 1 INTO v_r;"],
  noGate: ["    PERFORM public.attach_unconfirmed_email_gate();", "    NULL;"],
  anonTable: ["REVOKE ALL ON TABLE public.wish_link_requests FROM PUBLIC, anon, authenticated;", "GRANT SELECT ON TABLE public.wish_link_requests TO anon;"],
  anonAdmin: ["REVOKE ALL ON FUNCTION public.admin_wish_link_requests() FROM PUBLIC, anon;", "GRANT EXECUTE ON FUNCTION public.admin_wish_link_requests() TO anon;"],
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
const ADMIN = "33333333-0000-0000-0000-000000000001";
const ANN = "33333333-0000-0000-0000-000000000002";
const TEST = "33333333-0000-0000-0000-000000000003";
const UNCONF = "33333333-0000-0000-0000-000000000004";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email_confirmed_at timestamptz);
  INSERT INTO auth.users VALUES ('${ADMIN}', now()), ('${ANN}', now()), ('${TEST}', now()), ('${UNCONF}', NULL);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.role', true), '') $f$;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  INSERT INTO public.test_accounts VALUES ('${TEST}');
  CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p) $f$;
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  CREATE FUNCTION public.has_role(p uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles u WHERE u.user_id = p AND u.role = r) $f$;
  CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid NOT NULL, action text NOT NULL, target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
`);
// The unconfirmed-email gate's three functions, verbatim from their migration (its storage policies need no storage schema here).
const GATE_SRC = readFileSync(MIG_DIR + "20260927234313_refuse_unconfirmed_email_writes.sql", "utf8");
const gateFrom = GATE_SRC.indexOf("CREATE OR REPLACE FUNCTION public.session_email_unconfirmed()");
const gateTo = GATE_SRC.indexOf("SELECT public.attach_unconfirmed_email_gate();");
if (gateFrom < 0 || gateTo < gateFrom) throw new Error("email gate functions not found");
await db.exec(GATE_SRC.slice(gateFrom, gateTo));
await db.exec(readFileSync(MIG_DIR + BASE, "utf8"));
await db.exec(readFileSync(MIG_DIR + SHARE, "utf8"));
if (process.env.NEW_MIGRATION !== "skip") for (let k = 0; k < 3; k++) await db.exec(mig);

const as = async (uid, addr, origin) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? ""]);
  await db.query(`SELECT set_config('request.headers', $1, false)`, [JSON.stringify({ "x-forwarded-for": `9.9.9.9, ${addr ?? "1.1.1.1"}`, ...(origin ? { origin } : {}) })]);
};
const call = async (sql, params) => {
  try { return { v: (await db.query(sql, params)).rows[0]?.v }; } catch (e) { return { err: String(e.message) }; }
};
const add = (kind, words, url, list = "p1", name = "Mom", test = false) =>
  call(`SELECT public.wish_link_request_add($1, $2, $3, $4, $5, $6) AS v`, [kind, words, url, list, name, test]);
const getReq = (ids) => call(`SELECT public.wish_link_requests_get($1::uuid[]) AS v`, [ids]);
const row = async (id) => (await db.query(`SELECT * FROM public.wish_link_requests WHERE id = $1`, [id])).rows[0];
const ETSY = "https://www.etsy.com/listing/99/hand-knit-scarf";
const OUR_AMZ = "https://www.amazon.com/dp/B000000001?tag=louisianahelpr-20";

// A guest pastes a shop link and types an idea.
await as(null, "2.2.2.2");
const l1 = await add("link", "Hand knit scarf", ETSY);
check(/^[0-9a-f-]{36}$/.test(l1.v?.id ?? "") && l1.v?.link === null, `a pasted link is queued, no link yet (${JSON.stringify(l1)})`);
check((await row(l1.v.id))?.url_key === "etsy.com/listing/99/hand-knit-scarf" && (await row(l1.v.id))?.status === "open", "its page key is host + path, status open");
const i1 = await add("idea", "LSU hoodie\u202e\u200b size M", null);
check(!!i1.v?.id && (await row(i1.v.id))?.words === "LSU hoodie size M", "a typed idea is queued with invisible characters stripped");
const a1 = await add("link", "Cozy throw", OUR_AMZ);
check(a1.v?.link === OUR_AMZ && (await row(a1.v.id))?.status === "filled", `our own Amazon link is done at once (${JSON.stringify(a1)})`);

// Same gift, same list: the same row; same page, another list: its own row.
check((await add("link", "Scarf again", `${ETSY}/?utm_source=x`)).v?.id === l1.v.id, "the same page on the same list returns the row it has");
check((await add("idea", "lsu HOODIE size m", null)).v?.id === i1.v.id, "the same typed idea on the same list returns the row it has");
const l2 = await add("link", "Scarf", ETSY, "p2", "Dad");
check(!!l2.v?.id && l2.v.id !== l1.v.id, "the same page on another list is its own row");

// Refusals.
for (const bad of ["http://shop.com/x", "https://1.2.3.4/x", "https://localhost/x", "https://user@shop.com/x", "https://shop.com:8443/x", "https://printer.local/x", "javascript:alert(1)", `https://shop.com/${"x".repeat(500)}`, "https://shop.com/a b"]) {
  check(/invalid_url/.test((await add("link", "Thing", bad)).err ?? ""), `link refused: ${bad.slice(0, 40)}`);
}
check(/invalid_url/.test((await add("link", "Thing", null)).err ?? ""), "a link request without a link is refused");
check(/invalid_url/.test((await add("idea", "Thing", ETSY)).err ?? ""), "an idea with a link is refused");
for (const bad of ["see https://evil.com", "www.evil.com deal", "Text 337 555 0100 to claim", "free at freegifts.shop", "", "x".repeat(121)]) {
  check(/invalid_words/.test((await add("idea", bad, null)).err ?? ""), `words refused: ${bad.slice(0, 30) || "(empty)"}`);
}
check(/invalid_list/.test((await add("idea", "Mug", null, "BAD KEY!")).err ?? ""), "a bad list key is refused");
check(/invalid_kind/.test((await add("other", "Mug", null)).err ?? ""), "an unknown kind is refused");

// The public read: status + our link only.
const g1 = await getReq([l1.v.id, a1.v.id]);
const byId = Object.fromEntries((g1.v ?? []).map((x) => [x.id, x]));
check(byId[l1.v.id]?.status === "open" && byId[l1.v.id]?.link === null && byId[a1.v.id]?.link === OUR_AMZ, `get answers status and our link (${JSON.stringify(g1)})`);
check((g1.v ?? []).every((x) => Object.keys(x).sort().join(",") === "id,link,status"), "get never answers the words, pasted link or list name");
check(/invalid_ids/.test((await getReq(Array.from({ length: 301 }, () => l1.v.id))).err ?? ""), "301 ids are refused");

// Admin: only an admin; a fill reaches every open row for the same page; audit rows.
await as(ANN, "4.4.4.4");
check(/not_authorized/.test((await call(`SELECT public.admin_wish_link_requests() AS v`)).err ?? ""), "a member cannot read the queue");
check(/not_authorized/.test((await call(`SELECT public.admin_wish_link_request_fill($1, $2) AS v`, [l1.v.id, "https://ours.example.com/x"])).err ?? ""), "a member cannot fill");
check(/not_authorized/.test((await call(`SELECT public.admin_wish_link_request_dismiss($1) AS v`, [i1.v.id])).err ?? ""), "a member cannot dismiss");
await as(ADMIN, "6.6.6.6");
const q1 = (await call(`SELECT public.admin_wish_link_requests() AS v`)).v ?? [];
check(q1.some((r) => r.id === l1.v.id && r.words === "Hand knit scarf" && r.url === ETSY && r.list_name === "Mom"), "the admin queue shows the words, link and list");
check(/invalid_url/.test((await call(`SELECT public.admin_wish_link_request_fill($1, $2) AS v`, [l1.v.id, "http://ours.example.com/x"])).err ?? ""), "a fill with a non-https link is refused");
const OURS = "https://ours.example.com/scarf?aff=lh";
const f1 = await call(`SELECT public.admin_wish_link_request_fill($1, $2) AS v`, [l1.v.id, OURS]);
check(f1.v?.also_filled === 1 && (await row(l2.v.id))?.affiliate_url === OURS, `a fill reaches the same page on the other list (${JSON.stringify(f1)})`);
const audit = (await db.query(`SELECT action, target_id, admin_id FROM public.admin_audit_log ORDER BY created_at`)).rows;
check(audit.some((a) => a.action === "wish_link_fill" && a.target_id === l1.v.id && a.admin_id === ADMIN), "the fill writes an admin_audit_log row");
check((await getReq([l1.v.id])).v?.[0]?.link === OURS, "after the fill, get answers our link");
await call(`SELECT public.admin_wish_link_request_dismiss($1) AS v`, [i1.v.id]);
check((await row(i1.v.id))?.status === "dismissed" && (await db.query(`SELECT 1 FROM public.admin_audit_log WHERE action = 'wish_link_dismiss'`)).rows.length === 1, "dismiss sets dismissed and writes an audit row");
await as(null, "2.2.2.2");
const again = await add("idea", "LSU hoodie size M", null);
check(!!again.v?.id && again.v.id !== i1.v.id && (await row(again.v.id))?.status === "open", "a dismissed gift added again asks again (a new open row)");
await db.query(`DELETE FROM public.wish_link_requests WHERE id = $1`, [again.v.id]);
await as(ADMIN, "6.6.6.6");

// A page we already linked comes back with our link at once, for anyone.
await as(null, "7.7.7.7");
const l3 = await add("link", "Scarf for Aunt", `${ETSY}?ref=shop`, "p3", "Aunt");
check(l3.v?.link === OURS && (await row(l3.v.id))?.status === "filled", `a page we already linked is filled at once (${JSON.stringify(l3)})`);

// Shares carry {r} refs; the shared list reads back the words and our link, never the pasted link.
await db.exec(`DELETE FROM public.gift_wish_list_hits`);
const waiting = await add("link", "Silver locket", "https://www.target.com/p/silver-locket/-/A-555", "p3", "Aunt");
const share = (lists) => call(`SELECT public.gift_wish_lists_share($1::jsonb, false) AS v`, [JSON.stringify(lists)]);
const s1 = await share([{ n: "Mom", items: [{ g: "her", i: "abc123" }, { r: l1.v.id }, { r: i1.v.id }, { r: l1.v.id }, { r: a1.v.id }, { r: waiting.v.id }] }]);
check(/^[a-z0-9]{12}$/.test(s1.v ?? ""), `a share with request refs saves (${JSON.stringify(s1)})`);
const got = (await call(`SELECT public.gift_wish_list_get($1) AS v`, [s1.v])).v;
const items = got?.lists?.[0]?.items ?? [];
check(items.length === 5, `each request once per list (${JSON.stringify(items)})`);
check(JSON.stringify(items[0]) === JSON.stringify({ g: "her", i: "abc123" }), "guide refs read back unchanged");
check(items[1]?.w === "Hand knit scarf" && items[1]?.h === OURS, "a filled request reads back with its words and our link");
check(items[2]?.w === "LSU hoodie size M" && items[2]?.h === null && items[2]?.d === true, "a dismissed request reads back with no link, marked dismissed");
check(items[1]?.d === false, "a filled request is not marked dismissed");
check(!JSON.stringify(got).includes("etsy.com") && !JSON.stringify(got).includes("target.com") && items[4]?.w === "Silver locket" && items[4]?.h === null, "the pasted link never shows on a shared list, filled or waiting");
const GONE = "00000000-0000-0000-0000-000000000000";
check(/empty_list/.test((await share([{ n: "Mom", items: [{ r: GONE }] }])).err ?? ""), "a list of only unknown requests has nothing to share");
const s2 = await share([{ n: "Mom", items: [{ r: GONE }, { r: l1.v.id }] }]);
const stored2 = (await db.query(`SELECT lists FROM public.gift_wish_lists WHERE code = $1`, [s2.v ?? ""])).rows[0]?.lists;
check(JSON.stringify(stored2) === JSON.stringify([{ n: "Mom", items: [{ r: l1.v.id }] }]), `an unknown (pruned) request is left out, never refusing the share (${JSON.stringify(stored2)})`);
check(/invalid_items/.test((await share([{ n: "Mom", items: [{ r: l1.v.id, w: "Free iPhone" }] }])).err ?? ""), "a request ref with extra keys (own words) is refused");
check(/invalid_items/.test((await share([{ n: "Mom", items: [{ r: "not-a-uuid" }] }])).err ?? ""), "a malformed request ref is refused");
await db.query(`DELETE FROM public.wish_link_requests WHERE id = $1`, [a1.v.id]);
check(((await call(`SELECT public.gift_wish_list_get($1) AS v`, [s1.v])).v?.lists?.[0]?.items ?? []).length === 4, "a request deleted since is left out of the shared list");

// Rate limit: 30 new requests per address per 10 minutes.
await db.exec(`DELETE FROM public.gift_wish_list_hits`);
await as(null, "8.8.8.8");
let last;
for (let k = 0; k < 30; k++) last = await add("idea", `Gift ${k}`, null, "p9", "Kid");
check(!!last.v?.id, "the 30th new request from one address passes");
check(/rate_limited/.test((await add("idea", "Gift 31", null, "p9", "Kid")).err ?? ""), "the 31st in 10 minutes is refused");
check(/rate_limited/.test((await add("idea", "Gift 1", null, "p9", "Kid")).err ?? ""), "past the limit, even a gift already sent is refused (the limit comes before any look-up)");
// 120 an hour: 100 older hits (20 minutes ago) + 20 now pass the 10-minute limit but not the hour's.
await db.exec(`DELETE FROM public.gift_wish_list_hits`);
await as(null, "8.8.8.9");
const b89 = (await db.query(`SELECT md5('wish-link:' || '|a:8.8.8.9:' || (now() AT TIME ZONE 'America/Chicago')::date::text) AS b`)).rows[0].b;
await db.query(`INSERT INTO public.gift_wish_list_hits (bucket, snapshot, hit_at) SELECT $1, false, now() - interval '20 minutes' FROM generate_series(1, 100)`, [b89]);
for (let k = 0; k < 20; k++) last = await add("idea", `Hour ${k}`, null, "p8", "Kid");
check(!!last.v?.id, "the 120th in an hour passes");
check(/rate_limited/.test((await add("idea", "Hour 21", null, "p8", "Kid")).err ?? ""), "the 121st in an hour is refused");

// is_seed, and the admin queue leaves test rows out.
await db.exec(`DELETE FROM public.gift_wish_list_hits`);
await as(TEST, "5.5.5.5");
const t1 = await add("idea", "Test gift one", null, "t1", "T");
await as(null, "5.5.5.6", "http://localhost:5173");
const t2 = await add("idea", "Test gift two", null, "t2", "T");
await as(null, "5.5.5.7");
const t3 = await add("idea", "Test gift three", null, "t3", "T", true);
const real = await add("idea", "Real gift", null, "t4", "R");
check((await row(t1.v.id))?.is_seed && (await row(t2.v.id))?.is_seed && (await row(t3.v.id))?.is_seed && (await row(real.v.id))?.is_seed === false, "test account, test browser and p_test rows are is_seed; a visitor's is not");
await as(ADMIN, "6.6.6.6");
const q2 = (await call(`SELECT public.admin_wish_link_requests() AS v`)).v ?? [];
check(!q2.some((r) => [t1.v.id, t2.v.id, t3.v.id].includes(r.id)) && q2.some((r) => r.id === real.v.id), "the admin queue leaves test rows out");
check(q2.findIndex((r) => r.status !== "open") > q2.findLastIndex((r) => r.status === "open"), "open rows come first in the admin queue");

// The daily prune.
await db.query(`UPDATE public.wish_link_requests SET created_at = now() - interval '181 days' WHERE id = $1`, [real.v.id]);
await db.query(`SELECT public.gift_wish_list_prune()`);
check(!(await row(real.v.id)) && !!(await row(l1.v.id)), "requests older than 180 days are pruned, newer ones kept");

// Privileges.
const priv = (await db.query(`SELECT has_table_privilege('anon', 'public.wish_link_requests', 'SELECT') AS a, has_table_privilege('authenticated', 'public.wish_link_requests', 'SELECT') AS u,
  has_function_privilege('anon', 'public.wish_link_request_add(text, text, text, text, text, boolean)', 'EXECUTE') AS fa,
  has_function_privilege('anon', 'public.wish_link_requests_get(uuid[])', 'EXECUTE') AS fg,
  has_function_privilege('anon', 'public.admin_wish_link_requests()', 'EXECUTE') AS aa,
  has_function_privilege('anon', 'public.admin_wish_link_request_fill(uuid, text)', 'EXECUTE') AS af,
  has_function_privilege('anon', 'public.wish_link_url_key(text)', 'EXECUTE') AS ak`)).rows[0];
check(priv.a === false && priv.u === false, `anon and authenticated hold no table privilege (${JSON.stringify(priv)})`);
check(priv.fa === true && priv.fg === true, "anon may add and read requests");
check(priv.aa === false && priv.af === false && priv.ak === false, "anon may not call the admin or helper functions");
const acls = (await db.query(`SELECT proname, proacl::text AS acl FROM pg_proc WHERE proname LIKE '%wish_link%'`)).rows;
check(acls.length === 7 && acls.every((r) => !/(^|[{,])=X/.test(r.acl ?? "=X")), `PUBLIC holds no EXECUTE on any of the 7 functions (${JSON.stringify(acls)})`);

// The unconfirmed-email gate (Q807, db-smoke): attached to the new table; guests and confirmed members still add,
// a signed-in member with an unconfirmed email cannot.
const gate = (await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.wish_link_requests'::regclass AND tgname = 'zz_refuse_unconfirmed_email_write'`)).rows[0].n;
check(gate === 1, `wish_link_requests carries the unconfirmed-email gate trigger (${gate})`);
await as(null, "7.7.7.1");
check(!!(await add("idea", "Gate guest mug", null, "g1")).v?.id, "with the gate on, a guest still adds a request");
await db.query(`SELECT set_config('test.role', 'authenticated', false)`);
await as(ANN, "7.7.7.2");
check(!!(await add("idea", "Gate member mug", null, "g2")).v?.id, "with the gate on, a confirmed member still adds a request");
await as(UNCONF, "7.7.7.3");
check(/email_unconfirmed/.test((await add("idea", "Gate unconfirmed mug", null, "g3")).err ?? ""), "a member with an unconfirmed email is refused (email_unconfirmed)");
await db.query(`SELECT set_config('test.role', '', false)`);
await as(null);

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
