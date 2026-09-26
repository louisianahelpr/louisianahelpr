#!/usr/bin/env node
/**
 * PGlite proof for 20260926041106_thread_archives_deleted_party (docs/OPEN.md
 * Q335, owner 2026-09-26: "let people archive deleted-account threads").
 *
 * The fixture is thread_archives exactly as prod built it: its creating
 * migration 20260831011232 applied verbatim (table, owner-only RLS policies)
 * plus the two FK-index migrations. Rows written before the change must
 * survive it. Then the new migration is applied 3x and:
 *   - a viewer can archive a job's deleted-account thread (other_user_id NULL),
 *   - at most one such row per viewer per job (UNIQUE NULLS NOT DISTINCT),
 *   - the client's upsert(onConflict user_id,job_id,other_user_id) updates it
 *     instead of adding a second row,
 *   - live-party rows keep their uniqueness,
 *   - deleting the other party's account still CASCADEs their row and never
 *     fails because a NULL row already exists,
 *   - RLS stays owner-only for the NULL row (as `authenticated`).
 *
 *   node src/test/pglite/threadArchivesDeletedParty.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/threadArchivesDeletedParty.pglite.mjs   # RED
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = "20260926041106_thread_archives_deleted_party.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const tryExec = async (sql, params) => {
  try {
    const r = params ? await db.query(sql, params) : await db.exec(sql);
    return { ok: true, r };
  } catch (e) {
    return { ok: false, e: e.message };
  }
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY);
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
`);
// Prod's own shape, verbatim.
await db.exec(mig("20260831011232_add_thread_archives.sql"));
await db.exec(mig("20260906120000_add_missing_fk_indexes.sql").split(";").filter((s) => /thread_archives/.test(s)).join(";") + ";");
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.thread_archives TO authenticated;`);

const U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const ME = U(1), LIVE = U(2), GONE = U(3), OTHER_VIEWER = U(4);
const J1 = "10000000-0000-0000-0000-000000000001", J2 = "10000000-0000-0000-0000-000000000002";
await db.exec(`
INSERT INTO auth.users VALUES ('${ME}'),('${LIVE}'),('${GONE}'),('${OTHER_VIEWER}');
INSERT INTO public.jobs VALUES ('${J1}'),('${J2}');
-- Archived BEFORE the change: must survive it.
INSERT INTO public.thread_archives (user_id, job_id, other_user_id) VALUES ('${ME}', '${J1}', '${LIVE}'), ('${ME}', '${J2}', '${GONE}');
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 1; i <= 3; i++) {
    const r = await tryExec(mig(NEW));
    check(`migration applies (pass ${i})`, r.ok, r.e);
  }
}

const count = async (where) =>
  Number((await db.query(`SELECT count(*)::int AS n FROM public.thread_archives WHERE ${where}`)).rows[0].n);

check("rows archived before the change survive it", (await count(`user_id='${ME}'`)) === 2);

const ins = await tryExec(`INSERT INTO public.thread_archives (user_id, job_id, other_user_id) VALUES ('${ME}', '${J1}', NULL)`);
check("a job's deleted-account thread can be archived (other_user_id NULL)", ins.ok, ins.e);

const dup = await tryExec(`INSERT INTO public.thread_archives (user_id, job_id, other_user_id) VALUES ('${ME}', '${J1}', NULL)`);
check("a second deleted-account row for the same viewer + job is refused", !dup.ok && /duplicate key|unique/i.test(dup.e ?? ""), dup.e);

// PostgREST upsert with on_conflict=user_id,job_id,other_user_id.
const up = await tryExec(
  `INSERT INTO public.thread_archives (user_id, job_id, other_user_id, archived_at) VALUES ('${ME}', '${J1}', NULL, '2030-01-01T00:00:00Z')
   ON CONFLICT (user_id, job_id, other_user_id) DO UPDATE SET archived_at = EXCLUDED.archived_at`,
);
check("the client's upsert finds the NULL row (ON CONFLICT infers the new key)", up.ok, up.e);
check("…and updates it rather than adding one", (await count(`user_id='${ME}' AND job_id='${J1}' AND other_user_id IS NULL`)) === 1);
const at = (await db.query(`SELECT archived_at FROM public.thread_archives WHERE user_id='${ME}' AND job_id='${J1}' AND other_user_id IS NULL`)).rows[0]?.archived_at;
check("…with the new archived_at", at && new Date(at).getUTCFullYear() === 2030);

const liveDup = await tryExec(`INSERT INTO public.thread_archives (user_id, job_id, other_user_id) VALUES ('${ME}', '${J1}', '${LIVE}')`);
check("live-party rows stay unique", !liveDup.ok);

const delNull = await tryExec(`DELETE FROM public.thread_archives WHERE user_id='${ME}' AND job_id='${J2}' AND other_user_id IS NULL`);
check("restore (delete .is(other_user_id, null)) runs", delNull.ok, delNull.e);

// Account deletion with a NULL row already present on the same job.
const seeded = await tryExec(`INSERT INTO public.thread_archives (user_id, job_id, other_user_id) VALUES ('${ME}', '${J2}', NULL)`);
check("fixture: a NULL row on the job before the account deletion", seeded.ok, seeded.e);
const del = await tryExec(`DELETE FROM auth.users WHERE id='${GONE}'`);
check("deleting the other party's account succeeds with a NULL row on the job", del.ok, del.e);
check("…and CASCADEs their row (not SET NULL)", (await count(`other_user_id='${GONE}'`)) === 0 && (await count(`user_id='${ME}' AND job_id='${J2}' AND other_user_id IS NULL`)) === 1);

// RLS, as the client role.
await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${OTHER_VIEWER}', false);`);
const own = await tryExec(`INSERT INTO public.thread_archives (user_id, job_id, other_user_id) VALUES ('${OTHER_VIEWER}', '${J1}', NULL)`);
check("authenticated may archive their own deleted-account thread", own.ok, own.e);
const foreign = await tryExec(`INSERT INTO public.thread_archives (user_id, job_id, other_user_id) VALUES ('${ME}', '${J2}', NULL)`);
check("authenticated may not write another user's row", !foreign.ok);
const seen = Number((await db.query(`SELECT count(*)::int AS n FROM public.thread_archives`)).rows[0].n);
check("authenticated sees only their own rows", seen === 1, `saw ${seen}`);
await db.exec(`RESET ROLE;`);

const shape = await db.query(`
  SELECT (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='thread_archives' AND column_name='other_user_id') AS nullable,
         (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.thread_archives'::regclass AND contype='p') AS pk,
         (SELECT confdeltype FROM pg_constraint WHERE conrelid='public.thread_archives'::regclass AND contype='f'
             AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.thread_archives'::regclass AND attname='other_user_id')]) AS fk`);
const s = shape.rows[0];
check("other_user_id is nullable", s.nullable === "YES", JSON.stringify(s));
check("primary key is the surrogate id", s.pk === "PRIMARY KEY (id)");
check("other_user_id FK still ON DELETE CASCADE", s.fk === "c");

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
