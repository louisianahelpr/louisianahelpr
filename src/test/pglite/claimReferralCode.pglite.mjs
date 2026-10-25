#!/usr/bin/env node
/**
 * PGlite proof for 20261025202423_claim_referral_code_within_7_days (owner
 * 2026-10-25: a place to enter a friend's referral code after sign-up).
 *
 *   node src/test/pglite/claimReferralCode.pglite.mjs                    # AFTER
 *   NEW_MIGRATION=skip node src/test/pglite/claimReferralCode.pglite.mjs # RED: main
 *
 * record_referral_signup is prod's body (read live 2026-10-25). Proven: every
 * answer word, the 7-day window, once per account, anon refused, replay-safe.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261025202423_claim_referral_code_within_7_days.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const A = "11111111-1111-4111-8111-111111111111"; // the friend (owns FRIEND1)
const NEWBIE = "22222222-2222-4222-8222-222222222222";
const OLD = "33333333-3333-4333-8333-333333333333";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, created_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE TABLE public.referral_codes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, code text UNIQUE);
CREATE TABLE public.referrals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referrer_id uuid, referred_id uuid UNIQUE, referral_code_id uuid);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.record_referral_signup(p_referral_code text, p_new_user_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_code_record RECORD; v_inserted integer;
BEGIN
  IF p_referral_code IS NULL OR btrim(p_referral_code) = '' OR p_new_user_id IS NULL THEN RETURN FALSE; END IF;
  SELECT id, user_id INTO v_code_record FROM public.referral_codes WHERE code = UPPER(btrim(p_referral_code));
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_code_record.user_id = p_new_user_id THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = p_new_user_id) THEN RETURN FALSE; END IF;
  INSERT INTO public.referrals (referrer_id, referred_id, referral_code_id) VALUES (v_code_record.user_id, p_new_user_id, v_code_record.id) ON CONFLICT (referred_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT; RETURN v_inserted > 0;
END; $function$;
INSERT INTO auth.users VALUES ('${A}', now() - interval '30 days'), ('${NEWBIE}', now() - interval '2 days'), ('${OLD}', now() - interval '8 days');
INSERT INTO public.referral_codes (user_id, code) VALUES ('${A}', 'FRIEND1'), ('${NEWBIE}', 'NEWB1');
`);
if (MODE !== "skip") { for (let i = 0; i < 3; i++) await db.exec(NEW); check("migration applies 3x (replay-safe)", true); }

async function claim(role, uid, code) {
  try {
    await db.exec(`SET ROLE ${role}; SELECT set_config('request.uid', '${uid ?? ""}', false);`);
    const r = await db.query(`SELECT public.claim_my_referral_code($1) AS a`, [code]);
    return r.rows[0].a;
  } catch (e) { return `error: ${e.message.slice(0, 60)}`; } finally { await db.exec("RESET ROLE;"); }
}

check("anon cannot call it", String(await claim("anon", NEWBIE, "FRIEND1")).startsWith("error"));
check("blank -> invalid", (await claim("authenticated", NEWBIE, "  ")) === "invalid");
check("null -> invalid", (await claim("authenticated", NEWBIE, null)) === "invalid");
check("no user -> invalid", (await claim("authenticated", null, "FRIEND1")) === "invalid");
check("unknown code -> no_such_code", (await claim("authenticated", NEWBIE, "NOPE")) === "no_such_code");
check("own code -> own_code", (await claim("authenticated", NEWBIE, "newb1")) === "own_code");
check("8 days in -> too_late", (await claim("authenticated", OLD, "FRIEND1")) === "too_late");
check("a real friend's code, lower case -> recorded", (await claim("authenticated", NEWBIE, " friend1 ")) === "recorded");
check("second time -> already_referred", (await claim("authenticated", NEWBIE, "FRIEND1")) === "already_referred");
const rows = (await db.query(`SELECT count(*)::int AS n FROM public.referrals WHERE referred_id = '${NEWBIE}'`)).rows[0].n;
check("exactly one referral row", rows === 1, String(rows));
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
