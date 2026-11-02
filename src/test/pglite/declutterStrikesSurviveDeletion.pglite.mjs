#!/usr/bin/env node
/**
 * PGlite proof for 20261102032514_declutter_strikes_survive_deletion (Q2338): a member's ACTIVE Declutter strikes are
 * kept at account deletion under the one-way identity hash only, and come back (original dates) when a new account
 * verifies with the same identity; a deletion is never refused because of it.
 *
 *   node src/test/pglite/declutterStrikesSurviveDeletion.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterStrikesSurviveDeletion.pglite.mjs # RED: strikes die with the account
 *   MUTANT=<name> node src/test/pglite/declutterStrikesSurviveDeletion.pglite.mjs      # a planted defect: must FAIL
 *
 * Real: declutter_strike_expiry (its newest earlier CREATE) and the CASCADE from auth.users. Stubbed, said so: auth.users,
 * profiles and declutter_strikes reduced to the columns this reads (same FKs, reason CHECK and expiry trigger), and
 * log_cron_defect (records). Supabase's default anon/authenticated EXECUTE grant on new functions is emulated.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102032514_declutter_strikes_survive_deletion.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // Removed and expired strikes are kept too.
  keepAll: ["WHERE s.user_id = OLD.id AND s.removed_at IS NULL AND s.expires_at > now();", "WHERE s.user_id = OLD.id;"],
  // A retention failure refuses the deletion.
  refuseDelete: ["  EXCEPTION WHEN OTHERS THEN\n    -- A deletion is never refused for this", "  EXCEPTION WHEN division_by_zero THEN\n    -- A deletion is never refused for this"],
  // Restore copies instead of moving (the hash row outlives its use).
  copyNotMove: ["    DELETE FROM public.declutter_retained_strikes r\n     WHERE r.identity_sha256 = p_identity_sha256\n    RETURNING", "    SELECT r.offender_side, r.reason, r.given_at FROM public.declutter_retained_strikes r\n     WHERE r.identity_sha256 = p_identity_sha256 AND false IS NOT TRUE\n    --"],
  // Restore matches any hash.
  anyHash: ["     WHERE r.identity_sha256 = p_identity_sha256\n", "     WHERE true\n"],
  // The restore left open to members.
  openGrant: ["REVOKE ALL ON FUNCTION public.declutter_restore_retained_strikes(uuid, text) FROM PUBLIC, anon, authenticated;", ""],
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
const U = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ANN = U(1), BO = U(2), ANN2 = U(3), CY = U(4), DEE = U(5);
const HA = "a".repeat(64), HC = "c".repeat(64), HX = "e".repeat(64);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, identity_sha256 text);
CREATE TABLE public.declutter_strikes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offender_side text NOT NULL CHECK (offender_side IN ('buyer', 'seller')),
  reason text NOT NULL CHECK (reason IN ('missed_checkout', 'not_picked_up', 'seller_no_show', 'item_gone_after_sale',
    'cancelled_after_offers', 'not_as_described', 'fake_offer')),
  given_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, removed_at timestamptz,
  CONSTRAINT declutter_strikes_expiry CHECK (expires_at > given_at));
CREATE TABLE public.defects (fn text, ref text, msg text);
-- The unconfirmed-email gate (Q807) is attached by the migration; its body is proven in its own proof.
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.defects VALUES (p_fn, p_ref, p_msg) $$;
`);
await db.exec(definitionBefore("declutter_strike_expiry", THIS));
await db.exec(`CREATE TRIGGER declutter_strike_expiry BEFORE INSERT OR UPDATE OF given_at, expires_at ON public.declutter_strikes
  FOR EACH ROW EXECUTE FUNCTION public.declutter_strike_expiry();`);

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
const tryQ = async (s, p = []) => { try { return await q(s, p); } catch (e) { return { error: e.message }; } };
const member = async (id, h) => { await q(`INSERT INTO auth.users VALUES ($1)`, [id]); await q(`INSERT INTO public.profiles VALUES ($1, $2)`, [id, h]); };
const strike = (id, reason, ago, removed = false) => q(
  `INSERT INTO public.declutter_strikes (user_id, offender_side, reason, given_at, expires_at, removed_at)
   VALUES ($1, 'buyer', $2, now() - $3::interval, now(), CASE WHEN $4 THEN now() END)`, [id, reason, ago, removed]);
await member(ANN, HA); await member(BO, null); await member(CY, HC);
await strike(ANN, "missed_checkout", "10 days"); await strike(ANN, "not_picked_up", "200 days");
await strike(ANN, "fake_offer", "5 days", true);             // removed on appeal
await strike(ANN, "seller_no_show", "400 days");             // expired (a year after it was given)
await strike(BO, "missed_checkout", "3 days");
const annGiven = (await q(`SELECT given_at FROM public.declutter_strikes WHERE user_id = $1 AND reason = 'missed_checkout'`, [ANN]))[0].given_at;

await q(`DELETE FROM auth.users WHERE id = $1`, [ANN]);
await q(`DELETE FROM auth.users WHERE id = $1`, [BO]);
const kept = skip ? [] : await q(`SELECT identity_sha256, reason FROM public.declutter_retained_strikes ORDER BY reason`);
check(kept.length === 2 && kept.every((k) => k.identity_sha256 === HA), `[fix] Ann's 2 active strikes are kept under her identity hash (${kept.map((k) => k.reason)})`);
check(!kept.some((k) => ["fake_offer", "seller_no_show"].includes(k.reason)), "[fix] a removed and an expired strike are not kept");
check((await q(`SELECT count(*)::int n FROM public.declutter_strikes WHERE user_id IN ($1, $2)`, [ANN, BO]))[0].n === 0, "the account's own strike rows still go with it (CASCADE)");
const cols = skip ? [] : (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'declutter_retained_strikes' ORDER BY column_name`)).map((r) => r.column_name);
check(cols.join(",") === "expires_at,given_at,id,identity_sha256,offender_side,reason,retained_at", `[fix] only the hash, side, reason and dates are kept (${cols})`);

// Ann comes back as a new account and verifies with the same identity.
await member(ANN2, null);
const wrong = await tryQ(`SELECT public.declutter_restore_retained_strikes($1, $2) AS n`, [ANN2, HX]);
check(!wrong.error && wrong[0].n === 0, `[fix] another identity restores nothing (${JSON.stringify(wrong)})`);
const back = await tryQ(`SELECT public.declutter_restore_retained_strikes($1, $2) AS n`, [ANN2, HA]);
check(!back.error && back[0].n === 2, `[fix] the same identity gets both strikes back (${JSON.stringify(back)})`);
const mine = await q(`SELECT reason, given_at, expires_at FROM public.declutter_strikes WHERE user_id = $1 ORDER BY reason`, [ANN2]);
const mc = mine.find((m) => m.reason === "missed_checkout");
check(mine.length === 2 && mc && +mc.given_at === +annGiven, `[fix] with their original dates (${mine.map((m) => m.reason)})`);
const yr = await q(`SELECT bool_and(expires_at = given_at + interval '1 year') ok FROM public.declutter_strikes WHERE user_id = $1`, [ANN2]);
check(mine.length === 2 && yr[0].ok === true, "[fix] each still ends a year after it was given");
const left = skip ? [{ n: -1 }] : await q(`SELECT count(*)::int n FROM public.declutter_retained_strikes WHERE identity_sha256 = $1`, [HA]);
check(left[0].n === 0, `[fix] the kept rows are moved back, not copied (${left[0].n} left)`);
const again = await tryQ(`SELECT public.declutter_restore_retained_strikes($1, $2) AS n`, [ANN2, HA]);
check(!again.error && again[0].n === 0, "[fix] a second verification restores nothing twice");

// A retention that fails never refuses the deletion.
await strike(CY, "missed_checkout", "1 day");
if (!skip) await q(`ALTER TABLE public.declutter_retained_strikes ADD CONSTRAINT planted_refusal CHECK (false) NOT VALID`);
const del = await tryQ(`DELETE FROM auth.users WHERE id = $1`, [CY]);
check(!del.error && (await q(`SELECT count(*)::int n FROM auth.users WHERE id = $1`, [CY]))[0].n === 0, `[fix] a failed retention never refuses the deletion (${del.error ?? "deleted"})`);
check(skip || (await q(`SELECT count(*)::int n FROM public.defects WHERE fn = 'declutter_retain_strikes_on_delete' AND ref = $1`, [CY]))[0].n === 1, "[fix] and is logged");
if (!skip) await q(`ALTER TABLE public.declutter_retained_strikes DROP CONSTRAINT planted_refusal`);
// No identity hash: nothing to key on, nothing kept.
await member(DEE, null); await strike(DEE, "missed_checkout", "1 day");
await q(`DELETE FROM auth.users WHERE id = $1`, [DEE]);
check(skip || (await q(`SELECT count(*)::int n FROM public.declutter_retained_strikes`))[0].n === 0, "a member with no identity hash leaves nothing behind");

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.declutter_restore_retained_strikes(uuid, text)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_restore_retained_strikes(uuid, text)', 'EXECUTE') u,
    has_function_privilege('service_role', 'public.declutter_restore_retained_strikes(uuid, text)', 'EXECUTE') s,
    has_table_privilege('anon', 'public.declutter_retained_strikes', 'SELECT') ta,
    has_table_privilege('authenticated', 'public.declutter_retained_strikes', 'SELECT') tu,
    has_function_privilege('authenticated', 'public.declutter_retain_strikes_on_delete()', 'EXECUTE') tr`))[0];
  check(!acl.a && !acl.u && acl.s && !acl.ta && !acl.tu && !acl.tr, `grants: restore anon ${acl.a} auth ${acl.u} service ${acl.s}; table anon ${acl.ta} auth ${acl.tu}; trigger fn auth ${acl.tr}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
