#!/usr/bin/env node
/**
 * PGlite proof for 20261021110531_jobs_address_in_louisiana.sql (Q2291).
 *
 *   node src/test/pglite/jobsAddressInLouisiana.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobsAddressInLouisiana.pglite.mjs # RED: without it
 *
 * A member's job with an out-of-state address (state token, ZIP or map point) is refused; Louisiana addresses,
 * coarse addresses with nothing out of state, server writes, test rows and a redaction pass.
 */
import { PGlite, readMigration, newestFunctionSql, as } from "./seriesWorld.mjs";

const FIX = readMigration("20261021110531_jobs_address_in_louisiana.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: no state rule (expect FAILs)`);
const U = "22222222-2222-2222-2222-222222222222";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function auth.role() returns text language sql stable as $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant usage on schema public to authenticated, anon, service_role;
  create table public.jobs (id serial primary key, customer_id uuid, title text, location text, latitude numeric, longitude numeric, is_seed boolean default false);
  grant select, insert, update on public.jobs to authenticated, service_role;
  grant usage on sequence public.jobs_id_seq to authenticated, service_role;
  ${newestFunctionSql("is_server_context").sql}
  -- Stand-in for trg_jobs_insert_column_lock's is_seed rule (a member's job is never a seed row): it re-derives
  -- is_seed, and the address check must run AFTER it (review M1).
  create function public.stand_in_insert_lock() returns trigger language plpgsql as $f$
  begin
    if not public.is_server_context() then new.is_seed := false; end if;
    return new;
  end $f$;
  create trigger trg_jobs_insert_column_lock before insert on public.jobs for each row execute function public.stand_in_insert_lock();
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const post = (loc, lat = "NULL", lng = "NULL", seed = false, role = "authenticated") =>
  as(db, role, role === "authenticated" ? U : null, `insert into public.jobs (customer_id, title, location, latitude, longitude, is_seed) values ('${U}', 't', ${loc === null ? "NULL" : `'${loc}'`}, ${lat}, ${lng}, ${seed})`);
const refusedLa = (r) => !r.ok && /job_address_not_louisiana/.test(r.err);

check("R1: a Texas address (state token + ZIP) is refused", refusedLa(await post("700 Main St, Houston, TX 77002")), (await post("700 Main St, Houston, TX 77002")).err);
check("R2: a non-LA state word as the last segment is refused", refusedLa(await post("12 Oak St, Biloxi, MS")));
check("R3: an out-of-state ZIP with an LA label is refused", refusedLa(await post("12 Oak St, Houston, LA 77002")));
check("R4: a map point outside Louisiana is refused", refusedLa(await post("12 Oak St, Lafayette", "29.76", "-95.37")));
check("A1: a Louisiana address is accepted", (await post("1412 Bayou Ridge Rd, Lafayette, LA 70508", "30.22", "-92.02")).ok);
check("A2: 'Louisiana' spelled out is accepted", (await post("12 Oak St, Lafayette, Louisiana")).ok);
check("A3: a coarse address with nothing out of state is accepted", (await post("Lafayette")).ok);
check("A4: a test row (is_seed, the audit's fake ZIP 99999) written by the server passes", (await post("100 Audit Way, Baton Rouge, LA 99999", "NULL", "NULL", true, "service_role")).ok);
check("R6: a member cannot forge is_seed to skip the check (review M1)", refusedLa(await post("700 Main St, Houston, TX 77002", "NULL", "NULL", true)));
check("A5: a server write passes", (await post("700 Main St, Houston, TX 77002", "NULL", "NULL", false, "service_role")).ok);
const la = await as(db, "authenticated", U, `insert into public.jobs (customer_id, title, location) values ('${U}', 'move me', '12 Oak St, Lafayette, LA 70508') returning id`);
const id = la.rows?.[0]?.id;
check("R5: moving a job's address out of state is refused", refusedLa(await as(db, "authenticated", U, `update public.jobs set location = '700 Main St, Houston, TX 77002' where id = ${id}`)));
check("A6: a redaction (location NULL) passes", (await as(db, "authenticated", U, `update public.jobs set location = NULL where id = ${id}`)).ok);
check("A7: an unrelated update passes", (await as(db, "authenticated", U, `update public.jobs set title = 'renamed' where id = ${id}`)).ok);
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
