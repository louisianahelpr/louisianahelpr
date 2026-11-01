#!/usr/bin/env node
/**
 * PGlite proof for Q140 (docs/OPEN.md): scripts/ci/null-arg-validators.sql, the
 * class check db-smoke runs on every replay, run here against the NEWEST
 * migration definition of every `allow` function it probes.
 *
 *   node src/test/pglite/nullArgNeverAllows.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/nullArgNeverAllows.pglite.mjs   # RED: pre-fix definitions
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: the tables and columns those functions read (shapes as live,
 * 2026-09-23), the 17 `allow` functions and the 4 helpers they call taken
 * VERBATIM from their newest definition in supabase/migrations (any dollar-quote
 * tag), and a stub of the right arity/volatility for every other classified
 * boolean function (the inventory half of the check needs them to exist).
 * 20260923123701 is then applied 3x (replay-safe), and the class check must
 * print zero rows. With NEW_MIGRATION=skip the newest definitions are the
 * pre-fix ones and the check must name all five offenders.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const ROOT = new URL("../../../", import.meta.url).pathname;
const FIX = "20260923123701_null_argument_never_allows.sql";
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the pre-fix definitions (expect FAILs)`);

const migFiles = readdirSync(`${ROOT}supabase/migrations`).filter((f) => f.endsWith(".sql")).sort()
  // Skip mode drops the fix AND everything after it: a later migration (Q141,
  // 20260923130457) restates helper_credential_document_ok with the fix in it.
  .filter((f) => !(MODE && f >= FIX));
const migText = new Map(migFiles.map((f) => [f, readFileSync(`${ROOT}supabase/migrations/${f}`, "utf8")]));

/** The newest `CREATE [OR REPLACE] FUNCTION public.<name>(` statement, verbatim, any dollar tag. */
function newest(name) {
  let found = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  for (const f of migFiles) {
    const sql = migText.get(f);
    for (const m of sql.matchAll(head)) {
      // Skip a match inside a -- comment line.
      const lineStart = sql.lastIndexOf("\n", m.index) + 1;
      if (/--/.test(sql.slice(lineStart, m.index))) continue;
      const rest = sql.slice(m.index);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
      if (!tag) continue;
      const open = tag.index + tag[0].length;
      const close = rest.indexOf(tag[1], open);
      found = { file: f, sql: rest.slice(0, close + tag[1].length) + ";" };
    }
  }
  if (!found) throw new Error(`no migration defines public.${name}`);
  return found;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
-- email_confirmed_at: the class SQL's fixture inserts it (a newer classified
-- function reads it); without it the fixture raised FIXTURE_FAILED (Q1243).
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
-- Supabase's auth.uid(): the sub claim, from either GUC.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
-- Supabase's auth.role(): the role claim, from either GUC (read by is_server_context, Q1784).
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.job_category AS ENUM ('cleaning', 'other');
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE,
  -- A3-8 / A2-18 (20261028210552): declutter_delivery_tip_open reads the Helpr's payout account; the 'tip' step sets it.
  stripe_account_id text,
  subscription_tier text, subscription_expires_at timestamptz, ban_status text, auto_suspended_until timestamptz,
  is_seed boolean DEFAULT false,
  -- is_identity_verified (20261019051407) reads the two identity verdict columns.
  idv_status text, stripe_identity_verified boolean DEFAULT false,
  -- Q1803 (20261022002144): the newest is_caller_banned also refuses an under-13 block.
  under_13_blocked_at timestamptz);
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL,
  UNIQUE (user_id, role));
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text NOT NULL,
  category public.job_category NOT NULL DEFAULT 'other', budget numeric NOT NULL, location text, parish text, date_needed date NOT NULL,
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  status text NOT NULL DEFAULT 'open', payment_status text DEFAULT 'unpaid',
  poster_completed_at timestamptz, helper_completed_at timestamptz, revision_completed_at timestamptz, completed_at timestamptz,
  cancelled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  has_active_dispute boolean NOT NULL DEFAULT false, dispute_resolved_at timestamptz, disputed_by uuid, disputed_at timestamptz,
  -- The CI fixture inserts start_time (jobs.start_time is NOT NULL on prod since Q-start-time).
  is_seed boolean DEFAULT false, credential_tier integer NOT NULL DEFAULT 0, recurring_helper_id uuid, start_time time,
  -- job_announceable_to (20260927015010) reads p_job.parent_job_id (a vacated series visit).
  parent_job_id uuid);
