#!/usr/bin/env node
/**
 * PGlite proof for 20261025202148_card_hold_at_post.sql (Q2399, owner
 * 2026-10-25: hold the poster's card at posting, charge it only at the hire).
 *
 *   node src/test/pglite/cardHoldAtPost.pglite.mjs                       # GREEN, migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/cardHoldAtPost.pglite.mjs    # RED: every [fix] check fails on today's code
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/cardHoldAtPost.pglite.mjs   # a planted defect must turn a check red
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * The world is prod-shaped: public.jobs carries the LIVE column list (read
 * read-only from prod 2026-10-25), and every object the migration replaces is
 * first loaded from its NEWEST definition BEFORE this migration (the live
 * bodies: md5(prosrc) of all 25 matched those definitions on 2026-10-25), so
 * NEW_MIGRATION=skip is exactly today's prod. Helpers the bodies call that are
 * not under test are stubs (readiness, blocks, bans, names, cutoffs).
 *
 *   H1 [fix]  the webhook (service role) can write payment_status 'held'
 *   H2 [fix]  a held job is listed: job_payment_is_listed, job_is_funded (the applications policy), open_jobs_browse
 *   H3 [keep] a held job is NOT funded: job_payment_is_funded('held') = false; an unpaid job is not listed
 *   H4 [fix]  the poster's Hire (helper_id, a user session) on a held job passes the award gate
 *   H5 [fix]  accept_job_offer, ready Helpr, held job: payment_not_captured, nothing confirmed
 *   H6 [fix]  accept_job_offer, unready Helpr, held job: recorded pending_setup
 *   H7 [keep] complete_job_accept on a held job completes nothing (server path)
 *   H8 [fix]  no role, service_role included, can confirm a hire on a held job (jobs_held_is_never_hired)
 *   H9 [keep] after the capture (held -> escrow) the same accept completes as today
 *   H10 [fix] respond_to_direct_offer, ready Helpr, held: payment_not_captured; unready: pending_setup
 *   H11 [keep] complete_direct_offer_accept on a held job completes nothing (the deferred completion path)
 *   H12 [fix] crew: the poster's seat offer on a held job passes; a ready member's Confirm is payment_not_captured
 *   H13 [fix] crew: no role can confirm a seat on a held job (crew_seat_held_is_never_confirmed)
 *   H14 [fix] the Helpr fan-out fires on unpaid -> held, and NOT again on held -> escrow
 *   H15 [fix] switch card_hold_at_post exists as 'testers'; get_my_job_card_hold refuses an ordinary account (feature_disabled) and answers a tester poster
 *   H16 [fix] job_card_holds: no client privilege; an 'authorized' row without a PaymentIntent is refused
 */
import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261025202148_card_hold_at_post.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const REGISTRY = readFileSync(`${DIR}20261012031120_hidden_feature_switches.sql`, "utf8");

