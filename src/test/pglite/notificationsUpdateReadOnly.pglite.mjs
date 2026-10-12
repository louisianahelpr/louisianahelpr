#!/usr/bin/env node
/**
 * PGlite proof for 20261012234859_notifications_update_read_only.
 *
 *   node src/test/pglite/notificationsUpdateReadOnly.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/notificationsUpdateReadOnly.pglite.mjs   (before the fix: must FAIL)
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Builds
 * public.notifications with the LIVE grants measured 2026-10-12 (table-level
 * UPDATE for anon and authenticated) and the live UPDATE policy "Users can
 * update their own notifications", applies the migration 3x, then:
 *   - an authenticated member marks their own notice read: allowed;
 *   - the same member rewrites title / message / link / type / created_at, or
 *     sends read together with a new title: refused 42501, row unchanged;
 *   - a SECURITY DEFINER function (as the link-nulling trigger is) clears a
 *     link: allowed; service_role rewrites a title: allowed;
 *   - no privilege was narrowed (authenticated still holds table-level UPDATE,
 *     so no installed app is stranded).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20261012234859_notifications_update_read_only.sql", import.meta.url)), "utf8");

const ME = "00000000-0000-4000-8000-0000000000a1";
const N = "00000000-0000-4000-8000-0000000000b1";
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null,
    message text not null, type text not null default 'info', link text, read boolean not null default false,
    job_id uuid, created_at timestamptz not null default now());
  alter table public.notifications enable row level security;
  create policy "Users can view their own notifications" on public.notifications for select to authenticated using ((select auth.uid()) = user_id);
  create policy "Users can update their own notifications" on public.notifications for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  create policy svc on public.notifications for all to service_role using (true) with check (true);
  grant select, insert, update, delete, references on public.notifications to anon, authenticated, service_role;
  -- As the link-nulling trigger is: a definer function owned by the table owner.
  create function public.clear_link(p uuid) returns void language sql security definer set search_path = public as $$ update public.notifications set link = null where id = p $$;
  grant execute on function public.clear_link(uuid) to authenticated;
  insert into public.notifications(id, user_id, title, message, type, link) values ('${N}', '${ME}', 'Refund issued: $100', 'We refunded $100', 'payment', '/posts?job=1');
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(MIG);

const fails = [];
const asRole = async (role, sql) => {
  try {
    await db.exec(`begin; set local role ${role}; select set_config('request.jwt.claim.sub', '${role === "authenticated" ? ME : ""}', true); ${sql}; commit;`);
    return { ok: true };
  } catch (e) {
    await db.exec("rollback");
    return { ok: false, code: e.code };
  }
};
const row = async () => (await db.query(`select title, message, link, read from public.notifications where id = '${N}'`)).rows[0];

const markRead = await asRole("authenticated", `update public.notifications set read = true where user_id = '${ME}'`);
if (!markRead.ok) fails.push(`marking own notice read refused: ${markRead.code}`);
for (const set of ["title = 'You won $5,000'", "message = 'Call this number'", "link = 'https://evil.example'", "type = 'admin_alert'",
  "created_at = now() + interval '1 year'", "read = false, title = 'read plus a new title'"]) {
  const r = await asRole("authenticated", `update public.notifications set ${set} where user_id = '${ME}'`);
  if (r.ok || r.code !== "42501") fails.push(`authenticated could run SET ${set} (${r.ok ? "ok" : r.code})`);
}
const after = await row();
if (after.title !== "Refund issued: $100" || after.message !== "We refunded $100") fails.push(`the member rewrote the notice: ${JSON.stringify(after)}`);
if (after.read !== true) fails.push("the read mark did not stick");

const viaDefiner = await asRole("authenticated", `select public.clear_link('${N}')`);
if (!viaDefiner.ok) fails.push(`a definer function could not clear the link: ${viaDefiner.code}`);
const svc = await asRole("service_role", `update public.notifications set title = 'Refund issued: $100.00' where id = '${N}'`);
if (!svc.ok) fails.push(`service_role could not update the title: ${svc.code}`);
const final = await row();
if (final.link !== null || final.title !== "Refund issued: $100.00") fails.push(`server writes did not apply: ${JSON.stringify(final)}`);

const tablePriv = (await db.query(`select has_table_privilege('authenticated', 'public.notifications', 'UPDATE') p`)).rows[0].p;
if (tablePriv !== true) fails.push("authenticated lost table-level UPDATE: that is a schema break for installed apps");

if (fails.length) {
  console.error(`FAIL (${process.env.NEW_MIGRATION === "skip" ? "before the fix" : "with the fix"})\n- ` + fails.join("\n- "));
  process.exit(1);
}
console.log("ALL PASS (applied 3x): read still updatable; title/message/link/type/created_at and read+title refused 42501; definer and service_role writes pass; no privilege narrowed");
