// Probe: 20260914200051 (message-attachments read scoped to the object's own
// job + sender; voice-notes upload/delete), in real Postgres. NOT a vitest test
// (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/message-attachments-authz.probe.mjs
//
// Same database, same rows, twice: first under prod's live policies as read
// from pg_policies on 2026-09-14 (must show the holes: a forged
// messages.attachment_url grants a cross-user read, voice notes cannot be
// uploaded or deleted, a job id equal to a uid passes), then after the
// migration applied verbatim three times (every expectation must hold).
// Exit 1 if either half does not match. The prod twin is
// scripts/probes/message-attachments-authz.prod.mjs.
//
// RLS is actually ENABLED on both tables and auth.uid() is settable, so every
// SET ROLE statement is judged by the policies, not by the raw GRANT.
// `DELETE ... RETURNING` mirrors storage-api, which returns deleted rows, so a
// delete needs SELECT visibility as well (the object must be referenced).
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import fs from "node:fs";
const MIG = fs.readFileSync(new URL("../../supabase/migrations/20260914200051_message_attachments_path_scoped_read_and_voice_notes.sql", import.meta.url), "utf8");

const A = "71c56dfb-b326-4010-b960-b18dd3966e7f", B = "437de07d-1bd7-46c8-a451-6b46aa3bcad5", ADM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const J1 = "e8cabaca-87ac-4fa0-95e4-b33179e05d6e", J2 = "63bf6243-b1a6-55b9-ad4e-d6cae05df6bc";
const H1 = "11111111-1111-4111-8111-111111111111"; // helper on J1
const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
CREATE TABLE public.user_roles (user_id uuid, role app_role);
CREATE TABLE public.jobs (id uuid primary key, customer_id uuid, helper_id uuid, offered_to_helper_id uuid);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.applications (job_id uuid, helper_id uuid);
CREATE TABLE public.messages (id uuid primary key default gen_random_uuid(), job_id uuid not null, sender_id uuid not null, receiver_id uuid not null, content text, attachment_url text, attachment_mime text, attachment_size int, is_system boolean default false, flagged_hidden boolean default false, created_at timestamptz default now());
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.messages TO authenticated, anon;
CREATE POLICY "Users can view their own messages" ON public.messages FOR SELECT TO authenticated USING ((SELECT auth.uid()) = sender_id OR ((SELECT auth.uid()) = receiver_id AND COALESCE(flagged_hidden,false) = false));
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE FUNCTION public.is_party_to_job(_job_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id AND (j.customer_id = _user_id OR j.helper_id = _user_id OR j.offered_to_helper_id = _user_id))
    OR EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _user_id)
    OR EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = _job_id AND a.helper_id = _user_id) $$;
CREATE FUNCTION public.can_message_in_job(_job_id uuid, _sender uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id AND j.customer_id = _sender)
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id AND (j.offered_to_helper_id = _sender OR j.helper_id = _sender))
    OR EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _sender)
    OR EXISTS (SELECT 1 FROM public.messages m JOIN public.jobs j ON j.id = m.job_id WHERE m.job_id = _job_id AND m.sender_id = j.customer_id AND m.receiver_id = _sender) $$;