/** The newest CREATE of `name` (FUNCTION or VIEW) in a migration BEFORE this one, any dollar tag. */
function priorNewest(kind, name) {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS).sort();
  const head = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?${kind}\s+(?:public\.)?"?${name}"?[\s(]`, "gi");
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(DIR + files[i], "utf8");
    const starts = [...sql.matchAll(head)];
    if (!starts.length) continue;
    const at = starts[starts.length - 1].index;
    const rest = sql.slice(at);
    let end;
    if (kind === "function") {
      const tag = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(rest);
      const close = rest.indexOf(tag[1], tag.index + tag[0].length);
      end = rest.indexOf(";", close + tag[1].length) + 1;
    } else {
      end = rest.search(/;\s*(\n|$)/) + 1;
    }
    return rest.slice(0, end).replace(/^create\s+function/i, "CREATE OR REPLACE FUNCTION");
  }
  throw new Error(`no ${kind} ${name} before ${THIS}`);
}

const JOB_COLUMNS = `
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, title text, description text, category job_category,
  location text, date_needed date, start_time time without time zone, estimated_hours numeric(5,2), budget numeric(10,2),
  photos text[], special_requirements text, status job_status DEFAULT 'open', helper_id uuid, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), stripe_session_id text, stripe_payment_intent_id text, payment_status text DEFAULT 'unpaid',
  platform_fee_percent numeric(5,2), platform_fee_amount numeric(10,2), revision_note text, revision_requested_at timestamptz,
  poster_completed_at timestamptz, helper_completed_at timestamptz, boosted_at timestamptz, boost_expires_at timestamptz,
  is_recurring boolean, recurrence_interval text, recurrence_end_date date, parent_job_id uuid, proof_before_urls text[],
  proof_after_urls text[], cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean,
  poster_confirmed_at timestamptz, helper_confirmed_at timestamptz, helpers_needed integer, is_group_job boolean DEFAULT false,
  response_deadline timestamptz, expires_at timestamptz, review_reminder_sent boolean, removal_reason text, removed_at timestamptz,
  removed_by uuid, flag_reasons text[], dispute_reason text, dispute_evidence_urls text[], disputed_at timestamptz, disputed_by uuid,
  payout_scheduled_at timestamptz, latitude numeric, longitude numeric, is_urgent boolean, urgent_fee numeric, cancellation_fee numeric,
  cancellation_fee_status text, is_flexible_schedule boolean, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz,
  dispute_deadline timestamptz, dispute_status text, dispute_helper_response text, dispute_resolved_at timestamptz,
  revision_deadline timestamptz, revision_completed_at timestamptz, revision_acceptance_deadline timestamptz, sales_tax_rate numeric,
  sales_tax_amount numeric, customer_fee_amount numeric, helper_fee_percent numeric, commission_tax_amount numeric,
  poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz, parish text, zip_code text, revision_count integer,
  offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz, business_id uuid, boost_auto_extended boolean,
  start_reminder_sent_at timestamptz, no_show_alert_sent_at timestamptz, department text, requires_w9 boolean, credential_tier integer,
  pricing_mode text, has_active_dispute boolean, protection_fee numeric(10,2), is_auto_created boolean, scope_video_url text,
  expiring_notif_sent boolean, payment_confirm_notif_sent boolean, recurrence_days smallint[], recurrence_weeks smallint,
  recurring_helper_id uuid, accepted_at timestamptz, helper_dayof_confirmed_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
  dayof_unanswered_poster_alert_sent_at timestamptz, release_last_chance_notif_sent_at timestamptz, is_seed boolean DEFAULT false,
  helper_arrival_verified_at timestamptz, require_photo_proof boolean, completed_at timestamptz, helper_arrival_near_miss_at timestamptz,
  helper_arrival_near_miss_ft integer, client_request_id uuid, chargeback_evidence_due_by timestamptz, series_ended_on date,
  series_split_ok boolean, series_ban_cancelled_at timestamptz, materials_note text, onboarding_fee_amount numeric(10,2),
  helper_fee_flat_cents integer, poster_fee_flat_cents integer, last_edit_notice_at timestamptz`;

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled', 'revision_requested', 'disputed', 'pending_approval');
CREATE TYPE public.job_category AS ENUM ('cleaning', 'yard_work', 'moving', 'errands', 'handyman', 'painting', 'delivery', 'pet_care', 'assembly', 'other', 'storm_prep', 'events', 'electrical', 'plumbing', 'hvac', 'roofing', 'welding', 'carpentry', 'auto_repair', 'appliance_repair', 'flooring', 'concrete_masonry', 'fencing', 'pressure_washing', 'declutter_help');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.jobs (${JOB_COLUMNS});
-- the LIVE constraint (pg_get_constraintdef, prod, 2026-10-25)
ALTER TABLE public.jobs ADD CONSTRAINT jobs_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'escrow'::text, 'payout_pending'::text, 'released'::text, 'refunded'::text, 'cancelled'::text, 'abandoned'::text, 'failed'::text, 'chargeback'::text, 'cancelling'::text])));
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, message text,
  status text DEFAULT 'pending', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (job_id, helper_id));
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, helper_confirmed_at timestamptz);
CREATE TABLE public.crew_block_fees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.job_accept_pending (job_id uuid PRIMARY KEY, helper_id uuid, requested_at timestamptz DEFAULT now());
CREATE TABLE public.crew_confirm_pending (slot_id uuid PRIMARY KEY, job_id uuid, helper_id uuid, requested_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, ban_status text, auto_suspended_until timestamptz, is_seed boolean DEFAULT false);
CREATE TABLE public._ready (user_id uuid PRIMARY KEY);
CREATE TABLE public._fanout (job_id uuid, at timestamptz DEFAULT clock_timestamp());
-- helpers the bodies call that are not under test
CREATE FUNCTION public.helper_accept_block_reason(p uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public._ready r WHERE r.user_id = p) THEN NULL ELSE 'helper_payout_setup_incomplete' END $$;
CREATE FUNCTION public.helper_accept_missing(p uuid) RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT ARRAY['payout_setup']::text[] $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.member_display_name(n text, fallback text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(n, fallback) $$;
CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.job_offer_cutoff(d date, t time) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT (d + COALESCE(t, time '23:59'))::timestamptz $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.is_helper_shadowbanned(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT l $$;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() + interval '1 day' $$;
-- the fan-outs' bodies are not under test, their WHEN clauses are: count the calls
CREATE FUNCTION public.notify_helpers_on_job_post() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public._fanout (job_id) VALUES (NEW.id); RETURN NEW; END $$;
CREATE FUNCTION public.notify_saved_searches_on_new_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
`;

