#!/usr/bin/env node
/**
 * PGlite proof for 20261019051407_rentals_landlord_id_review (owner 2026-10-19:
 * landlords send a photo of their ID with their ownership proof, an admin
 * approves or rejects it with a note, no charge; and an approved ID counts as
 * ID-verified in EVERY section, through the one identity rule).
 *
 *   node src/test/pglite/landlordIdReview.pglite.mjs
 *   LID=skip node src/test/pglite/landlordIdReview.pglite.mjs     # RED: the old behaviour (every landlord-ID check fails)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs as src/test/pglite/rentalsMaintenance.pglite.mjs (its SCHEMA
 * block, copied, plus the profile columns the approval and the Jobs accept gate
 * read). The helpers are NOT re-typed: their newest definitions are read out of
 * supabase/migrations. Then the switch, Rentals S1 + slice 3, then this
 * migration 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const read = (f) => readFileSync(`${MIG_DIR}${f}`, "utf8");
const SELF = "20261019051407";
const BEFORE = ["20261012031120_hidden_feature_switches.sql", "20261017205605_rentals_maintenance_requests.sql",
  "20261017220911_rentals_link_one_live_job.sql", "20261017221621_rentals_visit_time.sql",
  "20261017223352_rentals_ownership_review_alert.sql"];
const LID = process.env.LID === "skip" ? "SELECT 1" : read(`${SELF}_rentals_landlord_id_review.sql`);

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement OLDER than this migration, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < SELF).sort()) {
    const sql = read(f);
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, stmt: `${sql.slice(m.index, end + t[1].length)};` };
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email_confirmed_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON storage.objects TO authenticated;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, is_seed boolean DEFAULT false,
  idv_status text, stripe_identity_verified boolean, date_of_birth date, ban_status text DEFAULT 'active', auto_suspended_until timestamptz,
  license_url text, insurance_url text);
CREATE TABLE public.helper_credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, document_url text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, status text NOT NULL DEFAULT 'open',
  payment_status text, stripe_session_id text, helper_id uuid, helper_confirmed_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text, message text,
  type text, link text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notification_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, category text, channel text,
  status text, subject text, job_id uuid, error_message text);
-- poster_cancel_job: the real one (12 KB, fees/strike ladder) is out of scope here; a stub that cancels the
-- caller's own job is enough to prove rentals_cancel_request_job's own gates.
CREATE FUNCTION public.poster_cancel_job(p_job_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql
  SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.jobs SET status = 'cancelled' WHERE id = p_job_id AND customer_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN '{}'::jsonb;
END $$;
CREATE FUNCTION public.notification_crosses_seed_boundary(p_recipient uuid, p_job_id uuid, p_link text, p_actor uuid DEFAULT NULL)
  RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
`;

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const LANDLORD = U(1), OTHER = U(2), ADMIN = U(3), CONNECT = U(4), STRIPEID = U(5), REJECTED = U(6), ADMIN2 = U(7);

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`
  ALTER TABLE public.profiles ADD COLUMN idv_confidence numeric, ADD COLUMN idv_failure_reason text,
    ADD COLUMN legacy_manual_review boolean, ADD COLUMN stripe_account_id text, ADD COLUMN stripe_payouts_enabled boolean,
    ADD COLUMN onboarding_fee_paid boolean, ADD COLUMN idv_attempt_count integer, ADD COLUMN idv_attempted_at timestamptz;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$ SELECT string_to_array(name, '/') $f$;
  GRANT INSERT ON storage.objects TO authenticated;
  CREATE POLICY "user-documents: owner or admin read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'user-documents' AND ((auth.uid())::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin'::app_role)));`);
for (const name of ["ops_alert_normalise", "identity_is_verified", "is_caller_banned", "member_under_18", "contact_leak_reason",
  "session_email_unconfirmed", "refuse_unconfirmed_email_write", "attach_unconfirmed_email_gate", "helper_accept_missing"]) {
  await db.exec(newestDefinition(name).stmt);
}
await db.exec(`
  REVOKE ALL ON FUNCTION public.member_under_18(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.is_caller_banned() FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.helper_accept_missing(uuid) FROM PUBLIC, anon, authenticated;`);
for (const f of BEFORE) await db.exec(read(f));
await db.exec(`
  INSERT INTO auth.users (id) SELECT ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 7) g;
  INSERT INTO public.profiles (user_id, idv_status, stripe_identity_verified, date_of_birth, stripe_account_id, stripe_payouts_enabled) VALUES
    ('${LANDLORD}', NULL,       NULL, '1980-01-01', 'acct_l', true),
    ('${OTHER}',    NULL,       NULL, '1981-01-01', NULL, NULL),
    ('${ADMIN}',    'verified', NULL, '1975-01-01', NULL, NULL),
    ('${CONNECT}',  'pending',  true, '1982-01-01', 'acct_c', true),
    ('${STRIPEID}', 'verified', NULL, '1983-01-01', NULL, NULL),
    ('${REJECTED}', NULL,       NULL, '1984-01-01', 'acct_r', true),
    ('${ADMIN2}',   NULL,       NULL, '1976-01-01', NULL, NULL);
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin');
  INSERT INTO public.test_accounts (user_id) SELECT id FROM auth.users;
  UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'rentals';`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
for (let i = 0; i < 3; i++) await db.exec(LID);

async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET request.jwt.claim.role = '${role}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;`);
  }
}
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
const refused = (r, re, code) => !Array.isArray(r) && re.test(r.error) && (code === undefined || r.code === code);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const rows = (r) => (Array.isArray(r) ? r : []);
const verified = async (u) => one(await svc(`SELECT public.is_identity_verified('${u}')`));
const acceptMissing = async (u) => one(await svc(`SELECT array_to_string(public.helper_accept_missing('${u}'), ',')`)) ?? "";
const upload = (u, name) => svc(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('user-documents', '${u}/landlord-id/${name}', '${u}')`);
const submit = (u, front, back = null) => as("authenticated", u,
  `SELECT public.rentals_submit_landlord_id(${front === null ? "NULL" : `'${front}'`}, ${back === null ? "NULL" : `'${back}'`})`);
/** The admin decides on the submission they opened (its submitted_at), unless `at` says otherwise. */
const review = async (admin, u, approve, note, at) => {
  const seen = at ?? one(await svc(`SELECT submitted_at::text FROM public.landlord_id_reviews WHERE user_id = '${u}'`));
  return as("authenticated", admin,
    `SELECT public.rentals_admin_review_landlord_id('${u}', ${approve}, ${note === null ? "NULL" : `'${note}'`}, ${seen ? `'${seen}'` : "NULL"})`);
};
const status = async (u) => one(await svc(`SELECT status FROM public.landlord_id_reviews WHERE user_id = '${u}'`));