-- job_announceable_to (Q392) reads the credential tier; its own gate is not under test here.
CREATE FUNCTION public.get_user_credential_tier(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
-- are_users_blocked (20260926034721) calls is_server_context(), a noarg; stubbed before it loads.
-- The real rule (20260915101102) with no role claims set, as here: a server
-- context is one with no end-user uid. has_role (20261012184600) reads it, so
-- an always-false stub made its baseline (and two callers') read false.
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NULL $$;
-- is_series_party (recurring split days) reads these two.
CREATE TABLE public.series_visit_holds (parent_job_id uuid, visit_date date, helper_id uuid);
CREATE TABLE public.series_date_offers (parent_job_id uuid, helper_id uuid);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, helper_id uuid NOT NULL,
  status text DEFAULT 'pending', UNIQUE (job_id, helper_id));
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
-- payout_setup_hire_allowed (20261025162003) reads these money rows by helper_id.
CREATE TABLE public.job_accept_pending (job_id uuid PRIMARY KEY, helper_id uuid NOT NULL);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid);
CREATE TABLE public.cancellation_fee_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid);
CREATE TABLE public.crew_cancellation_fee_shares (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid);
CREATE TABLE public.crew_block_fees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid);
CREATE TABLE public.job_detail_change_requests (id uuid PRIMARY KEY, job_id uuid, requested_by uuid, changed_fields text[], expires_at timestamptz);
CREATE TABLE public.job_detail_change_answers (request_id uuid, helper_id uuid, answer text DEFAULT 'pending');
-- is_system: can_send_message_to_in_job counts only the caller's own messages (Q1169, 20261004001242).
CREATE TABLE public.messages (job_id uuid, sender_id uuid, receiver_id uuid, created_at timestamptz DEFAULT now(), is_system boolean NOT NULL DEFAULT false);
CREATE TABLE public.reviews (job_id uuid, reviewer_id uuid);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
-- Rentals S1 (20261017205605): rentals_caller_is_active_tenant_of reads rental_tenancies; the class SQL's
-- fixture inserts a property, a unit and an active tenancy (the columns it writes).
CREATE TABLE public.rental_properties (id uuid PRIMARY KEY, owner_id uuid, label text, street_address text, city text,
  zip_code text, ownership_status text);
CREATE TABLE public.rental_units (id uuid PRIMARY KEY, property_id uuid, owner_id uuid, label text);
CREATE TABLE public.rental_tenancies (id uuid PRIMARY KEY, unit_id uuid, property_id uuid, landlord_id uuid, tenant_id uuid,
  status text, invite_token_sha256 text, invite_expires_at timestamptz, accepted_at timestamptz);
-- Homes listings (20261019043000): rentals_listing_visible reads rental_listings (+ rental_properties, profiles);
-- the class SQL's fixture inserts one live listing (the columns it writes).
CREATE TABLE public.rental_listings (id uuid PRIMARY KEY, unit_id uuid, property_id uuid, owner_id uuid, status text,
  headline text, rent_cents integer, beds numeric, baths numeric, available_on date, published_at timestamptz, expires_at timestamptz,
  kind text NOT NULL DEFAULT 'rent', removed_by_admin boolean NOT NULL DEFAULT false);