// today's triggers, verbatim from their newest migrations
const TODAY_TRIGGERS = `
CREATE TRIGGER trg_job_funded_before_award BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_job_funded_before_award();
CREATE TRIGGER group_job_helpers_award_gate BEFORE INSERT ON public.group_job_helpers FOR EACH ROW EXECUTE FUNCTION public.enforce_group_roster_award_gate();
CREATE TRIGGER trg_notify_helpers_funded_update AFTER UPDATE ON public.jobs FOR EACH ROW
  WHEN (NEW.status = 'open'::job_status AND NEW.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND NOT (OLD.status = 'open'::job_status AND COALESCE(OLD.payment_status, '') = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])))
  EXECUTE FUNCTION public.notify_helpers_on_job_post();
`;

const PRIOR = [
  ["function", "is_server_context"], ["function", "job_payment_is_funded"], ["function", "job_is_funded"],
  ["function", "enforce_job_funded_before_award"], ["function", "enforce_group_roster_award_gate"],
  ["function", "complete_job_accept"], ["function", "accept_job_offer"], ["function", "direct_accept_block_reason"],
  ["function", "complete_direct_offer_accept"], ["function", "respond_to_direct_offer"], ["function", "group_member_slot"],
  ["function", "rpc_group_member_confirm"], ["view", "open_jobs_browse"],
];

const POSTER = "00000000-0000-0000-0000-0000000000a1";
const TESTER_POSTER = "00000000-0000-0000-0000-0000000000a2";
const HELPR = "00000000-0000-0000-0000-0000000000b1";
const UNREADY = "00000000-0000-0000-0000-0000000000b2";
const MEMBER = "00000000-0000-0000-0000-0000000000b3";
const J = {
  held: "10000000-0000-0000-0000-000000000001", // posted, card held, open
  offer: "10000000-0000-0000-0000-000000000002", // held, poster has hired HELPR (offer out)
  unready: "10000000-0000-0000-0000-000000000003", // held, offer to UNREADY
  direct: "10000000-0000-0000-0000-000000000004", // held, direct offer to HELPR
  directU: "10000000-0000-0000-0000-000000000005", // held, direct offer to UNREADY
  crew: "10000000-0000-0000-0000-000000000006", // held crew
  unpaid: "10000000-0000-0000-0000-000000000007", // never paid
  fan: "10000000-0000-0000-0000-000000000008", // fan-out probe
  mine: "10000000-0000-0000-0000-000000000009", // tester poster's held job
};

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(REGISTRY);
await db.exec("SET check_function_bodies = off;");
for (const [kind, name] of PRIOR) await db.exec(priorNewest(kind, name));
await db.exec(TODAY_TRIGGERS);
// No RLS in this world: the roles reach the rows the way prod's policies and service role let them.
await db.exec("GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;");
await db.exec(`INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER_POSTER}');
  INSERT INTO public._ready (user_id) VALUES ('${HELPR}'), ('${MEMBER}');
  INSERT INTO public.profiles (user_id, full_name) VALUES ('${POSTER}', 'Pat'), ('${TESTER_POSTER}', 'Tess'), ('${HELPR}', 'Hal'), ('${UNREADY}', 'Una'), ('${MEMBER}', 'Mo');`);

