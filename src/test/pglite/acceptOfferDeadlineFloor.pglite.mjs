#!/usr/bin/env node
/**
 * PGlite proof for 20261007032040_accept_offer_deadline_floor (docs/OPEN.md
 * Q1391): a single hire's answer-by (jobs.response_deadline) is never sooner
 * than 55 minutes from now, so a poster cannot hand a Helpr an offer that the
 * hourly expire_unanswered_offers closes before they can read it. The job's
 * start and the 48 h cap still win.
 *
 *   node src/test/pglite/acceptOfferDeadlineFloor.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/acceptOfferDeadlineFloor.pglite.mjs # RED: the state on main
 *   ... --tree   # AFTER cases on the newest accept_application across the whole tree
 *
 * Also (lh-authz-rls review, 2026-10-07): no client writes
 * jobs.response_deadline directly; enforce_hire_columns_rpc_only refuses it
 * for the authenticated role while the definer hire RPC still writes it.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (override
 * with PGLITE_DIR). accept_application on main is cut from 20261005184940,
 * which is byte-identical to prod's pg_get_functiondef (read 2026-10-07).
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { newestTreeFunction } from "./treeFunction.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261007032040_accept_offer_deadline_floor.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
const TREE = process.argv.includes("--tree");
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text,
  date_needed date, start_time time, response_deadline timestamptz
);
CREATE TABLE public.applications (
  id uuid PRIMARY KEY, job_id uuid, helper_id uuid, status text, offer_message text
);
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON public.jobs TO authenticated;
`);
// The client hire-column lock as main has it (20261005063441), and its trigger.
await db.exec(`ALTER TABLE public.jobs ADD COLUMN offered_to_helper_id uuid, ADD COLUMN recurring_helper_id uuid,
  ADD COLUMN direct_offer_status text, ADD COLUMN direct_offer_expires_at timestamptz;`);
await db.exec(cut("20261005063441_offered_helper_cannot_be_cleared_by_client.sql", "enforce_hire_columns_rpc_only"));
await db.exec(`CREATE TRIGGER trg_hire_columns_rpc_only BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_hire_columns_rpc_only();`);
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "job_offer_cutoff"));
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "accept_application"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);
if (TREE && !MODE) {
  for (const name of ["accept_application", "enforce_hire_columns_rpc_only"]) {
    const t = newestTreeFunction(name);
    console.log(`--tree: ${name} from ${t.file}`);
    await db.exec(t.sql);
  }
}

const chicago = (expr) => [`((${expr}) AT TIME ZONE 'America/Chicago')::date`, `((${expr}) AT TIME ZONE 'America/Chicago')::time`];
async function seed(n, [d, t]) {
  await db.exec(`
    INSERT INTO public.jobs (id, customer_id, status, date_needed, start_time) VALUES ('${id(n)}', '${POSTER}', 'open', ${d}, ${t});
    INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(100 + n)}', '${id(n)}', '${HELPER}', 'pending');`);
}
async function hire(n, deadlineSql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${POSTER}'; SELECT public.accept_application('${id(100 + n)}', ${deadlineSql}, NULL);`);
    const r = await db.query(`SELECT response_deadline, extract(epoch FROM response_deadline - now())::int AS secs FROM public.jobs WHERE id = '${id(n)}'`);
    return { ok: true, secs: r.rows[0].secs, at: r.rows[0].response_deadline };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}
const MIN = 55 * 60;

// 1. The finding: a deadline 5 minutes out, on a job days away.
await seed(1, chicago(`now() + interval '5 days'`));
let r = await hire(1, `now() + interval '5 minutes'`);
check("5 min chosen on a job 5 days out: stored at least 55 min out", r.ok && r.secs >= MIN - 5, r.ok ? `${r.secs}s` : r.err);

// 2. A past deadline is floored, not stored (and not a hire that expires at once).
await seed(2, chicago(`now() + interval '5 days'`));
r = await hire(2, `now() - interval '2 hours'`);
check("a past deadline: stored at least 55 min out", r.ok && r.secs >= MIN - 5, r.ok ? `${r.secs}s` : r.err);

// 3. Ordinary windows are untouched (can fail if the floor over-reaches).
await seed(3, chicago(`now() + interval '5 days'`));
r = await hire(3, `now() + interval '4 hours'`);
check("4 h chosen: the 4 h stands", r.ok && Math.abs(r.secs - 4 * 3600) < 120, r.ok ? `${r.secs}s` : r.err);
await seed(4, chicago(`now() + interval '5 days'`));
r = await hire(4, `now() + interval '1 hour'`);
check("1 h chosen (the app's shortest): the 1 h stands", r.ok && Math.abs(r.secs - 3600) < 120, r.ok ? `${r.secs}s` : r.err);
await seed(5, chicago(`now() + interval '30 days'`));
r = await hire(5, `now() + interval '365 days'`);
check("a year out: still capped at 48 h", r.ok && r.secs <= 48 * 3600 + 60, r.ok ? `${r.secs}s` : r.err);
await seed(6, chicago(`now() + interval '30 days'`));
r = await hire(6, `NULL`);
check("NULL: 48 h", r.ok && Math.abs(r.secs - 48 * 3600) < 120, r.ok ? `${r.secs}s` : r.err);

// 4. The job's start still wins over the floor.
await seed(7, chicago(`now() + interval '30 minutes'`));
r = await hire(7, `now() + interval '5 minutes'`);
check("job starts in 30 min: answer-by is the start (under the floor), not later", r.ok && r.secs <= 31 * 60 && r.secs >= 25 * 60, r.ok ? `${r.secs}s` : r.err);
await seed(8, chicago(`now() + interval '5 minutes'`));
r = await hire(8, `now() + interval '24 hours'`);
check("job starts in 5 min: still refused job_starts_too_soon", !r.ok && /job_starts_too_soon/.test(r.err), r.ok ? `hired ${r.secs}s` : r.err);

// 5. The poster cannot write the deadline around the RPC (lh-authz-rls review):
// a direct UPDATE as the poster, on the booked job from case 3, to the past.
async function posterWrites(n, valueSql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${POSTER}'; SET request.jwt.claim.role = 'authenticated'; SET ROLE authenticated;
      UPDATE public.jobs SET response_deadline = ${valueSql} WHERE id = '${id(n)}'; RESET ROLE;`);
    return { ok: true };
  } catch (e) {
    await db.exec("RESET ROLE;");
    return { ok: false, err: e.message };
  }
}
r = await posterWrites(3, `now() - interval '1 hour'`);
check("poster's direct UPDATE of response_deadline (backdate) is refused", !r.ok && /hire_requires_rpc: jobs\.response_deadline/.test(r.err), r.ok ? "accepted" : r.err);
r = await posterWrites(3, `now() + interval '2 minutes'`);
check("poster's direct UPDATE of response_deadline (shorten) is refused", !r.ok, r.ok ? "accepted" : r.err);
// Can fail the other way: the poster still edits an ordinary column.
r = await posterWrites(3, `response_deadline`);
check("  a no-op write of it passes (the lock reads changed values only)", r.ok, r.ok ? "" : r.err);
r = await posterWrites(3, `NULL`);
check("a client clear is refused too (a NULL deadline never expires: the offer would hang)", !r.ok, r.ok ? "accepted" : r.err);
await db.exec(`SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = '';`);
await db.exec(`UPDATE public.jobs SET response_deadline = now() + interval '3 hours' WHERE id = '${id(3)}'`);
const srv = (await db.query(`SELECT extract(epoch FROM response_deadline - now())::int AS s FROM public.jobs WHERE id = '${id(3)}'`)).rows[0].s;
check("  the server (no JWT) still writes it", Math.abs(srv - 3 * 3600) < 120, `${srv}s`);

// 6. Grants: never anon / PUBLIC.
if (!MODE) {
  const acl = (await db.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'accept_application'`)).rows[0].acl;
  check("accept_application: no anon / PUBLIC execute", !/(^|[{,])(anon)?=X/.test(acl ?? ""), acl);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
