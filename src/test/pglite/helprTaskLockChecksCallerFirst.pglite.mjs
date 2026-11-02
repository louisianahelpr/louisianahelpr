#!/usr/bin/env node
/**
 * PGlite proof for 20261102045504_helpr_task_lock_checks_the_caller_first (Q1945): a signed-in member who is no
 * party to a Helpr delivery task (not its Helpr, buyer or seller, not an admin) is refused 'task_not_found' BEFORE
 * helpr_task_lock takes the Declutter order lock; the parties, an admin, a service caller and any member on an
 * OPEN task (accept) still lock it.
 *
 *   node src/test/pglite/helprTaskLockChecksCallerFirst.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/helprTaskLockChecksCallerFirst.pglite.mjs # RED: the 20261017055505 version
 *   MUTANT=<name> node src/test/pglite/helprTaskLockChecksCallerFirst.pglite.mjs      # a planted defect: must FAIL
 *
 * Stubbed, said so: helpr_tasks reduced to the columns the function reads (the real function returns the row type);
 * declutter_lock_order counts its calls on a SEQUENCE (a sequence is not rolled back by the refusal, so a lock
 * taken before a refusal is still seen); has_role from a user_roles table; auth.uid() from request.jwt.claim.sub.
 * The function is service-role only (REVOKE FROM PUBLIC, anon, authenticated), so it is called here as the
 * SECURITY DEFINER member RPCs call it, with the member's auth.uid(). Supabase's default EXECUTE grant to
 * anon/authenticated on new functions is emulated; this function already exists with it revoked (applied first
 * here, as on prod) and CREATE OR REPLACE keeps that ACL, so a dropped REVOKE is not a live defect.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102045504_helpr_task_lock_checks_the_caller_first.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The check runs AFTER the order lock.
  lockFirst: [
    "  -- Q1945: a member who is no party to a task that is not open takes no lock.\n  IF v_uid IS NOT NULL",
    "  IF t.source_kind = 'declutter_delivery' THEN\n    PERFORM public.declutter_lock_order(t.source_id);\n  END IF;\n  IF v_uid IS NOT NULL",
  ],
  // The seller is treated as a stranger.
  noSeller: ["     AND v_uid IS DISTINCT FROM t.pickup_contact_id\n", ""],
  // An open task is refused to strangers too (nobody could take a delivery).
  noOpen: ["IF v_uid IS NOT NULL AND t.status IS DISTINCT FROM 'open'", "IF v_uid IS NOT NULL"],
  // Admins are refused.
  noAdmin: ["     AND NOT public.has_role(v_uid, 'admin') THEN", "     THEN"],
};
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `dddddddd-0000-0000-0000-${String(n).padStart(12, "0")}`;
const HELPR = U(1), BUYER = U(2), SELLER = U(3), STRANGER = U(4), ADMIN = U(5);
const TASK = U(10), OPEN_TASK = U(11), ORDER = U(20);

/** The 20261017055505 definition of helpr_task_lock (the one on prod before this migration). */
function before() {
  const sql = readFileSync(MIG_DIR + "20261017055505_declutter_helpr_delivery.sql", "utf8");
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.helpr_task_lock(p_task uuid)");
  const end = sql.indexOf("GRANT EXECUTE ON FUNCTION public.helpr_task_lock(uuid) TO service_role;", start);
  return sql.slice(start, end) + "GRANT EXECUTE ON FUNCTION public.helpr_task_lock(uuid) TO service_role;";
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, source_kind text NOT NULL, source_id uuid NOT NULL, status text NOT NULL,
  helpr_id uuid, customer_id uuid, pickup_contact_id uuid);
CREATE SEQUENCE public.order_locks;
CREATE FUNCTION public.declutter_lock_order(p_order uuid) RETURNS void LANGUAGE sql AS $$ SELECT nextval('public.order_locks') $$;
`);
const q = async (s, p = []) => (await db.query(s, p)).rows;
await q(`INSERT INTO public.user_roles VALUES ($1, 'admin')`, [ADMIN]);
await q(`INSERT INTO public.helpr_tasks VALUES ($1, 'declutter_delivery', $3, 'accepted', $4, $5, $6),
  ($2, 'declutter_delivery', $3, 'open', NULL, $5, $6)`, [TASK, OPEN_TASK, ORDER, HELPR, BUYER, SELLER]);

await db.exec(before());
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

const locks = async () => Number((await q(`SELECT last_value, is_called FROM public.order_locks`)).map((r) => (r.is_called ? r.last_value : 0))[0]);
/** Call helpr_task_lock with auth.uid() = uid (null: a service caller), as the definer RPCs do. */
const lockAs = async (uid, task) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  const n0 = await locks();
  let err = null;
  try { await q(`SELECT (public.helpr_task_lock($1)).id`, [task]); } catch (e) { err = e.message; }
  return { err, locked: (await locks()) > n0 };
};

const stranger = await lockAs(STRANGER, TASK);
check(/task_not_found/.test(stranger.err ?? ""), `[fix] a stranger on a taken task is refused task_not_found (${stranger.err ?? "allowed"})`);
check(!stranger.locked, "[fix] and the Declutter order lock was never taken");
for (const [who, uid] of [["the Helpr", HELPR], ["the buyer", BUYER], ["the seller", SELLER], ["an admin", ADMIN], ["a service caller", null]]) {
  const r = await lockAs(uid, TASK);
  check(!r.err && r.locked, `${who} still locks the task and its order (${r.err ?? "ok"})`);
}
const open = await lockAs(STRANGER, OPEN_TASK);
check(!open.err && open.locked, `any member still locks an OPEN task (taking a delivery) (${open.err ?? "ok"})`);
const missing = await lockAs(STRANGER, U(99));
check(/task_not_found/.test(missing.err ?? ""), "an unknown task is task_not_found");

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.helpr_task_lock(uuid)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.helpr_task_lock(uuid)', 'EXECUTE') u`))[0];
  check(!acl.a && !acl.u, `members cannot call it directly (anon ${acl.a}, authenticated ${acl.u})`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