-- Homes photos (20261019071203): the delete check reads the photo rows.
CREATE TABLE public.rental_listing_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid, owner_id uuid, storage_path text, position integer);
-- Homes Buy (20261019061241): rentals_listing_visible reads the sale-listing fee for a sale listing.
CREATE TABLE IF NOT EXISTS public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), homes_sale_listing_fee_cents integer);
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text NOT NULL, description text NOT NULL);
-- 20261028151647: the newest feature_enabled_for_user (a loaded allow function) also lets a switch's own members in.
CREATE TABLE public.feature_switch_members (key text NOT NULL, user_id uuid NOT NULL, note text, PRIMARY KEY (key, user_id));
-- job_announceable_to (newest body) also reads Q1401's cutoff (loaded verbatim as a HELPER below) and Q1411's ban
-- review queue (created below as live).
-- Declutter (20261015042253's two allow checks read the cart and the pickup windows; the class SQL's
-- 'declutter' fixture step inserts an item, a cart line and a window).
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid NOT NULL, status text, title text, category text,
  condition_stars smallint, delivery_size text, price_cents integer, current_price_cents integer, area_label text,
  area_lat numeric, area_lng numeric,
  -- The share card (Q2426, 20261027194426): declutter_item_link_visible reads the seller-hidden and test flags.
  seller_hidden boolean NOT NULL DEFAULT false, is_seed boolean NOT NULL DEFAULT false,
  -- The handover chat (Q2462, 20261028235249): declutter_pair_needs_talk reads the ways the seller ticked and porch_ok;
  -- the class SQL's 'declutter' step offers item I by safe meeting spot only.
  porch_ok boolean NOT NULL DEFAULT true, handovers text[]);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL, buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL, price_cents integer, source text, status text NOT NULL DEFAULT 'in_cart', checkout_by timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, status text, buyer_id uuid, seller_id uuid,
  -- slice 5 (20261017055505): declutter_delivery_slot_ok reads the handover and the paid time; the class SQL's
  -- 'delivery' fixture step writes a paid delivery order with its amounts.
  handover text, paid_at timestamptz, items_cents integer, premium_cents integer, tax_cents integer, delivery_cents integer,
  total_cents integer, stripe_payment_intent_id text,
  -- Board 141 (20261026155251): the sale-final / window checks read the handover time; the 'handed_over' step writes them.
  handed_over_at timestamptz, closed_at timestamptz, close_reason text,
  -- The Free section (20261027170717): the newest window / final checks read how the order was paid.
  paid_with text,
  -- Shipping S2 (20261030000030): the class SQL's 'ship' step writes a shipped order; shipping_rate_buyable reads it.
  fee_rule text, shipping_cents integer NOT NULL DEFAULT 0);
-- LEAD-LIST-FOR-SELLER (20261101034159): the link sell_for_me_listings_sent reads; the class SQL's 'list_for_seller' step writes it.
CREATE TABLE public.declutter_listed_for_seller (item_id uuid PRIMARY KEY, job_id uuid NOT NULL, helpr_id uuid NOT NULL,
  seller_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, decided_at timestamptz);
-- Shipping S2 (20261030000030): the label claim shipping_rate_buyable reads, with the columns the 'ship' step writes.
CREATE TABLE public.shipments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), declutter_order_id uuid, idempotency_key text,
  label_mode text, service text, quoted_cents integer, ship_to jsonb, parcel jsonb, label_state text NOT NULL DEFAULT 'claimed');
-- Board 141 (20261026155251): what declutter_payout_unsent / declutter_sale_decided / declutter_sale_final read, with
-- the columns the class SQL's 'handed_over' fixture step writes.
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE, seller_id uuid,
  items_cents integer, debt_cents integer, amount_cents integer, status text, stripe_transfer_id text, attempts integer NOT NULL DEFAULT 0);
CREATE TABLE public.payout_send_marks (payout_kind text, payout_id uuid);
-- 20261031204932: the newest declutter_payout_unsent also reads an admin's manual release from the audit log.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text,
  target_id text, target_type text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_handovers (order_id uuid PRIMARY KEY, confirmed_by text, set_out_photo_path text, picked_up_photo_path text);
CREATE TABLE public.declutter_refund_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE, status text,
  declined_at timestamptz);
-- The 'delivery' fixture step runs only once this table exists (to_regclass), as on a database with 20261017055505.
CREATE TABLE public.declutter_order_deliveries (order_id uuid PRIMARY KEY, task_id uuid,
  -- A3-8 / A2-18: the columns the class SQL's 'tip' step writes.
  dropoff_address text, dropoff_area text, dropoff_lat numeric, dropoff_lng numeric, road_miles integer, size text, delivery_cents integer);
-- Slice 5, Helpr delivery (20261017055505): the photo access, vehicle and task checks read these.
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, helpr_id uuid, customer_id uuid,
  pickup_contact_id uuid, source_kind text, source_id uuid,
  -- Q1929 (20261021185418): declutter_delivery_raise_open reads the task's window end.
  open_until timestamptz,
  -- b83 (20261031134217): helpr_task_source_held reads the seller no-show report's clock.
  seller_no_show_reported_at timestamptz, seller_no_show_answered_at timestamptz, seller_no_show_settled_at timestamptz,
  -- A3-8 / A2-18 (20261028210552): the columns the class SQL's 'tip' step writes.
  size text, title text, pickup_area text, dropoff_area text, pickup_address text, pickup_lat numeric, pickup_lng numeric,
  dropoff_address text, dropoff_lat numeric, dropoff_lng numeric, trip_miles integer, pay_cents integer, fee_cents integer,
  latest_pickup_at timestamptz, pickup_slot_start timestamptz, dropoff_code text, confirmed_at timestamptz, confirmed_by text);
