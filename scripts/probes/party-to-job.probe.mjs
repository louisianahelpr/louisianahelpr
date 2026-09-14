// Probe: 20260914210443 (is_party_to_job loses every client grant; the
// messages INSERT policy checks the receiver through the caller-bound
// can_send_message_to_in_job), in real Postgres. NOT a vitest test (pglite is
// not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/party-to-job.probe.mjs
//
// The schema is prod-shaped from the LIVE definitions read on 2026-09-14
// (pg_get_functiondef, pg_policies, pg_proc.proacl): is_party_to_job,
// can_message_in_job (with the 24h lockout), can_send_message_in_job,
// is_party_to_job_folder, the "Users can send messages" policy and the four
// proof-photos storage policies, with prod's grants.
//
// 1. BEFORE, on the live shape: the hole must reproduce (a signed-in stranger
//    calls is_party_to_job with someone else's id and gets the answer).
// 2. The real migration applied verbatim three times: every expectation holds.
// 3. Deliberately broken copies of the migration, each on a fresh database:
//    every one must FAIL at least one expectation, or this probe cannot fail.
// 4. Skip path: on a database without the prerequisites it is a no-op.
// Exit 1 on any mismatch.
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import fs from "node:fs";
const MIG = fs.readFileSync(new URL("../../supabase/migrations/20260914210443_is_party_to_job_internal_receiver_gate.sql", import.meta.url), "utf8");

const A = "71c56dfb-b326-4010-b960-b18dd3966e7f";   // poster of J1, J3, J4
const B = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";   // stranger to J1 (poster of J2)
const H1 = "11111111-1111-4111-8111-111111111111";  // assigned Helpr on J1, J3, J4
const R = "22222222-2222-4222-8222-222222222222";   // group roster member on J1
const APP = "33333333-3333-4333-8333-333333333333"; // applicant on J1, never hired
const BAN = "66666666-6666-4666-8666-666666666666"; // offered Helpr on J1, banned
const J1 = "e8cabaca-87ac-4fa0-95e4-b33179e05d6e", J2 = "63bf6243-b1a6-45b9-ad4e-d6cae05df6bc";
const J3 = "44444444-4444-4444-8444-444444444444";   // completed 2 days ago: thread closed
const J4 = "55555555-5555-4555-8555-555555555555";   // completed 1 hour ago: thread open

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated, service_role;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE _parts text[]; BEGIN SELECT string_to_array(name, '/') INTO _parts; RETURN _parts[1 : array_length(_parts,1) - 1]; END $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated, anon;
CREATE TABLE public.jobs (id uuid primary key, customer_id uuid, helper_id uuid, offered_to_helper_id uuid, status text, completed_at timestamptz);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.applications (job_id uuid, helper_id uuid);
CREATE TABLE public.profiles (user_id uuid primary key, ban_status text, auto_suspended_until timestamptz);
CREATE TABLE public.messages (id uuid primary key default gen_random_uuid(), job_id uuid not null, sender_id uuid not null, receiver_id uuid not null, content text, attachment_url text, is_system boolean default false, flagged_hidden boolean default false, created_at timestamptz default now());
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.messages TO authenticated, anon;
CREATE POLICY "Users can view their own messages" ON public.messages FOR SELECT TO authenticated USING ((SELECT auth.uid()) = sender_id OR (SELECT auth.uid()) = receiver_id);

-- live is_caller_banned + the ban gate trigger on messages (2026-09-14)
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND ban_status IN ('banned', 'temp_banned', 'permanently_banned')
    AND (ban_status <> 'temp_banned' OR auto_suspended_until IS NULL OR auto_suspended_until > now()));
$function$;
CREATE FUNCTION public.enforce_ban_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_ban_gate_messages BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_ban_gate();
-- live is_party_to_job (pg_get_functiondef 2026-09-14)
CREATE FUNCTION public.is_party_to_job(_job_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id AND (j.customer_id = _user_id OR j.helper_id = _user_id OR j.offered_to_helper_id = _user_id))
    OR EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _user_id)
    OR EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = _job_id AND a.helper_id = _user_id);
