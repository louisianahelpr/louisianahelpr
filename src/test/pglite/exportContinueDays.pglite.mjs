#!/usr/bin/env node
/**
 * PGlite proof for 20261102030000_export_my_data_continue_days.sql (LEAD-EXPORT-CONTINUE-DAY): "Download My Data"
 * carries the continue-another-day rows of the member's own jobs (poster or Helpr) and any row the member wrote,
 * never another job's; every other section, the search_path and the grants unchanged.
 *
 *   node src/test/pglite/exportContinueDays.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/exportContinueDays.pglite.mjs  # RED: 20261101210500's body only
 *   MIGRATION_PATH=<planted copy> node ...                                  # RED on a planted defect
 *
 * World: the export_my_data statements of 20261101210500 (the newest CREATE before this one), then this migration's
 * 3x; every table the body reads stubbed with the columns it reads, the two continue-day tables with their real
 * columns (20261101231015). pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261101210500_export_my_data_meetup_spots.sql";
const NEW_FILE = "20261102030000_export_my_data_continue_days.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

/** The export_my_data statements of one migration: the no-arg DROP, the (uuid) CREATE (any dollar tag), its REVOKE/GRANT. */
function exportStatements(sql, label) {
  const out = [];
  const drop = /^DROP FUNCTION IF EXISTS public\.export_my_data\(\);$/m.exec(sql);
  if (drop) out.push(drop[0]);
  const create = /CREATE OR REPLACE FUNCTION public\.export_my_data\(p_user_id uuid\)[\s\S]*?\bAS (\$\w*\$)/.exec(sql);
  if (!create) throw new Error(`${label}: no export_my_data(uuid) definition`);
  const end = sql.indexOf(create[1], create.index + create[0].length);
  out.push(`${sql.slice(create.index, end + create[1].length)};`);
  for (const m of sql.matchAll(/^(?:REVOKE|GRANT) [^\n]*public\.export_my_data\(uuid\)[^\n]*;$/gm)) out.push(m[0]);
  if (out.length !== 4) throw new Error(`${label}: expected DROP + CREATE + REVOKE + GRANT, read ${out.length}`);
  return out.join("\n");
}

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
-- prod's default function ACL: a new function is EXECUTE for anon/authenticated until the migration revokes it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);

const defOf = async () => (await db.query(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure) AS d`)).rows[0].d;
await db.exec(exportStatements(readFileSync(`${MIG_DIR}${BASE}`, "utf8"), BASE));
const oldDef = await defOf();
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(exportStatements(sql, NEW_FILE));
      ok(true, `the migration's export_my_data applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `the migration's export_my_data applies (run ${i + 1} of 3)`, e.message);
    }
  }
}
const def = await defOf();

// 1. The old body VERBATIM except the two new last sections.
const ADDED = `
  -- Continue another day (20261101231015, LEAD-EXPORT-CONTINUE-DAY): the new days set or asked on the member's own
  -- jobs (as poster or Helpr) or by the member, and the record of each step.
  v_out := v_out || jsonb_build_object('job_continue_days', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.job_continue_days t
      WHERE t.proposed_by = v_uid OR t.decided_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_continue_events', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.job_continue_events t
      WHERE t.actor_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
`;
const ANCHOR = `             FROM public.instant_book_declines t
             WHERE t.helper_id = v_uid));
`;
ok(oldDef.split(ANCHOR).length === 2 && def === oldDef.replace(ANCHOR, ANCHOR + ADDED),
  "the new body is 20261101210500's verbatim plus the two continue-day sections", skip ? "skip" : "");
ok(/SET search_path TO 'public', 'pg_temp'/.test(def), "search_path still public, pg_temp");

// 2. ACL.
const acl = (await db.query(`SELECT
    has_function_privilege('anon', 'public.export_my_data(uuid)', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.export_my_data(uuid)', 'EXECUTE') AS auth,
    has_function_privilege('service_role', 'public.export_my_data(uuid)', 'EXECUTE') AS svc,
    (SELECT count(*)::int FROM pg_proc WHERE proname = 'export_my_data') AS overloads`)).rows[0];
ok(acl.overloads === 1 && acl.svc && !acl.anon && !acl.auth, "still the one (uuid) overload, EXECUTE for service_role only", JSON.stringify(acl));

// 3. RUN it: stub every table the body reads, with the columns it reads.
const body = def.slice(def.indexOf("BEGIN"));
const tables = new Map();
for (const chunk of body.split(/;\s*\n/)) {
  const alias = new Map();
  for (const m of chunk.matchAll(/\b(?:FROM|JOIN)\s+(public|auth|storage)\.(\w+)\s+(?:AS\s+)?(\w+)/gi)) {
    const t = `${m[1]}.${m[2]}`;
    if (!tables.has(t)) tables.set(t, new Set());
    if (!alias.has(m[3])) alias.set(m[3], new Set());
    alias.get(m[3]).add(t);
  }
  for (const m of chunk.matchAll(/\b([a-z]\w*)\.([a-z_]\w*)\b/g)) for (const t of alias.get(m[1]) ?? []) tables.get(t).add(m[2]);
}
const BOOL = new Set([...body.matchAll(/coalesce\(\w+\.(\w+),\s*(?:true|false)\)|\w+\.(\w+) IS (?:NOT )?(?:TRUE|FALSE)\b/gi)].map((m) => m[1] ?? m[2]));
// Columns the body compares with a word ('tenant'), whatever their name says.
const TEXT_COLS = new Set([...body.matchAll(/\w+\.(\w+)\s*(?:=|<>|IN)\s*\(?'[a-z_]+'/g)].map((m) => m[1]));
const typeOf = (c) =>
  TEXT_COLS.has(c) ? "text"
  : BOOL.has(c) ? "boolean"
  : c === "id" || c.endsWith("_id") || c.endsWith("_by") ? "uuid"
  : c.endsWith("_at") || c === "slot_start" || c === "slot_end" ? "timestamptz"
  : c.endsWith("_on") || c === "pickup_day" ? "date"
  : c.startsWith("is_") ? "boolean"
  : c.endsWith("_cents") || c === "rating" || c === "slot_no" ? "integer"
  : c === "weekdays" ? "smallint[]"
  : "text";
const stubs = [];
for (const [t, cols] of tables) {
  cols.delete("id");
  const colSql = ["id uuid PRIMARY KEY DEFAULT gen_random_uuid()", ...[...cols].map((c) => `${c} ${typeOf(c)}`)];
  stubs.push(`CREATE SCHEMA IF NOT EXISTS ${t.split(".")[0]}; CREATE TABLE IF NOT EXISTS ${t} (${colSql.join(", ")});`);
}
await db.exec(stubs.join("\n"));
// The continue-day tables with their real columns (20261101231015); the stubs cover the rest.
await db.exec(`
DROP TABLE IF EXISTS public.job_continue_events;
DROP TABLE IF EXISTS public.job_continue_days;
CREATE TABLE public.job_continue_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, proposed_by uuid, new_date date NOT NULL,
  new_start_time time NOT NULL, note text, status text NOT NULL DEFAULT 'proposed', created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, decided_by uuid, cleared_done_at timestamptz, helper_confirmed_at timestamptz, closed_at timestamptz);