// --- before: nobody verified by an upload
ok(await verified(LANDLORD) === false && (await acceptMissing(LANDLORD)).includes("stripe_id"),
  "a landlord with no verdict is not ID-verified (Homes helper) and the Jobs accept gate still asks for the ID");

// --- submit: own folder, files exist, verified-once is never asked again
await upload(LANDLORD, "1-front-id.jpg");
await upload(LANDLORD, "1-back-id.jpg");
await upload(OTHER, "1-front-id.jpg");
ok(refused(await submit(LANDLORD, `${OTHER}/landlord-id/1-front-id.jpg`), /bad_id_path/, "22023"),
  "a landlord cannot submit another person's ID photo path");
ok(refused(await submit(LANDLORD, `${LANDLORD}/rentals/x/1-front-id.jpg`), /bad_id_path/, "22023"),
  "an ID photo must sit under the caller's landlord-id/ folder");
ok(refused(await submit(LANDLORD, `${LANDLORD}/landlord-id/never-uploaded.jpg`), /id_photo_missing/, "22023"),
  "an ID path with no uploaded object is refused");
ok(refused(await submit(CONNECT, `${CONNECT}/landlord-id/x.jpg`), /already_verified/, "22023")
  && refused(await submit(STRIPEID, `${STRIPEID}/landlord-id/x.jpg`), /already_verified/, "22023"),
  "a member already verified by Stripe Connect or Stripe Identity is never asked for an ID photo");
