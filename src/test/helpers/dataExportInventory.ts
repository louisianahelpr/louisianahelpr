// Q290: what "Download My Data" must contain, and what it may leave out.
//
// Every public column that references a person is in exactly one of two
// places below:
//   - EXPORTED[table].by: export_my_data() returns the rows where that column
//     is the caller (auth.uid(), or the caller's own auth email);
//   - EXEMPT["table.column"]: a reason it is not a key the export scopes by.
// src/test/dataExportCoversEveryUserTable.test.ts derives the user columns from
// the schema itself (generated types + the migrations' foreign keys) and fails
// on a column in neither list AND on an entry that no longer names one.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./blankNonCode";
import { readdirSync } from "./trackedFiles";

const REPO = resolve(__dirname, "../../..");

/**
 * Column names that mean "a person". Matched against every column of every
 * public table in the generated types. Names that match but are not a person
 * (a deadline called `*_due_by`) are EXEMPT entries saying so; a person column
 * with a name this misses is still caught when a migration gives it a foreign
 * key to auth.users or profiles (fkUserColumns).
 */
const USER_COLUMN_RE =
  /^(?:user_id|\w+_user_id|customer_id|helper_id|\w+_helper_id|reviewer_id|reviewee_id|sender_id|receiver_id|recipient_id|donor_id|tipper_id|payer_id|opener_id|owner_id|reporter_id|reported_id|blocker_id|blocked_id|referrer_id|referred_id|admin_id|applicant_id|viewer_id|searcher_id|\w+_by|email|\w+_email|email_sha256|assigned_to)$/;

/** table → columns, from the `public.Tables` block of the generated types only (views excluded). */
export function publicTables(): Map<string, Set<string>> {
  const src = readFileSync(join(REPO, "src/integrations/supabase/types.ts"), "utf8");
  const pub = src.slice(src.indexOf("\n  public: {"));
  const tables = pub.slice(pub.indexOf("Tables: {"), pub.indexOf("Views: {"));
  const out = new Map<string, Set<string>>();
  for (const m of tables.matchAll(/\n {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)) {
    out.set(m[1], new Set([...("\n" + m[2]).matchAll(/\n {10}([a-z0-9_]+)\??:/g)].map((c) => c[1])));
  }
  return out;
}

/** "table.column" for every column a migration declares as a foreign key to auth.users or public.profiles. */
function fkUserColumns(): Set<string> {
  const dir = join(REPO, "supabase/migrations");
  const out = new Set<string>();
  const target = String.raw`references\s+(?:auth\.users|(?:public\.)?profiles)\b`;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    for (const st of sql.split(";")) {
      const t =
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/i.exec(st) ??
        /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/i.exec(st);
      if (!t) continue;
      for (const m of st.matchAll(new RegExp(String.raw`(?:^|[,(\s])"?(\w+)"?\s+uuid\b[^,]*?` + target, "gi"))) out.add(`${t[1]}.${m[1]}`);
      for (const m of st.matchAll(new RegExp(String.raw`foreign\s+key\s*\(\s*"?(\w+)"?\s*\)\s*` + target, "gi"))) out.add(`${t[1]}.${m[1]}`);
    }
  }
  return out;
}

/** Every live "table.column" that references a person: by name, or by foreign key. */
export function userKeyedColumns(tables = publicTables()): Set<string> {
  const out = new Set<string>();
  for (const [t, cols] of tables) for (const c of cols) if (USER_COLUMN_RE.test(c)) out.add(`${t}.${c}`);
  for (const key of fkUserColumns()) {
    const [t, c] = key.split(".");
    if (tables.get(t)?.has(c)) out.add(key);
  }
  return out;
}

/**
 * table → the export section it becomes and the person columns it is scoped by.
 * The section name is the table name except `profiles` → `profile` (one row).
 */
