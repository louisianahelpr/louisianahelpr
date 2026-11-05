#!/usr/bin/env node
/**
 * PGlite proof for 20261105172514_profile_job_photos.sql (owner 11-05, share-profile H4: work photos, all three
 * options combined). A job after photo shows on /u/<handle> only while the poster AND every booked Helpr allow sharing
 * (profiles.share_job_photos) AND the Helpr ticked it; the visitor gets a pick id, category and month, nothing else.
 *
 *   npx tsx src/test/pglite/profileJobPhotos.pglite.mjs            # migration applied 3x, ALL PASS
 *   npx tsx src/test/pglite/profileJobPhotos.pglite.mjs --before   # not applied: RED checks FAIL
 *   MIGRATION_PATH=<planted copy> npx tsx ...                       # red on a planted defect
 *
 * World: cut-down profiles / jobs / group_job_helpers / profile_handles_retired / test_accounts carrying the columns
 * the functions read; job_booked_helpr_ids is the REAL newest definition. declutter_member_out and member_under_18 are
 * column-backed stubs. Supabase's default EXECUTE-to-anon on new functions is emulated FIRST, so a function that
 * forgets its REVOKE shows up.
 *
 *   W1 a picked photo on a job everyone allowed: the visitor gets exactly {id, category, month}       RED before
 *   W2 an unpicked photo never shows (nothing from a job by default)                                  RED before
 *   W3 the poster or any crew Helpr turning sharing off hides it, and the image lookup says NULL      RED before
 *   W4 a member cannot pick another Helpr's job photo, a photo not on the job, or one on an open job  (passes before: no function)
 *   W5 no job id, storage path, address or customer name in the visitor's answer                     RED before
 *   W6 a banned or test Helpr's page gives no job photos, and the image lookup says NULL for them      RED before
 *   W7 a photo taken off the job stops showing; un-ticking removes it                                 RED before
 *   W8 the Helpr's own list says which are shown and which wait on consent                            RED before
 *   W9 anon: EXECUTE on the visitor read only; never the table, the lookup or the helpers             RED before
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261105172514_profile_job_photos.sql";
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? DIR + THIS, "utf8");
const BEFORE = process.argv.includes("--before");

const realFn = (name) => {
  const file = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS)
    .filter((f) => new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`).test(readFileSync(DIR + f, "utf8"))).sort().at(-1);
  const t = readFileSync(DIR + file, "utf8");
  const start = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(start).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
  const bodyStart = t.indexOf(tag, start) + tag.length;
  return t.slice(start, t.indexOf(tag, bodyStart) + tag.length) + ";";
};

let failures = 0;
let redFailures = 0;
const check = (name, ok, detail = "", red = true) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) {
    failures++;
    if (red) redFailures++;
  }
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HELPR = U(1), POSTER = U(2), CREW2 = U(3), OTHER = U(4), BANNED = U(5);
const J1 = U(101), J2 = U(102), JOPEN = U(103), JCREW = U(104), JB = U(105);
const P1 = `${J1}/after-1.jpg`, P1B = `${J1}/after-2.jpg`, P2 = `${J2}/after-1.png`, PO = `${JOPEN}/after-1.jpg`;
const PC = `${CREW2}/after-crew.jpg`, PB = `${JB}/after-1.jpg`;

const db = new PGlite();
const all = async (sql) => (await db.query(sql)).rows;
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, handle text, full_name text, email_verified boolean DEFAULT true,
    ban_status text, is_seed boolean DEFAULT false, anonymized_at timestamptz, share_job_photos boolean NOT NULL DEFAULT true,
    out_of_declutter boolean DEFAULT false, under_18 boolean DEFAULT false);
  CREATE TABLE public.profile_handles_retired (handle text PRIMARY KEY, user_id uuid);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p) $$;
  CREATE FUNCTION public.declutter_member_out(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT coalesce((SELECT out_of_declutter FROM public.profiles WHERE user_id = p), false) $$;
  CREATE FUNCTION public.member_under_18(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT (SELECT under_18 FROM public.profiles WHERE user_id = p) $$;
  CREATE TYPE public.job_status AS ENUM ('open', 'assigned', 'completed', 'cancelled');
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status public.job_status, category text,
    title text, location text, is_group_job boolean DEFAULT false, is_seed boolean DEFAULT false, proof_after_urls text[],
    completed_at timestamptz, updated_at timestamptz DEFAULT now());
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, proof_after_urls text[]);
`);
await db.exec(realFn("job_booked_helpr_ids"));
await db.exec(`REVOKE ALL ON FUNCTION public.job_booked_helpr_ids(uuid) FROM PUBLIC, anon, authenticated;`);
if (!BEFORE) {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (the RED checks must FAIL)`);
}

await db.exec(`
  INSERT INTO public.profiles (user_id, handle, full_name) VALUES
    ('${HELPR}', 'hal-h', 'Hal Helpr'), ('${POSTER}', 'pat-p', 'Pat Poster'), ('${CREW2}', 'cy-c', 'Cy Crew'),
    ('${OTHER}', 'oz-o', 'Oz Other'), ('${BANNED}', 'ban-b', 'Bo Banned');
  INSERT INTO public.jobs (id, customer_id, helper_id, status, category, title, location, proof_after_urls, completed_at, is_group_job) VALUES
    ('${J1}', '${POSTER}', '${HELPR}', 'completed', 'yard_work', 'Mow at 12 Oak St', '12 Oak St, Delcambre', ARRAY['${P1}', '${P1B}'], '2026-10-14 15:00-05', false),
    ('${J2}', '${POSTER}', '${HELPR}', 'completed', 'handyman', 'Fix fence', '9 Elm', ARRAY['${P2}', 'https://x.supabase.co/storage/v1/object/sign/proof-photos/a.jpg?token=t'], '2026-09-02 10:00-05', false),
    ('${JOPEN}', '${POSTER}', '${HELPR}', 'assigned', 'moving', 'Move couch', '1 Pine', ARRAY['${PO}'], NULL, false),
    ('${JCREW}', '${POSTER}', NULL, 'completed', 'cleaning', 'Crew clean', '3 Bay', ARRAY[]::text[], '2026-10-20 12:00-05', true),
    ('${JB}', '${POSTER}', '${BANNED}', 'completed', 'yard_work', 'Banned job', '5 Fir', ARRAY['${PB}'], '2026-10-01 12:00-05', false);
  INSERT INTO public.group_job_helpers (job_id, helper_id, proof_after_urls) VALUES
    ('${JCREW}', '${HELPR}', ARRAY['${PC}']), ('${JCREW}', '${CREW2}', ARRAY[]::text[]);
`);

const as = (role, uid) =>
  db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`);
const call = async (sql) => {
  try {
    return { rows: await all(sql) };
  } catch (e) {
    return { error: e.message };
  }
};
const pick = (uid, job, path, shown = true) =>
  as("authenticated", uid).then(() => call(`SELECT public.set_job_photo_shown('${job}', '${path}', ${shown}) AS v`));
const visitor = async (handle = "hal-h") => {
  await as("anon");
  const r = await call(`SELECT public.public_profile_work_photos('${handle}') AS v`);
  return r.error ? { error: r.error } : { v: r.rows[0].v };
};
const lookup = async (id) => {
  await db.exec("RESET ROLE");
  const r = await call(`SELECT public.profile_work_photo_object('${id}') AS v`);
  return r.error ? undefined : r.rows[0].v;
};

const a = await pick(HELPR, J1, P1);
const crewPick = await pick(HELPR, JCREW, PC);
const v1 = await visitor();
const list1 = v1.v ?? [];
const keysOk = list1.length > 0 && list1.every((x) => JSON.stringify(Object.keys(x).sort()) === JSON.stringify(["category", "id", "month"]));
check("W1 a picked photo on a job everyone allowed shows as exactly {id, category, month}",
  !a.error && !crewPick.error && list1.length === 2 && keysOk && list1[0].category === "cleaning" && list1[1].month === "2026-10" && list1[1].category === "yard_work",
  JSON.stringify(v1));
check("W2 an unpicked photo (the second after photo, the other job) never shows", list1.length === 2, JSON.stringify(list1));
const raw = JSON.stringify(v1.v ?? null);
check("W5 no job id, storage path, address, title or customer name in the visitor's answer",
  !!v1.v && ![J1, JCREW, P1, PC, "after-", "Oak", "Delcambre", "Pat", POSTER].some((s) => raw.includes(s)), raw);

const j1Pick = list1.find((x) => x.category === "yard_work")?.id;
const before = await lookup(j1Pick);
await db.exec(`RESET ROLE; UPDATE public.profiles SET share_job_photos = false WHERE user_id = '${POSTER}';`);
const offPoster = (await visitor()).v ?? [];
const afterOff = await lookup(j1Pick);
await db.exec(`RESET ROLE; UPDATE public.profiles SET share_job_photos = true WHERE user_id = '${POSTER}';
  UPDATE public.profiles SET share_job_photos = false WHERE user_id = '${CREW2}';`);
const offCrew = (await visitor()).v ?? [];
await db.exec(`RESET ROLE; UPDATE public.profiles SET share_job_photos = true WHERE user_id = '${CREW2}';`);
check("W3 the poster, or any crew Helpr, turning sharing off hides the photo; the image lookup says NULL then",
  before === P1 && afterOff === null && offPoster.length === 0 && offCrew.length === 1 && offCrew[0].category === "yard_work",
  JSON.stringify({ before, afterOff, offPoster, offCrew }));

const notMine = await pick(OTHER, J1, P1B);
const notOnJob = await pick(HELPR, J1, `${J1}/after-9.jpg`);
const openJob = await pick(HELPR, JOPEN, PO);
const legacy = await pick(HELPR, J2, "https://x.supabase.co/storage/v1/object/sign/proof-photos/a.jpg?token=t");
await as("anon");
const anonPick = await call(`SELECT public.set_job_photo_shown('${J1}', '${P1B}', true) AS v`);
check("W4 refused: another member's pick, a photo not on the job, an open job, a legacy full URL, and anon",
  [notMine, notOnJob, openJob, legacy, anonPick].every((r) => !!r.error),
  JSON.stringify([notMine, notOnJob, openJob, legacy, anonPick].map((r) => r.error ?? "allowed")), false);

const bPick = await pick(BANNED, JB, PB);
const bList = (await visitor("ban-b")).v ?? [];
const bBefore = bList.length;
const bObjBefore = bList[0] ? await lookup(bList[0].id) : undefined;
await db.exec(`RESET ROLE; UPDATE public.profiles SET ban_status = 'temp_banned' WHERE user_id = '${BANNED}';`);
const bBanned = (await visitor("ban-b")).v ?? null;
const bObjBanned = bList[0] ? await lookup(bList[0].id) : undefined;
await db.exec(`RESET ROLE; UPDATE public.profiles SET ban_status = NULL WHERE user_id = '${BANNED}'; INSERT INTO public.test_accounts VALUES ('${BANNED}');`);
const bTest = (await visitor("ban-b")).v ?? null;
const bObjTest = bList[0] ? await lookup(bList[0].id) : undefined;
check("W6 a banned or test Helpr's page gives no job photos, and the image lookup says NULL for them",
  !bPick.error && bBefore === 1 && bObjBefore === PB && Array.isArray(bBanned) && bBanned.length === 0 && bObjBanned === null
    && Array.isArray(bTest) && bTest.length === 0 && bObjTest === null,
  JSON.stringify({ bPick, bBefore, bObjBefore, bBanned, bObjBanned, bTest, bObjTest }));

await db.exec(`RESET ROLE; UPDATE public.jobs SET proof_after_urls = ARRAY['${P1B}'] WHERE id = '${J1}';`);
const removed = (await visitor()).v ?? [];
await db.exec(`RESET ROLE; UPDATE public.jobs SET proof_after_urls = ARRAY['${P1}', '${P1B}'] WHERE id = '${J1}';`);
const back = (await visitor()).v ?? [];
const untick = await pick(HELPR, J1, P1, false);
const unticked = (await visitor()).v ?? [];
check("W7 a photo taken off the job stops showing; un-ticking removes it",
  removed.length === 1 && back.length === 2 && !untick.error && unticked.length === 1 && unticked[0].category === "cleaning",
  JSON.stringify({ removed, back, untick, unticked }));

await pick(HELPR, J1, P1);
await db.exec(`RESET ROLE; UPDATE public.profiles SET share_job_photos = false WHERE user_id = '${POSTER}';`);
await as("authenticated", HELPR);
const mine = (await call(`SELECT job_id, photo_path, category, month, shown, consented FROM public.my_job_photos()`)).rows ?? [];
await db.exec(`RESET ROLE; UPDATE public.profiles SET share_job_photos = true WHERE user_id = '${POSTER}';`);
const row = (p) => mine.find((m) => m.photo_path === p);
check("W8 the Helpr's own list: every after photo of a completed job, shown or not, and whether it waits on consent",
  mine.length === 4 && row(P1)?.shown === true && row(P1)?.consented === false && row(P1B)?.shown === false
    && row(P2)?.month === "2026-09" && !row(PO) && row(PC)?.shown === true,
  JSON.stringify(mine));

await db.exec("RESET ROLE");
const acl = (await call(`SELECT
  has_function_privilege('anon', 'public.public_profile_work_photos(text)', 'EXECUTE') AS read,
  has_function_privilege('anon', 'public.profile_work_photo_object(uuid)', 'EXECUTE') AS obj,
  has_function_privilege('authenticated', 'public.profile_work_photo_object(uuid)', 'EXECUTE') AS obj_auth,
  has_function_privilege('anon', 'public.profile_job_photo_visible(uuid)', 'EXECUTE') AS vis,
  has_function_privilege('anon', 'public.job_photos_withheld(uuid)', 'EXECUTE') AS cons,
  has_function_privilege('authenticated', 'public.helpr_job_after_photos(uuid)', 'EXECUTE') AS after,
  has_function_privilege('anon', 'public.profile_page_hidden(uuid)', 'EXECUTE') AS gate,
  has_function_privilege('anon', 'public.my_job_photos()', 'EXECUTE') AS mine_anon,
  has_function_privilege('anon', 'public.set_job_photo_shown(uuid, text, boolean)', 'EXECUTE') AS set_anon,
  has_table_privilege('anon', 'public.profile_job_photos', 'SELECT') AS t_anon,
  has_table_privilege('authenticated', 'public.profile_job_photos', 'SELECT') AS t_auth`)).rows?.[0] ?? {};
check("W9 anon executes the visitor read only; nobody but service_role reaches the table, the lookup or the helpers",
  acl.read === true && [acl.obj, acl.obj_auth, acl.vis, acl.cons, acl.after, acl.gate, acl.mine_anon, acl.set_anon, acl.t_anon, acl.t_auth].every((x) => x === false),
  JSON.stringify(acl));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL (${redFailures} of them RED checks)`}${BEFORE ? " [--before]" : ""}`);
process.exit(BEFORE ? (redFailures > 0 && failures === redFailures ? 0 : 1) : (failures ? 1 : 0));
