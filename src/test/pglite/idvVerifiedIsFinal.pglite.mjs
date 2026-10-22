#!/usr/bin/env node
/**
 * PGlite proof for 20261022010525_idv_verified_leaves_only_by_decision
 * (member 7bb3a91e, 2026-10-21: a late 'processing' webhook overwrote 'verified').
 *
 *   node src/test/pglite/idvVerifiedIsFinal.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/idvVerifiedIsFinal.pglite.mjs  # RED: before it
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * The migration runs verbatim. Stubbed, and said so: the profiles columns it
 * touches, and the roles. The writes below are the exact ones the edge
 * functions send (stripe-idv-webhook's pre-077a2fd0fc unguarded update,
 * claim_idv_attempt's 'pending', admin-user-actions' idv_reject and
 * request_id_reupload).
 *
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/20261022010525_idv_verified_leaves_only_by_decision.sql", import.meta.url).pathname;
const SKIP = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.profiles (
    user_id uuid primary key, idv_status text default 'not_started'
      check (idv_status in ('not_started','pending','processing','verified','failed','manual_review','skipped')),
    idv_attempt_count integer not null default 0, idv_failure_reason text, idv_session_id text, idv_confidence numeric);
  grant all on public.profiles to service_role, authenticated;
`);
if (!SKIP) {
  const sql = readFileSync(MIG, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql); // replay-safe x3
}

const status = async (u) => (await db.query(`select idv_status from public.profiles where user_id = $1`, [u])).rows[0]?.idv_status;
const tryExec = async (sql, params = []) => {
  try { await db.query(sql, params); return null; } catch (e) { return e; }
};
const seed = async (u, s) => db.query(`insert into public.profiles (user_id, idv_status, idv_attempt_count) values ($1, $2, 1)`, [u, s]);

// 1. The incident: verified, then the late 'processing' event's unguarded write.
const Y = U(1);
await seed(Y, "verified");
const procErr = await tryExec(
  `update public.profiles set idv_session_id = 'vs_1', idv_status = 'processing' where user_id = $1`, [Y]);
check(procErr !== null && (await status(Y)) === "verified", "[fix] a late 'processing' write on a verified profile is refused, status stays verified");
check(procErr === null || /idv_verified_is_final/.test(String(procErr.message)), "[fix] the refusal names idv_verified_is_final");
check(procErr === null || procErr.code === "42501", "[fix] the refusal is 42501");

// 2. Every other non-decision value is refused too.
for (const [n, target] of [[2, "pending"], [3, "manual_review"], [4, "not_started"], [5, "skipped"]]) {
  const u = U(10 + n);
  await seed(u, "verified");
  const err = await tryExec(`update public.profiles set idv_status = $2 where user_id = $1`, [u, target]);
  check(err !== null && (await status(u)) === "verified", `[fix] verified -> ${target} without an admin is refused`);
}
{
  const u = U(16);
  await seed(u, "verified");
  const err = await tryExec(`update public.profiles set idv_status = null where user_id = $1`, [u]);
  check(err !== null && (await status(u)) === "verified", "[fix] verified -> NULL is refused");
}

// 3. Decisions and unrelated writes still land.
{
  const u = U(20);
  await seed(u, "verified");
  const err = await tryExec(`update public.profiles set idv_status = 'failed', idv_failure_reason = 'admin' where user_id = $1`, [u]);
  check(err === null && (await status(u)) === "failed", "[keep] verified -> failed (admin idv_reject, retained-ban refusal) lands");
}
{
  const u = U(21);
  await seed(u, "verified");
  const err = await tryExec(`update public.profiles set idv_confidence = 100, idv_status = 'verified' where user_id = $1`, [u]);
  check(err === null && (await status(u)) === "verified", "[keep] a write that keeps 'verified' lands");
}
{
  const u = U(22);
  await seed(u, "processing");
  const err = await tryExec(`update public.profiles set idv_status = 'verified' where user_id = $1`, [u]);
  check(err === null && (await status(u)) === "verified", "[keep] processing -> verified lands");
}
{
  const u = U(23);
  await seed(u, "manual_review");
  const err = await tryExec(`update public.profiles set idv_status = 'pending' where user_id = $1`, [u]);
  check(err === null && (await status(u)) === "pending", "[keep] a non-verified profile moves freely (claim's restart)");
}

// 4. The admin path: request_id_reupload through the RPC.
if (!SKIP) {
  const u = U(30);
  await seed(u, "verified");
  await db.query(`update public.profiles set idv_session_id = 'vs_old' where user_id = $1`, [u]);
  const r = await db.query(`select public.admin_idv_request_reupload($1, 'blurry') as n`, [u]);
  const row = (await db.query(`select idv_status, idv_attempt_count, idv_failure_reason, idv_session_id from public.profiles where user_id = $1`, [u])).rows[0];
  check(r.rows[0].n === 1 && row.idv_status === "not_started" && row.idv_attempt_count === 0 && row.idv_failure_reason === "blurry",
    "[fix] admin_idv_request_reupload moves verified -> not_started, count 0, the note as reason");
  check(row.idv_session_id === null, "[fix] admin_idv_request_reupload clears the old session (a late event cannot match it, Q2323)");
  const flag = (await db.query(`select coalesce(current_setting('lh.idv_admin_reset', true), '') as f`)).rows[0].f;
  check(flag !== "on", "[fix] the reset flag does not outlive the RPC");
  const u2 = U(31);
  await seed(u2, "verified");
  const after = await tryExec(`update public.profiles set idv_status = 'processing' where user_id = $1`, [u2]);
  check(after !== null, "[fix] after the RPC, a plain write in the same session is refused again");
  const none = await db.query(`select public.admin_idv_request_reupload(null, 'x') as n`);
  check(none.rows[0].n === 0, "[fix] a NULL user writes nothing");
  const acl = (await db.query(`select proacl::text as a from pg_proc where proname = 'admin_idv_request_reupload'`)).rows[0].a;
  check(/service_role=X/.test(acl) && !/(^|[{,])=X/.test(acl) && !/anon=X/.test(acl) && !/authenticated=X/.test(acl),
    `[fix] admin_idv_request_reupload executes for service_role only (${acl})`);
  await db.exec(`set role authenticated`);
  const asMember = await tryExec(`select public.admin_idv_request_reupload('${U(30)}', 'x')`);
  await db.exec(`reset role`);
  check(asMember !== null, "[fix] a member cannot call admin_idv_request_reupload");
} else {
  check(false, "[fix] admin_idv_request_reupload exists");
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
