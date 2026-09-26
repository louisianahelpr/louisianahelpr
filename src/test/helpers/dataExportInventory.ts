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
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./blankNonCode";

const REPO = resolve(__dirname, "../../..");

/**
 * Column names that mean "a person". Matched against every column of every
 * public table in the generated types. Names that match but are not a person
 * (a deadline called `*_due_by`) are EXEMPT entries saying so; a person column
 * with a name this misses is still caught when a migration gives it a foreign
 * key to auth.users or profiles (fkUserColumns).
 */
const USER_COLUMN_RE =
  /^(?:user_id|\w+_user_id|customer_id|helper_id|\w+_helper_id|reviewer_id|reviewee_id|sender_id|receiver_id|recipient_id|donor_id|tipper_id|opener_id|owner_id|reporter_id|reported_id|blocker_id|blocked_id|referrer_id|referred_id|admin_id|applicant_id|viewer_id|searcher_id|\w+_by|email|\w+_email|email_sha256|assigned_to)$/;

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
  match_digest_queue: { by: ["user_id"] },
  favorite_helpers: { by: ["customer_id"] },
  helper_availability: { by: ["helper_id"] },
  helper_credentials: { by: ["user_id"] },
  helper_verifications: { by: ["user_id"] },
  verification_checks: { by: ["user_id"] },
  verification_exceptions: { by: ["user_id"] },
  helper_w9_records: { by: ["helper_id"] },
  instant_payouts: { by: ["helper_id"] },
  payout_transfers: { by: ["helper_id"] },
  payment_refunds: { by: ["customer_id"] },
  chargeback_clawbacks: { by: ["helper_id"] },
  tips: { by: ["tipper_id", "helper_id"] },
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
  application_rate_log: { by: ["applicant_id"] },
  profile_search_rate_log: { by: ["searcher_id"] },
};

/**
 * "table.column" → why the export does not scope by it. `stripped: true` means
 * the column is also REMOVED from the rows the export does return (the guard
 * checks export_my_data() drops it), because it names someone the person was
 * never shown or holds a secret.
 */
// @two-way src/test/dataExportCoversEveryUserTable.test.ts:no stale entry: every EXPORTED/EXEMPT column is a live person column
export const EXEMPT: Record<string, { reason: string; stripped?: true }> = {
  // Staff and anti-abuse records. Handing these over would tell an abuser what
  // was noticed and by whom; GDPR Art. 23(1)(d)/(i) and CCPA 1798.105(d)(2)
  // security exceptions. Owner decision pending: docs/OPEN.md Q290.
  "admin_audit_log.admin_id": { reason: "staff action log, keyed by the staff member" },
  "admin_user_notes.admin_id": { reason: "staff notes: the author is a staff member" },
  "admin_user_notes.user_id": { reason: "internal staff notes about the account (anti-abuse; owner decision pending, Q290)" },
  "fraud_flags.user_id": { reason: "fraud signals: disclosure defeats them (security exception; owner decision pending, Q290)" },
  "helper_shadowbans.helper_id": { reason: "a shadowban only works undisclosed (security exception; owner decision pending, Q290)" },
  "helper_shadowbans.created_by": { reason: "staff member who applied the shadowban" },
  "retained_bans.email_sha256": { reason: "ban-evasion hash kept AFTER deletion; a live account's ban is exported via user_bans" },
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
  // Staff or third-party ids on exported rows: removed from the export.
  "profiles.insurance_reviewed_by": { reason: "staff reviewer id", stripped: true },
  "profiles.license_reviewed_by": { reason: "staff reviewer id", stripped: true },
  "jobs.removed_by": { reason: "staff moderator id", stripped: true },
  "disputes.decided_by": { reason: "staff decider id", stripped: true },
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