REVOKE EXECUTE ON FUNCTION public.can_message_in_job(uuid,uuid), public.is_party_to_job(uuid,uuid), public.has_role(uuid,app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_message_in_job(uuid,uuid), public.is_party_to_job(uuid,uuid), public.has_role(uuid,app_role) TO authenticated, service_role;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE _parts text[]; BEGIN SELECT string_to_array(name, '/') INTO _parts; RETURN _parts[1 : array_length(_parts,1) - 1]; END $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated, anon;
CREATE TABLE storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated, anon;
INSERT INTO storage.buckets VALUES ('message-attachments','message-attachments',false,5242880,ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']);
INSERT INTO public.jobs VALUES ('${J1}','${A}','${H1}',null), ('${J2}','${B}',null,null);
INSERT INTO public.user_roles VALUES ('${ADM}','admin');
-- prod's live policies before the migration
CREATE POLICY "Users can send messages" ON public.messages FOR INSERT TO public WITH CHECK ((SELECT auth.uid()) = sender_id AND can_message_in_job(job_id, (SELECT auth.uid())) AND is_party_to_job(job_id, receiver_id));
CREATE POLICY "message-attachments: sender uploads to own path" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'message-attachments' AND (storage.foldername(name))[2] = (SELECT auth.uid())::text);
CREATE POLICY "message-attachments: participants and admins read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'message-attachments' AND (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR EXISTS (SELECT 1 FROM public.messages m WHERE m.attachment_url = storage.objects.name AND ((SELECT auth.uid()) = m.sender_id OR (SELECT auth.uid()) = m.receiver_id))));
CREATE POLICY "message-attachments: sender deletes own" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'message-attachments' AND (storage.foldername(name))[2] = (SELECT auth.uid())::text);
`;

const aPath = `${J1}/${A}/f1-a.png`;
async function as(db, uid, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${uid ?? ""}', false);`);
  await db.exec(uid ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { if (process.env.DBG) console.log("ERR", sql.slice(0, 90), e.message); return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
async function scenario(db, label) {
  await db.exec(`RESET ROLE; DELETE FROM public.messages; DELETE FROM storage.objects;`);
  const out = {};
  const ins = (uid, name) => as(db, uid, `INSERT INTO storage.objects (bucket_id, name) VALUES ('message-attachments', '${name}')`);
  const canRead = async (uid, name) => { const r = await as(db, uid, `SELECT name FROM storage.objects WHERE name = '${name}'`); return r.ok && r.rows.length === 1; };
  const del = async (uid, name) => { const r = await as(db, uid, `DELETE FROM storage.objects WHERE name = '${name}' RETURNING name`); return r.ok && r.rows.length === 1; };
  out.A_upload_own = (await ins(A, aPath)).ok;
  out.B_reads_A_before_msg = await canRead(B, aPath);
  const forged = await as(db, B, `INSERT INTO public.messages (job_id, sender_id, receiver_id, attachment_url) VALUES ('${J2}','${B}','${B}','${aPath}') RETURNING id`);
  out.B_forged_insert_allowed = forged.ok;
  // legacy forged row (pre-migration data) written as owner, to test the read rule alone
  if (!forged.ok) await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, attachment_url) VALUES ('${J2}','${B}','${B}','${aPath}')`);
  out.B_reads_A_via_forged_row = await canRead(B, aPath);
  // legit: A messages helper H1 in J1 with A's attachment; both read
  out.A_legit_msg = (await as(db, A, `INSERT INTO public.messages (job_id, sender_id, receiver_id, attachment_url) VALUES ('${J1}','${A}','${H1}','${aPath}') RETURNING id`)).ok;
  out.A_reads_own = await canRead(A, aPath);
  out.H1_receiver_reads = await canRead(H1, aPath);
  out.admin_reads = await canRead(ADM, aPath);
  out.anon_reads = await canRead(null, aPath);
  // voice notes
  const v = `voice-notes/${J1}/${A}/v1.webm`;
  out.A_voice_upload = (await ins(A, v)).ok;
  out.A_voice_msg = (await as(db, A, `INSERT INTO public.messages (job_id, sender_id, receiver_id, attachment_url) VALUES ('${J1}','${A}','${H1}','${v}') RETURNING id`)).ok;
  out.H1_reads_voice = await canRead(H1, v);
  out.B_reads_voice = await canRead(B, v);
  out.A_voice_delete = await del(A, v);
  // planting / job-id-equals-uid / non-party
  out.B_plants_in_J1_own_segment = (await ins(B, `${J1}/${B}/p.png`)).ok;
  out.B_voice_plant_J1 = (await ins(B, `voice-notes/${J1}/${B}/p.webm`)).ok;
  out.A_voice_into_B_folder = (await ins(A, `voice-notes/${J2}/${B}/p.webm`)).ok;
  out.A_voice_jobid_equals_uid = (await ins(A, `voice-notes/${A}/x/p.webm`)).ok;
  out.A_nonuuid_job_segment = (await ins(A, `notauuid/${A}/p.png`)).ok;
  out.A_root_file = (await ins(A, `p.png`)).ok;
  out.B_deletes_A_file = await del(B, aPath);
  out.H1_upload_in_J1 = (await ins(H1, `${J1}/${H1}/h.png`)).ok;
  await as(db, H1, `INSERT INTO public.messages (job_id, sender_id, receiver_id, attachment_url) VALUES ('${J1}','${H1}','${A}','${J1}/${H1}/h.png')`);
  out.H1_deletes_own = await del(H1, `${J1}/${H1}/h.png`);
  out.A_msg_attach_other_job_own_uid = (await as(db, A, `INSERT INTO public.messages (job_id, sender_id, receiver_id, attachment_url) VALUES ('${J1}','${A}','${H1}','${J2}/${A}/x.png') RETURNING id`)).ok;
  out.A_msg_attach_nested = (await as(db, A, `INSERT INTO public.messages (job_id, sender_id, receiver_id, attachment_url) VALUES ('${J1}','${A}','${H1}','${J1}/${A}/a/b.png') RETURNING id`)).ok;
  out.A_msg_no_attach = (await as(db, A, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${J1}','${A}','${H1}','hi') RETURNING id`)).ok;
  out.anon_msg = (await as(db, null, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${J1}','${A}','${H1}','hi') RETURNING id`)).ok;
  console.log(`\n== ${label}`);
  console.table(out);
  return out;
}

const db = new PGlite();
await db.exec(SCHEMA);
const before = await scenario(db, "BEFORE (prod's live policies)");
for (let i = 1; i <= 3; i++) { await db.exec("RESET ROLE"); await db.exec(MIG); console.log(`migration applied (${i})`); }
const pol = await db.query(`select tablename, policyname, roles::text from pg_policies where policyname ~ '(message-attachments|send messages)' order by 1,2`);
console.table(pol.rows);
const mimes = await db.query(`select allowed_mime_types from storage.buckets`); console.log(mimes.rows[0]);
const after = await scenario(db, "AFTER migration x3");
const expectAfter = { A_upload_own: true, B_reads_A_before_msg: false, B_forged_insert_allowed: false, B_reads_A_via_forged_row: false, A_legit_msg: true, A_reads_own: true, H1_receiver_reads: true, admin_reads: true, anon_reads: false, A_voice_upload: true, A_voice_msg: true, H1_reads_voice: true, B_reads_voice: false, A_voice_delete: true, B_plants_in_J1_own_segment: false, B_voice_plant_J1: false, A_voice_into_B_folder: false, A_voice_jobid_equals_uid: false, A_nonuuid_job_segment: false, A_root_file: false, B_deletes_A_file: false, H1_upload_in_J1: true, H1_deletes_own: true, A_msg_attach_other_job_own_uid: false, A_msg_attach_nested: false, A_msg_no_attach: true, anon_msg: false };
// The holes the previous policies must show, or this probe proves nothing.
const expectBefore = { B_forged_insert_allowed: true, B_reads_A_via_forged_row: true, A_voice_upload: false, H1_reads_voice: false, A_voice_delete: false, A_voice_jobid_equals_uid: true, A_msg_attach_other_job_own_uid: true, A_reads_own: true, H1_receiver_reads: true };
const badBefore = Object.entries(expectBefore).filter(([k, v]) => before[k] !== v);
const bad = Object.entries(expectAfter).filter(([k, v]) => after[k] !== v);
console.log(badBefore.length ? `FAIL before (old policies did not reproduce the holes): ${JSON.stringify(badBefore)}` : "BEFORE: holes reproduced on the previous policies (red)");
console.log(bad.length ? `FAIL after: ${JSON.stringify(bad)}` : "AFTER: all expectations met (green)");
process.exit(bad.length || badBefore.length ? 1 : 0);