if (!SKIP) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
await db.exec("SET check_function_bodies = on;");
// The migration re-creates the fan-out bodies (their real text needs the whole
// alert world); only the triggers' WHEN clauses are under test, so count calls.
await db.exec(`CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public._fanout (job_id) VALUES (NEW.id); RETURN NEW; END $$;
  CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`);

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) pass++; else fail++;
};
/** Run as a role ('service' = service_role JWT, no uid). Returns rows or { error }. */
async function as(who, uid, sql) {
  try {
    const role = who === "service" ? "service_role" : who;
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET request.jwt.claim.role = '${role}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = '';`);
  }
}
/** As the database owner, the way the webhook's service-role writes reach the table. */
async function owner(sql) {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; }
}
const err = (r) => (r && !Array.isArray(r) ? r.error : "");

// ─── H1: the webhook marks a posted job held ───────────────────────────────
const tomorrow = "current_date + 1";
const ins = (id, extra = "", cols = "") => owner(`INSERT INTO public.jobs (id, customer_id, title, description, category, date_needed, budget, payment_status${cols})
  VALUES ('${id}', '${POSTER}', 'Job ${id.slice(-1)}', 'd', 'yard_work', ${tomorrow}, 40, 'unpaid'${extra})`);
for (const id of [J.held, J.offer, J.unready, J.unpaid, J.fan]) await ins(id);
await ins(J.direct, `, '${HELPR}', 'pending'`, ", offered_to_helper_id, direct_offer_status");
await ins(J.directU, `, '${UNREADY}', 'pending'`, ", offered_to_helper_id, direct_offer_status");
await ins(J.crew, ", true, 2", ", is_group_job, helpers_needed");
await owner(`INSERT INTO public.jobs (id, customer_id, title, description, category, date_needed, budget, payment_status) VALUES ('${J.mine}', '${TESTER_POSTER}', 'Mine', 'd', 'yard_work', ${tomorrow}, 40, 'unpaid')`);
await owner(`DELETE FROM public._fanout`);
const heldIds = [J.held, J.offer, J.unready, J.direct, J.directU, J.crew, J.fan, J.mine].map((i) => `'${i}'`).join(",");
const h1 = await as("service", null, `UPDATE public.jobs SET payment_status = 'held' WHERE id IN (${heldIds}) RETURNING id`);
check("H1 [fix] the webhook (service role) can write payment_status 'held'", Array.isArray(h1) && h1.length === 8, err(h1) || `${h1.length} rows`);

