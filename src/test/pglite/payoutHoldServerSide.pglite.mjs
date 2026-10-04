#!/usr/bin/env node
/**
 * PGlite proof for 20261004162921_payout_holds_server_side (docs/OPEN.md Q764).
 *
 *   node src/test/pglite/payoutHoldServerSide.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/payoutHoldServerSide.pglite.mjs   # RED: live state, no hold anywhere
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = what the migration touches, as LIVE on 2026-10-03:
 *   - public.payout_transfers with its live nullability and CHECKs
 *     (helper_id, stripe_transfer_id, stripe_account_id nullable; status in
 *     pending/paid/failed/canceled/reversed/reversal_cleared; pg_constraint);
 *   - has_role restated from its effective definition, user_roles, app_role;
 *   - auth.users / auth.uid() and the anon/authenticated/service_role roles;
 *   - attach_unconfirmed_email_gate() stubbed (its own proof is
 *     unconfirmedEmailWritesRefused.pglite.mjs).
 * export_my_data is created by the migration (it must compile); its new
 * payout_holds section is run on its own, cut verbatim from the function body.
 *
 * The migration is applied 3x (replay-safe), then:
 *   - a pending CLAIM row (no transfer id) for a held Helpr is refused, which
 *     is what stops release-payout / process-scheduled-payouts at the claim if
 *     a hold lands after their read; RED on the live state (it inserts);
 *   - rows that RECORD money already moved (paid with a transfer id, failed)
 *     are still accepted for a held Helpr, and an unheld Helpr's claim lands;
 *   - only an admin can place, deny or release a hold (authenticated non-admin
 *     and anon get an error), deny without a hold is refused, release reports
 *     whether a hold existed;
 *   - admins read every hold, a non-admin reads none, anon has no grant, and
 *     no client role can write the table directly;
 *   - each writer leaves its own admin_audit_log row (who, what, whom, why);
 *     a release of a hold that was not there leaves none;
 *   - the export section returns the person's hold without held_by/denied_by.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(
  new URL("../../../supabase/migrations/20261004162921_payout_holds_server_side.sql", import.meta.url).pathname,
  "utf8",
);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const HELPER = "bbbbbbbb-0000-4000-8000-000000000002";
const OTHER = "cccccccc-0000-4000-8000-000000000003";
const JOB = "10000000-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${HELPER}'), ('${OTHER}');

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
-- Effective definition (20260311000404).
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated, service_role;

-- Live column types (information_schema, 2026-10-03): target_id is TEXT.
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;

CREATE TABLE public.payout_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_transfer_id text UNIQUE,
  stripe_account_id text,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd',
  platform_fee_cents integer NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','paid','failed','canceled','reversed','reversal_cleared'])),
  failure_reason text,
  initiated_by text NOT NULL DEFAULT 'system' CHECK (initiated_by = ANY (ARRAY['system','admin','auto'])),
  initiated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  failed_at timestamptz,
  reversed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT ALL ON public.payout_transfers TO service_role;
`);

if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) {
    try { await db.exec(NEW); }
    catch (e) { check(`migration applies (run ${i + 1})`, false, e.message); }
  }
}

/** Run `sql` as `who` (an auth uid, "service", or null for anon). */
async function as(who, sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}

const claim = (helper, extra = {}) => {
  const row = { status: "pending", stripe_transfer_id: null, ...extra };
  return as(
    "service",
    `INSERT INTO public.payout_transfers (job_id, helper_id, stripe_transfer_id, stripe_account_id, amount_cents, status)
     VALUES ($1, $2, $3, 'acct_x', 1000, $4) RETURNING id`,
    [JOB, helper, row.stripe_transfer_id, row.status],
  );
};

// ── Authz on the writers ────────────────────────────────────────────────────
const byHelper = await as(HELPER, `SELECT public.admin_set_payout_hold('${HELPER}', 'self-clear attempt')`);
check("a non-admin cannot place a hold", !byHelper.ok, byHelper.err ?? "succeeded");
const byAnon = await as(null, `SELECT public.admin_set_payout_hold('${HELPER}', 'x')`);
check("anon cannot place a hold", !byAnon.ok, byAnon.err ?? "succeeded");
const blank = await as(ADMIN, `SELECT public.admin_set_payout_hold('${HELPER}', '   ')`);
check("a blank reason is refused", !blank.ok, blank.err ?? "succeeded");
const denyNone = await as(ADMIN, `SELECT public.admin_deny_payout_hold('${HELPER}', 'no hold yet')`);
check("deny without a hold is refused", !denyNone.ok && /no_payout_hold/.test(denyNone.err ?? ""), denyNone.err ?? "succeeded");