CREATE TABLE public.job_continue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, continue_id uuid, actor_id uuid, action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);

const POSTER = "00000000-0000-0000-0000-0000000000aa";
const HELPR = "00000000-0000-0000-0000-0000000000bb";
const NOBODY = "00000000-0000-0000-0000-0000000000cc";
const STRANGER = "00000000-0000-0000-0000-0000000000dd";
const JOB = "10000000-0000-0000-0000-000000000001";
const OTHER_JOB = "10000000-0000-0000-0000-000000000002";
const DAY = "20000000-0000-0000-0000-000000000001";
const OTHER_DAY = "20000000-0000-0000-0000-000000000002";
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${POSTER}', 'p@example.com', now()), ('${HELPR}', 'h@example.com', now()),
  ('${NOBODY}', 'n@example.com', now()), ('${STRANGER}', 's@example.com', now());
INSERT INTO public.jobs (id, customer_id, helper_id) VALUES ('${JOB}', '${POSTER}', '${HELPR}'), ('${OTHER_JOB}', '${STRANGER}', NULL);
INSERT INTO public.job_continue_days (id, job_id, proposed_by, new_date, new_start_time, note, status, decided_by, created_at) VALUES
  ('${DAY}', '${JOB}', '${HELPR}', '2026-11-05', '09:00', 'Back Thursday', 'set', '${POSTER}', '2026-11-01 20:00+00'),
  ('${OTHER_DAY}', '${OTHER_JOB}', '${STRANGER}', '2026-11-06', '10:00', 'Not yours', 'proposed', NULL, '2026-11-01 21:00+00');
INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail, created_at) VALUES
  ('${JOB}', '${DAY}', '${HELPR}', 'proposed', '{"new_date":"2026-11-05"}', '2026-11-01 20:00+00'),
  ('${JOB}', '${DAY}', '${POSTER}', 'set', '{}', '2026-11-01 20:05+00'),
  ('${JOB}', '${DAY}', NULL, 'reminder', '{"kind":"day_before"}', '2026-11-04 15:00+00'),
  ('${OTHER_JOB}', '${OTHER_DAY}', '${STRANGER}', 'proposed', '{}', '2026-11-01 21:00+00');`);
const exportOf = async (uid) => {
  try {
    return (await db.query(`SELECT public.export_my_data('${uid}') AS j`)).rows[0].j;
  } catch (e) {
    ok(false, `export_my_data runs for ${uid}`, e.message);
    return null;
  }
};
const poster = await exportOf(POSTER);
const helpr = await exportOf(HELPR);
const nobody = await exportOf(NOBODY);
for (const [who, out] of [["the poster", poster], ["the Helpr", helpr]]) {
  const days = out?.job_continue_days;
  const events = out?.job_continue_events;
  ok(Array.isArray(days) && days.length === 1 && days[0].id === DAY && days[0].note === "Back Thursday",
    `${who} gets the job's continue day`, JSON.stringify(days));
  ok(Array.isArray(events) && events.length === 3 && events.map((e) => e.action).join(",") === "proposed,set,reminder",
    `${who} gets the job's three steps, oldest first (the sweep's reminder too)`, JSON.stringify(events));
  ok(!JSON.stringify(out ?? {}).includes("Not yours") && !JSON.stringify(events ?? []).includes(OTHER_JOB),
    `  ${who} never gets another job's rows`, JSON.stringify({ days, events }));
}
ok(Array.isArray(nobody?.job_continue_days) && nobody.job_continue_days.length === 0
  && Array.isArray(nobody?.job_continue_events) && nobody.job_continue_events.length === 0, "a member with none gets two empty lists",
  JSON.stringify({ d: nobody?.job_continue_days, e: nobody?.job_continue_events }));
ok(Array.isArray(poster?.declutter_meetup_spots) && Array.isArray(poster?.instant_book_floors) && poster?.email === "p@example.com", "the other sections are still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
