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
  saved_jobs: { by: ["user_id"] },
  saved_searches: { by: ["user_id"] },
  saved_search_alert_queue: { by: ["user_id"] },
  job_match_queue: { by: ["user_id"] },
  match_digest_queue: { by: ["user_id"] },
  parish_match_alert_queue: { by: ["user_id"] },
  ops_alert_admin_subjects: { by: ["user_id"] },
  favorite_helpers: { by: ["customer_id"] },
  helper_availability: { by: ["helper_id"] },
  helper_credentials: { by: ["user_id"] },
  helper_verifications: { by: ["user_id"] },
  verification_checks: { by: ["user_id"] },
  verification_exceptions: { by: ["user_id"] },
  helper_w9_records: { by: ["helper_id"] },
  instant_payouts: { by: ["helper_id"] },
  payout_transfers: { by: ["helper_id"] },
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
  user_strikes: { by: ["user_id"] },
  user_violations: { by: ["user_id"] },
  user_roles: { by: ["user_id"] },
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
  disputes: { by: ["opener_id"] },
  job_views: { by: ["viewer_id"] },
  profile_views: { by: ["viewer_user_id"] },
  pet_profiles: { by: ["owner_id"] },
  str_calendar_connections: { by: ["user_id"] },
  thread_archives: { by: ["user_id"] },
  thread_mutes: { by: ["user_id"] },
  thread_pins: { by: ["user_id"] },
  nps_responses: { by: ["user_id"] },
  analytics_events: { by: ["user_id"] },
  error_logs: { by: ["user_id"] },
  admin_user_notes: { by: ["user_id"] },
  fraud_flags: { by: ["user_id"] },
  helper_shadowbans: { by: ["helper_id"] },
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
 * Every public-table policy as the migrations leave it: CREATE/DROP POLICY and
 * ALTER POLICY (RENAME TO, USING) replayed in file order, comments blanked.
 * Keyed "table:name" (a quoted name keeps its case, a bare one is folded).
 */
export function replayedPolicies(): Map<string, { table: string; text: string }> {
  const dir = join(REPO, "supabase/migrations");
  const live = new Map<string, { table: string; text: string }>();
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
      events.push({ at: m.index!, apply: () => live.set(key(m[4], m[1], m[2]), { table: m[4].toLowerCase(), text: m[5] }) });
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
          } else if (/\busing\b/i.test(rest)) {
            live.set(from, { table: cur.table, text: cur.text.replace(/\busing\b[\s\S]*$/i, "") + " " + rest.slice(rest.search(/\busing\b/i)) });
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
  // Q552: the service-role-only enrolment of the platform's OWN test accounts
  // (the launch switch keeps test jobs visible to them). No member is ever in it.
  "test_accounts.user_id": { reason: "platform test-account enrolment, service role only; holds no member's data" },
  // Q1575: a seen/unseen flag over a back-out the person was ALSO told by an
  // in-app notification and email (notifications are exported); no content of its own.
  "backout_notices.user_id": { reason: "UI state for the Needs You banner: whether a back-out notice was seen; the same news is in the exported notifications" },
  // Staff-only records and ban-evasion data. Staff notes, fraud flags and
  // shadowbans ABOUT the person are exported (owner, 2026-09-26, Q290); what
  // stays out is who on staff wrote or applied them, and records that are the
  // staff's own rather than the person's.
  "admin_audit_log.admin_id": { reason: "staff action log, keyed by the staff member" },
  "new_member_admin_notices.user_id": { reason: "2026-10-09: the server's once-only marker that admins were told this member joined (when they confirmed their email); a timestamp about the account, none of the person's own data" },
  "pre_verification_wipes.user_id": { reason: "Q447: the server's record that a pre-verification takeover deleted what someone else typed into this account (and which stored objects to remove); it holds none of the person's own data" },
  "job_refund_claims.claimed_by": { reason: "Q1323: names the code path holding a refund claim ('cancel_escrow' or 'admin_refund_general'), not a person" },
  "job_refund_claims.actor_user_id": { reason: "Q1323: server lock marker naming who started an in-flight refund claim; deleted when the claim is put back, holds none of the person's own data" },
  "crew_confirm_pending.helper_id": { reason: "20261007011530: transient state of one crew Confirm waiting on payout setup (deleted when it completes or the spot is removed); holds no content, only the job, slot and person ids the export already carries through group_job_helpers" },
  "job_accept_pending.helper_id": { reason: "Q1180: transient state of one offer (deleted when the accept completes or the offer moves on); holds no content, only the job and person ids the export already carries through jobs" },
  "admin_user_notes.admin_id": { reason: "the staff member who wrote the note", stripped: true },
  "helper_shadowbans.created_by": { reason: "the staff member who applied the shadowban", stripped: true },
  "payout_holds.held_by": { reason: "Q764: the staff member who placed the payout hold", stripped: true },
  "payout_holds.denied_by": { reason: "Q764: the staff member who recorded the denial", stripped: true },
  "ban_evasion_matches.user_id": { reason: "Q1324: ABOUT another person: the banned account a card, bank or name match points at, with that account's ban reason and date (GDPR Art. 15(4)); admin-only so a person cannot learn whether a name or card belongs to a banned account" },
  "ban_settlement_queue.user_id": { reason: "Q1324: the staff queue for an automatic ban's jobs; the ban itself is exported via user_bans and the profile" },
  "ban_settlement_queue.decided_by": { reason: "Q1324: the staff member who confirmed or lifted the ban" },
  "payout_schedule_freezes.helper_id": { reason: "Q1221: the server's queue of Stripe payout-schedule changes a payout hold makes; the hold itself is exported in payout_holds, and the schedule is the person's own Stripe setting, shown in their Stripe dashboard" },
  "payout_schedule_freezes.requested_by": { reason: "Q1221: the staff member who placed or released the hold" },
  "job_match_queue.send_email": { reason: "a boolean (send the parish email or not), not a person: matched by name only" },
  "retained_bans.email_sha256": { reason: "ban-evasion hash kept AFTER deletion; a live account's ban is exported via user_bans" },
  "identity_soft_fingerprints.user_id": { reason: "Q1416: ban-evasion data, one salted hash of name + date of birth from the person's own ID check (no name, date or document stored); exporting it would show a banned person which of their details is fingerprinted" },
  "payment_fingerprints.user_id": { reason: "Q1324: ban-evasion data, salted hashes of Stripe card/bank fingerprints (no card or account details); the cards and accounts themselves are the person's own in Stripe, and listing which are fingerprinted would show a banned person which payment method to swap" },
  "dispute_settlement_claims.claimed_by": { reason: "transient settlement lock held by staff or a function, not the person's data" },
  "marketing_content.created_by": { reason: "staff-only marketing drafts" },
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
  "verification_exceptions.assigned_to": { reason: "staff assignee id", stripped: true },
  "reports.assigned_to": { reason: "staff assignee id", stripped: true },
  "payout_transfers.initiated_by": { reason: "who pressed release: staff or a function", stripped: true },
  "payout_transfers.initiated_by_user_id": { reason: "who pressed release: staff or a function", stripped: true },
  "payment_refunds.initiated_by_user_id": { reason: "who issued the refund: staff", stripped: true },
  "user_bans.banned_by": { reason: "staff id", stripped: true },
  "user_strikes.issued_by": { reason: "staff id", stripped: true },
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