// Before any hold: an unheld Helpr's claim lands.
const unheldClaim = await claim(HELPER);
check("an unheld Helpr's claim row lands", unheldClaim.ok, unheldClaim.err);
await db.exec("DELETE FROM public.payout_transfers");

const placed = await as(ADMIN, `SELECT * FROM public.admin_set_payout_hold('${HELPER}', '  fraud review  ')`);
check("an admin places a hold", placed.ok && placed.rows[0]?.reason === "fraud review" && placed.rows[0]?.held_by === ADMIN,
  placed.err ?? JSON.stringify(placed.rows?.[0]));

// ── The claim a held Helpr cannot take ─────────────────────────────────────
const heldClaim = await claim(HELPER);
check("a held Helpr's pending CLAIM row is refused", !heldClaim.ok && /payout_held/.test(heldClaim.err ?? ""), heldClaim.err ?? "inserted");
const paidRecord = await claim(HELPER, { status: "paid", stripe_transfer_id: "tr_recorded" });
check("a row RECORDING a transfer that already moved is still accepted", paidRecord.ok, paidRecord.err);
const failedRecord = await claim(HELPER, { status: "failed" });
check("a failed-attempt row is still accepted", failedRecord.ok, failedRecord.err);
const otherClaim = await claim(OTHER);
check("another Helpr's claim still lands", otherClaim.ok, otherClaim.err);
const nullClaim = await claim(null);
check("a redacted (NULL helper) claim is not refused by the trigger", nullClaim.ok, nullClaim.err);

// ── Reads ──────────────────────────────────────────────────────────────────
const adminRead = await as(ADMIN, "SELECT helper_id, reason FROM public.payout_holds");
check("an admin reads the hold", adminRead.ok && adminRead.rows.length === 1, adminRead.err ?? JSON.stringify(adminRead.rows));
const helperRead = await as(HELPER, "SELECT helper_id FROM public.payout_holds");
check("a non-admin reads no hold (RLS)", helperRead.ok && helperRead.rows.length === 0, helperRead.err ?? JSON.stringify(helperRead.rows));
const anonRead = await as(null, "SELECT helper_id FROM public.payout_holds");
check("anon has no grant on payout_holds", !anonRead.ok, anonRead.err ?? "read");
const directDelete = await as(ADMIN, `DELETE FROM public.payout_holds WHERE helper_id = '${HELPER}' RETURNING helper_id`);
check("not even an admin deletes a hold directly (RPC only)", !directDelete.ok, directDelete.err ?? JSON.stringify(directDelete.rows));
const directInsert = await as(HELPER, `INSERT INTO public.payout_holds (helper_id, reason) VALUES ('${OTHER}', 'x')`);
check("no client inserts a hold directly", !directInsert.ok, directInsert.err ?? "inserted");

// ── Deny, release ──────────────────────────────────────────────────────────
const denied = await as(ADMIN, `SELECT * FROM public.admin_deny_payout_hold('${HELPER}', 'compliance failed')`);
check("an admin records a denial on the hold", denied.ok && denied.rows[0]?.denied_reason === "compliance failed" && denied.rows[0]?.denied_by === ADMIN,
  denied.err ?? JSON.stringify(denied.rows?.[0]));
const deniedClaim = await claim(HELPER);
check("a denied hold still refuses the claim", !deniedClaim.ok, deniedClaim.err ?? "inserted");