-- A3-8 / A2-18: declutter_delivery_tip_open reads whether a Helpr with no payout account still has pay waiting.
CREATE TABLE public.helpr_task_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid UNIQUE, helpr_id uuid, status text);
-- Q1929: helpr_task_source_held (a deny helper the raise check calls) reads open problem reports.
CREATE TABLE public.declutter_problems (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, status text);
CREATE TABLE public.helpr_vehicles (user_id uuid PRIMARY KEY, has_truck boolean NOT NULL DEFAULT false,
  second_person boolean NOT NULL DEFAULT false, photo_path text,
  -- Q2452 (20261028012406): helpr_task_vehicle_fits reads has_car; the class SQL's 'delivery' step writes it.
  has_car boolean NOT NULL DEFAULT false);
-- Q2450 Helpr Guarantee (20261027200455): job_messaging_closes_at (a HELPER) keeps the chat open while a request is
-- open and for 24 h after it closes, so its newest body reads the requests.
CREATE TABLE public.job_guarantee_claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text, closed_at timestamptz);
-- Q2425 (20261027204500): declutter_meetup_spot_near_lines reads the spot; the class SQL's 'meetup' step writes one.
CREATE TABLE public.declutter_meetup_spots (id uuid PRIMARY KEY, parish text, name text, address text, lat numeric, lng numeric,
  kind text, active boolean NOT NULL DEFAULT true);
CREATE TABLE public.declutter_pickup_windows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL,
  weekday smallint NOT NULL, starts_local time NOT NULL, ends_local time NOT NULL);
CREATE TABLE public.declutter_seller_porch_days (seller_id uuid PRIMARY KEY, weekdays smallint[] NOT NULL);
-- Porch places (D-NEW14, 20261030164712): declutter_order_is_porch_day reads the place frozen on an order.
-- Place hours (20261031145652): declutter_order_slot_in_windows reads the frozen place's hours.
CREATE TABLE public.declutter_order_porch_places (order_id uuid PRIMARY KEY, weekdays smallint[] NOT NULL, windows jsonb);
INSERT INTO public.feature_switches VALUES ('switch_canary', 'testers', 'canary');
-- Declutter is on (as on prod): declutter_item_link_visible (Q2426) reads the switch.
INSERT INTO public.feature_switches VALUES ('declutter', 'testers', 'Declutter');
-- Q1784: read by the newest job_announceable_to (shape as live, 2026-10-14,
-- information_schema.columns: the two columns it reads plus the NOT NULL rest).
CREATE TABLE public.ban_settlement_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  matched_on text NOT NULL DEFAULT 'test', review_state text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(),
  deferred_rungs jsonb NOT NULL DEFAULT '[]'::jsonb);
-- Shops slice 1 (20261017061155): the columns the shop visibility helpers and
-- the class SQL's 'shop' fixture step touch; the strike count is stubbed at 0
-- (its own table is not under test here).
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid NOT NULL UNIQUE, name text, category text, area_label text,
  pin_lat numeric, pin_lng numeric, hidden_at timestamptz, is_seed boolean NOT NULL DEFAULT false,
  -- SH2b (20261019042744): shop_link_visible also reads paused.
  paused boolean NOT NULL DEFAULT false);