ok(refused(await as("anon", null, `SELECT public.rentals_submit_landlord_id('a', NULL)`), /permission denied/),
  "anon cannot submit");
ok(Array.isArray(await submit(LANDLORD, `${LANDLORD}/landlord-id/1-front-id.jpg`, `${LANDLORD}/landlord-id/1-back-id.jpg`))
  && await status(LANDLORD) === "pending_review",
  "the landlord sends front + back: the review waits");
const alerts = async () => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE title = 'Landlord ID waits for review'`));
ok(await alerts() === 2, "every admin is told once (2 admins)");
await submit(LANDLORD, `${LANDLORD}/landlord-id/1-front-id.jpg`);
ok(await alerts() === 2, "a new photo while it already waits does not page again");
ok(one(await svc(`SELECT public.admin_alert_close_rule('Landlord ID waits for review')`)) === "rentals-landlord-id-review",
  "the alert title maps to its close rule");
await svc(`UPDATE public.profiles SET is_seed = false WHERE user_id = '${LANDLORD}'`);
ok(one(await svc(`SELECT public.admin_queue_still_pending('rentals-landlord-id-review', '{}'::jsonb, now())`)) === true,
  "the alert stays open while a (non-test) landlord's ID waits");

// --- pending is not verified anywhere
ok(await verified(LANDLORD) === false && (await acceptMissing(LANDLORD)).includes("stripe_id"),
  "PENDING: not verified for Homes, and the Jobs accept gate still asks for the ID");

// --- reads: owner and admins only; reviewed_by is staff-only
ok(rows(await as("authenticated", LANDLORD, `SELECT user_id FROM public.landlord_id_reviews`)).length === 1
  && rows(await as("authenticated", OTHER, `SELECT user_id FROM public.landlord_id_reviews`)).length === 0
  && rows(await as("authenticated", ADMIN, `SELECT user_id FROM public.landlord_id_reviews`)).length === 1,
  "the review row: the landlord and admins read it, another member reads nothing");
ok(refused(await as("authenticated", LANDLORD, `UPDATE public.landlord_id_reviews SET status = 'approved'`), /permission denied/)
  && refused(await as("authenticated", LANDLORD, `INSERT INTO public.landlord_id_reviews (user_id, status, front_path) VALUES ('${LANDLORD}', 'approved', 'x')`), /permission denied/),
  "no client writes the review row (a landlord cannot approve themselves)");
ok(refused(await as("authenticated", ADMIN, `SELECT reviewed_by FROM public.landlord_id_reviews`), /permission denied/),
  "no client reads reviewed_by (which admin reviewed is staff-only)");
// storage: the ID image is readable by its owner and admins only
ok(rows(await as("authenticated", OTHER, `SELECT name FROM storage.objects WHERE name LIKE '${LANDLORD}/landlord-id/%'`)).length === 0
  && rows(await as("authenticated", LANDLORD, `SELECT name FROM storage.objects WHERE name LIKE '${LANDLORD}/landlord-id/%'`)).length === 2
  && rows(await as("authenticated", ADMIN, `SELECT name FROM storage.objects WHERE name LIKE '${LANDLORD}/landlord-id/%'`)).length === 2,
  "storage: another member cannot read a landlord's ID image; the owner and an admin can");
const sub = (u, path) => as("authenticated", u, `SELECT public.is_submitted_credential_object('${path}') AS s`);
ok(one(await sub(LANDLORD, `${LANDLORD}/landlord-id/1-front-id.jpg`)) === true,
  "an ID photo under review is locked against its owner's replace/delete");

// --- review: admin only, never their own, reject needs a note
ok(refused(await review(OTHER, LANDLORD, true, null), /not_authorized/, "42501"), "a non-admin cannot approve an ID");
ok(refused(await review(LANDLORD, LANDLORD, true, null), /not_authorized/, "42501"), "a landlord cannot approve their own ID");
await svc(`INSERT INTO public.landlord_id_reviews (user_id, status, front_path) VALUES ('${ADMIN2}', 'pending_review', '${ADMIN2}/landlord-id/a.jpg')`);
ok(refused(await review(ADMIN2, ADMIN2, true, null), /not_authorized/, "42501"), "an admin never approves their own ID");
ok(refused(await review(ADMIN, LANDLORD, false, "no"), /reason_required/, "22023"), "a rejection needs a note");
ok(refused(await review(ADMIN, LANDLORD, true, null, "2000-01-01T00:00:00Z"), /review_changed/, "40001"),
  "an approval of a submission the admin did not open (a newer photo since) is refused");
ok(refused(await review(ADMIN, OTHER, true, null), /not_pending_review/, "P0002"), "nothing to approve for a member who sent nothing");

// --- reject: not verified, note shown, can send again
await upload(REJECTED, "1-front.jpg");
await submit(REJECTED, `${REJECTED}/landlord-id/1-front.jpg`);
ok(Array.isArray(await review(ADMIN, REJECTED, false, "The photo is blurry")) && await status(REJECTED) === "rejected",
  "an admin rejects with a note");
const mine = rows(await as("authenticated", REJECTED, `SELECT * FROM public.rentals_my_identity()`))[0] ?? {};
ok(mine.verified === false && mine.id_status === "rejected" && mine.review_note === "The photo is blurry",
  "REJECTED: the landlord sees 'rejected' and the admin's note, and is not verified");
ok(await verified(REJECTED) === false && (await acceptMissing(REJECTED)).includes("stripe_id"),
  "REJECTED: not verified for Homes, and the Jobs accept gate still asks for the ID");
ok(one(await svc(`SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'landlord_id_rejected' AND target_id = '${REJECTED}'`)) === 1,
  "the rejection is written to admin_audit_log");
await upload(REJECTED, "2-front.jpg");
ok(Array.isArray(await submit(REJECTED, `${REJECTED}/landlord-id/2-front.jpg`)) && await status(REJECTED) === "pending_review"
  && one(await svc(`SELECT review_note FROM public.landlord_id_reviews WHERE user_id = '${REJECTED}'`)) == null,
  "after a rejection the landlord sends a new photo: waiting again, the old note cleared");

// --- approve: verified in every section through the one rule
ok(Array.isArray(await review(ADMIN, LANDLORD, true, "Name matches the deed")) && await status(LANDLORD) === "approved",
  "an admin approves the ID");
ok(await verified(LANDLORD) === true, "APPROVED: the landlord passes the Homes identity helper (is_identity_verified)");
ok(!(await acceptMissing(LANDLORD)).includes("stripe_id"), "APPROVED: the Jobs accept gate no longer asks for the ID (helper_accept_missing)");
ok(one(await svc(`SELECT public.identity_is_verified(idv_status, stripe_identity_verified) FROM public.profiles WHERE user_id = '${LANDLORD}'`)) === true,
  "APPROVED: the one predicate every badge reads (get_safe_profiles, get_public_profile_stats, shop_badges) says verified");
const prof = rows(await svc(`SELECT idv_status, legacy_manual_review, stripe_identity_verified FROM public.profiles WHERE user_id = '${LANDLORD}'`))[0] ?? {};
ok(prof.idv_status === "verified" && prof.legacy_manual_review === true && prof.stripe_identity_verified == null,
  "the approval writes the manual-verify verdict and never touches Stripe's own Connect flag");
ok(one(await svc(`SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'landlord_id_approved' AND target_id = '${LANDLORD}'`)) === 1,
  "the approval is written to admin_audit_log (one row)");
ok(refused(await review(ADMIN, LANDLORD, true, null), /not_pending_review/, "P0002"), "an approval is not repeated");
ok(refused(await submit(LANDLORD, `${LANDLORD}/landlord-id/1-front-id.jpg`), /already_verified/, "22023"), "verified once: never asked again");
ok(one(await sub(LANDLORD, `${LANDLORD}/landlord-id/1-front-id.jpg`)) === true,
  "a decided ID photo stays locked against its owner until the retention sweep deletes it (the decision's evidence)");
const claim = one(await svc(`SELECT public.claim_idv_attempt('${CONNECT}', 1, false)->>'reason'`));
ok(claim === "already_verified", `claim_idv_attempt: a Connect-verified member is already verified, no second Stripe check (${claim})`);
await svc(`UPDATE public.profiles SET is_seed = false WHERE user_id = '${REJECTED}'`);
ok(one(await svc(`SELECT public.admin_queue_still_pending('rentals-landlord-id-review', '{}'::jsonb, now())`)) === true,
  "the alert stays open while another landlord's ID waits");
await review(ADMIN, REJECTED, true, null);
await svc(`DELETE FROM public.landlord_id_reviews WHERE user_id = '${ADMIN2}'`);
ok(one(await svc(`SELECT public.admin_queue_still_pending('rentals-landlord-id-review', '{}'::jsonb, now())`)) === false,
  "and closes once no ID waits");

// --- retention: due only after the window, service_role only, stamps only the decision it read
ok(rows(await svc(`SELECT * FROM public.landlord_id_images_due(30, 100)`)).length === 0, "a fresh decision is not due");
await svc(`UPDATE public.landlord_id_reviews SET reviewed_at = now() - interval '31 days' WHERE user_id = '${LANDLORD}'`);
const due = rows(await svc(`SELECT user_id, reviewed_at::text AS at FROM public.landlord_id_images_due(30, 100)`));
ok(due.length === 1 && due[0].user_id === LANDLORD, "a decision older than the window is due");
ok(refused(await as("authenticated", ADMIN, `SELECT * FROM public.landlord_id_images_due(30, 100)`), /permission denied/)
  && refused(await as("authenticated", LANDLORD, `SELECT public.landlord_id_images_deleted('${LANDLORD}', now())`), /permission denied/),
  "the retention functions are service_role only");
ok(one(await svc(`SELECT public.landlord_id_images_deleted('${LANDLORD}', now())`)) === false, "a stamp for another decision time changes nothing");
ok(one(await svc(`SELECT public.landlord_id_images_deleted('${LANDLORD}', '${due[0]?.at}')`)) === true
  && one(await sub(LANDLORD, `${LANDLORD}/landlord-id/1-front-id.jpg`)) === false
  && one(await svc(`SELECT (front_path IS NULL AND back_path IS NULL AND images_deleted_at IS NOT NULL) FROM public.landlord_id_reviews WHERE user_id = '${LANDLORD}'`)) === true
  && await status(LANDLORD) === "approved" && await verified(LANDLORD) === true,
  "the stamp clears the paths; the approval (and the verdict) stays");

// --- an approval whose verdict an admin later took away: the landlord may send again (never a dead end)
await svc(`UPDATE public.profiles SET idv_status = 'failed' WHERE user_id = '${LANDLORD}'`);
await upload(LANDLORD, "3-front.jpg");
ok(await verified(LANDLORD) === false && Array.isArray(await submit(LANDLORD, `${LANDLORD}/landlord-id/3-front.jpg`))
  && await status(LANDLORD) === "pending_review",
  "an 'approved' review whose verdict was revoked: the landlord sends a new photo and it waits again");

// --- grants
for (const sig of ["rentals_submit_landlord_id(text, text)", "rentals_admin_review_landlord_id(uuid, boolean, text, timestamptz)", "rentals_my_identity()"]) {
  const acl = one(await svc(`SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = 'public.${sig}'::regprocedure`)) ?? "";
  ok(!/(^|[{,])(anon)?=X/.test(acl) && /authenticated=X/.test(acl), `${sig}: EXECUTE authenticated, never anon/PUBLIC (${acl || "none"})`);
}
console.log(`\n${pass} PASS, ${fail} FAIL${process.env.LID === "skip" ? " (LID=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