$function$;
-- lockout clock, reduced to the completed_at branch (internal, no client grant)
CREATE FUNCTION public.job_messaging_closes_at(_job_id uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT j.completed_at + interval '24 hours' FROM public.jobs j WHERE j.id = _job_id AND j.status = 'completed';
$function$;
-- live can_message_in_job (20260914201350)
CREATE FUNCTION public.can_message_in_job(_job_id uuid, _sender uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(public.job_messaging_closes_at(_job_id) > now(), true)
    AND (
      EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id AND j.customer_id = _sender)
      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id AND (j.offered_to_helper_id = _sender OR j.helper_id = _sender))
      OR EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _sender)
      OR EXISTS (SELECT 1 FROM public.messages m JOIN public.jobs j ON j.id = m.job_id WHERE m.job_id = _job_id AND m.sender_id = j.customer_id AND m.receiver_id = _sender)
    );
$function$;
CREATE FUNCTION public.can_send_message_in_job(_job_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT auth.uid() IS NOT NULL AND public.can_message_in_job(_job_id, auth.uid());
$function$;
CREATE FUNCTION public.is_party_to_job_folder(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id::text = (storage.foldername(object_name))[1] AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid()));
$function$;
-- live proacl: is_party_to_job {postgres, authenticated, service_role};
-- can_message_in_job {postgres, service_role}; can_send_message_in_job and
-- is_party_to_job_folder {postgres, authenticated, service_role}
REVOKE ALL ON FUNCTION public.is_party_to_job(uuid,uuid), public.job_messaging_closes_at(uuid), public.can_message_in_job(uuid,uuid), public.can_send_message_in_job(uuid), public.is_party_to_job_folder(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_party_to_job(uuid,uuid), public.can_send_message_in_job(uuid), public.is_party_to_job_folder(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_party_to_job(uuid,uuid), public.job_messaging_closes_at(uuid), public.can_message_in_job(uuid,uuid), public.can_send_message_in_job(uuid), public.is_party_to_job_folder(text) TO service_role;

CREATE TABLE storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, anon;

-- live policies (pg_policies 2026-09-14)
CREATE POLICY "Users can send messages" ON public.messages FOR INSERT TO authenticated WITH CHECK (
  (SELECT auth.uid()) = sender_id AND can_send_message_in_job(job_id) AND is_party_to_job(job_id, receiver_id)
  AND ((attachment_url IS NULL)
    OR ((split_part(attachment_url, '/', 1) = (job_id)::text) AND (split_part(attachment_url, '/', 2) = (sender_id)::text) AND (split_part(attachment_url, '/', 3) <> '') AND (split_part(attachment_url, '/', 4) = ''))
    OR ((split_part(attachment_url, '/', 1) = 'voice-notes') AND (split_part(attachment_url, '/', 2) = (job_id)::text) AND (split_part(attachment_url, '/', 3) = (sender_id)::text) AND (split_part(attachment_url, '/', 4) <> '') AND (split_part(attachment_url, '/', 5) = ''))));
CREATE POLICY "Users can read proof photos for their jobs" ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'proof-photos') AND (((auth.uid())::text = (storage.foldername(name))[1]) OR is_party_to_job_folder(name)));
CREATE POLICY "Users can update their own proof photos" ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'proof-photos') AND (((auth.uid())::text = (storage.foldername(name))[1]) OR is_party_to_job_folder(name)));
CREATE POLICY "Users can delete their own proof photos" ON storage.objects FOR DELETE TO authenticated USING ((bucket_id = 'proof-photos') AND (((auth.uid())::text = (storage.foldername(name))[1]) OR is_party_to_job_folder(name)));
CREATE POLICY "Users can upload proof photos to own folder" ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'proof-photos') AND (((auth.uid())::text = (storage.foldername(name))[1]) OR is_party_to_job_folder(name)));

INSERT INTO public.jobs VALUES
  ('${J1}','${A}','${H1}','${BAN}','in_progress',null),
  ('${J2}','${B}',null,null,'open',null),
  ('${J3}','${A}','${H1}',null,'completed', now() - interval '2 days'),
  ('${J4}','${A}','${H1}',null,'completed', now() - interval '1 hour');
