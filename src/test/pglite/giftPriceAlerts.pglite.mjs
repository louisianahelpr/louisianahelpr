#!/usr/bin/env node
/**
 * PGlite proof for *_gift_price_alerts.sql (owner 2026-11-21, saved-gift price alerts).
 *   - gift_price_alert_subscribe refuses without consent, refuses a bad address, keeps only well-formed items (https,
 *     a name, a sane price), each link once, at most 60; refuses a list with none;
 *   - rate limited: 5 per network address in an hour, 3 per email address in a day;
 *   - a price the caller sends is ignored (the sender takes the guide's own); no caller price is ever stored;
 *   - signing up again replaces the list but keeps a still-listed gift's sender marks (price, seen, alerted);
 *   - an unsubscribed address is NOT turned back on by a signed-out request or by another member, only by the
 *     signed-in member whose confirmed login email it is; the refusal is an answer, not an error, so its rate-limit
 *     hits are kept;
 *   - is_seed by the ADDRESS only (a seed profile's address, a fixture inbox, a reserved domain), never by the caller;
 *   - anon and authenticated cannot read or write either table (RLS on, no grants);
 *   - the cleanup deletes last season's rows only.
 *
 *   node src/test/pglite/giftPriceAlerts.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/giftPriceAlerts.pglite.mjs # RED
 *   MUTANT=<name> node ...                                             # each must FAIL (see MUTANTS)
 *
 * Stubbed, and said so: auth.uid() reads the test.uid setting; is_test_member = a test_accounts list;
 * is_fixture_email = @mailinator.com; request.headers carries the x-forwarded-for the rate limit reads.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_gift_price_alerts.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANTS = {
  noConsent: ["  IF p_consent IS NOT TRUE THEN\n    RAISE EXCEPTION 'no_consent'", "  IF false THEN\n    RAISE EXCEPTION 'no_consent'"],
  httpLinks: ["v_href !~ '^https://[^[:space:]<>\"]+$'", "v_href !~ '^https?://[^[:space:]<>\"]+$'"],
  noIpLimit: ["hit_at > now() - interval '1 hour') >= 5", "hit_at > now() - interval '1 hour') >= 500"],
  noEmailLimit: ["hit_at > now() - interval '1 day') >= 3", "hit_at > now() - interval '1 day') >= 300"],
  anonResubscribes: ["    IF NOT v_own_address THEN", "    IF false THEN"],
  anyMemberResubscribes: ["WHERE u.id = v_uid AND lower(u.email) = v_email AND u.email_confirmed_at IS NOT NULL)", "WHERE u.id = v_uid)"],
  dropAlerted: ["n.e || COALESCE(jsonb_strip_nulls(jsonb_build_object('price', o.e->'price', 'seen', o.e->'seen', 'alerted', o.e->'alerted')), '{}'::jsonb)", "n.e"],
  seedNotMarked: ["  v_seed := EXISTS", "  v_seed := false AND EXISTS"],
  seedByCaller: ["  v_seed := EXISTS", "  v_seed := COALESCE(public.is_test_member(v_uid), false) OR EXISTS"],
  keepsClientPrice: ["jsonb_build_object('href', v_href, 'name', v_name, 'guide', v_guide)", "jsonb_build_object('href', v_href, 'name', v_name, 'guide', v_guide, 'price', v_el->'price')"],
  unsubscribedRaises: ["      RETURN jsonb_build_object('items', 0, 'was_unsubscribed', true);", "      RAISE EXCEPTION 'was_unsubscribed';"],
  tableOpen: ["REVOKE ALL ON TABLE public.gift_price_alerts FROM PUBLIC, anon, authenticated;", "GRANT SELECT ON TABLE public.gift_price_alerts TO anon, authenticated;"],
  expireAll: ["  DELETE FROM public.gift_price_alerts\n   WHERE", "  DELETE FROM public.gift_price_alerts\n   WHERE true OR"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], () => m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const ANN = U(1), BEN = U(2), TEST = U(3);

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_accounts WHERE user_id = p) $f$;
  CREATE FUNCTION public.is_fixture_email(e text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT e ILIKE '%@mailinator.com' $f$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email text, is_seed boolean NOT NULL DEFAULT false);
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  INSERT INTO auth.users VALUES ('${ANN}', 'ann@gmail.com', now()), ('${BEN}', 'ben@gmail.com', now()), ('${TEST}', 'qa@gmail.com', now());
  INSERT INTO public.test_accounts VALUES ('${TEST}');
  INSERT INTO public.profiles VALUES ('${ANN}', 'ann@gmail.com', false), (gen_random_uuid(), 'seedy@louisianahelpr.com', true);
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
const clearHits = () => db.exec(`DELETE FROM public.gift_price_alert_hits`);
const sub = (email, items, consent = true) =>
  q(`SELECT public.gift_price_alert_subscribe($1, $2::jsonb, $3) AS r`, [email, JSON.stringify(items), consent]);
const subErr = (email, items, consent = true) =>
  err(`SELECT public.gift_price_alert_subscribe($1, $2::jsonb, $3) AS r`, [email, JSON.stringify(items), consent]);
const row = async (email) => (await q(`SELECT * FROM public.gift_price_alerts WHERE email = $1`, [email]))[0];

const A = { href: "https://shop.example/a", name: "Cozy socks", price: 20, guide: "her" };
const B = { href: "https://shop.example/b", name: "Mug", price: 12.345 };

try {
  await setAddr("10.0.0.1");
  await asUid(null);

  check(/no_consent/.test(await subErr("ann@gmail.com", [A], false) ?? ""), "refuses without the consent box");
  check(/bad_email/.test(await subErr("not-an-email", [A]) ?? ""), "refuses an address that is not one");
  check(/no_items/.test(await subErr("ann@gmail.com", [{ href: "http://x.com/a", name: "x" }, { href: "https://x.com/b", name: "  " }, "junk"]) ?? ""), "refuses a list with no well-formed item (http link, blank name, not an object)");
  await clearHits();

  const r1 = await sub(" Ann@Gmail.com ", [A, B, A, { href: "https://shop.example/c", name: "Big", price: 99999 }, { href: "javascript:alert(1)", name: "bad" }]);
  check(r1[0]?.r?.items === 3, "keeps 3 well-formed items (duplicate link and javascript: link dropped)");
  const ann = await row("ann@gmail.com");
  check(!!ann && ann.is_seed === false && ann.consent_at !== null, "stores the address lowercased and trimmed, with consent time, not seed");
  check(ann?.items.every((i) => !("price" in i)), "a price the caller sends is never stored (the sender takes the guide's own)");

  // Re-subscribe keeps a still-listed gift's alerted price.
  await db.exec(`UPDATE public.gift_price_alerts SET items = jsonb_set(jsonb_set(jsonb_set(items, '{0,alerted}', '15'), '{0,price}', '20'), '{0,seen}', '15') WHERE email = 'ann@gmail.com'`);
  await clearHits();
  await sub("ann@gmail.com", [A, { href: "https://shop.example/d", name: "New thing" }]);
  const ann2 = await row("ann@gmail.com");
  check(ann2.items.length === 2 && Number(ann2.items[0].alerted) === 15 && Number(ann2.items[0].price) === 20 && Number(ann2.items[0].seen) === 15 && !("alerted" in ann2.items[1]) && !("price" in ann2.items[1]),
    "signing up again replaces the list and keeps a still-listed gift's price, seen and alerted marks");

  // Rate limits.
  await clearHits();
  for (let i = 0; i < 5; i++) await sub(`r${i}@gmail.com`, [A]);
  check(/rate_limited/.test(await subErr("r9@gmail.com", [A]) ?? ""), "a 6th sign-up from one address in an hour is refused");
  await setAddr("10.0.0.2");
  check((await subErr("r9@gmail.com", [A])) === null, "another network address is not limited by the first");
  await clearHits();
  for (let i = 0; i < 3; i++) { await setAddr(`10.0.1.${i}`); await sub("same@gmail.com", [A]); }
  await setAddr("10.0.1.9");
  check(/rate_limited/.test(await subErr("same@gmail.com", [A]) ?? ""), "a 4th sign-up for one email address in a day is refused, from any network");
  await clearHits();
  await setAddr("10.0.0.3");

  // Unsubscribed addresses.
  await db.exec(`UPDATE public.gift_price_alerts SET unsubscribed_at = now() WHERE email = 'ann@gmail.com'`);
  const hitsBefore = (await q(`SELECT count(*)::int AS n FROM public.gift_price_alert_hits`))[0].n;
  const anonRe = (await sub("ann@gmail.com", [A]))[0]?.r;
  const hitsAfter = (await q(`SELECT count(*)::int AS n FROM public.gift_price_alert_hits`))[0].n;
  check(anonRe?.was_unsubscribed === true && anonRe?.items === 0 && (await row("ann@gmail.com")).unsubscribed_at !== null, "a signed-out request does not turn an unsubscribed address back on");
  check(hitsAfter === hitsBefore + 2, "that refusal keeps its rate-limit hits (asking is not free)");
  await asUid(BEN);
  check((await sub("ann@gmail.com", [A]))[0]?.r?.was_unsubscribed === true && (await row("ann@gmail.com")).unsubscribed_at !== null, "another member cannot turn someone else's unsubscribed address back on");
  await asUid(ANN);
  check((await subErr("ann@gmail.com", [A])) === null && (await row("ann@gmail.com")).unsubscribed_at === null, "the signed-in owner of the address can turn it back on");
  await asUid(null);
  await clearHits();

  // Seed marking.
  await asUid(TEST);
  await sub("tester@gmail.com", [A]);
  await asUid(null);
  await sub("seedy@louisianahelpr.com", [A]);
  await sub("box@mailinator.com", [A]);
  await clearHits();
  await sub("x@foo.test", [A]);
  const seeds = await q(`SELECT email, is_seed FROM public.gift_price_alerts WHERE email IN ('seedy@louisianahelpr.com','box@mailinator.com','x@foo.test')`);
  check(seeds.length === 3 && seeds.every((s) => s.is_seed === true), "is_seed for a seed profile's address, a fixture inbox and a reserved domain");
  check((await row("tester@gmail.com")).is_seed === false, "a test account signing up a real address does not mark it seed (the address decides)");
  check((await row("r0@gmail.com")).is_seed === false, "a real address is not seed");

  // No client access to the tables.
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    const readErr = await err(`SELECT * FROM public.gift_price_alerts`);
    const writeErr = await err(`INSERT INTO public.gift_price_alerts (email, items, consent_at) VALUES ('z@gmail.com', '[{"href":"https://a.b/c","name":"x"}]', now())`);
    const hitsErr = await err(`SELECT * FROM public.gift_price_alert_hits`);
    await db.exec(`RESET ROLE`);
    check(/permission denied/.test(readErr ?? "") && /permission denied/.test(writeErr ?? "") && /permission denied/.test(hitsErr ?? ""), `${role} cannot read or write the tables`);
  }
  // ... but may call the opt-in.
  await clearHits();
  await db.exec(`SET ROLE anon`);
  const anonCall = await err(`SELECT public.gift_price_alert_subscribe('anon1@gmail.com', '[{"href":"https://a.b/c","name":"x"}]'::jsonb, true)`);
  await db.exec(`RESET ROLE`);
  check(anonCall === null, "anon may call the opt-in");

  // Cleanup: last season's rows only.
  await db.exec(`UPDATE public.gift_price_alerts SET created_at = now() - interval '400 days' WHERE email = 'r1@gmail.com'`);
  const before = (await q(`SELECT count(*)::int AS n FROM public.gift_price_alerts`))[0].n;
  await q(`SELECT public.gift_price_alerts_expire()`);
  const after = (await q(`SELECT count(*)::int AS n FROM public.gift_price_alerts`))[0].n;
  check(after === before - 1 && !(await row("r1@gmail.com")), "the cleanup deletes only last season's subscription");
} catch (e) {
  console.log(`FAIL  threw: ${e.message}`);
  failures++;
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
