#!/usr/bin/env node
/**
 * PGlite proof for the license-required job categories (owner 2026-10-19):
 * 20261019184157_add_mobile_job_categories + 20261019184311_category_license_required.
 *
 *   node src/test/pglite/categoryLicenseRequired.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/categoryLicenseRequired.pglite.mjs   # RED on main's definitions
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs: roles + prod's default function ACL, auth.uid(),
 * is_server_context(), has_role(), get_user_credential_tier() (tier 0),
 * credential_document_path_ok() (true), the job_category enum with prod's 24
 * values, and profiles / helper_credentials / jobs / applications /
 * job_quote_requests / job_quotes with the columns the gates read. Main's
 * previous definitions are loaded VERBATIM from their migrations
 * (enforce_application_credential_tier from 20260915101102, auto_pending_credentials
 * from 20260923110759, get_pending_credentials from 20260923101130,
 * is_category_taxable + enforce_funded_category_tax_class from 20261017055441),
 * then the enum migration in its own transaction, then the license migration
 * 3x, each in its own transaction like the migration runner.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const ENUM_MIG = readFileSync(`${MIG_DIR}20261019184157_add_mobile_job_categories.sql`, "utf8");
const NEW_MIG = readFileSync(process.env.MIG_PATH ?? `${MIG_DIR}20261019184311_category_license_required.sql`, "utf8");

/** One CREATE FUNCTION statement, verbatim, from a migration file. */
function extractFn(file, name) {
  const sql = readFileSync(`${MIG_DIR}${file}`, "utf8");
  const start = sql.search(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\(`));
  if (start < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS (\$[a-z_]*\$)/.exec(sql.slice(start))[1];
  const open = sql.indexOf(`AS ${tag}`, start) + 3 + tag.length;
  const end = sql.indexOf(`${tag};`, open);
  return sql.slice(start, end + tag.length + 1);
}

const OLD = [
  extractFn("20260915101102_null_uid_is_not_server.sql", "enforce_application_credential_tier"),
  extractFn("20260923110759_credential_url_is_own_document.sql", "auto_pending_credentials"),
  extractFn("20260923101130_pending_credential_requires_document.sql", "get_pending_credentials"),
  extractFn("20261017055441_trades_taxed_like_handyman.sql", "is_category_taxable"),
  extractFn("20261017055441_trades_taxed_like_handyman.sql", "enforce_funded_category_tax_class"),
];

const PROD_24 = ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "pet_care", "assembly", "other", "storm_prep", "events", "electrical", "plumbing", "hvac", "roofing", "welding", "carpentry", "auto_repair", "appliance_repair", "flooring", "concrete_masonry", "fencing", "pressure_washing"];
const LICENSED = ["locksmith", "mobile_vet", "hair_stylist", "massage", "mobile_bartending"];

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.server', true), '') = 'on' $$;
CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.admin', true), '') = 'on' $$;
CREATE FUNCTION public.get_user_credential_tier(uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.credential_document_path_ok(uuid, text, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TYPE public.job_category AS ENUM (${PROD_24.map((c) => `'${c}'`).join(",")});
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, full_name text, email text, avatar_url text, business_name text,
  license_url text, license_status text NOT NULL DEFAULT 'none', is_licensed boolean NOT NULL DEFAULT false,
  license_expires_at date, license_reviewed_at timestamptz, license_reviewed_by uuid, license_rejection_reason text,
  insurance_url text, insurance_status text NOT NULL DEFAULT 'none', is_insured boolean NOT NULL DEFAULT false,
  insurance_expires_at date, insurance_reviewed_at timestamptz, insurance_reviewed_by uuid, insurance_rejection_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.helper_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, credential_type text NOT NULL,
  status text NOT NULL DEFAULT 'unverified', trade_category text, document_url text, expiration_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, category public.job_category NOT NULL,
  credential_tier int NOT NULL DEFAULT 0, helper_id uuid, offered_to_helper_id uuid,
  payment_status text NOT NULL DEFAULT 'unpaid', stripe_session_id text
);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, helper_id uuid NOT NULL);
CREATE TABLE public.job_quote_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), poster_id uuid, category public.job_category NOT NULL DEFAULT 'other');
CREATE TABLE public.job_quotes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL, quoter_id uuid);
`;
const TRIGGERS = `
CREATE TRIGGER trg_application_credential_gate BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_application_credential_tier();
CREATE TRIGGER auto_pending_credentials_trigger BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_pending_credentials();
`;

const db = new PGlite();
await db.exec(SCHEMA);
for (const f of OLD) await db.exec(f);
await db.exec(TRIGGERS);
await db.exec(`BEGIN;\n${ENUM_MIG}\nCOMMIT;`);
await db.exec(`BEGIN;\n${ENUM_MIG}\nCOMMIT;`); // replay
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(`BEGIN;\n${NEW_MIG}\nCOMMIT;`);
}

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

const POSTER = "00000000-0000-0000-0000-00000000000a";
const NOLIC = "00000000-0000-0000-0000-0000000000b1"; // no license at all
const MASSAGE = "00000000-0000-0000-0000-0000000000b2"; // verified, covers massage
const HAIR = "00000000-0000-0000-0000-0000000000b3"; // verified, covers hair_stylist only
const EXPIRED = "00000000-0000-0000-0000-0000000000b4"; // covered massage, expired
const VENDOR = "00000000-0000-0000-0000-0000000000b5"; // helper_credentials trade_license for massage
const PENDING = "00000000-0000-0000-0000-0000000000b6"; // claims massage, not yet reviewed

/** Run as a signed-in member (or the server); returns null on success or the error message. */
async function as(uid, sql, params = [], { server = false, admin = false } = {}) {
  try {
    await db.query("BEGIN");
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('test.server', $2, true), set_config('test.admin', $3, true)`, [uid ?? "", server ? "on" : "", admin ? "on" : ""]);
    const r = await db.query(sql, params);
    await db.query("COMMIT");
    return { err: null, rows: r.rows };
  } catch (e) {
    await db.query("ROLLBACK");
    return { err: e.message, rows: [] };
  }
}

const hasLicCol = (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='license_categories'`)).rows.length > 0;
const cats = (arr) => (hasLicCol ? `, license_categories = '{${arr.join(",")}}'` : "");
await db.exec(`
INSERT INTO public.profiles(user_id) VALUES ('${POSTER}'), ('${NOLIC}'), ('${MASSAGE}'), ('${HAIR}'), ('${EXPIRED}'), ('${VENDOR}'), ('${PENDING}');
`);
// Set up as an admin (the review path review_credential writes).
await db.exec(`
-- auto_pending_credentials counts an admin writer only with a uid.
SELECT set_config('test.admin', 'on', false), set_config('request.jwt.claim.sub', '${POSTER}', false);
UPDATE public.profiles SET license_url='m.pdf', is_licensed=true, license_status='verified', license_expires_at=current_date + 200 ${cats(["massage"])} WHERE user_id='${MASSAGE}';
UPDATE public.profiles SET license_url='h.pdf', is_licensed=true, license_status='verified', license_expires_at=current_date + 200 ${cats(["hair_stylist"])} WHERE user_id='${HAIR}';
UPDATE public.profiles SET license_url='e.pdf', is_licensed=true, license_status='verified', license_expires_at=current_date - 1 ${cats(["massage"])} WHERE user_id='${EXPIRED}';
UPDATE public.profiles SET license_url='p.pdf', is_licensed=true, license_status='pending' ${cats(["massage"])} WHERE user_id='${PENDING}';
INSERT INTO public.helper_credentials(user_id, credential_type, status, trade_category, expiration_date) VALUES ('${VENDOR}', 'trade_license', 'verified', 'massage', current_date + 200);
SELECT set_config('test.admin', '', false), set_config('request.jwt.claim.sub', '', false);
`);

// 0. The enum.
const { rows: enumRows } = await db.query(`SELECT count(*)::int AS n FROM unnest(enum_range(NULL::public.job_category))`);
check("enum has prod's 24 values + 17 new (41), replay-safe", enumRows[0].n === 41, `${enumRows[0].n}`);

// 1. A poster can post in any category (no helper on it yet).
const post = await as(POSTER, `INSERT INTO public.jobs(customer_id, category) VALUES ($1, 'massage') RETURNING id`, [POSTER]);
check("[keep] a poster can post a massage job", post.err === null, post.err ?? "");
const massageJob = post.rows[0]?.id;
const { rows: [{ id: cleanJob }] } = await db.query(`INSERT INTO public.jobs(customer_id, category) VALUES ($1, 'cleaning') RETURNING id`, [POSTER]);
const { rows: [{ id: hairJob }] } = await db.query(`INSERT INTO public.jobs(customer_id, category) VALUES ($1, 'hair_stylist') RETURNING id`, [POSTER]);

const apply = (uid, job) => as(uid, `INSERT INTO public.applications(job_id, helper_id) VALUES ($1, $2) RETURNING id`, [job, uid]);
const refused = (r) => r.err !== null && /category_license_required/.test(r.err);

// 2. Applications.
let r = await apply(NOLIC, massageJob);
check("[fix] an unlicensed Helpr's apply to a massage job is refused", refused(r), r.err ?? "accepted");
r = await apply(MASSAGE, massageJob);
check("[keep] a Helpr licensed for massage can apply", r.err === null, r.err ?? "");
r = await apply(HAIR, massageJob);
check("[fix] a license for ANOTHER category does not cover massage", refused(r), r.err ?? "accepted");
r = await apply(HAIR, hairJob);
check("[keep] the hair stylist can apply to a hair job", r.err === null, r.err ?? "");
r = await apply(EXPIRED, massageJob);
check("[fix] an expired license is refused", refused(r), r.err ?? "accepted");
r = await apply(PENDING, massageJob);
check("[fix] a license still awaiting review is refused", refused(r), r.err ?? "accepted");
r = await apply(VENDOR, massageJob);
check("[keep] a vendor-verified trade_license for massage is accepted", r.err === null, r.err ?? "");
r = await apply(NOLIC, cleanJob);
check("[keep] anyone can still apply to a cleaning job", r.err === null, r.err ?? "");
r = await as(null, `INSERT INTO public.applications(job_id, helper_id) VALUES ($1, $2)`, [massageJob, NOLIC], { server: true });
check("[keep] the server context passes (recurring visits, admin tooling)", r.err === null, r.err ?? "");

// 3. Quotes.
const { rows: [{ id: req }] } = await db.query(`INSERT INTO public.job_quote_requests(poster_id, category) VALUES ($1, 'mobile_bartending') RETURNING id`, [POSTER]);
r = await as(NOLIC, `INSERT INTO public.job_quotes(request_id, quoter_id) VALUES ($1, $2)`, [req, NOLIC]);
check("[fix] an unlicensed Helpr's quote on a bartending request is refused", refused(r), r.err ?? "accepted");
if (hasLicCol) await as(POSTER, `UPDATE public.profiles SET license_categories = '{mobile_bartending,massage}' WHERE user_id = $1`, [MASSAGE], { admin: true });
r = await as(MASSAGE, `INSERT INTO public.job_quotes(request_id, quoter_id) VALUES ($1, $2)`, [req, MASSAGE]);
check("[keep] a Helpr licensed for bartending can quote", r.err === null, r.err ?? "");

// 4. Offers, hires and category switches on the job.
r = await as(POSTER, `UPDATE public.jobs SET offered_to_helper_id = $2 WHERE id = $1`, [massageJob, NOLIC]);
check("[fix] a direct offer of a massage job to an unlicensed Helpr is refused", refused(r), r.err ?? "accepted");
r = await as(POSTER, `UPDATE public.jobs SET offered_to_helper_id = $2 WHERE id = $1`, [massageJob, MASSAGE]);
check("[keep] a direct offer to a licensed Helpr goes through", r.err === null, r.err ?? "");
r = await as(NOLIC, `UPDATE public.jobs SET helper_id = $2 WHERE id = $1`, [massageJob, NOLIC]);
check("[fix] an unlicensed Helpr cannot be put on a massage job", refused(r), r.err ?? "accepted");
await db.query(`UPDATE public.jobs SET helper_id = $2 WHERE id = $1`, [cleanJob, NOLIC]);
r = await as(POSTER, `UPDATE public.jobs SET category = 'massage' WHERE id = $1`, [cleanJob]);
check("[fix] switching a job with an unlicensed Helpr on it to massage is refused", refused(r), r.err ?? "accepted");
r = await as(POSTER, `UPDATE public.jobs SET category = 'handyman' WHERE id = $1`, [cleanJob]);
check("[keep] switching it to another open category is fine", r.err === null, r.err ?? "");
r = await as(POSTER, `INSERT INTO public.jobs(customer_id, category, offered_to_helper_id) VALUES ($1, 'locksmith', $2)`, [POSTER, NOLIC]);
check("[fix] a booked quote / direct-offer insert to an unlicensed Helpr is refused", refused(r), r.err ?? "accepted");

// 5. The claim is reviewed: changing the categories on a verified license re-enters review.
r = await as(HAIR, `UPDATE public.profiles SET license_categories = '{hair_stylist,massage}' WHERE user_id = $1 RETURNING license_status`, [HAIR]);
check("[fix] a Helpr adding a category to a verified license sends it back to pending", r.err === null && r.rows[0]?.license_status === "pending", r.err ?? r.rows[0]?.license_status);
r = await apply(HAIR, massageJob);
check("[fix] ...and the self-added category does not let them apply", refused(r), r.err ?? "accepted");
r = await as(POSTER, `UPDATE public.profiles SET license_categories = '{massage}' WHERE user_id = $1 RETURNING license_status`, [MASSAGE], { admin: true });
check("[keep] an admin editing the categories keeps the license verified", r.err === null && r.rows[0]?.license_status === "verified", r.err ?? r.rows[0]?.license_status);

// 6. The admin queue shows the claimed categories.
r = await as(POSTER, `SELECT user_id, license_categories FROM public.get_pending_credentials()`, [], { admin: true });
const pend = r.rows.find((x) => x.user_id === PENDING);
check("[fix] get_pending_credentials returns the claimed categories", r.err === null && JSON.stringify(pend?.license_categories) === '["massage"]', r.err ?? JSON.stringify(pend));

// 7. ACL and the set.
const acl = await db.query(`SELECT has_function_privilege('authenticated', 'public.helper_holds_category_license(uuid, public.job_category)', 'EXECUTE') a,
                                   has_function_privilege('anon', 'public.helper_holds_category_license(uuid, public.job_category)', 'EXECUTE') b,
                                   has_function_privilege('anon', 'public.category_requires_license(public.job_category)', 'EXECUTE') c`).catch((e) => ({ rows: [{ err: e.message }] }));
check("[fix] helper_holds_category_license is not callable by a client; category_requires_license not by anon", acl.rows[0].a === false && acl.rows[0].b === false && acl.rows[0].c === false, JSON.stringify(acl.rows[0]));
const set = await db.query(`SELECT array_agg(c::text ORDER BY c::text) s FROM unnest(enum_range(NULL::public.job_category)) c WHERE public.category_requires_license(c)`).catch((e) => ({ rows: [{ s: e.message }] }));
check("[fix] category_requires_license is true exactly for the five licensed categories", JSON.stringify(set.rows[0].s) === JSON.stringify([...LICENSED].sort()), JSON.stringify(set.rows[0].s));

// 8. Sales tax.
const tax = await db.query(`SELECT c::text c, public.is_category_taxable(c) t FROM unnest(enum_range(NULL::public.job_category)) c`);
const taxed = tax.rows.filter((x) => x.t).map((x) => x.c);
check("[fix] tire_service and dent_windshield are taxed like auto_repair", taxed.includes("tire_service") && taxed.includes("dent_windshield"), taxed.join(","));
check("[keep] no other new category is taxed", taxed.length === 16, `${taxed.length}: ${taxed.join(",")}`);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