INSERT INTO public.group_job_helpers VALUES ('${J1}','${R}');
INSERT INTO public.applications VALUES ('${J1}','${APP}');
INSERT INTO public.profiles VALUES ('${BAN}','banned',null);
`;

async function as(db, who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { if (process.env.DBG) console.log("ERR", sql.slice(0, 90), e.message); return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}

async function scenario(db) {
  await db.exec(`RESET ROLE; DELETE FROM public.messages; DELETE FROM storage.objects;`);
  const out = {};
  const send = async (uid, job, to) => (await as(db, uid, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${job}','${uid}','${to}','hi') RETURNING id`)).ok;
  // An RPC as PostgREST runs it: SELECT fn(...) under the client role. "answered"
  // = the call ran and returned true; a permission error or false is a refusal.
  const rpc = async (who, fn, args) => { const r = await as(db, who, `SELECT public.${fn}(${args}) AS v`); return r.ok ? r.rows[0].v : `ERR`; };

  // First, while no message exists: an applicant the poster has not messaged
  // cannot post, and so learns nothing through the wrapper either. (Once the
  // poster messages them, can_message_in_job branch 4 admits them.)
  out.send_applicant_unmessaged = await send(APP, J1, A);
  out.wrap_applicant_probe_roster = await rpc(APP, "can_send_message_to_in_job", `'${J1}','${R}'`);
  // ── sends: parties to parties still work, in both directions ─────────────
  out.send_poster_to_helpr = await send(A, J1, H1);
  out.send_helpr_to_poster = await send(H1, J1, A);
  out.send_poster_to_applicant = await send(A, J1, APP);
  // Documented residual: once the poster has messaged the applicant, the
  // applicant may post, and can ask about parties exactly as an INSERT would.
  out.wrap_applicant_after_messaged = await rpc(APP, "can_send_message_to_in_job", `'${J1}','${R}'`);
  out.send_poster_to_roster = await send(A, J1, R);
  out.send_roster_to_poster = await send(R, J1, A);
  out.send_open_completed_thread = await send(A, J4, H1);
  // ── sends that must be refused ────────────────────────────────────────────
  out.send_poster_to_non_party = await send(A, J1, B);
  out.send_stranger_into_job = await send(B, J1, A);
  out.send_closed_thread = await send(A, J3, H1);
  out.send_banned_party = await send(BAN, J1, A);
  out.send_forged_sender = (await as(db, B, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${J1}','${A}','${H1}','x') RETURNING id`)).ok;
  out.send_anon = (await as(db, null, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${J1}','${A}','${H1}','x') RETURNING id`)).ok;

  // ── direct RPC with an arbitrary user id ─────────────────────────────────
  out.rpc_stranger_is_party_helpr = await rpc(B, "is_party_to_job", `'${J1}','${H1}'`);
  out.rpc_stranger_is_party_applicant = await rpc(B, "is_party_to_job", `'${J1}','${APP}'`);
  out.rpc_party_is_party = await rpc(A, "is_party_to_job", `'${J1}','${H1}'`);
  out.rpc_anon_is_party = await rpc(null, "is_party_to_job", `'${J1}','${H1}'`);
  out.rpc_service_is_party = await rpc("service", "is_party_to_job", `'${J1}','${H1}'`);
  // the wrapper, called directly
  out.wrap_stranger_helpr = await rpc(B, "can_send_message_to_in_job", `'${J1}','${H1}'`);
  out.wrap_stranger_applicant = await rpc(B, "can_send_message_to_in_job", `'${J1}','${APP}'`);
  out.wrap_stranger_roster = await rpc(B, "can_send_message_to_in_job", `'${J1}','${R}'`);
  out.wrap_closed_thread_party = await rpc(A, "can_send_message_to_in_job", `'${J3}','${H1}'`);
  out.wrap_anon = await rpc(null, "can_send_message_to_in_job", `'${J1}','${H1}'`);
  out.wrap_banned_party = await rpc(BAN, "can_send_message_to_in_job", `'${J1}','${H1}'`);
  out.wrap_party_non_party = await rpc(A, "can_send_message_to_in_job", `'${J1}','${B}'`);
  out.wrap_party_party = await rpc(A, "can_send_message_to_in_job", `'${J1}','${H1}'`); // = what INSERT already reveals to A

  // ── proof-photos storage policies (is_party_to_job_folder), unchanged ────
  const p = `${J1}/proof-1.jpg`;
  const ins = async (uid, name) => (await as(db, uid, `INSERT INTO storage.objects (bucket_id, name) VALUES ('proof-photos','${name}') RETURNING name`)).ok;
  const read = async (uid, name) => { const r = await as(db, uid, `SELECT name FROM storage.objects WHERE name = '${name}'`); return r.ok && r.rows.length === 1; };
  const upd = async (uid, name) => { const r = await as(db, uid, `UPDATE storage.objects SET metadata = '{"x":1}' WHERE name = '${name}' RETURNING name`); return r.ok && r.rows.length === 1; };
  const del = async (uid, name) => { const r = await as(db, uid, `DELETE FROM storage.objects WHERE name = '${name}' RETURNING name`); return r.ok && r.rows.length === 1; };
  out.photo_helpr_upload_job_folder = await ins(H1, p);
  out.photo_poster_reads = await read(A, p);
  out.photo_helpr_reads = await read(H1, p);
  out.photo_stranger_reads = await read(B, p);
  out.photo_applicant_reads = await read(APP, p);
  out.photo_stranger_upload_job_folder = await ins(B, `${J1}/evil.jpg`);
  out.photo_stranger_upload_own_folder = await ins(B, `${B}/mine.jpg`);
  out.photo_stranger_updates = await upd(B, p);
  out.photo_poster_updates = await upd(A, p);
  out.photo_stranger_deletes = await del(B, p);
  out.photo_helpr_deletes = await del(H1, p);

  // ── grants as the catalog reports them ───────────────────────────────────
  const g = (await db.query(`SELECT
      has_function_privilege('authenticated', 'public.is_party_to_job(uuid,uuid)', 'EXECUTE') AS auth_ip,
      has_function_privilege('anon', 'public.is_party_to_job(uuid,uuid)', 'EXECUTE') AS anon_ip,
      has_function_privilege('service_role', 'public.is_party_to_job(uuid,uuid)', 'EXECUTE') AS svc_ip,
      CASE WHEN to_regprocedure('public.can_send_message_to_in_job(uuid,uuid)') IS NULL THEN NULL
           ELSE has_function_privilege('anon', 'public.can_send_message_to_in_job(uuid,uuid)', 'EXECUTE') END AS anon_wrap,
      (SELECT p.prosecdef AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=public'] FROM pg_proc p
        WHERE p.oid = to_regprocedure('public.can_send_message_to_in_job(uuid,uuid)')) AS wrap_hygiene`)).rows[0];
  out.grant_authenticated_is_party = g.auth_ip;
  out.grant_anon_is_party = g.anon_ip;
  out.grant_service_is_party = g.svc_ip;
  out.grant_anon_wrapper = g.anon_wrap;
  out.wrapper_secdef_search_path = g.wrap_hygiene;
  return out;
}

const expectAfter = {
  send_poster_to_helpr: true, send_helpr_to_poster: true, send_poster_to_applicant: true, send_poster_to_roster: true,
  send_roster_to_poster: true, send_open_completed_thread: true,
  send_poster_to_non_party: false, send_stranger_into_job: false, send_applicant_unmessaged: false, send_closed_thread: false,
  send_forged_sender: false, send_anon: false, send_banned_party: false,
  rpc_stranger_is_party_helpr: "ERR", rpc_stranger_is_party_applicant: "ERR", rpc_party_is_party: "ERR", rpc_anon_is_party: "ERR",
  rpc_service_is_party: true,
  wrap_stranger_helpr: false, wrap_stranger_applicant: false, wrap_stranger_roster: false, wrap_applicant_probe_roster: false,
  wrap_applicant_after_messaged: true, wrap_banned_party: false,
  wrap_closed_thread_party: false, wrap_anon: "ERR", wrap_party_non_party: false, wrap_party_party: true,
  photo_helpr_upload_job_folder: true, photo_poster_reads: true, photo_helpr_reads: true, photo_stranger_reads: false,
  photo_applicant_reads: false, photo_stranger_upload_job_folder: false, photo_stranger_upload_own_folder: true,
  photo_stranger_updates: false, photo_poster_updates: true, photo_stranger_deletes: false, photo_helpr_deletes: true,
  grant_authenticated_is_party: false, grant_anon_is_party: false, grant_service_is_party: true, grant_anon_wrapper: false,
  wrapper_secdef_search_path: true,
};
// On the live shape: the probing hole, and every send/photo behaviour the
// migration must preserve (so AFTER is compared against real behaviour, not a guess).
const expectBefore = {
  ...Object.fromEntries(Object.entries(expectAfter).filter(([k]) => k.startsWith("send_") || k.startsWith("photo_"))),
  rpc_stranger_is_party_helpr: true, rpc_stranger_is_party_applicant: true, rpc_party_is_party: true, rpc_anon_is_party: "ERR",
  grant_authenticated_is_party: true, grant_anon_is_party: false,
};

const diff = (got, want) => Object.entries(want).filter(([k, v]) => got[k] !== v).map(([k, v]) => `${k}: want ${v}, got ${got[k]}`);

async function run(label, migSql) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  let applyErr = null;
  for (let i = 1; i <= 3; i++) {
    try { await db.exec("RESET ROLE"); await db.exec(migSql); }
    catch (e) { applyErr = `apply ${i}: ${e.message}`; break; }
  }
  const got = applyErr ? {} : await scenario(db);
  await db.close();
  return { label, applyErr, got, bad: applyErr ? [applyErr] : diff(got, expectAfter) };
}

// ── 1. BEFORE ───────────────────────────────────────────────────────────────
let fail = false;
{
  const db = new PGlite();
  await db.exec(SCHEMA);
  const before = await scenario(db);
  await db.close();
  const bad = diff(before, expectBefore);
  console.log("\n== BEFORE (live shape)"); console.table(before);
  if (bad.length) { fail = true; console.log("FAIL before (live shape did not reproduce):", bad); }
  else console.log("BEFORE: hole reproduced (stranger and applicant probes answered true); sends/photos baseline recorded");
}

// ── 2. The real migration, 3x ───────────────────────────────────────────────
{
  const r = await run("REAL", MIG);
  console.log("\n== AFTER real migration x3"); console.table(r.got);
  if (r.bad.length) { fail = true; console.log("FAIL after:", r.bad); }
  else console.log(`AFTER: all ${Object.keys(expectAfter).length} expectations met (green)`);
}

// ── 3. Broken copies: each must be caught ───────────────────────────────────
const mutate = (from, to) => {
  if (!MIG.includes(from)) throw new Error(`mutation anchor not found: ${from.slice(0, 60)}`);
  return MIG.replace(from, to);
};
const broken = [
  ["revoke omits authenticated (FROM PUBLIC, anon)",
    mutate("REVOKE ALL ON FUNCTION public.is_party_to_job(uuid, uuid) FROM PUBLIC, anon, authenticated;", "REVOKE ALL ON FUNCTION public.is_party_to_job(uuid, uuid) FROM PUBLIC, anon;")],
  ["revoke FROM PUBLIC only (the 20260904 V-015 shape)",
    mutate("REVOKE ALL ON FUNCTION public.is_party_to_job(uuid, uuid) FROM PUBLIC, anon, authenticated;", "REVOKE ALL ON FUNCTION public.is_party_to_job(uuid, uuid) FROM PUBLIC;")],
  ["wrapper not bound to the caller (no can_message_in_job gate)",
    mutate("     AND public.can_message_in_job(_job_id, auth.uid())\n     AND public.is_party_to_job", "     AND public.is_party_to_job")],
  ["policy still calls is_party_to_job (revoked, not swapped)",
    mutate("AND public.can_send_message_to_in_job(job_id, receiver_id)", "AND public.is_party_to_job(job_id, receiver_id)")],
  ["policy checks sender_id instead of receiver_id",
    mutate("AND public.can_send_message_to_in_job(job_id, receiver_id)", "AND public.can_send_message_to_in_job(job_id, sender_id)")],
  ["wrapper SECURITY INVOKER",
    mutate(" STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\n  -- The caller", " STABLE\n SET search_path TO 'public'\nAS $function$\n  -- The caller")],
  ["wrapper without the ban check",
    mutate("     AND NOT public.is_caller_banned()\n", "")],
  ["wrapper without SET search_path",
    mutate(" STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\n  -- The caller", " STABLE SECURITY DEFINER\nAS $function$\n  -- The caller")],
  ["wrapper not granted to authenticated",
    mutate("GRANT EXECUTE ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) TO authenticated, service_role;", "GRANT EXECUTE ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) TO service_role;")],
  ["wrapper left anon-callable (no REVOKE)",
    mutate("REVOKE ALL ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) FROM PUBLIC, anon;", "")],
];
console.log("\n== BROKEN COPIES (each must be caught)");
for (const [label, sql] of broken) {
  const r = await run(label, sql);
  if (r.bad.length === 0) { fail = true; console.log(`NOT CAUGHT: ${label}`); }
  else console.log(`caught: ${label}\n   ${r.bad.slice(0, 4).join("\n   ")}${r.bad.length > 4 ? `\n   (+${r.bad.length - 4} more)` : ""}`);
}

// ── 4. Skip path: on a database without the prerequisites it is a no-op ─────
{
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  let ok = true;
  try { await db.exec(MIG); await db.exec(MIG); } catch (e) { ok = false; console.log("FAIL skip path:", e.message); }
  const made = (await db.query(`SELECT to_regprocedure('public.can_send_message_to_in_job(uuid,uuid)') IS NOT NULL AS made`)).rows[0].made;
  await db.close();
  if (!ok || made) { fail = true; console.log("FAIL skip path: migration did not no-op on an empty database"); }
  else console.log("\nSKIP PATH: empty database, applied twice, no-op (green)");
}

console.log(fail ? "\nPROBE FAILED" : "\nPROBE PASSED");
process.exit(fail ? 1 : 0);
