#!/usr/bin/env node
/**
 * PGlite proof for 20261109193417_revision_notices_plain_words (F192 + F193, wording only).
 *
 *   npx tsx src/test/pglite/revisionNoticeWording.pglite.mjs [--replay] [--before]
 *
 * --before installs the previous definition (the last one in 20260924220318) instead: R2-R3 FAIL.
 *
 *   R1 unchanged: the count goes up on each new change request; at the 3rd, one staff fraud flag (scope_creep) and one
 *      notice each to the person who posted and the hired Helpr, with the same type, links and job_id; none before
 *   R2 the poster's notice: "Several changes asked on this job", what they can do, "our team"; no emoji, no "scope creep"
 *   R3 the Helpr's notice: "Several changes asked on your job", "Our team can see this"; no "Admins"
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261109193417_revision_notices_plain_words.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

function lastDefinition(sql, fn) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "gi");
  let out = null;
  for (const m of sql.matchAll(head)) {
    const rest = sql.slice(m.index);
    const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
    const close = rest.indexOf(tag[1], tag.index + tag[0].length);
    out = rest.slice(0, close + tag[1].length) + ";";
  }
  return out;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const POSTER = "00000000-0000-4000-8000-000000000001", HELPR = "00000000-0000-4000-8000-000000000002";
const JOB = "00000000-0000-4000-8000-0000000000aa";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, status text, customer_id uuid, helper_id uuid, revision_count int DEFAULT 0);
CREATE TABLE public.fraud_flags (id bigserial PRIMARY KEY, user_id uuid, flag_type text, details text, job_id uuid);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, user_id uuid, title text, message text, type text, link text, job_id uuid);
INSERT INTO public.jobs (id, title, status, customer_id, helper_id) VALUES ('${JOB}', 'Paint a fence', 'in_progress', '${POSTER}', '${HELPR}');
`);
if (BEFORE) {
  await db.exec(lastDefinition(readFileSync(DIR + "20260924220318_rename_tab_addresses.sql", "utf8"), "track_revision_scope_creep"));
} else {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
}
await db.exec(`CREATE TRIGGER jobs_track_revision_scope_creep BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.track_revision_scope_creep();`);

const ask = async () => {
  await db.exec(`UPDATE public.jobs SET status = 'revision_requested' WHERE id = '${JOB}'`);
  await db.exec(`UPDATE public.jobs SET status = 'in_progress' WHERE id = '${JOB}'`);
};
await ask(); await ask();
const before3 = (await db.query(`SELECT count(*)::int AS n FROM public.notifications`)).rows[0].n;
await ask();
const count = (await db.query(`SELECT revision_count FROM public.jobs WHERE id = '${JOB}'`)).rows[0].revision_count;
const flags = (await db.query(`SELECT flag_type FROM public.fraud_flags`)).rows;
const n = (await db.query(`SELECT user_id::text AS u, title, message, type, link, job_id::text AS j FROM public.notifications ORDER BY id`)).rows;
const p = n.find((r) => r.u === POSTER), h = n.find((r) => r.u === HELPR);
check("R1 count 3, one staff flag, no notice before the 3rd, one each at it (type, links, job_id unchanged)",
  count === 3 && flags.length === 1 && flags[0].flag_type === "scope_creep" && before3 === 0 && n.length === 2
  && p?.type === "warning" && p.link === `/posts?job=${JOB}` && p.j === JOB && h?.type === "warning" && h.link === `/jobs?job=${JOB}` && h.j === JOB,
  JSON.stringify({ count, flags: flags.length, before3, n: n.length }));
check("R2 poster: plain title and next step, 'our team', no emoji or 'scope creep'",
  p?.title === "Several changes asked on this job"
  && p.message === `You've asked for 3 changes on "Paint a fence". If it still isn't right, you can approve the work or ask our team to step in.`
  && !/⚠|scope creep/i.test(p.title + p.message), JSON.stringify(p));
check("R3 Helpr: plain title, 'Our team can see this', no 'Admins'",
  h?.title === "Several changes asked on your job"
  && h.message === `3 changes were asked on "Paint a fence". Our team can see this and will step in if needed. Keep messages in the app.`
  && !/admin/i.test(h.title + h.message), JSON.stringify(h));

if (BEFORE) {
  const expected = 2;
  console.log(failures === expected ? `BEFORE: ${failures} FAIL as expected` : `BEFORE: expected ${expected} FAIL, got ${failures}`);
  process.exit(failures === expected ? 0 : 1);
}
console.log(failures ? `${failures} FAILED` : "all PASS");
process.exit(failures ? 1 : 0);