export const EXPORTED: Record<string, { section?: string; by: string[] }> = {
  profiles: { section: "profile", by: ["user_id"] },
  jobs: { by: ["customer_id", "helper_id", "recurring_helper_id", "offered_to_helper_id", "cancelled_by", "disputed_by"] },
  applications: { by: ["helper_id"] },
  reviews: { by: ["reviewer_id", "reviewee_id"] },
  messages: { by: ["sender_id", "receiver_id"] },
  message_reactions: { by: ["user_id"] },
  notifications: { by: ["user_id"] },
  notification_preferences: { by: ["user_id"] },
  notification_logs: { by: ["user_id", "recipient_email"] },
  notification_dedupe_suppressions: { by: ["user_id"] },
  push_tokens: { by: ["user_id"] },
  push_subscriptions: { by: ["user_id"] },
  saved_jobs: { by: ["user_id"] },
  saved_searches: { by: ["user_id"] },
  saved_search_alert_queue: { by: ["user_id"] },
  job_match_queue: { by: ["user_id"] },
  match_digest_queue: { by: ["user_id"] },
  parish_match_alert_queue: { by: ["user_id"] },
  favorite_helpers: { by: ["customer_id"] },
  helper_availability: { by: ["helper_id"] },
  helper_credentials: { by: ["user_id"] },
  helper_verifications: { by: ["user_id"] },
  verification_checks: { by: ["user_id"] },
  helper_w9_records: { by: ["helper_id"] },
  instant_payouts: { by: ["helper_id"] },
  payout_transfers: { by: ["helper_id"] },
  payout_failures: { by: ["user_id"] },
  refund_requests: { by: ["requester_id", "responder_id", "answered_by"] },
  // SMS alerts (20261021193738): the member's text consent, its events, and every text considered for them.
  sms_consent: { by: ["user_id"] },
  sms_consent_events: { by: ["user_id"] },
  sms_messages: { by: ["user_id"] },
  crew_cancellation_fee_shares: { by: ["helper_id"] },
  // Q1390: the member's block fee (owed when a poster blocked them close to the start).
  crew_block_fees: { by: ["helper_id"] },
  cancellation_fee_transfers: { by: ["helper_id"] },
  payment_refunds: { by: ["customer_id"] },
  chargeback_clawbacks: { by: ["helper_id"] },
  tips: { by: ["tipper_id", "helper_id"] },
  // Q1297: the Helpr's own tip re-pay ledger (was EXEMPT until 20261005060801).
  tip_hold_redrives: { by: ["helper_id"] },
  gift_cards: { by: ["donor_id", "recipient_id", "recipient_email"] },
  referral_codes: { by: ["user_id"] },
  referral_credits: { by: ["user_id"] },
  referrals: { by: ["referrer_id", "referred_id"] },
  reports: { by: ["reporter_id"] },
  user_blocks: { by: ["blocker_id"] },
  user_bans: { by: ["user_id"] },
  user_violations: { by: ["user_id"] },
  user_roles: { by: ["user_id"] },
  // Declutter (20261014200728, build decision B9 in docs/specs/declutter-auctions.md).
  declutter_items: { by: ["seller_id"] },
  declutter_item_private: { by: ["seller_id"] },
  declutter_item_photos: { by: ["seller_id"] },
  declutter_pickup_windows: { by: ["seller_id"] },
  // Remembered listing choices (20261030144112; exported by 20261030153635): one row per seller.
  declutter_seller_defaults: { by: ["member_id"] },
  // Porch days (20261029161347; exported by 20261029223949): the seller's own picked porch weekdays.
  declutter_seller_porch_days: { by: ["seller_id"] },
  // A seller's own meet spots (20261101194608; exported by 20261101210500).
  declutter_meetup_spots: { by: ["seller_id"] },
  declutter_questions: { by: ["asker_id"] },
  declutter_watchlist: { by: ["user_id"] },
  declutter_tax_attestations: { by: ["seller_id"] },
  declutter_strikes: { by: ["user_id"] },
  // Wanted posts (20261016053541). declutter_wanted_matches has no person column.
  declutter_wanted: { by: ["user_id"] },
  // "Suggest a category" (20261015051141 + 20261015052622, I1).
  category_suggestions: { by: ["user_id"] },
  // Declutter slice 3 (20261014210518): both sides of a trade.
  declutter_offers: { by: ["buyer_id", "seller_id"] },
  declutter_orders: { by: ["buyer_id", "seller_id"] },
  declutter_cart_items: { by: ["buyer_id", "seller_id"] },
  declutter_buyer_cards: { by: ["user_id"] },
  // Declutter slice 3b (20261014224914): a seller's card-fee debts (row 60).
  declutter_seller_fee_debts: { by: ["seller_id"] },
  // Declutter slice 4 (20261015042253): bookings (either side), problems the member reported,
  // a seller's payouts, reviews written and (once visible, row 45) received.
  declutter_bookings: { by: ["buyer_id", "seller_id"] },
  declutter_problems: { by: ["reporter_id"] },
  declutter_payouts: { by: ["seller_id"] },
  declutter_reviews: { by: ["reviewer_id", "reviewee_id"] },
  // Declutter slice 5, Helpr delivery (20261017055505 + 20261017055506).
  helpr_vehicles: { by: ["user_id"] },
  helpr_tasks: { by: ["helpr_id", "released_helpr_id"] },
  helpr_task_events: { by: ["actor_id"] },
  helpr_task_payouts: { by: ["helpr_id"] },
  // Q2453 (20261028014848): tips on deliveries, the tipper's and the Helpr's.
  helpr_task_tips: { by: ["tipper_id", "helpr_id"] },
  declutter_delivery_dropoffs: { by: ["buyer_id"] },
  // Declutter seller delivery (20261027153244, exported by 20261027153245): the seller's setting,
  // windows, days off and per-item switch; each delivery either side is on (a seller's copy drops
  // the buyer's drop-off address and point).
  declutter_seller_delivery: { by: ["seller_id"] },
  declutter_delivery_windows: { by: ["seller_id"] },
  declutter_delivery_days_off: { by: ["seller_id"] },
  declutter_item_no_seller_delivery: { by: ["seller_id"] },
  declutter_seller_deliveries: { by: ["buyer_id", "seller_id"] },
  // Helpr Guarantee (20261027200455, exported by 20261027223332): each request either side is on.
  job_guarantee_claims: { by: ["poster_id", "helper_id"] },
  // Safe meetup spots (20261027204500, exported by 20261027233614, Q2451): the buyer's own pick per seller.
  declutter_meetup_choices: { by: ["buyer_id"] },
  // D-NEW14 porch places (20261030164712, exported by 20261030165438): the seller's own places; the buyer's own pick per seller.
  declutter_porch_places: { by: ["seller_id"] },
  declutter_porch_place_choices: { by: ["buyer_id"] },
  job_post_drafts: { by: ["user_id"] },
  // LEAD-EXPORT-SIGNUP-SOURCE (20261101022048): the member's own sign-up source words.
  member_signup_sources: { by: ["user_id"] },
  profile_handles_retired: { by: ["user_id"] },
  // CMP-4 instant book (20261101063725, 20261101065105; exported by 20261101140006): the Helpr's own floors and declines.
  instant_book_floors: { by: ["helper_id"] },
  instant_book_declines: { by: ["helper_id"] },
  // Bundle discounts (20261027211754, exported by 20261028003604): the seller's own setting.
  declutter_bundle_rules: { by: ["seller_id"] },
  // Q2462 (20261028235249, exported by 20261028235250): the handover talks, buyer or seller, and their messages.
  declutter_handover_talks: { by: ["buyer_id", "seller_id"] },
  declutter_handover_talk_messages: { by: ["sender_id"] },
  declutter_order_talk_messages: { by: ["sender_id"] },
  helpr_task_talk_messages: { by: ["sender_id"] },
  // The Free change (20261030064021, Q2487): asks for free items (asker or giver) and the 30-day pause.
  declutter_free_requests: { by: ["requester_id", "seller_id"] },
  declutter_free_pauses: { by: ["user_id"] },
  // Q1866 (20261030081455): quote requests (as poster) and quotes given (as quoter).
  job_quote_requests: { by: ["poster_id"] },
  job_quotes: { by: ["quoter_id"] },
  // Shops slice 1 (20261017061155) and the slice-two item tables (20261017061157), exported
  // by 20261017061157: the member's shop, photos, follows, items, item
  // photos, review state, confirmations, and the home-food year confirmations
  // and counted sales.
  shops: { by: ["owner_id"] },
  shop_photos: { by: ["owner_id"] },
  shop_follows: { by: ["user_id"] },
  shop_items: { by: ["owner_id"] },
  shop_item_private: { by: ["owner_id"] },
  shop_item_photos: { by: ["owner_id"] },
  shop_item_attestations: { by: ["owner_id"] },
  shop_cottage_confirmations: { by: ["owner_id"] },
  shop_cottage_sales: { by: ["owner_id"] },
  // Rentals S1 (20261017205605): landlord and tenant both get the shared rows.
  rental_properties: { by: ["owner_id"] },
  rental_units: { by: ["owner_id"] },
  rental_tenancies: { by: ["landlord_id", "tenant_id"] },
  maintenance_requests: { by: ["tenant_id", "landlord_id"] },
  maintenance_request_photos: { by: ["tenant_id"] },
  // Homes -> Rent listings (20261019043000), exported by 20261019043100.
  rental_listings: { by: ["owner_id"] },
  rental_listing_photos: { by: ["owner_id"] },
  // Shops M1 orders (20261018164442), exported by 20261018164443: as buyer or
  // as the shop; the lines go with their order (no person column of their own).
  shop_orders: { by: ["buyer_id", "seller_id"] },
  // No person column: the lines of the member's own orders, through the order
  // (the exact sub-select the scope test spells out, like job_pets through the job).
  shop_order_lines: { by: [] },
  // Shops' own strikes (20261018164444, per section), exported by 20261018164443.
  shop_strikes: { by: ["user_id"] },
  // The shop's private pickup address (M1b part 2, 20261018210400), exported by
  // 20261018210401 to its owner only (the Stripe Tax location id is internal, dropped).
  shop_pickup_addresses: { by: ["owner_id"] },
  job_helpr_fault_rulings: { section: "helpr_fault_rulings", by: ["helper_id"] },
  landlord_id_reviews: { by: ["user_id"] },
  // Homes rent + deposit records (20261019083350): keyed by TENANCY, no person column; each section reads the
  // rows of the tenancies the member is a side of (landlord or tenant): the rental_tenancies sub-select.
  rental_rent_plans: { by: [] },
  rental_rent_charges: { by: [] },
  rental_rent_payments: { by: [] },
  rental_deposits: { by: [] },
  // Homes lease (20261019111310): by each party (kept on the lease); a draft's blanks go to the landlord only.
  rental_leases: { by: ["landlord_id", "tenant_id"] },
  // Saved homes (20261019185723): the member's own hearts.
  saved_homes: { by: ["user_id"] },
  legal_acceptances: { by: ["user_id"] },
  login_history: { by: ["user_id"] },
  email_tracking: { by: ["user_id"] },
  email_send_log: { by: ["recipient_email"] },
  suppressed_emails: { by: ["email"] },
  job_checkins: { by: ["user_id"] },
  job_tracking: { by: ["helper_id"] },
  group_job_helpers: { by: ["helper_id"] },
  recurring_visit_releases: { by: ["helper_id"] },
  recurring_visit_payments: { by: ["payer_id", "helper_id"] },
  job_revisions: { by: ["requested_by"] },
  job_completion_nudges: { by: ["resolved_by"] },
  disputes: { by: ["opener_id", "agreed_poster_id", "agreed_helper_id"] },
  job_views: { by: ["viewer_id"] },
  profile_views: { by: ["viewer_user_id"] },
  pet_profiles: { by: ["owner_id"] },
  str_calendar_connections: { by: ["user_id"] },
  thread_archives: { by: ["user_id"] },
  thread_mutes: { by: ["user_id"] },
  thread_pins: { by: ["user_id"] },
  nps_responses: { by: ["user_id"] },
  analytics_events: { by: ["user_id"] },
  payout_holds: { by: ["helper_id"] },
  application_rate_log: { by: ["applicant_id"] },
  profile_search_rate_log: { by: ["searcher_id"] },
  crew_dispute_member_outcomes: { by: ["helper_id"] },
  job_schedule_change_requests: { by: ["requested_by", "responder_id"] },
  // Q1254: the requests the person asked, and the answers the person gave.
  job_detail_change_requests: { by: ["requested_by"] },
  job_detail_change_answers: { by: ["helper_id"] },
  series_date_offers: { by: ["helper_id"] },
  series_visit_holds: { by: ["helper_id"] },
  // Q739: no person column; the poster's rows, through the job (posterReadableViaJob).
  job_pets: { by: [] },
  // Q1461: the poster's Access & Parking notes; no person column, through the job like job_pets.
  job_access_notes: { by: [] },
};

