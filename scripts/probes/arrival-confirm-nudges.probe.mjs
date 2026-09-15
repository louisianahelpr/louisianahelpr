// PGlite probe for 20260915070651_arrival_confirm_nudges: applies it 3x on a
// prod-shaped stub (default privileges grant anon/authenticated, service_role
// BYPASSRLS), then shows clients are refused and a stage claim is single-winner.
// Run from a dir with @electric-sql/pglite installed (npm i --no-save):
//   node scripts/probes/arrival-confirm-nudges.probe.mjs supabase/migrations/20260915070651_arrival_confirm_nudges.sql

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const mig = readFileSync(process.argv[2], "utf8");
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY);
  CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text, disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2, note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  INSERT INTO public.jobs VALUES ('00000000-0000-0000-0000-000000000001');
`);
for (let i = 1; i <= 3; i++) { await db.exec(mig); console.log("apply", i, "ok"); }
const acl = await db.query(`select relacl::text, relrowsecurity from pg_class where relname='job_arrival_confirm_nudges'`);
console.log("acl", JSON.stringify(acl.rows));
const exp = await db.query(`select jobname, expected_max_gap::text from cron_work_expectations`);
console.log("expectation", JSON.stringify(exp.rows));
const tryAs = async (role, sql) => { try { await db.exec(`SET ROLE ${role}; ${sql}; RESET ROLE;`); return "allowed"; } catch (e) { await db.exec("RESET ROLE"); return "refused: " + e.message.slice(0, 50); } };
console.log("anon select", await tryAs("anon", "select * from job_arrival_confirm_nudges"));
console.log("authenticated insert", await tryAs("authenticated", "insert into job_arrival_confirm_nudges(job_id) values ('00000000-0000-0000-0000-000000000001')"));
console.log("service_role insert", await tryAs("service_role", "insert into job_arrival_confirm_nudges(job_id, first_sent_at) values ('00000000-0000-0000-0000-000000000001', now())"));
const r = await db.query(`update job_arrival_confirm_nudges set second_sent_at = now() where job_id='00000000-0000-0000-0000-000000000001' and second_sent_at is null returning job_id`);
const r2 = await db.query(`update job_arrival_confirm_nudges set second_sent_at = now() where job_id='00000000-0000-0000-0000-000000000001' and second_sent_at is null returning job_id`);
console.log("claim second: first run", r.rows.length, "second run", r2.rows.length);
