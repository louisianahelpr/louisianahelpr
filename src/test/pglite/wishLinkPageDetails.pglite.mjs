#!/usr/bin/env node
/**
 * PGlite proof for 20261122034304_wish_link_page_details (gift lists lane, 2026-11-21: "the server fetch of a pasted
 * link's title, photo and price for the link queue"):
 *   - wish_link_pages_due hands the edge function open, unchecked link rows, one per page, never Amazon, never a test
 *     row, never an idea or a filled/dismissed row; 1..20 only.
 *   - wish_link_page_save stores the outcome on that row and every unchecked row for the same page, cleans the title,
 *     keeps only an https public photo link and a positive USD price under $100,000, stores nothing but the kind for
 *     skipped/blocked/failed, answers 0 for a row that is gone, and refuses an unknown status.
 *   - Both are service role only (anon and authenticated may not call them); the admin queue now carries the page
 *     fields and still refuses anyone but an admin.
 *
 *   node src/test/pglite/wishLinkPageDetails.pglite.mjs                    # ALL PASS (new migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/wishLinkPageDetails.pglite.mjs # RED
 *   MUTANT=<name> node ...                                                 # each must FAIL (see MUTANTS)
 *
 * World: as wishLinkRequests.pglite.mjs (auth.users, auth.uid() from test.uid, is_test_member, has_role,
 * admin_audit_log), then the three gift list migrations before this one.
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
const LINKQ = files.find((f) => f.endsWith("_wish_link_requests.sql"));
const THIS = files.find((f) => f.endsWith("_wish_link_page_details.sql"));
if (!BASE || !SHARE || !LINKQ || !THIS) throw new Error("migration not found");

const MUTANTS = {
  dueAmazon: ["AND r.url_key NOT LIKE 'amazon:%'\n", "\n"],
  dueSeed: ["AND r.page_checked_at IS NULL AND NOT r.is_seed\n", "AND r.page_checked_at IS NULL\n"],
  dueChecked: ["WHERE r.kind = 'link' AND r.status = 'open' AND r.page_checked_at IS NULL AND NOT r.is_seed", "WHERE r.kind = 'link' AND r.status = 'open' AND NOT r.is_seed"],
  dueAnyStatus: ["WHERE r.kind = 'link' AND r.status = 'open' AND r.page_checked_at IS NULL AND NOT r.is_seed", "WHERE r.kind = 'link' AND r.page_checked_at IS NULL AND NOT r.is_seed"],
  dueNoDistinct: ["            FROM (SELECT DISTINCT ON (r.url_key) r.id, r.url, r.created_at\n", "            FROM (SELECT r.id, r.url, r.created_at\n"],
  dueNoLimitCheck: ["  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN", "  IF false THEN"],
  saveNoSpread: ["   WHERE kind = 'link' AND (id = p_id OR (url_key = v_key AND page_checked_at IS NULL));", "   WHERE kind = 'link' AND id = p_id;"],
  saveImageTrusted: ["    v_image := CASE WHEN p_image IS NOT NULL AND public.wish_link_url_ok(p_image) THEN p_image END;", "    v_image := p_image;"],
  saveNoStrip: ["'[[:cntrl:]\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]', '', 'g'), '\\s+', ' ', 'g')), 200);", "'x^', '', 'g'), '\\s+', ' ', 'g')), 200);"],
  saveStatusOpen: ["  IF p_id IS NULL OR p_status IS NULL OR p_status NOT IN ('ok', 'none', 'skipped', 'blocked', 'failed') THEN", "  IF p_id IS NULL THEN"],
  saveDetailsOnFail: ["  IF p_status IN ('ok', 'none') THEN\n    -- Never trusted", "  IF true THEN\n    -- Never trusted"],
  dueAnon: ["REVOKE ALL ON FUNCTION public.wish_link_pages_due(integer) FROM PUBLIC, anon, authenticated;", "GRANT EXECUTE ON FUNCTION public.wish_link_pages_due(integer) TO authenticated;"],
  saveAnon: ["REVOKE ALL ON FUNCTION public.wish_link_page_save(uuid, text, text, text, numeric) FROM PUBLIC, anon, authenticated;", "GRANT EXECUTE ON FUNCTION public.wish_link_page_save(uuid, text, text, text, numeric) TO anon;"],
  adminNoPage: ["            'page_title', r.page_title, 'page_image', r.page_image, 'page_price', r.page_price,\n", "\n"],
  saveRangeBeforeRound: ["    v_price := round(p_price, 2);\n    v_price := CASE WHEN v_price > 0 AND v_price < 100000 THEN v_price END;", "    v_price := CASE WHEN p_price > 0 AND p_price < 100000 THEN round(p_price, 2) END;"],
  saveOkWithNothing: ["  v_status := CASE WHEN p_status = 'ok' AND v_title IS NULL AND v_image IS NULL AND v_price IS NULL THEN 'none' ELSE p_status END;", "  v_status := p_status;"],
  adminOpen: ["    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';\n  END IF;\n  -- Test data never shows", "    NULL;\n  END IF;\n  -- Test data never shows"],
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
const ADMIN = "44444444-0000-0000-0000-000000000001";
const ANN = "44444444-0000-0000-0000-000000000002";
const TEST = "44444444-0000-0000-0000-000000000003";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  INSERT INTO auth.users VALUES ('${ADMIN}'), ('${ANN}'), ('${TEST}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  INSERT INTO public.test_accounts VALUES ('${TEST}');
  CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p) $f$;
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  CREATE FUNCTION public.has_role(p uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles u WHERE u.user_id = p AND u.role = r) $f$;
  CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid NOT NULL, action text NOT NULL, target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
`);
await db.exec(readFileSync(MIG_DIR + BASE, "utf8"));
await db.exec(readFileSync(MIG_DIR + SHARE, "utf8"));
await db.exec(readFileSync(MIG_DIR + LINKQ, "utf8"));
if (process.env.NEW_MIGRATION !== "skip") for (let k = 0; k < 3; k++) await db.exec(mig);

const as = async (uid, addr) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? ""]);
  await db.query(`SELECT set_config('request.headers', $1, false)`, [JSON.stringify({ "x-forwarded-for": `9.9.9.9, ${addr ?? "1.1.1.1"}` })]);
};
const call = async (sql, params) => {
  try { return { v: (await db.query(sql, params)).rows[0]?.v }; } catch (e) { return { err: String(e.message) }; }
};
const add = (kind, words, url, list = "p1", name = "Mom", test = false) =>
  call(`SELECT public.wish_link_request_add($1, $2, $3, $4, $5, $6) AS v`, [kind, words, url, list, name, test]);
const due = (n = 8) => call(`SELECT public.wish_link_pages_due($1) AS v`, [n]);
const save = (id, status, title = null, image = null, price = null) =>
  call(`SELECT public.wish_link_page_save($1, $2, $3, $4, $5) AS v`, [id, status, title, image, price]);
const row = async (id) => (await db.query(`SELECT * FROM public.wish_link_requests WHERE id = $1`, [id])).rows[0];

const ETSY = "https://www.etsy.com/listing/99/hand-knit-scarf";
const TARGET = "https://www.target.com/p/stanley-cup/-/A-1";
const AMZ = "https://www.amazon.com/dp/B000000002";

// Rows: Etsy on two lists, Target, an Amazon link, an idea, a test row, a dismissed row.
await as(null, "2.2.2.2");
const e1 = (await add("link", "Hand knit scarf", ETSY)).v.id;
const e2 = (await add("link", "Scarf", ETSY, "p2", "Dad")).v.id;
const t1 = (await add("link", "Stanley cup", TARGET)).v.id;
const a1 = (await add("link", "Cozy throw", AMZ)).v.id;
const i1 = (await add("idea", "LSU hoodie", null)).v.id;
await as(TEST, "3.3.3.3");
const s1 = (await add("link", "Seed thing", "https://www.etsy.com/listing/7/seed", "p3", "Test", true)).v.id;
await as(null, "4.4.4.4");
const d1 = (await add("link", "Dismissed thing", "https://www.etsy.com/listing/8/gone", "p4", "Sue")).v.id;
await db.query(`UPDATE public.wish_link_requests SET status = 'dismissed' WHERE id = $1`, [d1]);
check(!!(await row(s1))?.is_seed, "the test row is is_seed (by the queue's own rule)");

// Due: one per page, open, unchecked, never Amazon/idea/test/dismissed.
const d0 = await due();
const ids = (d0.v ?? []).map((x) => x.id);
check(ids.length === 2 && ids.includes(t1) && (ids.includes(e1) || ids.includes(e2)), `due: Etsy once and Target (${JSON.stringify(d0)})`);
check(!ids.includes(a1) && !ids.includes(i1) && !ids.includes(s1) && !ids.includes(d1), "due: never Amazon, an idea, a test row or a dismissed row");
check((d0.v ?? []).every((x) => typeof x.url === "string" && Object.keys(x).length === 2), "due: only id and url");
check(/invalid_limit/.test((await due(0)).err ?? "") && /invalid_limit/.test((await due(21)).err ?? ""), "due: 1..20 only");
check((await due(1)).v?.length === 1, "due: the limit holds");

// Save: ok with details, cleaned, spread to the other unchecked row for the same page.
const etsyId = ids.find((x) => x === e1 || x === e2);
const other = etsyId === e1 ? e2 : e1;
const n1 = await save(etsyId, "ok", "  Hand\u202e Knit\u200b   Scarf\n", "https://i.etsystatic.com/1.jpg", 24.999);
check(n1.v === 2, `save stamps the row and the other unchecked row for the page (${JSON.stringify(n1)})`);
const r1 = await row(other);
check(r1.page_status === "ok" && r1.page_checked_at !== null, "the other row is checked too");
check(r1.page_title === "Hand Knit Scarf", `the title is cleaned (${JSON.stringify(r1.page_title)})`);
check(r1.page_image === "https://i.etsystatic.com/1.jpg" && Number(r1.page_price) === 25, `photo kept, price to the cent (${r1.page_price})`);
check(!(((await due()).v ?? []).some((x) => x.id === e1 || x.id === e2)), "a checked page is not due again");

// Untrusted values are dropped; a failure stores only its kind.
const n2 = await save(t1, "ok", "x".repeat(300), "http://evil.example.com/x.jpg", 250000);
const r2 = await row(t1);
check(n2.v === 1 && r2.page_title?.length === 200 && r2.page_image === null && r2.page_price === null, `long title cut, http photo and huge price dropped (${JSON.stringify([r2.page_title?.length, r2.page_image, r2.page_price])})`);
const n2b = await save(t1, "ok", "Cup", "https://localhost/x.jpg", -5);
check(n2b.v === 1 && (await row(t1)).page_image === null && (await row(t1)).page_price === null, "a private-host photo and a negative price are dropped");
const n3 = await save(t1, "failed", "Leaked title", "https://img.example.com/a.jpg", 10);
const r3 = await row(t1);
check(n3.v === 1 && r3.page_status === "failed" && r3.page_title === null && r3.page_image === null && r3.page_price === null, "a failed read stores only its kind");
const n2c = await save(t1, "ok", "Big", null, 99999.995);
check(n2c.v === 1 && (await row(t1)).page_price === null, `a price that rounds to $100,000 is dropped, never a failed save (${JSON.stringify(n2c)})`);
const n2d = await save(t1, "ok", " \u200b ", "http://x.example.com/a.jpg", 0);
check(n2d.v === 1 && (await row(t1)).page_status === "none", "an ok page with nothing kept is stored as none");
check(/invalid_status/.test((await save(t1, "great")).err ?? "") && /invalid_status/.test((await save(t1, null)).err ?? ""), "an unknown status is refused");
check((await save("44444444-9999-0000-0000-000000000000", "ok", "x")).v === 0, "a row that is gone: 0");
check((await save(i1, "ok", "x")).v === 0 && (await row(i1)).page_status === null, "an idea row is never stamped");

// The admin queue carries the page fields; only an admin may read it.
await as(ADMIN, "5.5.5.5");
const q = await call(`SELECT public.admin_wish_link_requests() AS v`);
const qe = (q.v ?? []).find((x) => x.id === other);
check(qe?.page_title === "Hand Knit Scarf" && qe?.page_image === "https://i.etsystatic.com/1.jpg" && Number(qe?.page_price) === 25 && qe?.page_status === "ok" && !!qe?.page_checked_at,
  `the admin queue shows the page's title, photo, price and check (${JSON.stringify(qe)})`);
check(!(q.v ?? []).some((x) => x.id === s1), "the admin queue still leaves test rows out");
await as(ANN, "6.6.6.6");
check(/not_authorized/.test((await call(`SELECT public.admin_wish_link_requests() AS v`)).err ?? ""), "a member may not read the admin queue");

// Privileges: service role only.
const priv = (await db.query(`SELECT
  has_function_privilege('anon', 'public.wish_link_pages_due(integer)', 'EXECUTE') AS da,
  has_function_privilege('authenticated', 'public.wish_link_pages_due(integer)', 'EXECUTE') AS du,
  has_function_privilege('anon', 'public.wish_link_page_save(uuid, text, text, text, numeric)', 'EXECUTE') AS sa,
  has_function_privilege('authenticated', 'public.wish_link_page_save(uuid, text, text, text, numeric)', 'EXECUTE') AS su,
  has_function_privilege('service_role', 'public.wish_link_pages_due(integer)', 'EXECUTE') AS ds,
  has_function_privilege('service_role', 'public.wish_link_page_save(uuid, text, text, text, numeric)', 'EXECUTE') AS ss,
  has_function_privilege('anon', 'public.admin_wish_link_requests()', 'EXECUTE') AS aa`)).rows[0];
check(!priv.da && !priv.du && !priv.sa && !priv.su && !priv.aa, `anon/authenticated may not call the page functions or the admin queue (${JSON.stringify(priv)})`);
check(priv.ds && priv.ss, "the service role may");
const acls = (await db.query(`SELECT proname, proacl::text AS acl FROM pg_proc WHERE proname IN ('wish_link_pages_due', 'wish_link_page_save')`)).rows;
check(acls.length === 2 && acls.every((r) => !/(^|[{,])=X/.test(r.acl ?? "=X")), `PUBLIC holds no EXECUTE on either (${JSON.stringify(acls)})`);

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