/**
 * A SECOND section over a table that already has its own EXPORTED section, scoped
 * not by a person column of that table but through a parent row the caller is a
 * party to. `scope` is the exact WHERE the section must carry (whitespace-free
 * compare): anything wider fails "every section is filtered to the caller".
 * declutter_problems_about_me (20261017055501, lane J): problems the OTHER side of
 * the member's order filed about them (RLS lets both parties read a problem),
 * without the reporter's id, photos or the deciding admin.
 */
export const EXTRA_SECTIONS: Record<string, { table: string; scope: string; stripped: string[]; noPersonColumn?: true }> = {
  declutter_problems_about_me: {
    table: "declutter_problems",
    scope:
      "WHERE t.reporter_id IS DISTINCT FROM v_uid AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND (o.buyer_id = v_uid OR o.seller_id = v_uid))",
    stripped: ["decided_by", "reporter_id", "photo_paths"],
  },
  // Board 141, Declutter side (20261026155252): refund requests on the member's own sales (no person column; the buyer's words).
  declutter_refund_requests: {
    table: "declutter_refund_requests",
    scope: "WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))",
    stripped: [],
    noPersonColumn: true,
  },  // Q2451 (20261027233614): the meeting spot of each order the member is a side of (no person column; a public place).
  declutter_order_meetups: {
    table: "declutter_order_meetups",
    scope: "WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))",
    stripped: [],
    noPersonColumn: true,
  },
  // D-NEW14 (20261030164712, exported by 20261030165438): the place frozen on each order the member is a side of; the
  // buyer's copy leaves out the seller's address, point and id.
  declutter_order_porch_places: {
    table: "declutter_order_porch_places",
    scope: "WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))",
    stripped: [],
    noPersonColumn: true,
  },
  // D2-1 (20261030004216, exported by 20261030024748): the chat of each paid order the member is a side of (no person
  // column; one row per order). Its messages are EXPORTED by sender_id and through this chat (talk_id IN ...).
  declutter_order_talks: {
    table: "declutter_order_talks",
    scope: "WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))",
    stripped: [],
    noPersonColumn: true,
  },
  // Q1866 (20261030081455): the quotes other members gave on the member's own requests, without the quoter's id or photos.
  job_quotes_on_my_requests: {
    table: "job_quotes",
    scope: "WHERE t.quoter_id IS DISTINCT FROM v_uid AND t.request_id IN (SELECT r.id FROM public.job_quote_requests r WHERE r.poster_id = v_uid)",
    stripped: ["quoter_id", "photo_paths"],
  },
  // Q1866: the counter-offers on any quote the member gave or received (no person column; keyed by its quote).
  job_quote_offers: {
    table: "job_quote_offers",
    scope: "WHERE t.quote_id IN (SELECT q.id FROM public.job_quotes q JOIN public.job_quote_requests r ON r.id = q.request_id WHERE q.quoter_id = v_uid OR r.poster_id = v_uid)",
    stripped: [],
    noPersonColumn: true,
  },
};

/**
 * Q739: tables whose SELECT policy lets a job's POSTER read a row because they
 * own the job, that the export does NOT give the poster. Each says why. Every
 * other such table must return the rows on the caller's own jobs (see
 * posterReadableViaJob and dataExportCoversEveryUserTable). Two-way: an entry
 * that no longer names a poster-readable table fails.
 */
// @two-way src/test/dataExportCoversEveryUserTable.test.ts:POSTER_SIDE_EXEMPT entries that no longer name a poster-readable table
export const POSTER_SIDE_EXEMPT: Record<string, string> = {
  job_checkins: "a check-in is the Helpr's own location event, exported to them by user_id; never the poster's data",
  job_tracking: "the Helpr's live location trail, exported to them by helper_id; never the poster's data",
};

/**
 * Q739: every table whose SELECT (or ALL) policy, after replaying every
 * CREATE/DROP POLICY in the migrations (comments blanked), admits a job's
 * poster AS the poster: a jobs subquery on customer_id = auth.uid(), or
 * is_series_party(<col>). Maps table -> the column that names the job ("?"
 * when the policy names none, e.g. a realtime topic match). public.jobs itself
 * is left out: its poster column is its own customer_id.
 */
/**
 * Q1329: the two migrations that re-scope policies' roles in a DO loop
 * (`EXECUTE format('ALTER POLICY %I ON %I.%I TO <role>')`), which no static
 * parse can see. Each names the role it sets and the pg_policies filter its
 * loop runs, applied to the replay at that point. Two-way: every migration with
 * such a format string must be here (dataExportCoversEveryUserTable).
 */
// @two-way src/test/dataExportCoversEveryUserTable.test.ts:a migration re-scopes policy roles in a loop the replay does not model
export const ROLE_SCOPING_LOOPS: Record<string, { to: string; admits: (table: string, name: string, text: string) => boolean }> = {
  "20260505235500_scope_uid_policies_to_authenticated.sql": {
    to: "authenticated",
    admits: (table, name, text) =>
      /auth\.uid\(\)/i.test(text) &&
      !(table === "analytics_events" && name === "anyone_can_insert_analytics") &&
      !(table === "error_logs" && name === "anyone_can_insert_errors"),
  },
  "20260506000000_scope_service_role_policies_to_service_role.sql": {
    to: "service_role",
    admits: (_table, _name, text) => /service_role/i.test(text),
  },
};

