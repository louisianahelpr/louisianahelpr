#!/usr/bin/env node
/**
 * PGlite proof for 20261120201223_thread_archives_delete_for_me ("Delete for
 * me" on a message thread, owner-approved site polish 2026-11-20).
 *
 * Fixture: thread_archives exactly as prod built it (20260831011232 verbatim,
 * then 20260926041106's deleted-party key), plus a minimal public.messages.
 * The new migration is applied 3x, then:
 *   - archives written before it survive with cleared_before NULL;
 *   - "delete for me" (upsert archived_at = cleared_before = now) lands, and a
 *     later archive upsert that omits cleared_before keeps it;
 *   - restore of a cleared row (archived_at := cleared_before) keeps the clear;
 *   - the reader rule the client applies (created_at > cleared_before) hides
 *     every older message from the clearer only, and a NEWER message reappears;
 *     the other party still reads every message; no message row is deleted;
 *   - RLS stays own-rows-only for select / insert / update / delete, including
 *     the new column, as `authenticated`;
 *   - export_my_data covers it: the thread_archives line of the NEWEST
 *     export_my_data definition in supabase/migrations, run verbatim, returns
 *     cleared_before;
 *   - account deletion covers it: deleting the member CASCADEs the row;
 *   - ban gate: thread_archives' writes are on the reasoned exemption list in
 *     scripts/ci/ban-gate-coverage.sql (own inbox organisation, invisible to
 *     others) and delete-for-me changes only the member's own view, so it is
 *     asserted to stay listed rather than refused.
 *
 *   node src/test/pglite/threadArchivesDeleteForMe.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/threadArchivesDeleteForMe.pglite.mjs   # RED
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = (f) => readFileSync(`${MIG_DIR}${f}`, "utf8");
const NEW = "20261120201223_thread_archives_delete_for_me.sql";

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
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id),
  sender_id uuid, receiver_id uuid,
  content text, created_at timestamptz NOT NULL
);
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
`);
await db.exec(mig("20260831011232_add_thread_archives.sql"));
await db.exec(mig("20260926041106_thread_archives_deleted_party.sql"));
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.thread_archives TO authenticated;`);

const U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const ME = U(1), THEM = U(2), STRANGER = U(3);
const J1 = "10000000-0000-0000-0000-000000000001", J2 = "10000000-0000-0000-0000-000000000002";
await db.exec(`
INSERT INTO auth.users VALUES ('${ME}'),('${THEM}'),('${STRANGER}');
INSERT INTO public.jobs VALUES ('${J1}'),('${J2}');
INSERT INTO public.thread_archives (user_id, job_id, other_user_id, archived_at) VALUES ('${ME}', '${J2}', '${THEM}', '2026-11-01T00:00:00Z');
INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at) VALUES
  ('${J1}', '${THEM}', '${ME}', 'old 1', '2026-11-10T10:00:00Z'),
  ('${J1}', '${ME}', '${THEM}', 'old 2', '2026-11-10T11:00:00Z');
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 1; i <= 3; i++) {
    const r = await tryExec(mig(NEW));
    check(`migration applies (pass ${i})`, r.ok, r.e);
  }
}

const one = async (sql) => (await db.query(sql)).rows[0];
check("an archive written before the change survives with cleared_before NULL",
  (await tryExec(`SELECT cleared_before FROM public.thread_archives WHERE user_id='${ME}' AND job_id='${J2}'`, [])).r?.rows?.[0]?.cleared_before === null);

// The client's delete-for-me upsert (PostgREST on_conflict=user_id,job_id,other_user_id merges only sent columns).
const CLEAR = "2026-11-10T12:00:00Z";
const del = await tryExec(
  `INSERT INTO public.thread_archives (user_id, job_id, other_user_id, archived_at, cleared_before) VALUES ('${ME}', '${J1}', '${THEM}', '${CLEAR}', '${CLEAR}')
   ON CONFLICT (user_id, job_id, other_user_id) DO UPDATE SET archived_at = EXCLUDED.archived_at, cleared_before = EXCLUDED.cleared_before`,
);
check("delete for me lands (upsert with cleared_before)", del.ok, del.e);

// The reader rule: the clearer reads only messages newer than cleared_before; the other party reads all.
const visibleTo = async (uid) => Number((await one(`
  SELECT count(*)::int AS n FROM public.messages m
   WHERE m.job_id='${J1}' AND (m.sender_id='${uid}' OR m.receiver_id='${uid}')
     AND m.created_at > coalesce((SELECT a.cleared_before FROM public.thread_archives a
          WHERE a.user_id='${uid}' AND a.job_id=m.job_id
            AND a.other_user_id = CASE WHEN m.sender_id='${uid}' THEN m.receiver_id ELSE m.sender_id END), '-infinity')`)).n);
check("the clearer sees none of the older messages", (await visibleTo(ME)) === 0);
check("the other party still sees every message", (await visibleTo(THEM)) === 2);
await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at) VALUES ('${J1}', '${THEM}', '${ME}', 'new', '2026-11-11T09:00:00Z')`);
check("a newer message reappears for the clearer (and only it)", (await visibleTo(ME)) === 1);
check("no message row was deleted", Number((await one(`SELECT count(*)::int AS n FROM public.messages`)).n) === 3);

// A later archive omits cleared_before: the clear must survive it.
await db.exec(`INSERT INTO public.thread_archives (user_id, job_id, other_user_id, archived_at) VALUES ('${ME}', '${J1}', '${THEM}', '2026-11-12T00:00:00Z')
   ON CONFLICT (user_id, job_id, other_user_id) DO UPDATE SET archived_at = EXCLUDED.archived_at`);
const afterArchive = await one(`SELECT archived_at, cleared_before FROM public.thread_archives WHERE user_id='${ME}' AND job_id='${J1}'`);
check("archiving a cleared thread keeps cleared_before", afterArchive.cleared_before && new Date(afterArchive.cleared_before).toISOString() === new Date(CLEAR).toISOString());
// Restore of a cleared row.
await db.exec(`UPDATE public.thread_archives SET archived_at = cleared_before WHERE user_id='${ME}' AND job_id='${J1}' AND other_user_id='${THEM}'`);
check("restore keeps the clear (archived_at = cleared_before)", (await visibleTo(ME)) === 1);

// RLS, as the client role.
await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${STRANGER}', false);`);
check("authenticated sees no one else's rows (cleared_before included)",
  Number((await one(`SELECT count(*)::int AS n FROM public.thread_archives`)).n) === 0);
const forgeIns = await tryExec(`INSERT INTO public.thread_archives (user_id, job_id, other_user_id, archived_at, cleared_before) VALUES ('${THEM}', '${J1}', '${ME}', now(), now())`);
check("authenticated may not clear a thread for another member (insert)", !forgeIns.ok);
const forgeUpd = await tryExec(`UPDATE public.thread_archives SET cleared_before = now() WHERE user_id='${ME}'`, []);
check("…nor update another member's row", forgeUpd.ok && forgeUpd.r?.affectedRows === 0, forgeUpd.e);
const forgeDel = await tryExec(`DELETE FROM public.thread_archives WHERE user_id='${ME}'`, []);
check("…nor delete it", forgeDel.ok && forgeDel.r?.affectedRows === 0, forgeDel.e);
const ownIns = await tryExec(`INSERT INTO public.thread_archives (user_id, job_id, other_user_id, archived_at, cleared_before) VALUES ('${STRANGER}', '${J1}', '${ME}', now(), now())`);
check("authenticated may clear their own thread", ownIns.ok, ownIns.e);
const ownUpd = await tryExec(`UPDATE public.thread_archives SET cleared_before = now() WHERE user_id='${STRANGER}'`, []);
check("…and update their own row", ownUpd.ok && ownUpd.r?.affectedRows === 1, ownUpd.e);
await db.exec(`RESET ROLE;`);
check("the member's rows are untouched by the stranger", Number((await one(`SELECT count(*)::int AS n FROM public.thread_archives WHERE user_id='${ME}'`)).n) === 2);

// export_my_data: the thread_archives line of the newest definition, verbatim.
const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
let exportLine = null, exportFile = null;
for (const f of files) {
  const src = mig(f);
  if (!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.export_my_data\s*\(/i.test(src)) continue;
  const m = src.match(/jsonb_build_object\('thread_archives',\s*(\(SELECT[\s\S]*?WHERE t\.user_id = v_uid\))\)/);
  exportFile = f;
  exportLine = m ? m[1] : null;
}
check("the newest export_my_data has a thread_archives line", !!exportLine, exportFile ?? "none");
if (exportLine) {
  const exported = await one(`SELECT ${exportLine.replace(/v_uid/g, `'${ME}'::uuid`)} AS j`);
  const rows = exported.j ?? [];
  check("export_my_data exports cleared_before", rows.some((r) => r.job_id === J1 && r.cleared_before), JSON.stringify(rows).slice(0, 200));
}

// Account deletion.
const gone = await tryExec(`DELETE FROM auth.users WHERE id='${ME}'`);
check("deleting the member's account succeeds", gone.ok, gone.e);
check("…and CASCADEs their thread_archives rows", Number((await one(`SELECT count(*)::int AS n FROM public.thread_archives WHERE user_id='${ME}'`)).n) === 0);

// Ban gate: the reasoned exemption stays in place for all three writes.
const banSql = readFileSync(new URL("../../../scripts/ci/ban-gate-coverage.sql", import.meta.url).pathname, "utf8");
for (const op of ["INSERT", "UPDATE", "DELETE"]) {
  check(`ban gate: thread_archives ${op} is on the reasoned exemption list`, new RegExp(`\\('thread_archives',\\s*'${op}',\\s*'[^']+'\\)`).test(banSql));
}

const col = await one(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='thread_archives' AND column_name='cleared_before'`);
check("cleared_before is a nullable timestamptz", col?.data_type === "timestamp with time zone" && col?.is_nullable === "YES", JSON.stringify(col));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
