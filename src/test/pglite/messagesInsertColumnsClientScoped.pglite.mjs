#!/usr/bin/env node
/**
 * PGlite proof for 20261003182009_messages_insert_columns_client_scoped (Q340).
 *
 *   node src/test/pglite/messagesInsertColumnsClientScoped.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/messagesInsertColumnsClientScoped.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = public.messages as LIVE on 2026-10-03: the 18 columns with their
 * types/defaults/NOT NULLs (information_schema.columns), the table ACL
 * `authenticated=ardxm, anon=rxm` (pg_class.relacl, anon's INSERT already
 * revoked by 20260925144708) and authenticated's column UPDATE on content,
 * read, edited_at. RLS is on with a permissive INSERT policy, so a refusal
 * below is the GRANT layer, not the policy. The SECURITY DEFINER writer
 * (insert_job_status_system_message) is modelled by a definer function that
 * inserts read + is_system.
 *
 * The migration is applied 3x, then:
 *   - authenticated cannot set is_system, created_at, read, read_at,
 *     flagged_hidden, flag_reason, edited_at or id on INSERT;
 *   - every insert payload the client ever shipped still lands (today's
 *     10-column send, the 8-column attachment send, the 4-column broadcast);
 *   - the definer insert, the column UPDATE and DELETE keep working;
 *   - scripts/ci/client-insert-columns.sql returns 0 rows (it returns the
 *     table-level INSERT on the live state).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const NEW = read("../../../supabase/migrations/20261003182009_messages_insert_columns_client_scoped.sql");
const CHECK = read("../../../scripts/ci/client-insert-columns.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SENDER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const RECEIVER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const JOB = "10000000-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  receiver_id uuid,
  content text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  flagged_hidden boolean NOT NULL DEFAULT false,
  flag_reason text,
  attachment_url text,
  attachment_mime text,
  attachment_size integer,
  attachment_duration integer,
  is_system boolean NOT NULL DEFAULT false,
  reply_to_id uuid,
  read_at timestamptz,
  edited_at timestamptz,
  client_id uuid
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "send" ON public.messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "see" ON public.messages FOR SELECT TO authenticated USING (auth.uid() IN (sender_id, receiver_id));
CREATE POLICY "edit" ON public.messages FOR UPDATE TO authenticated USING (auth.uid() = sender_id) WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "delete" ON public.messages FOR DELETE TO authenticated USING (auth.uid() = sender_id);

-- Live ACL 2026-10-03: authenticated=ardxm, anon=rxm (MAINTAIN is not modelled).
REVOKE ALL ON public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE, REFERENCES ON public.messages TO authenticated;
GRANT SELECT, REFERENCES ON public.messages TO anon;
GRANT UPDATE (content, read, edited_at) ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

-- insert_job_status_system_message's shape: SECURITY DEFINER, owner the superuser.
CREATE FUNCTION public.zz_system_message(p_job uuid, p_to uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.messages (job_id, sender_id, receiver_id, content, read, is_system)
  VALUES (p_job, '${SENDER}', p_to, 'Job status changed', true, true) RETURNING id INTO v;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.zz_system_message(uuid, uuid) TO authenticated;
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who ?? ""}', false);`);
  await db.exec(who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const count = async () => (await db.query("SELECT count(*)::int AS n FROM public.messages")).rows[0].n;
const base = `'${JOB}', '${SENDER}', '${RECEIVER}'`;

const refused = async (label, cols, vals) => {
  const before = await count();
  const r = await as(SENDER, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content, ${cols}) VALUES (${base}, 'hi', ${vals}) RETURNING id`);
  const after = await count();
  check(label, !r.ok && /permission denied/i.test(r.err) && before === after, r.ok ? `landed ${r.rows.length} row(s)` : r.err);
};
const lands = async (label, sql) => {
  const r = await as(SENDER, sql);
  check(label, r.ok && r.rows.length === 1, r.ok ? `${r.rows.length} row(s)` : r.err);
  return r.ok ? r.rows[0] : null;
};

// ── Server-owned columns are refused at the GRANT (RED on the live ACL: all ──
// land here; on prod scan_message_content, left out of this fixture, also
// overwrites flagged_hidden / flag_reason on every insert, so R5/R6 test the
// grant layer alone) ──
await refused("R1 is_system = true (a fake platform notice)", "is_system", "true");
await refused("R2 created_at in the future (an edit window that never closes)", "created_at", "now() + interval '10 years'");
await refused("R3 read = true (the recipient never sees it as new)", "read", "true");
await refused("R4 read_at stamped by the sender", "read_at", "now()");
await refused("R5 flagged_hidden chosen by the sender", "flagged_hidden", "false");
await refused("R6 flag_reason chosen by the sender", "flag_reason", "'clean'");
await refused("R7 edited_at stamped on insert", "edited_at", "now()");
await refused("R8 id chosen by the client", "id", "gen_random_uuid()");

// ── Every payload the client ever shipped still lands ──────────────────────
const sent = await lands(
  "L1 today's send (sendHandlers.ts: the 10 columns)",
  `INSERT INTO public.messages (client_id, job_id, sender_id, receiver_id, content, attachment_url, attachment_mime, attachment_size, attachment_duration, reply_to_id)
   VALUES (gen_random_uuid(), ${base}, 'hello', '${JOB}/${SENDER}/a.jpg', 'image/jpeg', 1234, NULL, NULL) RETURNING id, read, is_system, created_at <= now() AS sane_clock`,
);
check("L1b the server owns the rest (read false, is_system false, created_at now)", sent && sent.read === false && sent.is_system === false && sent.sane_clock === true, JSON.stringify(sent));
await lands(
  "L2 the 2026-07..09 attachment send (8 columns, no client_id / reply_to_id)",
  `INSERT INTO public.messages (job_id, sender_id, receiver_id, content, attachment_url, attachment_mime, attachment_size, attachment_duration)
   VALUES (${base}, 'voice', 'voice-notes/${JOB}/${SENDER}/v.m4a', 'audio/mp4', 999, 12) RETURNING id`,
);
await lands("L3 the oldest send / broadcast (4 columns)", `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES (${base}, 'plain') RETURNING id`);
await lands("L4 the SECURITY DEFINER system message still writes read + is_system", `SELECT public.zz_system_message('${JOB}', '${RECEIVER}') AS id`);
await lands("L5 the sender edits their content (column UPDATE unchanged)", `UPDATE public.messages SET content = 'edited' WHERE id = '${sent?.id}' RETURNING id`);
await lands("L6 the sender deletes their message (DELETE unchanged)", `DELETE FROM public.messages WHERE id = '${sent?.id}' RETURNING id`);
{
  const r = await as(null, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES (${base}, 'anon') RETURNING id`);
  check("L7 anon still cannot insert at all", !r.ok, r.ok ? "landed" : r.err);
}

// ── The class check itself ─────────────────────────────────────────────────
// Its INSERT half: this fixture is the UPDATE grant as live before Q1166
// (edited_at included), which the UPDATE half reports by design; that half's
// proof is messageReadReceiptIsTheReceivers.pglite.mjs.
{
  const rows = (await db.query(CHECK.replace(/;\s*$/, ""))).rows.filter((r) => r.table === "messages" && /\bINSERT\b/.test(r.what));
  check(
    "C1 scripts/ci/client-insert-columns.sql is clean (INSERT)",
    rows.length === 0,
    rows.map((r) => `${r.role}: ${r.what}`).join("; ") || "0 rows",
  );
}
if (MODE !== "skip") {
  // ...and can fail: put one server-owned column back, and drop one send column.
  await db.exec("GRANT INSERT (is_system) ON public.messages TO authenticated; REVOKE INSERT (reply_to_id) ON public.messages FROM authenticated;");
  const rows = (await db.query(CHECK.replace(/;\s*$/, ""))).rows.filter((r) => r.table === "messages").map((r) => `${r.role}: ${r.what}`);
  check(
    "C2 the check flags an extra column AND a missing one (two-way)",
    rows.includes("authenticated: INSERT (is_system)") && rows.includes("authenticated: missing INSERT (reply_to_id)"),
    rows.join("; "),
  );
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