// ─── H14: the fan-out fired once per job on unpaid -> held ─────────────────
const fan1 = await owner(`SELECT count(*)::int AS n FROM public._fanout WHERE job_id = '${J.fan}'`);
await owner(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${J.fan}' AND payment_status = 'held'`);
const fan2 = await owner(`SELECT count(*)::int AS n FROM public._fanout WHERE job_id = '${J.fan}'`);
check("H14 [fix] the Helpr fan-out fires on unpaid -> held, and not again on held -> escrow",
  fan1?.[0]?.n === 1 && fan2?.[0]?.n === 1, `after posting ${fan1?.[0]?.n}, after capture ${fan2?.[0]?.n}`);

// ─── H2 / H3: listed vs funded ─────────────────────────────────────────────
const h2 = await owner(`SELECT public.job_payment_is_listed('held') AS listed, public.job_is_funded('${J.held}') AS applies,
  EXISTS (SELECT 1 FROM public.open_jobs_browse b WHERE b.id = '${J.held}') AS browse`);
check("H2 [fix] a held job is listed (predicate, applications gate, open_jobs_browse)",
  Array.isArray(h2) && h2[0].listed === true && h2[0].applies === true && h2[0].browse === true, err(h2) || JSON.stringify(h2[0]));
const h3 = await owner(`SELECT public.job_payment_is_funded('held') AS funded, public.job_is_funded('${J.unpaid}') AS unpaid_applies,
  EXISTS (SELECT 1 FROM public.open_jobs_browse b WHERE b.id = '${J.unpaid}') AS unpaid_browse`);
check("H3 [keep] a held job is not funded; an unpaid job is not listed",
  Array.isArray(h3) && h3[0].funded === false && h3[0].unpaid_applies === false && h3[0].unpaid_browse === false, err(h3) || JSON.stringify(h3[0]));

// ─── H4: the poster's Hire on a held job (an offer) ─────────────────────────
const hire = (id, helper) => as("authenticated", POSTER, `UPDATE public.jobs SET status = 'accepted', helper_id = '${helper}', response_deadline = now() + interval '1 day' WHERE id = '${id}' RETURNING id`);
const h4 = await hire(J.offer, HELPR);
await hire(J.unready, UNREADY);
check("H4 [fix] the poster's Hire (helper_id, a user session) on a held job passes the award gate", Array.isArray(h4) && h4.length === 1, err(h4));

// ─── H5 / H6: accept_job_offer on a held job ───────────────────────────────
const h5 = await as("authenticated", HELPR, `SELECT public.accept_job_offer('${J.offer}') AS r`);
const h5row = await owner(`SELECT helper_confirmed_at FROM public.jobs WHERE id = '${J.offer}'`);
check("H5 [fix] accept_job_offer, ready Helpr, held job: payment_not_captured, nothing confirmed",
  /payment_not_captured/.test(err(h5)) && h5row?.[0]?.helper_confirmed_at == null, err(h5) || JSON.stringify(h5));
const h6 = await as("authenticated", UNREADY, `SELECT public.accept_job_offer('${J.unready}') AS r`);
const h6p = await owner(`SELECT count(*)::int AS n FROM public.job_accept_pending WHERE job_id = '${J.unready}' AND helper_id = '${UNREADY}'`);
check("H6 [fix] accept_job_offer, unready Helpr, held job: recorded pending_setup",
  Array.isArray(h6) && h6[0]?.r?.state === "pending_setup" && h6p?.[0]?.n === 1, err(h6) || JSON.stringify(h6?.[0]));

// ─── H7 / H8: nothing completes a hire on a held card ──────────────────────
await owner(`INSERT INTO public._ready (user_id) VALUES ('${UNREADY}')`);
const h7 = await owner(`SELECT public.complete_job_accept('${J.unready}') AS done`);
check("H7 [keep] complete_job_accept on a held job completes nothing (server path)", Array.isArray(h7) && h7[0].done === false, err(h7) || JSON.stringify(h7));
await owner(`DELETE FROM public._ready WHERE user_id = '${UNREADY}'`);
const h8s = await as("service", null, `UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = '${J.offer}' RETURNING id`);
const h8o = await owner(`UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = '${J.offer}' RETURNING id`);
const heldNow = await owner(`SELECT payment_status FROM public.jobs WHERE id = '${J.offer}'`);
check("H8 [fix] no role (service_role, the owner) can confirm a hire on a held job",
  heldNow?.[0]?.payment_status === "held" && /jobs_held_is_never_hired/.test(err(h8s)) && /jobs_held_is_never_hired/.test(err(h8o)),
  `${heldNow?.[0]?.payment_status}; service: ${err(h8s) || "allowed"}; owner: ${err(h8o) || "allowed"}`);

// ─── H9: after the capture, the accept completes exactly as today ──────────
await owner(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${J.offer}' AND payment_status = 'held'`);
const h9 = await as("authenticated", HELPR, `SELECT public.accept_job_offer('${J.offer}') AS r`);
const h9row = await owner(`SELECT helper_confirmed_at IS NOT NULL AS confirmed FROM public.jobs WHERE id = '${J.offer}'`);
check("H9 [keep] after the capture (held -> escrow) the accept completes as today",
  Array.isArray(h9) && h9[0]?.r?.state === "accepted" && h9row?.[0]?.confirmed === true, err(h9) || JSON.stringify(h9?.[0]));

// ─── H10 / H11: the direct-offer door ──────────────────────────────────────
const h10a = await as("authenticated", HELPR, `SELECT public.respond_to_direct_offer('${J.direct}', true) AS r`);
const h10b = await as("authenticated", UNREADY, `SELECT public.respond_to_direct_offer('${J.directU}', true) AS r`);
check("H10 [fix] respond_to_direct_offer on a held job: ready -> payment_not_captured, unready -> pending_setup",
  /payment_not_captured/.test(err(h10a)) && Array.isArray(h10b) && h10b[0]?.r?.action === "pending_setup",
  `ready: ${err(h10a) || JSON.stringify(h10a?.[0])}; unready: ${err(h10b) || JSON.stringify(h10b?.[0])}`);
const h11 = await owner(`SELECT public.complete_direct_offer_accept('${J.direct}', '${HELPR}') AS r`);
const h11row = await owner(`SELECT helper_id, helper_confirmed_at FROM public.jobs WHERE id = '${J.direct}'`);
check("H11 [keep] complete_direct_offer_accept on a held job completes nothing (the deferred completion path)",
  Array.isArray(h11) && h11[0].r === null && h11row?.[0]?.helper_id == null && h11row?.[0]?.helper_confirmed_at == null,
  err(h11) || JSON.stringify({ r: h11?.[0]?.r, row: h11row?.[0] }));

// ─── H12 / H13: crews ──────────────────────────────────────────────────────
const seat = await as("authenticated", POSTER, `INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${J.crew}', '${MEMBER}') RETURNING id`);
const confirm = await as("authenticated", MEMBER, `SELECT public.rpc_group_member_confirm('${J.crew}') AS r`);
check("H12 [fix] crew: the seat offer on a held job passes; a ready member's Confirm is payment_not_captured",
  Array.isArray(seat) && seat.length === 1 && /payment_not_captured/.test(err(confirm)),
  `seat: ${err(seat) || "ok"}; confirm: ${err(confirm) || JSON.stringify(confirm?.[0])}`);
const h13 = await owner(`UPDATE public.group_job_helpers SET helper_confirmed_at = now() WHERE job_id = '${J.crew}' RETURNING id`);
check("H13 [fix] crew: no role can confirm a seat on a held job", /payment_not_captured/.test(err(h13)), err(h13) || "allowed");

// ─── H15: the switch and the poster's read ─────────────────────────────────
const sw = await owner(`SELECT audience FROM public.feature_switches WHERE key = 'card_hold_at_post'`);
const ordinary = await as("authenticated", POSTER, `SELECT * FROM public.get_my_job_card_hold('${J.held}')`);
if (!SKIP) await owner(`INSERT INTO public.job_card_holds (job_id, stripe_mode, payment_intent_id, state, amount_cents) VALUES ('${J.mine}', 'test', 'pi_test_hold', 'authorized', 4200) ON CONFLICT DO NOTHING`);
const tester = await as("authenticated", TESTER_POSTER, `SELECT * FROM public.get_my_job_card_hold('${J.mine}')`);
const testerOther = await as("authenticated", TESTER_POSTER, `SELECT * FROM public.get_my_job_card_hold('${J.held}')`);
check("H15 [fix] switch card_hold_at_post is 'testers'; get_my_job_card_hold refuses an ordinary account and answers only a tester's own job",
  sw?.[0]?.audience === "testers" && /feature_disabled/.test(err(ordinary)) && Array.isArray(tester) && tester[0]?.amount_cents === 4200
    && Array.isArray(testerOther) && testerOther.length === 0,
  `switch ${sw?.[0]?.audience ?? "missing"}; ordinary: ${err(ordinary) || "answered"}; tester: ${err(tester) || JSON.stringify(tester?.[0])}; other job rows ${Array.isArray(testerOther) ? testerOther.length : err(testerOther)}`);

// ─── H16: the holds table ──────────────────────────────────────────────────
const priv = await owner(`SELECT has_table_privilege('authenticated', 'public.job_card_holds', 'SELECT') AS a, has_table_privilege('anon', 'public.job_card_holds', 'SELECT') AS b`);
const noPi = await owner(`INSERT INTO public.job_card_holds (job_id, stripe_mode, state, amount_cents) VALUES ('${J.held}', 'test', 'authorized', 100)`);
check("H16 [fix] job_card_holds: no client privilege; an 'authorized' row without a PaymentIntent is refused",
  Array.isArray(priv) && priv[0].a === false && priv[0].b === false && /job_card_holds_authorized_has_intent/.test(err(noPi)),
  err(priv) || `${JSON.stringify(priv[0])}; ${err(noPi) || "accepted"}`);

console.log(`\n${pass} passed, ${fail} failed${SKIP ? " (NEW_MIGRATION=skip: today's code)" : " (migration applied 3x)"}`);
process.exit(fail === 0 ? 0 : 1);
