#!/usr/bin/env node
/**
 * PGlite proof for 20261006204113_job_materials_and_access_notes
 * (docs/OPEN.md Q1438: materials shown to everyone, access & parking notes
 * only to the poster and the booked Helpr(s)).
 *
 *   node src/test/pglite/jobAccessNotes.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobAccessNotes.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: the LIVE jobs columns (pg_attribute, read-only, 2026-10-06), the
 * jobs RLS SELECT/INSERT/UPDATE policies as they are on prod, and the objects
 * this migration redefines in their EFFECTIVE definitions on main (cut from
 * the migration that last defined each: open_jobs_browse 20261006042617,
 * enforce_poster_jobs_money_lock 20261004193548, clear_job_accept_pending
 * 20261003214350, reject_contact_leak_in_job 20260924045813,
 * enforce_jobs_insert_column_lock 20261005060416). Functions the view only
 * needs to compile (mask_job_location, early_access_cutoff, ...) are stubs.
 * Roles are real: `SET ROLE authenticated` is PostgREST with a user JWT,
 * `SET ROLE anon` a signed-out visitor, the superuser the migration runner.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261006204113_job_materials_and_access_notes.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

/** The newest CREATE of one function inside one migration file. */
function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}
/** The text between two markers of one migration file (a DO block, a CREATE TRIGGER). */
function between(file, startMarker, endMarker) {
  const sql = read(MIGDIR + file);
  const s = sql.indexOf(startMarker);
  const e = sql.indexOf(endMarker, s);
  if (s < 0 || e < 0) throw new Error(`${file}: markers not found`);
  return sql.slice(s, e + endMarker.length);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const CREWMATE = "96c9899e-87a2-49e2-bbdd-268717d52aee";
const STRANGER = "f6cc3ebb-9478-473c-8eb8-62b406f0734f";
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OPEN = id(1); // open, funded, legacy materials + access text
const BOOKED = id(2); // helper_id = HELPER, access text only
const CREW = id(3); // crew job, CREWMATE on the roster
const MATONLY = id(4); // materials only
const OPEN2 = id(5); // open, nothing yet
const OFFER = id(6); // open direct offer with a pending accept

const JOBS_COLUMNS = read("./fixtures/jobs.columns.live.sql");

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
CREATE TYPE public.job_category AS ENUM ('cleaning','yard_work','moving','errands','handyman','painting','delivery','pet_care','assembly','other','storm_prep','events');
CREATE TABLE public.jobs (
${JOBS_COLUMNS}
, PRIMARY KEY (id));
CREATE TABLE public.group_job_helpers (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE, helper_id uuid, status text DEFAULT 'accepted');
CREATE TABLE public.applications (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid, helper_id uuid, status text);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE TABLE public.notifications (id uuid DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid);
CREATE TABLE public.profiles (user_id uuid, is_seed boolean DEFAULT false);
GRANT SELECT ON public.group_job_helpers, public.applications, public.ban_settlement_queue TO anon, authenticated, service_role;
CREATE FUNCTION public.mask_job_location(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'masked' $$;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() + interval '1 day' $$;
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.enforce_ban_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE FUNCTION public.refuse_unconfirmed_email_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own jobs" ON public.jobs FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = customer_id OR (SELECT auth.uid()) = helper_id);
CREATE POLICY "Customers can create jobs" ON public.jobs FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = customer_id AND business_id IS NULL);
CREATE POLICY "Customers can update their own jobs" ON public.jobs FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = customer_id);
GRANT SELECT, INSERT, UPDATE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
`);
for (const [file, fn] of [
  ["20260915101102_null_uid_is_not_server.sql", "is_server_context"],
  ["20260915030812_contact_leak_reason_exempts_location_shares.sql", "contact_leak_reason"],
  ["20260915045110_hide_offered_helper_from_non_posters.sql", "jobs_private_select_columns"],
  ["20260915045110_hide_offered_helper_from_non_posters.sql", "sync_jobs_select_grants"],
  ["20261004193548_booked_job_terms_locked.sql", "enforce_poster_jobs_money_lock"],
  ["20261005060416_direct_offer_markers_server_owned_on_insert.sql", "enforce_jobs_insert_column_lock"],
  ["20261003214350_direct_offer_accept_works_like_an_offer.sql", "clear_job_accept_pending"],
  ["20260924045813_job_special_requirements_contact_scan.sql", "reject_contact_leak_in_job"],
]) {
  await db.exec(cut(file, fn));
}
await db.exec(`
SELECT public.sync_jobs_select_grants();
CREATE TRIGGER trg_poster_jobs_money_lock BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_jobs_money_lock();
CREATE TRIGGER trg_jobs_insert_column_lock BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_insert_column_lock();
`);
await db.exec(between("20260924045813_job_special_requirements_contact_scan.sql", "DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_job", "public.reject_contact_leak_in_job();"));
await db.exec(between("20261003214350_direct_offer_accept_works_like_an_offer.sql", "DROP TRIGGER IF EXISTS trg_jobs_clear_accept_pending", "public.clear_job_accept_pending();"));
// The view's body on main, run directly (its DO block skips when the view is absent).
{
  const src = read(MIGDIR + "20261006042617_ban_review_hides_posts_on_crew_surfaces.sql");
  const body = /EXECUTE \$v\$([\s\S]*?)\$v\$;/.exec(src)[1];
  await db.exec(body + ";\nGRANT SELECT ON public.open_jobs_browse TO anon, authenticated;");
}

// The state on main: both notes in one column.
const job = (jid, extra) => {
  const cols = { status: "open", ...extra };
  return `INSERT INTO public.jobs (id, customer_id, title, description, category, budget, date_needed, payment_status, created_at, ${Object.keys(cols).join(", ")})
  VALUES ('${jid}', '${POSTER}', 'Job ${jid.slice(-2)}', 'desc', 'cleaning', 50, current_date + 7, 'escrow', now() - interval '2 days', ${Object.values(cols).map((v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`)).join(", ")})`;
};
await db.exec(`
${job(OPEN, { special_requirements: "Materials I'll provide: clean\n\nGate 4521, park on the left" })};
${job(BOOKED, { special_requirements: "Side door, code 7731", helper_id: HELPER, status: "accepted" })};
${job(CREW, { special_requirements: "Lockbox on the porch", is_group_job: "true", helpers_needed: "2" })};
${job(MATONLY, { special_requirements: "Materials I'll provide: supplies" })};
${job(OPEN2, { special_requirements: null })};
${job(OFFER, { special_requirements: null, offered_to_helper_id: HELPER, direct_offer_status: "pending" })};
INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${CREW}', '${CREWMATE}');
INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ('${OFFER}', '${HELPER}');
`);

if (!MODE) {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(NEW);
      check(`migration applies (run ${i})`, true);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
}

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try {
    return { rows: (await db.query(sql)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.message };
  } finally {
    await db.exec("RESET ROLE");
  }
}
/** One statement in its own transaction (deferred FK checks run at COMMIT). */
async function asTx(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  try {
    await db.exec(`BEGIN; ${who === "service" ? "SET LOCAL ROLE service_role" : "SET LOCAL ROLE authenticated"}; ${sql}; COMMIT;`);
    return null;
  } catch (e) {
    await db.exec("ROLLBACK").catch(() => {});
    return e.message;
  } finally {
    await db.exec("RESET ROLE");
  }
}
/** First row, or `{ __error }` (the RED run reads columns main does not have). */
const one = async (sql) => {
  try {
    return (await db.query(sql)).rows[0] ?? {};
  } catch (e) {
    return { __error: e.message };
  }
};
const notesOf = async (jid) => (await one(`SELECT notes FROM public.job_access_notes WHERE job_id = '${jid}'`)).notes ?? null;

// ── 1. Backfill ──────────────────────────────────────────────────────────────
{
  const r = await one(`SELECT materials_note, special_requirements FROM public.jobs WHERE id = '${OPEN}'`);
  check("backfill: combined text -> materials_note", r.materials_note === "clean", JSON.stringify(r));
  check("backfill: combined text -> job_access_notes", (await notesOf(OPEN)) === "Gate 4521, park on the left");
  check("backfill: special_requirements nulled", r.special_requirements === null);
  check("backfill: unprefixed text is access only", (await notesOf(BOOKED)) === "Side door, code 7731");
  const m = await one(`SELECT materials_note FROM public.jobs WHERE id = '${MATONLY}'`);
  check("backfill: materials-only text", m.materials_note === "supplies" && (await notesOf(MATONLY)) === null);
  const left = await one(`SELECT count(*)::int n FROM public.jobs WHERE special_requirements IS NOT NULL`);
  check("backfill: no jobs row keeps special_requirements", left.n === 0, `${left.n} left`);
}

// ── 2. Who reads the access notes ───────────────────────────────────────────
{
  const anon = await as(null, `SELECT * FROM public.job_access_notes`);
  check("anon cannot read job_access_notes", !!anon.error && /permission denied/.test(anon.error), anon.error ?? `${anon.rows.length} rows`);
  const stranger = await as(STRANGER, `SELECT job_id FROM public.job_access_notes`);
  check("a stranger reads no access notes", !stranger.error && stranger.rows.length === 0, stranger.error ?? `${stranger.rows.length} rows`);
  const poster = await as(POSTER, `SELECT job_id FROM public.job_access_notes ORDER BY job_id`);
  check("the poster reads all of theirs", !poster.error && poster.rows.length === 3, poster.error ?? `${poster.rows.length} rows`);
  const helper = await as(HELPER, `SELECT job_id FROM public.job_access_notes`);
  check("the booked Helpr reads only the booked job's", !helper.error && helper.rows.length === 1 && helper.rows[0].job_id === BOOKED,
    helper.error ?? JSON.stringify(helper.rows));
  const crew = await as(CREWMATE, `SELECT job_id FROM public.job_access_notes`);
  check("a crew member reads only their crew job's", !crew.error && crew.rows.length === 1 && crew.rows[0].job_id === CREW,
    crew.error ?? JSON.stringify(crew.rows));
  // HELPER holds a pending direct offer on OFFER: an offer is not a booking.
  await db.exec(`INSERT INTO public.job_access_notes (job_id, notes) VALUES ('${OFFER}', 'Offer gate 1') ON CONFLICT DO NOTHING`).catch(() => {});
  const offered = await as(HELPER, `SELECT job_id FROM public.job_access_notes WHERE job_id = '${OFFER}'`);
  check("a pending direct offer does not read them", offered.rows.length === 0, offered.error ?? `${offered.rows.length} rows`);
}

// ── 3. Browse never carries them; materials is public ───────────────────────
{
  const cols = (await db.query(`SELECT attname FROM pg_attribute WHERE attrelid = 'public.open_jobs_browse'::regclass AND attnum > 0 AND NOT attisdropped`)).rows.map((r) => r.attname);
  check("open_jobs_browse exposes materials_note", cols.includes("materials_note"));
  const anon = await as(null, `SELECT id, materials_note, special_requirements FROM public.open_jobs_browse WHERE id = '${OPEN}'`);
  check("anon browse returns materials_note", !anon.error && anon.rows[0]?.materials_note === "clean", anon.error ?? JSON.stringify(anon.rows));
  check("anon browse returns no access text", !anon.error && anon.rows.every((r) => r.special_requirements === null), JSON.stringify(anon.rows));
  const viewDef = (await one(`SELECT pg_get_viewdef('public.open_jobs_browse'::regclass) d`)).d;
  check("open_jobs_browse never reads job_access_notes", !/job_access_notes/.test(viewDef));
  const sel = await as(HELPER, `SELECT materials_note FROM public.jobs WHERE id = '${BOOKED}'`);
  check("authenticated has the materials_note column grant", !sel.error, sel.error ?? "");
}

// ── 4. Writes ───────────────────────────────────────────────────────────────
{
  const ok = await asTx(POSTER, `INSERT INTO public.job_access_notes (job_id, notes) VALUES ('${OPEN2}', 'Blue gate')`);
  check("the poster adds a note to an open job", ok === null, ok ?? "");
  const upd = await asTx(POSTER, `UPDATE public.job_access_notes SET notes = 'Red gate' WHERE job_id = '${OPEN2}'`);
  check("the poster edits it while nobody is booked", upd === null && (await notesOf(OPEN2)) === "Red gate", upd ?? "");
  const stranger = await asTx(STRANGER, `INSERT INTO public.job_access_notes (job_id, notes) VALUES ('${OPEN2}', 'x')`);
  check("a stranger cannot add a note to someone's job", stranger !== null, stranger ?? "accepted");
  const helperUpd = await as(HELPER, `UPDATE public.job_access_notes SET notes = 'hijack' WHERE job_id = '${BOOKED}' RETURNING job_id`);
  check("the booked Helpr cannot edit the note", helperUpd.rows.length === 0 && (await notesOf(BOOKED)) === "Side door, code 7731", helperUpd.error ?? "");
  const locked = await asTx(POSTER, `UPDATE public.job_access_notes SET notes = 'moved' WHERE job_id = '${BOOKED}'`);
  check("the poster cannot change it once booked (Q1204 parity)", locked !== null && /once a Helpr is booked/.test(locked), locked ?? "accepted");
  const lockedDel = await asTx(POSTER, `DELETE FROM public.job_access_notes WHERE job_id = '${BOOKED}'`);
  check("nor delete it once booked", lockedDel !== null && (await notesOf(BOOKED)) !== null, lockedDel ?? "accepted");
  const crewLocked = await asTx(POSTER, `UPDATE public.job_access_notes SET notes = 'moved' WHERE job_id = '${CREW}'`);
  {
    // Once the job is over the poster may take the gate code back (review #2).
    const done = id(70);
    await db.exec(`${job(done, { helper_id: HELPER, status: "completed" })}; INSERT INTO public.job_access_notes (job_id, notes) VALUES ('${done}', 'Old gate 1111')`).catch(() => { /* RED run: no table */ });
    const del = await asTx(POSTER, `DELETE FROM public.job_access_notes WHERE job_id = '${done}'`);
    check("the poster can delete the note once the job is completed", del === null && (await notesOf(done)) === null && !MODE, del ?? "");
  }
  check("a crew roster counts as booked", crewLocked !== null, crewLocked ?? "accepted");
  const leak = await asTx(POSTER, `UPDATE public.job_access_notes SET notes = 'call me 504-555-1212' WHERE job_id = '${OPEN2}'`);
  check("the access note is contact-scanned", leak !== null && /access and parking notes/.test(leak), leak ?? "accepted");
  const matLeak = await asTx(POSTER, `UPDATE public.jobs SET materials_note = 'email me at a@b.com' WHERE id = '${OPEN2}'`);
  check("materials_note is contact-scanned", matLeak !== null && /materials note/.test(matLeak), matLeak ?? "accepted");
  const matOpen = await asTx(POSTER, `UPDATE public.jobs SET materials_note = 'Paint and rollers' WHERE id = '${OPEN2}'`);
  check("the poster sets materials on an open job", matOpen === null, matOpen ?? "");
  const matBooked = await asTx(POSTER, `UPDATE public.jobs SET materials_note = 'changed' WHERE id = '${BOOKED}'`);
  check("materials_note is locked once booked", matBooked !== null && /once a Helpr is booked/.test(matBooked), matBooked ?? "accepted");
  const blank = await asTx(POSTER, `UPDATE public.jobs SET materials_note = '   ' WHERE id = '${OPEN2}'`);
  const b = await one(`SELECT materials_note FROM public.jobs WHERE id = '${OPEN2}'`);
  check("a blank materials note is stored as NULL", blank === null && b.materials_note === null, blank ?? JSON.stringify(b));
}

// ── 5. A pre-change client still sending the combined text ──────────────────
{
  const err = await asTx(POSTER, `INSERT INTO public.jobs (customer_id, title, description, category, budget, date_needed, special_requirements, client_request_id)
    VALUES ('${POSTER}', 'Legacy post', 'desc', 'painting', 40, current_date + 3, E'Materials I''ll provide: paint\\n\\nKey under the mat', '${id(60)}')`);
  check("a legacy INSERT with the combined text succeeds", err === null, err ?? "");
  const r = await one(`SELECT id, materials_note, special_requirements FROM public.jobs WHERE client_request_id = '${id(60)}'`);
  check("legacy INSERT: materials routed, column nulled", r?.materials_note === "paint" && r?.special_requirements === null, JSON.stringify(r));
  check("legacy INSERT: access routed to job_access_notes", r ? (await notesOf(r.id)) === "Key under the mat" : false);
  const lockedLegacy = await asTx(POSTER, `UPDATE public.jobs SET special_requirements = 'new gate' WHERE id = '${BOOKED}'`);
  check("a legacy UPDATE on a booked job is still refused", lockedLegacy !== null && (await notesOf(BOOKED)) === "Side door, code 7731", lockedLegacy ?? "accepted");
  const openLegacy = await asTx(POSTER, `UPDATE public.jobs SET special_requirements = 'Gate 99' WHERE id = '${MATONLY}'`);
  check("a legacy UPDATE on an open job routes the access note", openLegacy === null && (await notesOf(MATONLY)) === "Gate 99", openLegacy ?? "");
  const direct = await db.exec(`ALTER TABLE public.jobs DISABLE TRIGGER zzzzz_jobs_route_notes; UPDATE public.jobs SET special_requirements = 'raw' WHERE id = '${OPEN2}'`).then(() => null, (e) => e.message);
  await db.exec(`ALTER TABLE public.jobs ENABLE TRIGGER zzzzz_jobs_route_notes`).catch(() => {});
  check("jobs_special_requirements_retired refuses text in the column", direct !== null && /jobs_special_requirements_retired/.test(direct), direct ?? "accepted");
}

// ── 6. Recurring visit, pending direct accept, account deletion ─────────────
{
  const visit = id(50);
  const err = await asTx("service", `INSERT INTO public.jobs (id, customer_id, title, description, category, budget, date_needed, parent_job_id, helper_id, status, payment_status)
    VALUES ('${visit}', '${POSTER}', 'Visit', 'desc', 'cleaning', 50, current_date + 14, '${OPEN}', '${HELPER}', 'accepted', 'escrow')`);
  const v = await one(`SELECT materials_note FROM public.jobs WHERE id = '${visit}'`);
  check("a recurring visit inherits materials", err === null && v?.materials_note === "clean", err ?? JSON.stringify(v));
  check("a recurring visit inherits the access note", (await notesOf(visit)) === "Gate 4521, park on the left");
  const vh = await as(HELPER, `SELECT job_id FROM public.job_access_notes WHERE job_id = '${visit}'`);
  check("the visit's Helpr reads it", vh.rows.length === 1, vh.error ?? "");

  const before = await one(`SELECT count(*)::int n FROM public.job_accept_pending WHERE job_id = '${OFFER}'`);
  const e2 = await asTx(POSTER, `UPDATE public.jobs SET materials_note = 'Ladder provided' WHERE id = '${OFFER}'`);
  const after = await one(`SELECT count(*)::int n FROM public.job_accept_pending WHERE job_id = '${OFFER}'`);
  check("changing materials voids a pending direct accept", e2 === null && before.n === 1 && after.n === 0, e2 ?? `${before.n} -> ${after.n}`);

  // Account deletion: section 4b of the NEWEST purge_user_data, its real text
  // (cut from the migration, not retyped), run as the service role the
  // delete-account path uses, for the poster of the booked job.
  await db.exec(`UPDATE public.jobs SET materials_note = 'Ladder by the gate' WHERE id = '${BOOKED}'`).catch(() => { /* RED run: no column */ });
  const OLD_PURGE = "20260924072554_redacted_job_description_is_user_copy.sql";
  const section4b = (file) => {
    const purge = cut(file, "purge_user_data");
    const from = purge.indexOf("  WITH upd AS (\n    UPDATE public.jobs\n       SET location");
    let to = purge.indexOf("SELECT count(*) INTO v_jobs_redacted FROM upd;", from) + "SELECT count(*) INTO v_jobs_redacted FROM upd;".length;
    const q1427End = "PERFORM set_config('app.access_notes_server_write', '', true);";
    const q1427 = purge.indexOf(q1427End, to);
    if (q1427 > 0 && q1427 - to < 1200) to = q1427 + q1427End.length;
    return from > 0 && to > from ? purge.slice(from, to) : null;
  };
  const run4b = (text) => asTx("service", `DO $purge$ DECLARE p_user_id uuid := '${POSTER}'; v_jobs_redacted integer; BEGIN ${text} END $purge$`);
  if (!MODE) {
    // Discrimination: the purge as it was before this change leaves the gate code behind.
    const eOld = await run4b(section4b(OLD_PURGE));
    check("the pre-Q1438 purge leaves the access note behind (the defect this closes)", eOld === null && (await notesOf(BOOKED)) !== null, eOld ?? "");
    await db.exec(`UPDATE public.jobs SET description = 'desc' WHERE customer_id = '${POSTER}'`);
  }
  const purgeFile = MODE ? OLD_PURGE : "20261006204113_job_materials_and_access_notes.sql";
  const text4b = section4b(purgeFile);
  check("purge_user_data 4b found in the newest definition", !!text4b, purgeFile);
  const e3 = await run4b(text4b ?? "NULL;");
  const d = await one(`SELECT materials_note, description FROM public.jobs WHERE id = '${BOOKED}'`);
  check("account deletion (purge 4b) removes the access note on a booked job", e3 === null && (await notesOf(BOOKED)) === null, e3 ?? JSON.stringify(d));
  check("account deletion (purge 4b) clears the materials note", e3 === null && d.materials_note === null && /closed their account/.test(d.description ?? ""), e3 ?? JSON.stringify(d));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