/** The roles a CREATE POLICY's text (after `ON table`) names: `TO a, b`, else public. */
function policyRoles(text: string): string[] {
  const head = text.split(/\busing\b|\bwith\s+check\b/i)[0];
  const to = /\bto\s+([\w\s,"]+?)\s*$/i.exec(head)?.[1] ?? "public";
  return to.split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase()).sort();
}

export type ReplayedPolicy = { table: string; text: string; roles: string[]; permissive: "PERMISSIVE" | "RESTRICTIVE" };

/**
 * Every public-table policy as the migrations leave it: CREATE/DROP POLICY and
 * ALTER POLICY (RENAME TO, TO roles, USING) replayed in file order, comments
 * blanked, plus the ROLE_SCOPING_LOOPS. Keyed "table:name" (a quoted name
 * keeps its case, a bare one is folded). roles/permissive as pg_policies
 * prints them (Q1329).
 */
export function replayedPolicies(): Map<string, ReplayedPolicy> {
  const dir = join(REPO, "supabase/migrations");
  const live = new Map<string, ReplayedPolicy>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    const events: { at: number; apply: () => void }[] = [];
    // Schema-aware: a policy ON realtime.messages / storage.objects is not a public table's.
    // Names quoted (case kept) or bare (folded to lower case), as Postgres reads them.
    const NAME = String.raw`(?:"([^"]+)"|(\w+))`;
    const ON = String.raw`\s+on\s+(?:"?(\w+)"?\.)?"?(\w+)"?`;
    const key = (table: string, quoted?: string, bare?: string) => `${table.toLowerCase()}:${quoted ?? bare!.toLowerCase()}`;
    for (const m of sql.matchAll(new RegExp(String.raw`drop\s+policy\s+(?:if\s+exists\s+)?${NAME}${ON}`, "gi"))) {
      if (m[3] && m[3].toLowerCase() !== "public") continue;
      events.push({ at: m.index!, apply: () => live.delete(key(m[4], m[1], m[2])) });
    }
    for (const m of sql.matchAll(new RegExp(String.raw`create\s+policy\s+${NAME}${ON}([^;]*);`, "gi"))) {
      if (m[3] && m[3].toLowerCase() !== "public") continue;
      events.push({
        at: m.index!,
        apply: () =>
          live.set(key(m[4], m[1], m[2]), {
            table: m[4].toLowerCase(),
            text: m[5],
            roles: policyRoles(m[5]),
            permissive: /^\s*as\s+restrictive\b/i.test(m[5]) ? "RESTRICTIVE" : "PERMISSIVE",
          }),
      });
    }
    // ALTER POLICY ... RENAME TO ..., and ALTER POLICY ... [TO ...] USING (...) [WITH CHECK (...)].
    for (const m of sql.matchAll(new RegExp(String.raw`alter\s+policy\s+${NAME}${ON}([^;]*);`, "gi"))) {
      if (m[3] && m[3].toLowerCase() !== "public") continue;
      const from = key(m[4], m[1], m[2]);
      const rest = m[5];
      events.push({
        at: m.index!,
        apply: () => {
          const cur = live.get(from);
          if (!cur) return;
          const rename = new RegExp(String.raw`^\s*rename\s+to\s+${NAME}`, "i").exec(rest);
          if (rename) {
            live.delete(from);
            live.set(key(m[4], rename[1], rename[2]), cur);
            return;
          }
          const roles = /^\s*to\s/i.test(rest) ? policyRoles(rest) : cur.roles;
          if (/\busing\b/i.test(rest)) {
            live.set(from, { ...cur, roles, text: cur.text.replace(/\busing\b[\s\S]*$/i, "") + " " + rest.slice(rest.search(/\busing\b/i)) });
          } else {
            live.set(from, { ...cur, roles });
          }
        },
      });
    }
    const loop = ROLE_SCOPING_LOOPS[f];
    if (loop) {
      const at = sql.search(/execute\s+format\s*\(\s*'alter\s+policy/i);
      events.push({
        at: at < 0 ? sql.length : at,
        apply: () => {
          for (const [k, v] of live) {
            if (v.roles.includes("public") && loop.admits(v.table, k.slice(k.indexOf(":") + 1), v.text)) live.set(k, { ...v, roles: [loop.to] });
          }
        },
      });
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
  }
  return live;
}

export function posterReadableViaJob(tables = publicTables()): Map<string, string> {
  const out = new Map<string, string>();
  for (const { table, text } of replayedPolicies().values()) {
    // Only tables the schema still has (a dropped table's policies went with it).
    if (table === "jobs" || !tables.has(table)) continue;
    const cmd = (/\bfor\s+(all|select|insert|update|delete)\b/i.exec(text)?.[1] ?? "all").toLowerCase();
    if (cmd !== "select" && cmd !== "all") continue;
    const series = /\bis_series_party\s*\(\s*(?:\w+\.)?(\w+)\s*\)/i.exec(text);
    // The spellings of "the caller owns the job": customer_id = auth.uid() (either
    // side of the =), and auth.uid() IN (SELECT [alias.]customer_id FROM jobs [alias] ...).
    const eqForm =
      /\bcustomer_id\s*=\s*\(?\s*(?:select\s+)?auth\.uid\s*\(\s*\)/i.test(text) ||
      /\bauth\.uid\s*\(\s*\)(?:\s+AS\s+uid)?\s*\)?\s*=\s*(?:\w+\.)?customer_id\b/i.test(text);
    const inForm = /\bauth\.uid\s*\(\s*\)(?:\s+AS\s+uid)?\s*\)?\s+IN\s*\(\s*SELECT\s+(?:(?:public\.)?\w+\.)?customer_id\s+FROM\s+(?:public\.)?jobs\b/i.test(text);
    if (!series && !(/\bjobs\b/i.test(text) && (eqForm || inForm))) continue;
    const col =
      series?.[1] ??
      /\b(?:j|jobs)\.id\s*=\s*(?:(?:public\.)?\w+\.)?(\w+)/i.exec(text)?.[1] ??
      /(?:(?:public\.)?\w+\.)?(\w+)\s*=\s*(?:j|jobs)\.id\b/i.exec(text)?.[1] ??
      /\bwhere\s+id\s*=\s*(?:(?:public\.)?\w+\.)?(\w+)/i.exec(text)?.[1] ??
      "?";
    if (!out.has(table) || out.get(table) === "?") out.set(table, col.toLowerCase());
  }
  return out;
}


/**
 * Q1235: the Helpr's side of posterReadableViaJob. Every table whose SELECT (or
 * ALL) policy admits the job's HIRED HELPR as that Helpr: inside a jobs
 * sub-select (`FROM jobs ... WHERE ... helper_id = auth.uid()`, either side of
 * the =, or `auth.uid() IN (SELECT helper_id FROM jobs ...)`), or
 * is_series_party(<col>). A table's OWN helper_id column compared to
 * auth.uid() outside a jobs sub-select is not this (that is the row's own
 * person column, exported by EXPORTED[table].by). Maps table -> the job column.
 */
export function helperReadableViaJob(tables = publicTables()): Map<string, string> {
  const UID = String.raw`\(?\s*(?:select\s+)?auth\.uid\s*\(\s*\)(?:\s+AS\s+uid)?\s*\)?`;
  const helperIsCaller = new RegExp(String.raw`(?:\b(?:\w+\.)?helper_id\s*=\s*${UID}|${UID}\s*=\s*(?:\w+\.)?helper_id\b)`, "i");
  /** Each `FROM jobs ...` up to the paren that closes its sub-select. */
  const jobsSubselects = (text: string) =>
    [...text.matchAll(/\bFROM\s+(?:public\.)?jobs\b/gi)].map((m) => {
      let depth = 0;
      for (let i = m.index!; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth < 0) return text.slice(m.index!, i);
      }
      return text.slice(m.index!);
    });
  const out = new Map<string, string>();
  for (const { table, text } of replayedPolicies().values()) {
    if (table === "jobs" || !tables.has(table)) continue;
    const cmd = (/\bfor\s+(all|select|insert|update|delete)\b/i.exec(text)?.[1] ?? "all").toLowerCase();
    if (cmd !== "select" && cmd !== "all") continue;
    const series = /\bis_series_party\s*\(\s*(?:\w+\.)?(\w+)\s*\)/i.exec(text);
    const viaSub = jobsSubselects(text).some((sub) => helperIsCaller.test(sub));
    const inForm = new RegExp(String.raw`${UID}\s+IN\s*\(\s*SELECT\s+(?:(?:public\.)?\w+\.)?helper_id\s+FROM\s+(?:public\.)?jobs\b`, "i").test(text);
    if (!series && !viaSub && !inForm) continue;
    const col =
      series?.[1] ??
      /\b(?:j|jobs)\.id\s*=\s*(?:(?:public\.)?\w+\.)?(\w+)/i.exec(text)?.[1] ??
      /(?:(?:public\.)?\w+\.)?(\w+)\s*=\s*(?:j|jobs)\.id\b/i.exec(text)?.[1] ??
      /\bwhere\s+id\s*=\s*(?:(?:public\.)?\w+\.)?(\w+)/i.exec(text)?.[1] ??
      /\b(\w+)\s+IN\s*\(\s*SELECT\s+(?:\w+\.)?id\s+FROM\s+(?:public\.)?jobs\b/i.exec(text)?.[1] ??
      "?";
    if (!out.has(table) || out.get(table) === "?") out.set(table, col.toLowerCase());
  }
  return out;
}

/**
 * "table.column" → why the export does not scope by it. `stripped: true` means
 * the column is also REMOVED from the rows the export does return (the guard
 * checks export_my_data() drops it), because it names someone the person was
 * never shown or holds a secret.
 */
// @two-way src/test/dataExportCoversEveryUserTable.test.ts:no stale entry: every EXPORTED/EXEMPT column is a live person column
export const EXEMPT: Record<string, { reason: string; stripped?: true }> = {
  // CMP-4 instant book (20261101063725, 20261101065105); lead 11-01.
  // LEAD-LIST-FOR-SELLER (20261101034159): a private link (item, job, Helpr, seller, sent/decided times), service role only.
  "declutter_listed_for_seller.seller_id": { reason: "link row; the listing itself is a declutter_items row exported under the seller (seller_id), and the job under its poster" },
  "declutter_listed_for_seller.helpr_id": { reason: "link row; the listing the Helpr wrote is the seller's declutter_items row (exported under the seller), and the Helpr's side is the job, exported under helper_id" },
  "payee_accounts.user_id": { reason: "PayPal phase 1 (20261023223419, 2026-10-23): switch paypal_payments is off, so no member rows exist; export added before the switch goes to everyone (OPEN Q2377, a go-live blocker)" },
  "payee_accounts.paypal_email": { reason: "PayPal phase 1 (20261023223419, 2026-10-23): switch paypal_payments is off, so no member rows exist; export added before the switch goes to everyone (OPEN Q2377, a go-live blocker)" },
  "provider_payments.payer_id": { reason: "PayPal phase 1 (20261023223419, 2026-10-23): switch paypal_payments is off, so no member rows exist; export added before the switch goes to everyone (OPEN Q2377, a go-live blocker)" },
  "provider_payouts.payee_user_id": { reason: "PayPal phase 1 (20261023223419, 2026-10-23): switch paypal_payments is off, so no member rows exist; export added before the switch goes to everyone (OPEN Q2377, a go-live blocker)" },
  "provider_payouts.marked_paid_by": { reason: "the staff member who marked a manual PayPal payout paid (PayPal phase 1, 20261023223419); the payout is the Helpr's and is exported with it once Q2377 lands, with this staff id dropped" },
  // Quotes slice 1 (20261015091114): NOT exported yet, tracked by docs/OPEN.md
  // Q?quotes-export. ready/rentals-s1 also restates export_my_data, so the quotes
  // sections wait for it to land; the 'quotes' switch stays off until they do.
  "shops.sos_verified_by": { reason: "the staff member who checked a shop's Secretary of State number; the shop is the member's (exported by shops.owner_id, 20261017061157, with this staff id dropped)", stripped: true },
  "job_helpr_fault_rulings.admin_id": { reason: "the staff member who ruled the Helpr at fault (Q2082 (b)); the ruling is the Helpr's (exported by job_helpr_fault_rulings.helper_id, 20261019015302, with this staff id dropped)", stripped: true },
  "shop_strikes.removed_by": { reason: "the staff member who removed a Shops strike; the strike is the member's (exported by shop_strikes.user_id, 20261018164443, with this staff id dropped)", stripped: true },
  "shipping_quotes.buyer_id": { reason: "Shipping S2 (20261030012052): a 30-minute postage quote (service-role only), deleted with the account (ON DELETE CASCADE); the buyer's address on a paid order is exported with shipments in S5 (docs/specs/shipping-draft.md 9.3, Q2259)" },
  "declutter_move_reminders.seller_id": { reason: "Moving-sale reminders (20261030221156): a mark that a notice went out, holding only the date already exported with the listing's private row; the notice itself is in the seller's exported notifications; deleted with the account" },
  "shipping_quotes.seller_id": { reason: "Shipping S2 (20261030012052): the seller of a 30-minute postage quote the buyer asked for; no seller data on it beyond the id; deleted with either account (ON DELETE CASCADE)" },
  "shipments.buyer_id": { reason: "Shipping S1 (20261020024605): service-role table with no rows until the label worker (S3); the buyer's own address on it is added to export_my_data in S5 (docs/specs/shipping-draft.md 9.3, Q2259); on account deletion the address is redacted to its ZIP (trigger shipments_guard_update)" },
  "refund_requests.answer_by": { reason: "a deadline timestamp (when the Helpr must answer the refund request), not a person; the request is exported by refund_requests.requester_id/responder_id/answered_by (20261021102943)" },
  "shop_orders.accept_by": { reason: "a deadline timestamp (when the shop must answer the order), not a person; the order is exported by shop_orders.buyer_id/seller_id (20261018164443)" },
  "shops.hidden_by": { reason: "the staff member who hid a shop; the shop is the member's (exported by shops.owner_id, 20261017061157, with this staff id dropped; the hide reason stays)", stripped: true },
  "declutter_strikes.removed_by": { reason: "the staff member who removed a Declutter strike; the strike is the member's (the strike is exported by declutter_strikes.user_id, 20261014200728, with this staff id dropped)" },
  "declutter_strikes.appeal_decided_by": { reason: "the staff member who decided a Declutter strike appeal; the strike is the member's (the strike is exported by declutter_strikes.user_id, 20261014200728, with this staff id dropped)" },
  "declutter_offers.respond_by": { reason: "a deadline timestamp (when the offer must be answered), not a person; the offer is exported by declutter_offers.buyer_id/seller_id (20261014210518)" },
  "declutter_refund_requests.answer_by": { reason: "a deadline timestamp (when the seller must answer a refund request), not a person; the table has no person column (keyed by order_id; the buyer and seller are the order's, exported by declutter_orders.buyer_id/seller_id; 20261026155251)" },
  "declutter_refund_requests.return_by": { reason: "a deadline timestamp (when the seller must confirm the item came back after agreeing a full refund, #3558), not a person; the table has no person column (keyed by order_id; 20261026155251)" },
  "declutter_refund_requests.offer_answer_by": { reason: "a deadline timestamp (when the buyer must answer the seller's part offer), not a person; the table has no person column (keyed by order_id; 20261026155251)" },
  "declutter_cart_items.checkout_by": { reason: "a deadline timestamp (when checkout must happen), not a person; the line is exported by declutter_cart_items.buyer_id/seller_id (20261014210518)" },
  "helpr_tasks.customer_id": { reason: "the buyer of the Declutter order a delivery belongs to; their side of it is exported through their order (declutter_orders by buyer_id), and the Helpr's task row holds the seller's address, which is never the buyer's data (20261017055505)" },
  "helpr_tasks.pickup_contact_id": { reason: "the seller of the Declutter order a delivery belongs to; their side of it is exported through their order (declutter_orders by seller_id), and the Helpr's task row holds the buyer's drop-off address, which is never the seller's data (20261017055505)" },
  "helpr_tasks.return_answer_by": { reason: "a deadline timestamp (when the seller must say a returned item is back, 24 hours on), not a person; the task is exported by helpr_tasks.helpr_id (BUY-36, 20261031231150)" },
  "helpr_tasks.stuck_choice_by": { reason: "a deadline timestamp (when the buyer must choose refund, another Helpr or collecting), not a person; the task is exported by helpr_tasks.helpr_id (BUY-36, 20261031231150)" },
  "helpr_tasks.stuck_fix_by": { reason: "a deadline timestamp (when the buyer must fix the address or add a note, 24 hours on), not a person; the task is exported by helpr_tasks.helpr_id (BUY-36, 20261031231150)" },
  "helpr_tasks.stuck_return_by": { reason: "a deadline timestamp (when a Helpr at fault must bring the item back, 48 hours on), not a person; the task is exported by helpr_tasks.helpr_id (BUY-36, 20261031231150)" },
  "helpr_tasks.seller_no_show_answer_by": { reason: "a deadline timestamp (when the Helpr must answer the seller's \"The Helpr didn't come\" report, 24 hours on), not a person; the task is exported by helpr_tasks.helpr_id (20261031134217)" },
  "helpr_tasks.confirmed_by": { reason: "how a delivery was confirmed ('code', 'customer', 'auto', 'admin'), not a person (20261017055505)" },
  "job_guarantee_claims.helpr_answer_by": { reason: "a deadline timestamp (when the Helpr must answer), not a person (20261027200455)" },
  "job_guarantee_claims.poster_answer_by": { reason: "a deadline timestamp (when the poster must answer), not a person (20261027200455)" },
  "declutter_seller_deliveries.proposed_by": { reason: "which side ('buyer' or 'seller') asked for a new delivery time, not a person; the delivery is exported by declutter_seller_deliveries.buyer_id/seller_id (20261027153244, exported by 20261027153245)" },
  "declutter_delivery_dropoffs.seller_id": { reason: "the other side of the order: the drop-off address is the BUYER's and is never exported to the seller (exported by declutter_delivery_dropoffs.buyer_id, 20261017055506)" },
  "declutter_handovers.no_show_answer_by": { reason: "a deadline: when the seller's 24 hours to answer a no-show report end, not a person (20261031004529)" },
  "declutter_handovers.confirmed_by": { reason: "how a Declutter handover was confirmed ('buyer', 'seller', 'porch', 'auto', 'admin'; 'code' on historical rows only), not a person; the table has no person column (it is keyed by order_id; 20261015042253, no QR 'scan' since 20261018183715)" },
  "declutter_problems.decided_by": { reason: "the staff member who decided a Declutter problem report; the report is the member's (exported by declutter_problems.reporter_id, 20261015042253, with this staff id dropped)", stripped: true },
  "landlord_id_reviews.reviewed_by": { reason: "the admin who reviewed a landlord's ID photo (owner 2026-10-19); the review is the landlord's (exported by landlord_id_reviews.user_id with this staff id dropped)", stripped: true },
  "rental_rent_payments.reported_by": { reason: "which side entered a rent payment ('tenant' or 'landlord'), not a person id; the table is keyed by tenancy_id and holds no person column (20261019073106)" },
  "rental_tenancies.ended_by": { reason: "which side ended the tenancy ('tenant' or 'landlord'), not a person id; the tenancy is exported by its landlord_id and tenant_id (20261019073106)" },
  "rental_properties.ownership_reviewed_by": { reason: "the admin who checked a landlord's ownership proof; the property is the landlord's (exported by rental_properties.owner_id, 20261017205605, with this staff id dropped)", stripped: true },
  "declutter_order_porch_places.seller_id": { reason: "D-NEW14 porch places (20261030164712, exported by 20261030165438): the seller of an order's frozen place; the section is scoped by the order (either side), and the buyer's copy has this id, the address and the point removed", stripped: true },
  "declutter_porch_place_choices.seller_id": { reason: "D-NEW14 porch places (20261030164712, exported by 20261030165438): which seller a buyer's place pick is for; the pick is the buyer's own and the seller never sees it (as declutter_meetup_choices.seller_id)" },
  "declutter_seller_flags.set_by": { reason: "the staff member (or NULL for the server) who flagged a seller as business-like; the whole table stays out of the export (A3-I6)" },
  // Q552: the service-role-only enrolment of the platform's OWN test accounts
  // (the launch switch keeps test jobs visible to them). No member is ever in it.
  "test_accounts.user_id": { reason: "platform test-account enrolment, service role only; holds no member's data" },
  "feature_switch_members.user_id": { reason: "platform enrolment on a testers switch (owner 2026-10-28), service role only; holds no member's data" },
  "store_review_accounts.user_id": { reason: "App Store review account marker (lead 2026-11-01), service role only; holds no member's data" },
  "apple_sign_in_tokens.user_id": { reason: "Q1791 (lead 2026-10-30): the Apple refresh token kept only so account deletion can call Apple /auth/revoke (App Store Review 5.1.1(v)), service role only; an Apple-issued credential, not member-entered data, and the row goes with the account (ON DELETE CASCADE)" },
  "stripe_customers.user_id": { reason: "one wallet (20261018090700): the member's Stripe Customer id per Stripe mode, service role only; a Stripe internal handle, not member-entered data, stripped from the export like declutter_buyer_cards.stripe_customer_id (the member's saved cards are exported via declutter_buyer_cards)" },
  // Q1575: a seen/unseen flag over a back-out the person was ALSO told by an
  // in-app notification and email (notifications are exported); no content of its own.
  // Q1714: the dedupe claim behind a refund notice; the notice itself (amount,
  // card, reference) is an exported notification, and the refund is exported
  // through payment_refunds.
  "refund_notices.user_id": { reason: "dedupe claim for a refund notice, service role only; the notice is in the exported notifications and the refund in payment_refunds" },
  "backout_notices.user_id": { reason: "UI state for the Needs You banner: whether a back-out notice was seen; the same news is in the exported notifications" },
  // 2026-10-09: the "Louisiana Helpr Team" thread key. Every such row has its
  // user as sender (their reply) or receiver (staff's message), so the
  // messages export (by sender_id / receiver_id) already carries all of them.
  "messages.team_thread_user_id": { reason: "team-thread key; every row in a user's team thread has that user as sender_id or receiver_id, both already exported" },
  // Staff-only records and ban-evasion data. Owner 2026-10-29 (A3-I6): the
  // data export LEAVES OUT the moderation tables (reversing the 2026-09-26
  // Q290 choice to export staff notes, fraud flags and shadowbans). Law relied
  // on, per row below: CCPA regs, Cal. Code Regs. tit. 11, s. 7024(d) (no
  // disclosure of specific pieces that creates a substantial, articulable and
  // unreasonable risk to the account's or the business's security); GDPR
  // Art. 23(1)(d)/(j) (access may be restricted for preventing and detecting
  // crime and enforcing civil claims) and Art. 15(4) (the copy must not harm
  // others' rights). Louisiana has no general consumer-access statute.
  // What the member is TOLD stays exported: user_bans, user_violations,
  // strikes, payout_holds, their own reports.
  "admin_user_notes.user_id": { reason: "A3-I6 (owner 2026-10-29): staff notes about the member, a moderation tool; often quote other members' reports, so GDPR Art. 15(4) and Art. 23(1)(d), and Cal. Code Regs. tit. 11, s. 7024(d); deleted with the account (ON DELETE CASCADE)" },
  "fraud_flags.user_id": { reason: "A3-I6 (owner 2026-10-29): automatic and staff fraud signals; showing a member which signal flagged them teaches evasion, Cal. Code Regs. tit. 11, s. 7024(d) and GDPR Art. 23(1)(d)" },
  "helper_shadowbans.helper_id": { reason: "A3-I6 (owner 2026-10-29): whether a Helpr is quietly hidden from search, a moderation tool that works only while unannounced, Cal. Code Regs. tit. 11, s. 7024(d) and GDPR Art. 23(1)(d)" },
  "declutter_seller_flags.user_id": { reason: "A3-I6 (owner 2026-10-29, lead-confirmed): flags against a seller (business-like seller review), a moderation tool, Cal. Code Regs. tit. 11, s. 7024(d) and GDPR Art. 23(1)(d)" },
  "ops_alert_admin_subjects.user_id": { reason: "A3-I6 (owner 2026-10-29, lead-confirmed): which staff alerts were about the member, an admin tool, Cal. Code Regs. tit. 11, s. 7024(d) and GDPR Art. 23(1)(d)" },
  "verification_exceptions.user_id": { reason: "A3-I6 (owner 2026-10-29, lead-confirmed): staff decisions on the member's ID checks, a fraud-prevention tool, Cal. Code Regs. tit. 11, s. 7024(d) and GDPR Art. 23(1)(d); the ID check result itself is exported in verification_checks" },
  "error_logs.user_id": { reason: "A3-I6 (owner 2026-10-29): the app's crash and error diagnostics (stack traces, URLs, screen names) describing Helpr's own systems, Cal. Code Regs. tit. 11, s. 7024(d) (security of the business's systems); scrubbed of tokens on write (src/lib/errorLogger.ts)" },
  "admin_audit_log.admin_id": { reason: "staff action log, keyed by the staff member" },
  "support_replies.admin_id": { reason: "the staff member who answered a support ticket (20261023200521); the member's copy of the reply is their own notification row, exported with their notifications, and the send is in admin_audit_log" },
  "job_approval_escalations.resolved_by": { reason: "the staff member who closed a job waiting on approval (20261023143240); the job is the poster's and the Helpr's, exported with their jobs, and the close is in admin_audit_log" },
  "job_payout_holds.held_by": { reason: "Q1491: the staff member who placed a JOB payout hold (NULL when stripe-webhook placed it); a server-only money-control row about the job, not the person's own data" },
  "shop_hand_refunds.recorded_by": { reason: "the staff member who recorded a Shops refund made by hand in Stripe (NULL when stripe-webhook recorded it; Shops M3, 20261019071055); a server-only money-control row about the order, not the person's own data" },
  "series_platform_ends.admin_id": { reason: "the staff member who ended a series (Q1735); the series is the poster's, exported with their jobs" },
  "new_member_admin_notices.user_id": { reason: "2026-10-09: the server's once-only marker that admins were told this member joined (when they confirmed their email); a timestamp about the account, none of the person's own data" },
  "pre_verification_wipes.user_id": { reason: "Q447: the server's record that a pre-verification takeover deleted what someone else typed into this account (and which stored objects to remove); it holds none of the person's own data" },
  "job_refund_claims.claimed_by": { reason: "Q1323: names the code path holding a refund claim ('cancel_escrow' or 'admin_refund_general'), not a person" },
  "job_refund_claims.actor_user_id": { reason: "Q1323: server lock marker naming who started an in-flight refund claim; deleted when the claim is put back, holds none of the person's own data" },
  "crew_confirm_pending.helper_id": { reason: "20261007011530: transient state of one crew Confirm waiting on payout setup (deleted when it completes or the spot is removed); holds no content, only the job, slot and person ids the export already carries through group_job_helpers" },
  "job_accept_pending.helper_id": { reason: "Q1180: transient state of one offer (deleted when the accept completes or the offer moves on); holds no content, only the job and person ids the export already carries through jobs" },
  "admin_user_notes.admin_id": { reason: "the staff member who wrote the note; the whole table stays out of the export (A3-I6)" },
  "declutter_handover_talks.opened_by": { reason: "Q2462 (20261028235249): which side opened the talk; always the buyer or the seller of that row (CHECK opened_by = buyer_id OR seller_id), so the row is already exported to both by buyer_id/seller_id" },
  "declutter_donation_partners.created_by": { reason: "Q2428 (20261027222743): the admin who added a partner charity; staff curation, not member data; each save is also in admin_audit_log" },
  "helper_shadowbans.created_by": { reason: "the staff member who applied the shadowban; the whole table stays out of the export (A3-I6)" },
  "category_suggestions.reviewed_by": { reason: "I1: the staff member who approved or declined the suggestion", stripped: true },
  "payout_holds.held_by": { reason: "Q764: the staff member who placed the payout hold", stripped: true },
  "payout_holds.denied_by": { reason: "Q764: the staff member who recorded the denial", stripped: true },
  "ban_evasion_matches.user_id": { reason: "Q1324: ABOUT another person: the banned account a card, bank or name match points at, with that account's ban reason and date (GDPR Art. 15(4)); admin-only so a person cannot learn whether a name or card belongs to a banned account" },
  "ban_settlement_queue.user_id": { reason: "Q1324: the staff queue for an automatic ban's jobs; the ban itself is exported via user_bans and the profile" },
  "ban_settlement_queue.decided_by": { reason: "Q1324: the staff member who confirmed or lifted the ban" },
  "payout_schedule_freezes.helper_id": { reason: "Q1221: the server's queue of Stripe payout-schedule changes a payout hold makes; the hold itself is exported in payout_holds, and the schedule is the person's own Stripe setting, shown in their Stripe dashboard" },
  "payout_schedule_freezes.requested_by": { reason: "Q1221: the staff member who placed or released the hold" },
  "job_match_queue.send_email": { reason: "a boolean (send the parish email or not), not a person: matched by name only" },
  "saved_searches.notify_email": { reason: "a boolean (Q2275: the saved search's email channel on or off), not a person: matched by name only" },
  "application_nudge_sends.user_id": { reason: "owner 2026-10-29 (UX-3, Q2484): which job's poster was sent the one 24-hour \"Your applicants are waiting\" nudge and when, service role only; the nudge itself is exported as the member's notifications, and the rows are deleted with the account" },
  "declutter_talk_reminder_sends.user_id": { reason: "owner 11-01 (20261101200929): which unread Declutter chat message got the 15-minute or 2-hour reminder for which member and when, service role only; the reminder itself is exported as the member's notifications, and the rows are deleted with the account" },
  "unread_message_reminder_sends.user_id": { reason: "owner 11-01 (20261101183017): which unread message got the 15-minute or 2-hour reminder for which member and when, service role only; the reminder itself is exported as the member's notifications, and the rows are deleted with the account" },
  "helpr_start_reminder_sends.user_id": { reason: "owner 2026-10-29 (Q2483): which start reminder (2 hours, 8 AM, head out) went to the Helpr for which job and when, service role only; the reminder itself is exported as the member's notifications, and the rows are deleted with the account" },
  "payout_setup_reminders.helper_id": { reason: "owner 2026-10-25: which payout setup reminder (hired, day 1/3/7, money waiting) went to the Helpr and when, service role only; the reminder itself is exported as the member's notifications, and the rows are deleted with the account" },
  "connect_account_retirements.user_id": { reason: "owner 2026-10-25: the Stripe Connect account id stripe-connect replaced after Stripe rejected it, a money record for ops (a balance may remain on it), service role only; the member's current account is already in the export via profiles" },
  "job_checkout_nudges.user_id": { reason: "lead 2026-10-25: which unpaid job got the one \"Finish posting your job\" notice and when, service role only; the notice itself is exported in notifications and the email in email_send_log, and the rows go with the account" },
  "application_email_state.user_id": { reason: "lead 2026-10-25: pacing counter for a poster's applicant emails (when last emailed, how many waiting), service role only; the emails themselves are exported in email_send_log, and the row goes with the account" },
  "job_match_email_state.user_id": { reason: "lead 2026-10-25: pacing counter for a member's job-match emails (last day emailed, how many waiting), service role only; the emails themselves are exported in email_send_log, and the row goes with the account" },


  "confirm_reminder_sends.user_id": { reason: "lead 2026-10-25: which confirm-your-email reminder (step 1 or 2) went to the account and when, service role only; the email itself is exported in email_send_log, and the rows go with the account" },
  "helpr_delivery_online.user_id": { reason: "Q2440 (owner-approved 2026-10-27): the Go online switch, one row per Helpr: until when, a radius, and an area point rounded to ~1 km taken from the profile area (exported with profiles) or a position the member shared on the route screen; it turns itself off after its chosen 1 to 12 hours and the point is erased on Off, on the next go-online or new delivery after an auto-off; members read their own row on Deliver for pay, and it is deleted with the account (ON DELETE CASCADE)" },
  "declutter_price_alerts.user_id": { reason: "Q2429 (owner 2026-10-27): the rate-limit ledger of price-drop notices sent to a watcher (item, price, when), service role only; the notice itself is exported in notifications, and the rows are deleted with the account or the item" },
  "come_back_email_sends.user_id": { reason: "owner 2026-10-21: which come-back email (step 1 or 2) went to the member and when, service role only; the email itself is exported in email_send_log, and the rows are deleted with the account" },
  "booking_sources.user_id": { reason: "B59 2026-10-29: an attribution row the member never typed (which Helpr's Book me link brought them), service role only, read only by the admin report; removed with the account (ON DELETE CASCADE)" },
  "booking_sources.helpr_id": { reason: "B59 2026-10-29: the Helpr side of the same attribution row; it pays nothing and is shown only in the admin report; removed with either account (ON DELETE CASCADE)" },
  "signup_leads.email": { reason: "owner 2026-10-09: the sign-up step-1 address saved BEFORE an account exists (service role only); for a member it holds only the address the account already exports plus a source and timestamps, and a completed row is deleted at 30 days" },
  "retained_bans.email_sha256": { reason: "ban-evasion hash kept AFTER deletion; a live account's ban is exported via user_bans" },
  "identity_soft_fingerprints.user_id": { reason: "Q1416: ban-evasion data, one salted hash of name + date of birth from the person's own ID check (no name, date or document stored); exporting it would show a banned person which of their details is fingerprinted" },
  "payment_fingerprints.user_id": { reason: "Q1324: ban-evasion data, salted hashes of Stripe card/bank fingerprints (no card or account details); the cards and accounts themselves are the person's own in Stripe, and listing which are fingerprinted would show a banned person which payment method to swap" },
  "dispute_settlement_claims.claimed_by": { reason: "transient settlement lock held by staff or a function, not the person's data" },
  "marketing_content.created_by": { reason: "staff-only marketing drafts" },
  "declutter_meetup_choices.seller_id": { reason: "Q2451 (20261027204500, exported by 20261027233614): which seller a BUYER's pick of a meeting spot is for; the pick is the buyer's own until checkout and the seller never sees it, so it is exported to the buyer only. The order's agreed spot is exported to both sides (declutter_order_meetups)" },
  "declutter_meetup_spots.created_by": { reason: "Q2425 (20261027204500): the admin who added a public meetup spot (a police lot, a store); staff curation, not member data; each save is also in admin_audit_log" },
  "marketing_content.generated_by": { reason: "staff-only marketing drafts" },
  "marketing_settings.updated_by": { reason: "staff-only settings row" },
  "platform_settings.updated_by": { reason: "staff-only settings row" },
  // Other people's data the person was never shown.
  "reports.reported_id": { reason: "reports ABOUT the person: exporting them reveals the reporter (GDPR Art. 15(4))" },
  "user_blocks.blocked_id": { reason: "who blocked the person is the blocker's private choice" },
  "profile_views.viewed_user_id": { reason: "who viewed the person's profile is the viewer's browsing" },
  "favorite_helpers.helper_id": { reason: "other people's favourite lists that name the person" },
  "thread_archives.other_user_id": { reason: "the other party's inbox setting; the person's own are exported by user_id" },
  "thread_mutes.other_user_id": { reason: "the other party's inbox setting; the person's own are exported by user_id" },
  "thread_pins.other_user_id": { reason: "the other party's inbox setting; the person's own are exported by user_id" },
  "referral_credits.referred_user_id": { reason: "the credit belongs to the referrer (user_id); the person's own referral row is in referrals" },
  // On a row the export already returns (scoped by another column).
  "profiles.email": { reason: "on the person's own profile row (exported by user_id)" },
  "profiles.preferred_helper_id": { reason: "a pointer on the person's own profile row (exported by user_id)" },
  "str_calendar_connections.preferred_helper_id": { reason: "a pointer on the person's own row (exported by user_id)" },
  "jobs.chargeback_evidence_due_by": { reason: "a deadline, not a person" },
  "retired_client_relations.retired_by": { reason: "the migration version that dropped a relation, not a person" },
  // Staff or third-party ids on exported rows: removed from the export.
  "profiles.insurance_reviewed_by": { reason: "staff reviewer id", stripped: true },
  "profiles.license_reviewed_by": { reason: "staff reviewer id", stripped: true },
  "jobs.removed_by": { reason: "staff moderator id", stripped: true },
  "disputes.decided_by": { reason: "staff decider id", stripped: true },
  "crew_dispute_member_outcomes.decided_by": { reason: "staff decider id", stripped: true },
  "helper_verifications.changed_by": { reason: "staff reviewer id", stripped: true },
  "verification_exceptions.assigned_to": { reason: "staff assignee id; the whole table stays out of the export (A3-I6)" },
  "reports.assigned_to": { reason: "staff assignee id", stripped: true },
  "payout_transfers.initiated_by": { reason: "who pressed release: staff or a function", stripped: true },
  "payout_transfers.initiated_by_user_id": { reason: "who pressed release: staff or a function", stripped: true },
  "payment_refunds.initiated_by_user_id": { reason: "who issued the refund: staff", stripped: true },
  "user_bans.banned_by": { reason: "staff id", stripped: true },
  "user_violations.reported_by": { reason: "who reported the violation (GDPR Art. 15(4))", stripped: true },
};

type ExportSection = { name: string; table: string; text: string };

/** The sections of an export_my_data() body: `v_out := v_out || jsonb_build_object('<name>', (SELECT … FROM public.<table> t WHERE …));` */
export function exportSections(body: string): ExportSection[] {
  const parts = body.split(/v_out\s*:=\s*v_out\s*\|\|\s*jsonb_build_object\(\s*'/).slice(1);
  return parts.map((p) => {
    const name = /^(\w+)'/.exec(p)?.[1] ?? "";
    const text = p.slice(0, p.indexOf(";"));
    const table = /\bFROM\s+public\.(\w+)\s+t\b/i.exec(text)?.[1] ?? "";
    return { name, table, text };
  });
}
