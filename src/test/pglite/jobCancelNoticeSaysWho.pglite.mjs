#!/usr/bin/env node
/**
 * PGlite proof for 20261109231855_job_cancel_notice_says_who (F176, owner UI audit 11-09 Part 3).
 *
 *   node src/test/pglite/jobCancelNoticeSaysWho.pglite.mjs            # AFTER: the migration applied 3x
 *   node src/test/pglite/jobCancelNoticeSaysWho.pglite.mjs --before   # the LIVE definition (20261023143240): C1-C4 + G1-G4 FAIL
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * Prod shape, read live 11-09: trigger on_job_status_change AFTER UPDATE ON public.jobs FOR EACH ROW; job_status and
 * app_role enums as on prod; has_role is prod's own text (it answers inside a trigger: pg_trigger_depth() > 0), with
 * auth.uid() and is_server_context() stubbed. The function body is run verbatim from the migration file.
 *
 * Every branch of the trigger's cancel half, for a single Helpr AND a crew:
 *   C1/G1 the poster cancelled (cancelled_by = customer_id): names the poster, "You don't owe anything, and it doesn't
 *         count against you."
 *   C2/G2 an admin cancelled (admin removal, admin_refund_general): "by our team.", nothing about money.
 *   C3/G3 a dispute decision cancelled it (OLD.status = 'disputed'; rpc_decide_dispute, admin_refund_dispute, which
 *         can bill an at-fault Helpr): "after our team decided the dispute.", never "owe" or "doesn't count".
 *   C4/G4 nobody recorded (cancelled_by NULL) or another member: only "was cancelled."
 *   C5    a dispute decided by an admin who is also recorded as cancelled_by: the dispute words win (no "owe").
 *   S1/S2 a sanctioned cancel (app.sanctioned_cancel on) sends nothing, single and crew (unchanged).
 *   N1    no Helpr on the job: no notice (unchanged).
 *   K1-K3 the completion half is unchanged: "Job completed!" text, the payout-scheduled skip, the crew share line.
 *   B1    the completion IF blocks are byte-identical to the LIVE definition's.
 *   T1    title, type and link of the cancel notice unchanged ('Job cancelled', 'warning', /jobs?job=<id>).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const THIS = "20261109231855_job_cancel_notice_says_who.sql";
const LIVE_FILE = "20261023143240_payout_waits_for_the_posters_approval.sql"; // md5(prosrc) == prod 11-09
const BEFORE = process.argv.includes("--before");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

function cutFunction(sql, name) {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  const m = [...sql.matchAll(re)].at(-1);
  if (!m) throw new Error(`${name} not defined`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return { stmt: sql.slice(m.index, sql.indexOf(";", close) + 1), body: sql.slice(bodyStart, close) };
}

const live = cutFunction(mig(LIVE_FILE), "notify_on_job_update");
const next = cutFunction(mig(THIS), "notify_on_job_update");

const db = new PGlite();
await db.exec(`
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('t.uid', true), '')::uuid $$;
  CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
  CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
  CREATE OR REPLACE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $function$
    SELECT _user_id IS NOT NULL
       AND (
         _user_id IS NOT DISTINCT FROM auth.uid()
         OR public.is_server_context()
         OR pg_trigger_depth() > 0
         OR EXISTS (SELECT 1 FROM public.user_roles c WHERE c.user_id = auth.uid() AND c.role = 'admin'::public.app_role)
       )
       AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
  $function$;
  CREATE OR REPLACE FUNCTION public.payout_day_label(p_at timestamptz) RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT to_char(p_at AT TIME ZONE 'America/Chicago', 'Dy, Mon FMDD') $$;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, title text NOT NULL, status public.job_status NOT NULL, customer_id uuid, helper_id uuid,
    cancelled_by uuid, is_group_job boolean DEFAULT false, payment_status text, payout_scheduled_at timestamptz);
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
  CREATE TABLE public.notifications (id bigserial, user_id uuid NOT NULL, title text NOT NULL, message text NOT NULL,
    type text, link text, job_id uuid);
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
`);

if (BEFORE) {
  await db.exec(live.stmt);
} else {
  const sql = mig(THIS);
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("R1 replay: the migration applies 3x", true);
}
await db.exec(`CREATE TRIGGER on_job_status_change AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION notify_on_job_update();`);

const POSTER = "00000000-0000-0000-0000-0000000000a1";
const HELPR = "00000000-0000-0000-0000-0000000000b1";
const CREW2 = "00000000-0000-0000-0000-0000000000b2";
const ADMIN = "00000000-0000-0000-0000-0000000000c1";
const OTHER = "00000000-0000-0000-0000-0000000000d1";
await db.exec(`INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin'), ('${POSTER}', 'customer'), ('${HELPR}', 'helper')`);

let n = 0;
async function job({ status = "accepted", group = false, helper = HELPR, title = "Move a dresser", pay = "escrow" } = {}) {
  n++;
  const id = `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  await db.query(
    `INSERT INTO public.jobs (id, title, status, customer_id, helper_id, is_group_job, payment_status) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, title, status, POSTER, group ? null : helper, group, pay]);
  if (group) await db.query(`INSERT INTO public.group_job_helpers VALUES ($1, $2), ($1, $3)`, [id, HELPR, CREW2]);
  return id;
}
async function cancel(id, by, { sanctioned = false, uid = null } = {}) {
  await db.exec("BEGIN");
  if (sanctioned) await db.exec(`SELECT set_config('app.sanctioned_cancel', 'on', true)`);
  if (uid) await db.exec(`SELECT set_config('t.uid', '${uid}', true)`);
  await db.query(`UPDATE public.jobs SET status = 'cancelled', cancelled_by = $2 WHERE id = $1`, [id, by]);
  await db.exec("COMMIT");
  return (await db.query(`SELECT user_id, title, message, type, link FROM public.notifications WHERE link = '/jobs?job=' || $1 ORDER BY id`, [id])).rows;
}
const T = '"Move a dresser" was cancelled';
const POSTER_WORDS = `${T} by the person who posted it. You don't owe anything, and it doesn't count against you.`;
const ADMIN_WORDS = `${T} by our team.`;
const DISPUTE_WORDS = `${T} after our team decided the dispute.`;
const PLAIN_WORDS = `${T}.`;
const one = (rows, msg) => rows.length === 1 && rows[0].user_id === HELPR && rows[0].message === msg;
const crew = (rows, msg) => rows.length === 2 && rows.every((r) => r.message === msg) && new Set(rows.map((r) => r.user_id)).size === 2;
const noOwe = (rows) => rows.every((r) => !/owe|count against/.test(r.message));

let r;
r = await cancel(await job(), POSTER, { uid: POSTER });
check("C1 poster cancelled: names the poster, owes nothing, no strike", one(r, POSTER_WORDS), JSON.stringify(r));
r = await cancel(await job(), ADMIN, { uid: ADMIN });
check("C2 admin cancelled: by our team, nothing about money", one(r, ADMIN_WORDS) && noOwe(r), JSON.stringify(r));
r = await cancel(await job({ status: "disputed" }), null);
check("C3 dispute decision cancelled it: after our team decided, never owes/doesn't count", one(r, DISPUTE_WORDS) && noOwe(r), JSON.stringify(r));
r = await cancel(await job(), null);
check("C4a nobody recorded: only that it was cancelled", one(r, PLAIN_WORDS), JSON.stringify(r));
r = await cancel(await job(), OTHER);
check("C4b another member recorded: only that it was cancelled", one(r, PLAIN_WORDS), JSON.stringify(r));
r = await cancel(await job({ status: "disputed" }), POSTER);
check("C5 disputed, even with the poster recorded: the dispute words (no owes)", one(r, DISPUTE_WORDS) && noOwe(r), JSON.stringify(r));
r = await cancel(await job({ group: true }), POSTER, { uid: POSTER });
check("G1 crew, poster cancelled: every member, poster words", crew(r, POSTER_WORDS), JSON.stringify(r));
r = await cancel(await job({ group: true }), ADMIN, { uid: ADMIN });
check("G2 crew, admin cancelled: every member, by our team", crew(r, ADMIN_WORDS), JSON.stringify(r));
r = await cancel(await job({ group: true, status: "disputed" }), null);
check("G3 crew, dispute decision: every member, dispute words", crew(r, DISPUTE_WORDS), JSON.stringify(r));
r = await cancel(await job({ group: true }), null);
check("G4 crew, nobody recorded: every member, only cancelled", crew(r, PLAIN_WORDS), JSON.stringify(r));
r = await cancel(await job(), POSTER, { sanctioned: true });
check("S1 sanctioned single cancel: nothing (the cancelling function tells the Helpr)", r.length === 0, JSON.stringify(r));
r = await cancel(await job({ group: true }), POSTER, { sanctioned: true });
check("S2 sanctioned crew cancel: nothing", r.length === 0, JSON.stringify(r));
r = await cancel(await job({ status: "open", helper: null }), POSTER);
check("N1 no Helpr on the job: no notice", r.length === 0, JSON.stringify(r));
r = await cancel(await job(), ADMIN);
check("T1 title, type and link unchanged", r.length === 1 && r[0].title === "Job cancelled" && r[0].type === "warning" && /^\/jobs\?job=10000000-/.test(r[0].link), JSON.stringify(r));

// Completion half (unchanged).
const k1 = await job({ status: "in_progress" });
await db.query(`UPDATE public.jobs SET status = 'completed' WHERE id = $1`, [k1]);
r = (await db.query(`SELECT title, message FROM public.notifications WHERE link = '/jobs?job=' || $1`, [k1])).rows;
check("K1 completion notice unchanged", r.length === 1 && r[0].title === "Job completed!" && r[0].message === '"Move a dresser" is complete.', JSON.stringify(r));
const k2 = await job({ status: "in_progress" });
await db.query(`UPDATE public.jobs SET status = 'completed', payment_status = 'payout_pending', payout_scheduled_at = now() WHERE id = $1`, [k2]);
r = (await db.query(`SELECT 1 FROM public.notifications WHERE link = '/jobs?job=' || $1`, [k2])).rows;
check("K2 payout already scheduled: no duplicate completion notice", r.length === 0, JSON.stringify(r));
const k3 = await job({ status: "in_progress", group: true });
await db.query(`UPDATE public.jobs SET status = 'completed', payment_status = 'payout_pending', payout_scheduled_at = '2026-11-12 15:00Z' WHERE id = $1`, [k3]);
r = (await db.query(`SELECT message FROM public.notifications WHERE link = '/jobs?job=' || $1`, [k3])).rows;
check("K3 crew completion share line unchanged", r.length === 2 && r.every((x) => x.message === '"Move a dresser" is complete. Your share will be sent to your account Thu, Nov 12.'), JSON.stringify(r));

// B1: the completion IF blocks byte-identical to LIVE.
const completionBlocks = (b) => [
  b.slice(b.indexOf("  -- One Helpr: when the same write"), b.indexOf("  END IF;", b.indexOf("'Job completed!'")) + 9),
  b.slice(b.indexOf("    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN"), b.indexOf("    END IF;", b.indexOf("payout_day_label(NEW.payout_scheduled_at)")) + 11),
];
const [l1, l2] = completionBlocks(live.body);
const [n1, n2] = completionBlocks(next.body);
check("B1 the completion half is byte-identical to the LIVE definition", l1.length > 400 && l2.length > 400 && l1 === n1 && l2 === n2, `${l1.length}/${l2.length}`);
const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'notify_on_job_update'`)).rows[0]?.a ?? "";
if (!BEFORE) check("G grants as live: no PUBLIC, anon or authenticated EXECUTE", !/(^|[{,])=X|anon=|authenticated=/.test(acl) && /service_role=X/.test(acl), acl);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