// ── Export section, cut verbatim from the migrated export_my_data ───────────
const def = (await db.query("SELECT prosrc FROM pg_proc WHERE proname = 'export_my_data'")).rows[0]?.prosrc ?? "";
const m = /jsonb_build_object\('payout_holds', (\(SELECT[\s\S]*?WHERE t\.helper_id = v_uid\))\)/.exec(def);
check("export_my_data has a payout_holds section", !!m);
if (m) {
  const r = await db.query(`SELECT ${m[1].replaceAll("v_uid", `'${HELPER}'::uuid`)} AS s`);
  const s = r.rows[0]?.s ?? [];
  check("the export returns the person's own hold", s.length === 1 && s[0].reason === "fraud review", JSON.stringify(s));
  check("the export strips the staff ids", s.length === 1 && !("held_by" in s[0]) && !("denied_by" in s[0]) && "denied_reason" in s[0], JSON.stringify(s));
  const o = await db.query(`SELECT ${m[1].replaceAll("v_uid", `'${OTHER}'::uuid`)} AS s`);
  check("nobody else's hold is exported", (o.rows[0]?.s ?? []).length === 0, JSON.stringify(o.rows[0]?.s));
}
const execAcl = await db.query(
  "SELECT has_function_privilege('anon', 'public.export_my_data(uuid)', 'EXECUTE') AS anon, has_function_privilege('authenticated', 'public.export_my_data(uuid)', 'EXECUTE') AS auth",
).catch((e) => ({ rows: [{ err: e.message }] }));
check("export_my_data stays service-role only", execAcl.rows[0]?.anon === false && execAcl.rows[0]?.auth === false, JSON.stringify(execAcl.rows[0]));

const releasedByHelper = await as(HELPER, `SELECT public.admin_release_payout_hold('${HELPER}') AS r`);
check("a non-admin cannot release a hold", !releasedByHelper.ok, releasedByHelper.err ?? "released");
const released = await as(ADMIN, `SELECT public.admin_release_payout_hold('${HELPER}') AS r`);
check("an admin releases the hold (true)", released.ok && released.rows[0]?.r === true, released.err ?? JSON.stringify(released.rows));
const releasedAgain = await as(ADMIN, `SELECT public.admin_release_payout_hold('${HELPER}') AS r`);
check("releasing again reports no hold (false)", releasedAgain.ok && releasedAgain.rows[0]?.r === false, releasedAgain.err ?? JSON.stringify(releasedAgain.rows));
await db.exec("DELETE FROM public.payout_transfers WHERE status = 'pending' AND stripe_transfer_id IS NULL");
const afterRelease = await claim(HELPER);
check("after release the claim lands again", afterRelease.ok, afterRelease.err);

// ── Audit rows (Q76) ──────────────────────────────────────────────────────
const audit = (await db.query("SELECT admin_id, action, target_id, target_type, details FROM public.admin_audit_log ORDER BY created_at, action")).rows;
const actions = audit.map((r) => r.action).sort();
check("place, deny and release each wrote ONE audit row (the no-op release none)",
  JSON.stringify(actions) === JSON.stringify(["payout_denied", "payout_held_for_review", "payout_hold_released"]), JSON.stringify(actions));
check("audit rows name the admin, the Helpr and the reason",
  audit.length > 0 && audit.every((r) => r.admin_id === ADMIN && r.target_id === HELPER && r.target_type === "user" && typeof r.details?.reason === "string"),
  JSON.stringify(audit));

// ── Grants on the writers ─────────────────────────────────────────────────
for (const sig of ["admin_set_payout_hold(uuid, text)", "admin_deny_payout_hold(uuid, text)", "admin_release_payout_hold(uuid)"]) {
  const r = await db.query(`SELECT has_function_privilege('anon', 'public.${sig}', 'EXECUTE') AS a`).catch((e) => ({ rows: [{ a: e.message }] }));
  check(`anon has no EXECUTE on ${sig}`, r.rows[0]?.a === false, String(r.rows[0]?.a));
}

// ── SECURITY DEFINER hygiene: an empty search_path on every definer here ───
const cfg = (await db.query(
  "SELECT proname, proconfig FROM pg_proc WHERE proname IN ('admin_set_payout_hold','admin_deny_payout_hold','admin_release_payout_hold','refuse_payout_claim_while_held') ORDER BY proname",
)).rows;
check("all four definers run with search_path=\"\"",
  cfg.length === 4 && cfg.every((r) => JSON.stringify(r.proconfig) === JSON.stringify(['search_path=""'])), JSON.stringify(cfg));

console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
