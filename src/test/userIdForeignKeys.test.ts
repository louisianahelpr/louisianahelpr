/**
 * CLASS GUARD (docs/OPEN.md Q282, widened by Q331 and Q448): every public-table
 * uuid column that names a person (`*user_id`, `*_by`, `assigned_to`, or a
 * person role such as `helper_id`, `customer_id`, `reporter_id`, see
 * PERSON_ROLES) has a foreign key to
 * auth.users or profiles, or it is on NO_FK_BY_DESIGN below with the reason.
 *
 * Why: notification_preferences had none, so accounts removed by any path
 * that skips purge_user_data left their rows behind (255 of 315 orphaned when
 * measured 2026-09-24). On 2026-09-26 the same class held 3,611 orphan rows
 * across 9 tables (notification_logs 1,939, analytics_events 820,
 * login_history 482, ...). A FK makes the database, not every deletion path,
 * responsible; the ON DELETE action is chosen to match what the purge does
 * (DELETE -> CASCADE, anonymise -> SET NULL), see
 * 20260926034714_user_fks_q331_deletion_backstop.sql.
 *
 * THE CLASS is derived from source: every `CREATE TABLE` in
 * supabase/migrations and every `ALTER TABLE ... ADD COLUMN` with a
 * `*user_id` / `*_by` uuid column, replayed in order through inline
 * REFERENCES, ADD [CONSTRAINT] FOREIGN KEY, DROP CONSTRAINT, DROP COLUMN,
 * RENAME and DROP TABLE. On 2026-09-26 that derivation matched the live
 * catalog (information_schema.columns on public BASE TABLEs, uuid,
 * name ~ 'user_id$' or '_by$': 58 columns) column for column, and the live
 * pg_constraint FKs on them once the Q331 migration is applied.
 * NO_FK_BY_DESIGN is exact in both directions: adding a FK to a listed column
 * fails until it is removed from the list.
 *
 * The Q448 FKs' behaviour (orphan cleanup, ON DELETE actions, replay x3) is
 * proven by src/test/pglite/personFksQ448.pglite.mjs.
 *
 * @mutate supabase/migrations/20260926034714_user_fks_q331_deletion_backstop.sql | ADD CONSTRAINT admin_user_notes_user_id_fkey\n      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID; | ADD CONSTRAINT admin_user_notes_user_id_fkey\n      NOT VALID;
 * @mutate supabase/migrations/20260926034714_user_fks_q331_deletion_backstop.sql | FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID; | NOT VALID;
 * @mutate supabase/migrations/20261007045539_person_fks_q448_named_columns.sql | FOREIGN KEY (blocker_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID; | NOT VALID;
 * @mutate src/test/userIdForeignKeys.test.ts | \|reporter\|reported\| | \|reporter\|
 * @mutate supabase/migrations/20260924010547_user_fks_prefs_and_message_sender.sql | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; | NULL;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

// Columns that deliberately have NO foreign key, and why (Q331, 2026-09-26,
// each matching purge_user_data's documented decision).
// @two-way src/test/userIdForeignKeys.test.ts:NO_FK_BY_DESIGN lists no column that now has a FK
const NO_FK_BY_DESIGN: Record<string, string> = {
  "provider_payouts.marked_paid_by":
    "PayPal phase 1 (20261023223419): the admin who pressed Mark paid on a manual PayPal payout is part of its evidence (provider_payouts_manual_success_has_evidence requires it NOT NULL on a success row); a SET NULL FK would break that check and block deleting that admin's account, so the evidence outlives the account by design",
  "job_refund_claims.actor_user_id":
    "server-only lock marker naming who started a refund claim (poster or admin); the row is deleted on put-back and a FK would block deleting that person's account mid-claim (Q1323)",
  "user_bans.user_id":
    "a ban outlives the account by design: purge_user_data retains it (4n) and retain_ban_on_deletion carries it forward; a FK would CASCADE it away or block the delete",
  "user_bans.banned_by":
    "enforcement record retained with its ban (admin_audit_log class); often the subject themself (consequence ladder)",
  "jobs.removed_by":
    "an admin enforcement action; purge_user_data deliberately retains it (4p) so the admin surface sees the truth",
  // Q448 (2026-10-07): person columns named by role, outside the old pattern.
  "admin_audit_log.admin_id":
    "compliance trail: who did a privileged action must outlive that admin's account (Q331's admin_audit_log decision; 839 of 1,574 rows already name a deleted admin, measured 2026-10-07)",
  "shop_hand_refunds.recorded_by":
    "the admin who recorded a refund made in Stripe (NULL when the webhook recorded it), kept with the money row as part of the admin trail (same class as job_payout_holds.held_by): a CHECK requires it on an admin row, so ON DELETE SET NULL would break the row; server-only table, service_role writes it (Shops M3, 20261019071055)",
  "job_payout_holds.held_by":
    "the admin who placed a payout hold (NULL when stripe-webhook placed it), kept with the hold as part of the admin trail (same class as series_platform_ends.admin_id); server-only table, service_role grants only (Q1491)",
  "series_platform_ends.admin_id":
    "the admin who ended a recurring series (Q1735), kept with that record as part of the admin trail (same class as admin_audit_log.admin_id); server-only table",
  "admin_user_notes.admin_id":
    "the note's author, kept with the note as part of the admin trail (same class as admin_audit_log.admin_id)",
  "reports.reported_id":
    "NOT NULL by design: purge_user_data keeps a report against a deleted account (4k) so moderation history stays; a FK would erase it or block the delete",
  "tips.helper_id":
    "NOT NULL money record the purge leaves alone: a tip paid out is tax and payout history; SET NULL cannot run and CASCADE / NO ACTION would erase it or block the delete",
  "tips.tipper_id":
    "NOT NULL money record the purge leaves alone (same reason as tips.helper_id)",
  "tip_hold_redrives.helper_id":
    "NOT NULL money ledger for held-tip re-drives, kept as payout history (same reason as tips.helper_id)",
  "instant_payouts.helper_id":
    "NOT NULL money ledger: an instant payout is payout and fee history and outlives the account (1 of 1 row already names a deleted Helpr, measured 2026-10-07)",
  "helper_w9_records.helper_id":
    "NOT NULL tax record: a W-9 must be retained after the account is gone (IRS record keeping); a FK would erase it or block the delete",
};

// Q448 (2026-10-07): the class is a person id by ROLE, not only *user_id /
// *_by. Every role noun below names a person on prod (each was joined against
// auth.users on 2026-10-07: e.g. jobs.offered_to_helper_id 51 of 51 match,
// reports.reporter_id 9 of 12, user_blocks.blocker_id 3 of 3), so a new
// tips.payer_id or foo.helper_id is in the class the day it is written.
// Rentals S1 (2026-10-15) adds tenant and landlord: both are auth.users ids
// (rental_tenancies, maintenance_requests, maintenance_request_photos).
const PERSON_ROLES = "helper|customer|tipper|payer|admin|reporter|reported|blocker|blocked|owner|viewer|referrer|referred|reviewer|reviewee|opener|responder|searcher|applicant|donor|recipient|sender|receiver|tenant|landlord";
const PERSON_COL = new RegExp(String.raw`^(\w*user_id|\w+_by|assigned_to|(?:\w+_)?(?:${PERSON_ROLES})_id)$`, "i");
const ID = String.raw`"?(\w+)"?`;
const TABLE = String.raw`(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?`;
const PERSON_REF = /REFERENCES\s+(?:auth\.users|(?:public\.)?profiles)\b/i;

// key "table.column" -> has FK
let cols = new Map<string, boolean>();
// constraint name -> key, so DROP CONSTRAINT <name> unsets the right column
let fkNames = new Map<string, string>();

function replay(): Map<string, boolean> {
  cols = new Map();
  fkNames = new Map();
  const dir = join(__dirname, "../../supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    for (const st of sql.split(";")) statement(st);
  }
  return cols;
}

function setFk(table: string, col: string, name: string | null) {
  const key = `${table}.${col}`;
  if (!cols.has(key)) return;
  cols.set(key, true);
  fkNames.set(name ?? `${table}_${col}_fkey`, key);
}

function statement(st: string) {
  // CREATE TABLE public.t ( ... )   (non-public schemas are out of scope)
  let m = st.match(new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:\w+\.)?)"?(\w+)"?\s*\(([\s\S]*)$`, "i"));
  if (m) {
    if (m[1] && m[1].toLowerCase() !== "public.") return;
    const table = m[2];
    for (const line of m[3].split(/,\s*\n/)) {
      const c = line.match(new RegExp(String.raw`^\s*${ID}\s+uuid\b`, "i"));
      if (c && PERSON_COL.test(c[1])) {
        cols.set(`${table}.${c[1]}`, false);
        if (PERSON_REF.test(line)) setFk(table, c[1], null);
      }
      const t = line.match(new RegExp(String.raw`(?:CONSTRAINT\s+${ID}\s+)?FOREIGN\s+KEY\s*\(\s*${ID}\s*\)\s*(REFERENCES[^,]*)`, "i"));
      if (t && PERSON_REF.test(t[3])) setFk(table, t[2], t[1] ?? null);
    }
    return;
  }
  m = st.match(new RegExp(String.raw`ALTER\s+TABLE\s+${TABLE}\s+RENAME\s+TO\s+${ID}`, "i"));
  if (m) {
    const [from, to] = [m[1], m[2]];
    for (const [k, v] of [...cols]) {
      if (k.startsWith(`${from}.`)) { cols.delete(k); cols.set(`${to}.${k.slice(from.length + 1)}`, v); }
    }
    for (const [n, k] of [...fkNames]) if (k.startsWith(`${from}.`)) fkNames.set(n, `${to}.${k.slice(from.length + 1)}`);
    return;
  }
  m = st.match(new RegExp(String.raw`ALTER\s+TABLE\s+${TABLE}\s+([\s\S]*)$`, "i"));
  if (m) {
    const table = m[1];
    const body = m[2];
    for (const a of body.matchAll(new RegExp(String.raw`ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?${ID}\s+uuid\b([^,]*)`, "gi"))) {
      if (!PERSON_COL.test(a[1])) continue;
      if (!cols.has(`${table}.${a[1]}`)) cols.set(`${table}.${a[1]}`, false);
      if (PERSON_REF.test(a[2])) setFk(table, a[1], null);
    }
    for (const a of body.matchAll(new RegExp(String.raw`ADD\s+(?:CONSTRAINT\s+${ID}\s+)?FOREIGN\s+KEY\s*\(\s*${ID}\s*\)\s*(REFERENCES\s+[\w."]+)`, "gi"))) {
      if (PERSON_REF.test(a[3])) setFk(table, a[2], a[1] ?? null);
    }
    for (const a of body.matchAll(new RegExp(String.raw`DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?${ID}`, "gi"))) {
      const key = fkNames.get(a[1]);
      if (key && key.startsWith(`${table}.`)) { cols.set(key, false); fkNames.delete(a[1]); }
    }
    for (const a of body.matchAll(new RegExp(String.raw`DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?${ID}`, "gi"))) {
      cols.delete(`${table}.${a[1]}`);
    }
    return;
  }
  m = st.match(new RegExp(String.raw`^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:\w+\.)?)"?(\w+)"?`, "i"));
  if (m && (!m[1] || m[1].toLowerCase() === "public.")) {
    for (const k of [...cols.keys()]) if (k.startsWith(`${m[2]}.`)) cols.delete(k);
  }
}

describe("every person-id column (*user_id, *_by, *helper_id and the other person roles) has a foreign key or a stated reason (Q282, Q331)", () => {
  const all = replay();
  const missing = [...all].filter(([, v]) => !v).map(([k]) => k).sort();

  // Inventory, EXACT: the scanner must still see every public BASE TABLE uuid
  // column named *user_id or *_by. Live information_schema agreed on
  // 2026-09-26 (58); Q355 part 2 adds ops_alert_admin_subjects.user_id (FK to
  // auth.users); Q225 adds parish_match_alert_queue.user_id (FK to
  // auth.users); Q392 adds job_match_queue.user_id (FK to auth.users); Q728
  // adds crew_dispute_member_outcomes.decided_by (FK in 20260927034536) and
  // Q407 adds job_schedule_change_requests.requested_by (FK to auth.users),
  // 63 (2026-09-27); Q764 adds payout_holds.held_by and .denied_by (FKs to
  // auth.users in 20261004162921), 65 (2026-10-04); Q447 adds
  // pre_verification_wipes.user_id (FK to auth.users in 20261004194257), 66
  // (2026-10-04). A new
  // person column moves this; so does a scanner that stops reading a file.
  // Q448 (2026-10-07) widened the class from the name pattern to person ROLES
  // (helper_id, customer_id, reporter_id, ...): 53 more columns, and the
  // replay then matched live information_schema column for column (125 on
  // prod plus identity_soft_fingerprints.user_id, added by Q1416 in this
  // branch), with live FKs on every one except the 11 that
  // 20261007045539_person_fks_q448_named_columns.sql adds.
  it("scans the whole person-column inventory", () => {
    expect(all.size).toBe(222); // 222: +1 sign-up sources (20261031220447, OPS-5): member_signup_sources.user_id (FK to auth.users ON DELETE CASCADE); 221: +1 half-finished job posts (20261030223154, OPS-3): job_post_drafts.user_id (FK to auth.users ON DELETE CASCADE); 220: +1 applicant nudge (20261030150630, UX-3, Q2484): application_nudge_sends.user_id (FK to auth.users ON DELETE CASCADE); 219: +1 Sign in with Apple token store (20261030050004, Q1791): apple_sign_in_tokens.user_id (FK to auth.users ON DELETE CASCADE); 218: +1 the Free change (20261030064021, Q2487): declutter_free_pauses.user_id (FK to auth.users ON DELETE CASCADE); 217: +1 start reminders (20261030035326, Q2483, 2026-10-30): helpr_start_reminder_sends.user_id (FK to auth.users ON DELETE CASCADE); 216: +1 Book me (20261030013347, B66): booking_sources.user_id (FK to auth.users ON DELETE CASCADE; helpr_id is not a role name); 215: +1 web push (20261030022344, B65): push_subscriptions.user_id (measured on the stacked tree; B65 alone left 213); 214: +1 the paid-order chat (20261030004216, D2-1): declutter_order_talk_messages.sender_id (FK to auth.users ON DELETE SET NULL: the message keeps its sender_side after a deletion); 213: +2 the handover chat (20261028235249, #3730): declutter_handover_talks.opened_by and declutter_handover_talk_messages.sender_id (FKs to auth.users ON DELETE CASCADE; buyer_id/seller_id are not role names); 211: +1 per-person switch list (20261028151647, owner 2026-10-28): feature_switch_members.user_id (FK to auth.users ON DELETE CASCADE); 210: +1 tips on deliveries (20261028014848, Q2453): helpr_task_tips.helpr_id (FK to auth.users ON DELETE SET NULL: the tip is a money record kept after deletion; tipper_id is not a role name); 209: +1 donate what doesn't sell (20261027222743, 2026-10-27): declutter_donation_partners.created_by (FK to auth.users ON DELETE SET NULL: the admin who added the partner; declutter_donations has no person column); 208 before that: 208 measured on Train J: Train D (go-online, price-drop) and the Helpr Guarantee landed beside it; +1 safe meetup spots (20261027204500, 2026-10-27): declutter_meetup_spots.created_by (FK to auth.users ON DELETE SET NULL: the admin who added the spot; declutter_meetup_choices.buyer_id/seller_id are not role names); 205 before that: +1 Helpr Guarantee (20261027200455, 2026-10-27): job_guarantee_claims.helper_id (FK to auth.users ON DELETE SET NULL; poster_id is not a role name, so it is not counted); 204 before that: +1 confirm reminders (20261025190000, 2026-10-25): confirm_reminder_sends.user_id (FK to auth.users ON DELETE CASCADE); 203 before that: +2 email pacing (20261025182522, 2026-10-25): application_email_state.user_id and job_match_email_state.user_id (FKs to auth.users ON DELETE CASCADE); 201 before that: +1 checkout nudge (20261025170841, 2026-10-25): job_checkout_nudges.user_id (FK to auth.users ON DELETE CASCADE); 200 before that: +2 payout setup after the hire (20261025162003, 2026-10-25): payout_setup_reminders.helper_id (FK to auth.users ON DELETE CASCADE) and connect_account_retirements.user_id (FK ON DELETE SET NULL: the retired Stripe account id is a money record kept after deletion); 198 before that: +4 PayPal phase 1 (20261023223419, 2026-10-23): provider_payments.payer_id and provider_payouts.payee_user_id (FKs to auth.users ON DELETE SET NULL), payee_accounts.user_id (FK ON DELETE CASCADE), provider_payouts.marked_paid_by (no FK by design, NO_FK_BY_DESIGN); 194 before that: +1 support replies (20261023200521, 2026-10-23): support_replies.admin_id (FK to auth.users ON DELETE SET NULL); 193 before that: +1 approval queue (20261023143240, 2026-10-23): job_approval_escalations.resolved_by (FK to auth.users ON DELETE SET NULL); 192 before that: +3 SMS alerts (20261021193738, 2026-10-22): sms_consent.user_id and sms_messages.user_id (FKs to auth.users ON DELETE CASCADE) and sms_consent_events.user_id (FK ON DELETE SET NULL: the consent record is kept 4 years after deletion, Q2336); 189 before that: +3 board 141 refund requests (20261021102943, 2026-10-21): person columns on refund_requests and disputes, each a FK to auth.users ON DELETE SET NULL; 186 before that: +1 come-back emails (20261021113827, 2026-10-21): come_back_email_sends.user_id (FK to auth.users ON DELETE CASCADE); 185 before that: +1 payout failures (20261021030052, Builder 5 s2b, 2026-10-21): payout_failures.user_id (FK to auth.users ON DELETE CASCADE); 184 before that: +1 Saved homes (20261019185722, 2026-10-19): saved_homes.user_id (FK to auth.users ON DELETE CASCADE); 183 before that: +1 Shops M3 (20261019071055, 2026-10-19): shop_hand_refunds.recorded_by (no FK by design, NO_FK_BY_DESIGN); 182 before that: +2 Homes lease (20261019111310 area, 2026-10-19): rental_leases.landlord_id and .tenant_id, each a FK to auth.users; 180 before that: +2 Landlord ID (20261019051407, 2026-10-19): landlord_id_reviews.user_id (FK to auth.users ON DELETE CASCADE: account deletion removes the review with the photos) and .reviewed_by (FK ON DELETE SET NULL); 178 before that: +2 J4 Helpr at fault (20261019015301, 2026-10-19): job_helpr_fault_rulings.helper_id and .admin_id, each a FK to auth.users ON DELETE SET NULL; 176 before that: +2 Homes listings (20261019043000, 2026-10-18): rental_listings.owner_id and rental_listing_photos.owner_id, each with a FK to auth.users ON DELETE CASCADE; 174 before that: +1 Shops pickup address (20261018210400, 2026-10-18): shop_pickup_addresses.owner_id (FK to auth.users ON DELETE CASCADE); 173 before that: +2 Shops per-section strikes (20261018164444, 2026-10-18): shop_strikes.user_id (FK to auth.users ON DELETE CASCADE) and shop_strikes.removed_by (FK ON DELETE SET NULL); 171 before that: +1 one wallet (20261018090700, 2026-10-18): stripe_customers.user_id, FK to auth.users ON DELETE CASCADE; 170 before that: +8 Rentals S1 (20261017205605, 2026-10-15): rental_properties.owner_id/.ownership_reviewed_by, rental_units.owner_id, rental_tenancies.landlord_id/.tenant_id, maintenance_requests.tenant_id/.landlord_id, maintenance_request_photos.tenant_id (tenant and landlord joined PERSON_ROLES), each with a FK to auth.users; 162 before that: +6 Shops slice 2 items (20261017061157, 2026-10-16): shop_items.owner_id, shop_item_private.owner_id, shop_item_photos.owner_id, shop_item_attestations.owner_id, shop_cottage_confirmations.owner_id, shop_cottage_sales.owner_id, each with a FK to auth.users ON DELETE CASCADE; 156 before that: +5 Shops slice 1 (20261017061155, 2026-10-15): shops.owner_id/.sos_verified_by/.hidden_by, shop_photos.owner_id, shop_follows.user_id, each with a FK to auth.users; 151 before that: +2 Declutter slice 5 (20261017055505, 2026-10-16): helpr_vehicles.user_id (FK to auth.users ON DELETE CASCADE) and helpr_tasks.confirmed_by (how a delivery was confirmed, text, not a person); 149 before that: -2 +1 sec-a train (2026-10-17): 20261015000241 drops the unused user_strikes table (user_strikes.user_id/.issued_by gone), 20261015022636 adds job_payout_holds.held_by (no FK by design, NO_FK_BY_DESIGN); 150 before that:+1 Declutter wanted posts (20261016053541, 2026-10-16): declutter_wanted.user_id, FK to auth.users ON DELETE CASCADE; +4 Declutter slice 4 (20261015042253, 2026-10-15): declutter_problems.reporter_id/.decided_by, declutter_reviews.reviewer_id/.reviewee_id, each with a FK to auth.users; +1 Declutter slice 3 (20261014210518, 2026-10-14): declutter_buyer_cards.user_id, FK to auth.users ON DELETE CASCADE; +2 category_suggestions.user_id/.reviewed_by (I1, 20261015051141, 2026-10-15, FKs to auth.users ON DELETE SET NULL); +6 Declutter (20261014193955, 2026-10-14): declutter_seller_flags.set_by, declutter_strikes.user_id/.removed_by/.appeal_decided_by, declutter_watchlist.user_id, declutter_seller_flags.user_id, each with a FK to auth.users; +series_platform_ends.admin_id (Q1735, 2026-10-12, no FK by design: admin trail); +refund_notices.user_id (Q1714, 2026-10-12, FK to auth.users ON DELETE CASCADE); +messages.team_thread_user_id (2026-10-09, admin Team thread, FK to auth.users ON DELETE CASCADE); +new_member_admin_notices.user_id (2026-10-09, FK to auth.users ON DELETE CASCADE); +backout_notices.user_id (Q1575, 2026-10-08, FK to auth.users ON DELETE CASCADE); +job_detail_change_requests.requested_by and job_detail_change_answers.helper_id (Q1254, 2026-10-07, FKs to auth.users ON DELETE CASCADE); +crew_block_fees.helper_id (Q1390, 2026-10-07, FK to auth.users ON DELETE SET NULL); +crew_confirm_pending.helper_id (#2523, FK added by 20261007045539, CASCADE); +test_accounts.user_id (Q552, 2026-10-07, FK to auth.users); +identity_soft_fingerprints.user_id (Q1416, 2026-10-07, FK to auth.users ON DELETE CASCADE); +job_refund_claims.actor_user_id (Q1323, 2026-10-05); +payment_fingerprints.user_id, ban_evasion_matches.user_id, ban_settlement_queue.user_id/.decided_by (Q1324), payout_schedule_freezes.requested_by (Q1221), 2026-10-06, each with a FK
  });
  it("sees the columns this class is about (parser sanity)", () => {
    for (const k of ["notification_logs.user_id", "jobs.cancelled_by", "profiles.license_reviewed_by", "payment_refunds.initiated_by_user_id", "notifications.user_id",
      "jobs.offered_to_helper_id", "user_blocks.blocker_id", "reports.assigned_to", "tips.tipper_id", "str_calendar_connections.preferred_helper_id"]) {
      expect(all.has(k), k).toBe(true);
    }
  });
  it("no person column without a FK is missing from NO_FK_BY_DESIGN", () => {
    expect(missing.filter((k) => !(k in NO_FK_BY_DESIGN))).toEqual([]);
  });
  it("NO_FK_BY_DESIGN lists no column that now has a FK or no longer exists (exact, both directions)", () => {
    expect(Object.keys(NO_FK_BY_DESIGN).filter((k) => !missing.includes(k))).toEqual([]);
  });
});