CREATE FUNCTION public.declutter_active_strike_count(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
-- Shops M1 (20261018164444) reads the shop's own strike count instead; stubbed at 0 the same way.
CREATE FUNCTION public.shop_active_strike_count(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
-- Shops M1/M2: the columns shop_handover_photo_access (20261018211820) reads; no order row (an admin reads without one).
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text NOT NULL, captured_at timestamptz);
-- 20261027163240 (payout setup only when owed): payout_setup_hire_allowed also reads a shop's payouts.
CREATE TABLE public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid);
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text);
CREATE TABLE storage.objects (id bigserial PRIMARY KEY, bucket_id text, name text, owner uuid, created_at timestamptz DEFAULT now(), UNIQUE (bucket_id, name));
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;
`);

// Real definitions: every allow function (21 on 2026-09-26) plus the helpers they call.
const ALLOW = ["can_message_in_job", "can_review_job", "can_send_message_in_job", "can_send_message_to_in_job",
  "check_dispute_velocity", "credential_document_path_ok", "dispute_evidence_url_ok", "has_role",
  "helper_credential_document_ok", "identity_is_verified", "is_party_to_job",
  "is_party_to_job_folder", "job_announceable_to", "job_is_funded", "job_payment_is_funded", "user_has_pending_application",
  "user_may_see_job_address", "is_crew_member_of_job_folder", "is_series_party", "can_read_job_access_notes",
  "can_read_job_detail_change", "feature_enabled_for_user", "feature_enabled_for",
  // After feature_enabled_for_user: since 20261017085012 (Q1844) its SQL body calls it, and a SQL body is validated at CREATE.
  "helper_has_advanced_analytics",
  "declutter_in_agreed_sale", "declutter_slot_in_windows", "declutter_handover_photo_access", "shop_handover_photo_access",
  // Declutter slice 5 (20261017055505).
  "declutter_delivery_slot_ok", "helpr_task_photo_access", "helpr_task_photo_ok", "handover_photo_is_fresh", "declutter_return_photo_ok", "helpr_task_same_stripe_mode",
  "helpr_task_source_slot_ok", "helpr_task_vehicle_fits",
  // Declutter delivery-pay raise (Q1929, 20261021185418).
  "declutter_delivery_raise_open",
  // Board 141, Declutter side (20261026155251); payout_unsent before problem_window_open, which calls it.
  "declutter_payout_unsent", "declutter_problem_window_open", "declutter_sale_final",
  // Safe meetup spots (Q2425, 20261027204500).
  "declutter_meetup_spot_near_lines",
  // Handover chat (Q2462, 20261028235249).
  "declutter_pair_needs_talk",
  // Shops slice 1 (20261017061155).
  "shop_owner_in_good_standing", "shop_publicly_visible", "shop_visible_to",
  // SH2b public shop page (20261019042744).
  "shop_state_ok", "shop_link_visible",
  // SH12 shop FAQs/policies (20261019072541); after has_role and shop_link_visible, which it calls.
  "shop_extras_readable",
  // Rentals S1 (20261017205605).
  "rentals_caller_is_active_tenant_of",
  // Rentals identity either verdict (20261019051407); after identity_is_verified, which its SQL body calls.
  "is_identity_verified",
  // Homes listings (20261019043000); after is_identity_verified, which its newest SQL body calls (20261019061241).
  "rentals_listing_visible",
  // Homes public link (20261019062540) and listing photo storage checks (20261019071203).
  "rentals_public_listing_visible", "rentals_listing_photo_access", "rentals_listing_photo_deletable",
  // Homes rent tracker read policies (20261019073106).
  "rentals_tenancy_party",
  // Payout setup only after a hire (20261025162003); after feature_enabled_for_user and job_payment_is_funded, which its SQL body calls.
  "payout_setup_hire_allowed", "referral_member_has_completed_job",
  // Card hold at post (Q2399, 20261027185146): listed = funded or the card held; job_is_funded's SQL body calls it.
  "job_payment_is_listed",
  // Declutter share card (Q2426), 2026-10-27.
  "declutter_item_link_visible",
  // A3-8 / A2-18 (20261028210552): the tip line's check; after are_users_blocked (a HELPER), which its SQL body calls.
  "declutter_delivery_tip_open",
  // Porch days (20261029161347): the one porch-weekday rule.
  "declutter_is_porch_day",
  // Audit 1a #10 (20261029222816): may the uploader delete this unattached handover photo.
  "declutter_handover_photo_unattached",
  // Shipping S2 (20261030000030): may the label worker buy this rate.
  "shipping_rate_buyable",
  // Porch places (D-NEW14, 20261030164712): after declutter_is_porch_day, which its SQL body calls.
  "declutter_order_is_porch_day",
  // Place hours (20261031145652): the order's frozen place hours, else declutter_slot_in_windows (loaded FIRST).
  "declutter_order_slot_in_windows",
  // LEAD-LIST-FOR-SELLER (20261101034159): may a Have a Helpr list it job be marked done (a listing was sent).
  "sell_for_me_listings_sent"];
// Loaded after the stubs below: their SQL bodies call seed_jobs_hidden_publicly(), a stubbed noarg
// (shop_visible_to calls shop_publicly_visible, which calls shop_state_ok, as does shop_link_visible:
// each comes after its callee).
// declutter_item_link_visible (Q2426) calls seed_hidden_in_discovery(), a stubbed noarg, so it loads after the stubs too.
const AFTER_STUBS = ["job_announceable_to", "shop_state_ok", "shop_publicly_visible", "shop_link_visible", "shop_visible_to", "shop_extras_readable",
  "declutter_item_link_visible"];
// job_offer_cutoff (Q1784): called by the newest allow bodies; loaded verbatim
// like the rest (SQL bodies are validated at CREATE, so it must exist first).
const HELPERS = ["job_offer_cutoff", "job_legacy_completed_at", "job_messaging_closes_at", "is_caller_banned", "are_users_blocked", "is_off_job",
  // Q1929: declutter_delivery_raise_open's SQL body calls it (validated at CREATE).
  "helpr_task_source_held",
  // Board 141: a deny helper the window and final checks call (validated at CREATE).
  "declutter_sale_decided",
  // Q2425: declutter_meetup_spot_near_lines' SQL body calls both (validated at CREATE).
  "declutter_miles_between", "declutter_meetup_rules",
  // Q2462: declutter_pair_needs_talk's SQL body calls it (validated at CREATE).
  "declutter_pair_shared_ways"];
// Load order: a SQL body is validated at CREATE, so a callee comes first.
// declutter_order_slot_in_windows (20261031145652): declutter_delivery_slot_ok's SQL body calls it.
// BUY-43 (20261101051951): declutter_delivery_tip_open's SQL body calls payout_waits_on_identity, whose SQL body calls
// feature_enabled_for_user (after has_role, which it calls), identity_check_exempt (which calls feature_enabled_for_user) and identity_is_verified,
// so those load before it.
const FIRST = ["job_payment_is_funded", "job_payment_is_listed", "declutter_order_slot_in_windows",
  "has_role", "feature_enabled_for_user", "identity_check_exempt", "identity_is_verified", "payout_waits_on_identity"];
const ORDER = [...HELPERS, ...FIRST, ...ALLOW.filter((f) => !FIRST.includes(f) && !AFTER_STUBS.includes(f))];
const loaded = [];
// Skip mode loads the newest definition that exists BEFORE the fix. A function
// first defined after it (is_off_job, 20260925230845, which today's
// can_message_in_job calls) has no such definition and none of the pre-fix
// bodies calls it, so it is left out and stubbed with the rest (Q1243).
const absentBeforeFix = new Set();
if (MODE)
  for (const name of [...ORDER, ...AFTER_STUBS]) {
    try {
      newest(name);
    } catch {
      absentBeforeFix.add(name); // no definition before the fix: stubbed below
    }
  }
// Q1784: the newest has_role / user_may_see_job_address / feature_enabled_for_user
// allow a caller with no uid only in a server context (20261012184600). db-smoke
// runs the check as postgres, where the REAL is_server_context() is true; the
// `SELECT false` stub made every baseline call false here (BASELINE_NOT_TRUE).
// Replace the stub with its newest definition, verbatim, before anything uses it.
{
  const def = newest("is_server_context");
  await db.exec(def.sql);
  loaded.push(`is_server_context@${def.file.slice(0, 14)}`);
}
for (const name of ORDER) {
  if (absentBeforeFix.has(name)) continue;
  const def = newest(name);
  await db.exec(def.sql);
  loaded.push(`${name}@${def.file.slice(0, 14)}`);
}
console.log(`loaded newest definitions: ${loaded.join(" ")}`);
if (absentBeforeFix.size) console.log(`not defined before the fix (stubbed): ${[...absentBeforeFix].join(" ")}`);

// Stubs for the rest of the classified inventory (right arity + volatility).
const sqlFile = readFileSync(`${ROOT}scripts/ci/null-arg-validators.sql`, "utf8");
const classRows = [...sqlFile.matchAll(/^\s*\('([a-z_0-9]+)',\s*'(allow|absent|deny|classify|noarg|action)',/gm)].map((m) => ({ fn: m[1], kind: m[2] }));
// The count comes from the SQL itself (Q1243): a hand-kept constant here went
// stale four times (55, 61, 66, 67; the file had 70 on 2026-10-04). Every row
// of the q140_class VALUES block must parse, and there must be a real list.
const classBlock = sqlFile.slice(sqlFile.indexOf("INSERT INTO q140_class"), sqlFile.indexOf("INSERT INTO q140_case"));
const declared = (classBlock.match(/^\s*\('/gm) ?? []).length;
check(`the class list parses (${declared} entries in the SQL)`, declared > 60 && classRows.length === declared, `${classRows.length} parsed`);
const real = new Set([...ALLOW, ...HELPERS, "is_server_context"].filter((f) => !absentBeforeFix.has(f)));
for (const { fn, kind } of classRows) {
  if (real.has(fn)) continue;
  const args = kind === "noarg" ? "" : "x text";
  const vol = kind === "action" ? "VOLATILE" : "STABLE";
  await db.exec(`CREATE FUNCTION public.${fn}(${args}) RETURNS boolean LANGUAGE sql ${vol} AS $$ SELECT false $$;`);
}
for (const name of AFTER_STUBS) {
  if (absentBeforeFix.has(name)) continue;
  const def = newest(name);
  await db.exec(def.sql);
  console.log(`loaded newest definition after stubs: ${name}@${def.file.slice(0, 14)}`);
}

if (!MODE) {
  const fix = readFileSync(`${ROOT}supabase/migrations/${FIX}`, "utf8");
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(fix); check(`20260923123701 applies (pass ${i}/3)`, true); }
    catch (e) { check(`20260923123701 applies (pass ${i}/3)`, false, e.message); }
  }
  // The fix restates functions a LATER migration restated again (identity_is_verified, 20261021081258): on a real
  // replay the later one wins, so reload each newer definition after the replays (else the twin probes the
  // September body and reports a NULL-allows the live function does not have).
  for (const m of fix.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi)) {
    const def = newest(m[1]);
    if (def.file > FIX) { await db.exec(def.sql); console.log(`reloaded the newer definition after the fix: ${m[1]}@${def.file.slice(0, 14)}`); }
  }
}

// The class check, as db-smoke runs it (psql meta-commands dropped).
const runCheck = async () => {
  const res = await db.exec(sqlFile.split("\n").filter((l) => !l.startsWith("\\")).join("\n"));
  const rows = res.find((r) => r.fields?.length === 1 && r.rows.length >= 0 && r.fields[0].name === "?column?");
  return rows ? rows.rows.map((r) => r["?column?"]) : null;
};
const out = await runCheck();
check("the class check ran and returned its result set", out !== null);
for (const line of out ?? []) console.log(`      ${line}`);
check("class check is clean: zero rows", (out ?? ["?"]).length === 0, `${(out ?? []).length} rows`);

// Each of the five named offenders, by name, so the red run says which one.
for (const [fn, arg] of [["helper_credential_document_ok", 2], ["credential_document_path_ok", 2],
  ["check_dispute_velocity", 1], ["identity_is_verified", 1], ["job_is_funded", 1]]) {
  const hit = (out ?? []).find((l) => l.startsWith(`${fn}|NULL_ARG_ALLOWS|argument ${arg} `));
  check(`${fn}: argument ${arg} NULL returns false`, !hit, hit ?? "");
}

// Fail-closed self-tests of the check itself (each on a scratch copy of the state).
const plant = async (name, sql, expect) => {
  await db.exec("BEGIN;");
  await db.exec(sql);
  const o = await runCheck();
  await db.exec("ROLLBACK;");
  const hit = (o ?? []).some((l) => l.includes(expect));
  check(`self-test: ${name} -> ${expect}`, hit, (o ?? []).join(" ; "));
};
if (!MODE) {
  await plant("an unclassified boolean function", "CREATE FUNCTION public.q140_new_ok(x uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;", "q140_new_ok|UNCLASSIFIED");
  await plant("a classified function that is gone", "DROP FUNCTION public.is_seed_email(text);", "is_seed_email|STALE");
  await plant("a NULL-true allow function", "CREATE OR REPLACE FUNCTION public.job_payment_is_funded(p_payment_status text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT p_payment_status IS NULL OR p_payment_status = 'escrow' $$;", "job_payment_is_funded|NULL_ARG_ALLOWS");
  await plant("a NULL-NULL allow function", "CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT CASE WHEN _user_id IS NULL THEN NULL ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) END $$;", "has_role|NULL_ARG_ALLOWS");
  await plant("a baseline that is not true", "CREATE OR REPLACE FUNCTION public.is_party_to_job(_job_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;", "is_party_to_job|BASELINE_NOT_TRUE");
  await plant("a volatile check classified allow", "ALTER FUNCTION public.has_role(uuid, public.app_role) VOLATILE;", "has_role|WRONG_KIND");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
