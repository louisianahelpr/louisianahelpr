#!/usr/bin/env node
/**
 * PGlite proof for 20260924023843_block_closes_pending_applications_and_offers
 * (Q345 item 2).
 *
 *   node scripts/probes/block-closes-pending.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * FIXTURE. P posts; B is the person P will be blocked with; H is unrelated.
 *   J1 (P's, open): B's pending application.
 *   J2 (P's, open): a pending direct offer to B (helper_id NULL).
 *   J3 (P's, open): H's pending application.
 *   J4 (B's, open): P's pending application (the reverse seat).
 *   J5 (P's, open): a pending direct offer to H.
 * B blocks P through block_user_and_settle (the helper seat; the poster seat is
 * run as a second scenario).
 *
 *   RED-BEFORE (the migration with the Q345 settle section excised — derived):
 *     B's and P's applications stay pending; the offer to B stays pending.
 *   AFTER (verbatim, 3x): both cross applications are rejected with
 *     closed_reason = 'party_blocked', the offer to B is declined, no
 *     notification was written for either closure, and H's application and
 *     offer are untouched.
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync(
  new URL(
    "../../supabase/migrations/20260924023843_block_closes_pending_applications_and_offers.sql",
    import.meta.url,
  ).pathname,
  "utf8",
);
const SETTLE = /\n {2}-- ADDED 2026-09-24 \(Q345\): what is still PENDING[\s\S]*?GET DIAGNOSTICS v_closed_offers = ROW_COUNT;\n/;
if (!SETTLE.test(MIGRATION)) {
  console.error("FAIL  could not locate the Q345 settle section — the probe would be vacuous.");
  process.exit(2);
}
const BEFORE = MIGRATION.replace(SETTLE, "\n");
if (/party_blocked'\s*$/m.test(BEFORE.split("CREATE OR REPLACE FUNCTION public.block_user_and_settle")[1] ?? "")) {
  console.error("FAIL  the excision left the settle behind.");
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const P = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const H = "55555555-5555-5555-5555-555555555555";
const J = (n) => `a0000000-0000-0000-0000-00000000000${n}`;

const SETUP = `
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE SCHEMA IF NOT EXISTS net;
  CREATE TABLE net.calls (url text);
  CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS
    $$ INSERT INTO net.calls VALUES (url) RETURNING 1::bigint $$;
  CREATE SCHEMA IF NOT EXISTS vault;
  CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
  CREATE TABLE public.notification_preferences (user_id uuid, email_job_applications boolean);
  CREATE TABLE public.profiles (user_id uuid, email text, full_name text);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid, reason text, UNIQUE (blocker_id, blocked_id));
  CREATE OR REPLACE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text, title text, budget numeric,
    date_needed date, start_time time, helper_confirmed_at timestamptz, helper_completed_at timestamptz,
    offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
    cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean,
    cancellation_fee numeric, cancellation_fee_status text);
  CREATE TABLE public.applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
    closed_reason text, decline_reason text,
    CONSTRAINT applications_closed_reason_check CHECK (closed_reason IS NULL OR closed_reason = 'job_cancelled'));
  CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid);
`;
const TRIGGER = `
  CREATE TRIGGER on_application_change AFTER INSERT OR UPDATE ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_application();
`;
const SEED = `
  INSERT INTO public.jobs (id, customer_id, status, title) VALUES
    ('${J(1)}', '${P}', 'open', 'j1'), ('${J(3)}', '${P}', 'open', 'j3'), ('${J(4)}', '${B}', 'open', 'j4');
  INSERT INTO public.jobs (id, customer_id, status, title, offered_to_helper_id, direct_offer_status, direct_offer_expires_at) VALUES
    ('${J(2)}', '${P}', 'open', 'j2', '${B}', 'pending', now() + interval '1 day'),
    ('${J(5)}', '${P}', 'open', 'j5', '${H}', 'pending', now() + interval '1 day');
  ALTER TABLE public.applications DISABLE TRIGGER on_application_change;
  INSERT INTO public.applications (job_id, helper_id, status) VALUES
    ('${J(1)}', '${B}', 'pending'), ('${J(3)}', '${H}', 'pending'), ('${J(4)}', '${P}', 'pending');
  ALTER TABLE public.applications ENABLE TRIGGER on_application_change;
`;

async function run(label, migration, times, blocker, blocked) {
  const db = new PGlite();
  await db.exec(SETUP);
  for (let i = 0; i < times; i++) await db.exec(migration);
  await db.exec(TRIGGER);
  await db.exec(SEED);
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${blocker}', false)`);
  await db.query(`SELECT public.block_user_and_settle('${blocked}')`);
  const apps = Object.fromEntries(
    (await db.query(`SELECT j.title, a.status, a.closed_reason FROM public.applications a JOIN public.jobs j ON j.id = a.job_id`)).rows.map(
      (r) => [r.title, `${r.status}${r.closed_reason ? `/${r.closed_reason}` : ""}`],
    ),
  );
  const offers = Object.fromEntries(
    (await db.query(`SELECT title, direct_offer_status FROM public.jobs WHERE offered_to_helper_id IS NOT NULL`)).rows.map((r) => [r.title, r.direct_offer_status]),
  );
  const notes = (await db.query(`SELECT count(*)::int n FROM public.notifications`)).rows[0].n;
  const emails = (await db.query(`SELECT count(*)::int n FROM net.calls`)).rows[0].n;
  // Positive control: an ordinary decline of H DOES notify, so the zero above
  // is the party_blocked skip and not a trigger that never fires.
  await db.query(`UPDATE public.applications SET status = 'rejected' WHERE job_id = '${J(3)}'`);
  const control = (await db.query(`SELECT count(*)::int n FROM public.notifications`)).rows[0].n - notes;
  await db.close();
  console.log(`-- ${label}: apps=${JSON.stringify(apps)} offers=${JSON.stringify(offers)} notifications=${notes} emails=${emails}`);
  return { apps, offers, notes, emails, control };
}

const before = await run("RED-BEFORE (settle excised), B blocks P", BEFORE, 1, B, P);
check("before: B's and P's cross applications stay pending", before.apps.j1 === "pending" && before.apps.j4 === "pending");
check("before: the offer to B stays pending", before.offers.j2 === "pending");

for (const [seat, blocker, blocked] of [["helper seat (B blocks P)", B, P], ["poster seat (P blocks B)", P, B]]) {
  const after = await run(`AFTER (verbatim 3x), ${seat}`, MIGRATION, 3, blocker, blocked);
  check(`after, ${seat}: both cross applications closed as party_blocked`, after.apps.j1 === "rejected/party_blocked" && after.apps.j4 === "rejected/party_blocked", JSON.stringify(after.apps));
  check(`after, ${seat}: the offer between them is declined`, after.offers.j2 === "declined", after.offers.j2);
  check(`after, ${seat}: no notice or email for either closure`, after.notes === 0 && after.emails === 0, `notifications=${after.notes} emails=${after.emails}`);
  check(`after, ${seat}: H's application and offer untouched`, after.apps.j3 === "pending" && after.offers.j5 === "pending");
  check(`after, ${seat}: control, an ordinary decline still notifies`, after.control === 1, `control=${after.control}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
