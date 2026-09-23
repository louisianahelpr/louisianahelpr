import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

/**
 * Q137 (docs/OPEN.md): a seed subject never notifies a real person.
 *
 * Before (prod, 2026-09-23): the Q100 fixture job (is_seed) was funded at
 * 11:35Z and notify_helpers_on_job_post told every matching helper in East
 * Baton Rouge "New job in your parish" and POSTed each one to
 * send-notification-email. Producers skipped a seed job only while the LAUNCH
 * switch seed_jobs_hidden_publicly() was true, and it is false on prod. 105
 * notifications in 30 days reached a non-seed account about a seed job.
 *
 * The rule now lives at the choke points (migration 20260923121354):
 *   - notifications BEFORE INSERT trg_notifications_seed_boundary (in-app AND
 *     push: push is fanned out by the AFTER INSERT trigger on the same row);
 *   - match_digest_queue BEFORE INSERT trg_match_digest_queue_seed_boundary;
 *   - send-notification-email asks notification_crosses_seed_boundary()
 *     before it sends; create-notification asks it (with the caller as actor)
 *     before it inserts;
 *   - sweep_daily_job_digest counts seed jobs only for seed recipients.
 * The trigger can only judge what a row CARRIES: its job_id, or a link naming
 * a job (job= / jobId= / quickApply= / /jobs/) or an actor (userId= /
 * offerTo= / user=). So this guard is built from the inventory of every
 * producer in the source:
 *   1. every SQL function (newest definition) that INSERTs into notifications;
 *   2. every edge-function .from("notifications").insert/upsert site;
 *   3. every email / push sender outside the choke points;
 * and each producer that does NOT carry its subject must be classified here
 * (no seed subject / a digest that filters seed itself / a KNOWN gap). A new
 * producer that neither carries its subject nor is classified fails CI.
 * Behaviour (live trigger chain, applied 3x):
 * src/test/pglite/seedNeverNotifiesReal.pglite.mjs — ALL PASS (30);
 * NEW_MIGRATION=skip -> 17 FAILED.
 */
// @mutate supabase/migrations/20260923121354_seed_subject_never_notifies_real.sql |   IF v_cross THEN\n    -- The record is best-effort |   IF false THEN\n    -- The record is best-effort
// @mutate supabase/migrations/20260923121354_seed_subject_never_notifies_real.sql |   BEFORE INSERT ON public.notifications\n  FOR EACH ROW EXECUTE FUNCTION public.notifications_seed_boundary(); |   AFTER INSERT ON public.notifications\n  FOR EACH ROW EXECUTE FUNCTION public.notifications_seed_boundary();
// @mutate supabase/migrations/20260923121354_seed_subject_never_notifies_real.sql | CREATE TRIGGER trg_notifications_seed_boundary | CREATE TRIGGER aaa_notifications_seed_boundary
// @mutate supabase/migrations/20260923121354_seed_subject_never_notifies_real.sql |     v_cross := true;\n    v_reason := 'seed boundary check failed, dropped: ' \|\| SQLERRM;\n  END;\n\n  IF v_cross THEN\n    -- The | v_cross := false;\n    v_reason := 'x';\n  END;\n\n  IF v_cross THEN\n    -- The
// @mutate supabase/migrations/20260923121354_seed_subject_never_notifies_real.sql |   BEFORE INSERT ON public.match_digest_queue | AFTER INSERT ON public.match_digest_queue
// @mutate supabase/migrations/20260923121354_seed_subject_never_notifies_real.sql |         AND (NOT nj.is_seed OR COALESCE(p.is_seed, false)) |         AND true
// @mutate supabase/migrations/20260923121354_seed_subject_never_notifies_real.sql |   v_job := COALESCE(p_job_id, public.notification_job_id_from_link(p_link)); |   v_job := p_job_id;
// @mutate supabase/migrations/20260923121354_seed_subject_never_notifies_real.sql | '[?&](?:userId\|offerTo\|user)= | '[?&](?:userId\|user)=
// @mutate supabase/migrations/20260923121354_seed_subject_never_notifies_real.sql | notification_crosses_seed_boundary(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated; | notification_crosses_seed_boundary(uuid, uuid, text, uuid) FROM PUBLIC;
// @mutate supabase/functions/send-notification-email/index.ts |     if (crossesSeed === true) { |     if (crossesSeed === 'never') {
// @mutate supabase/functions/send-notification-email/index.ts |     if (seedCheckError \|\| typeof crossesSeed !== 'boolean') { |     if (false) {
// @mutate supabase/functions/send-notification-email/index.ts |     if (seedCheckError \|\| typeof crossesSeed !== 'boolean') { |     if (seedCheckError?.code !== 'PGRST202' && (seedCheckError \|\| typeof crossesSeed !== 'boolean')) {
// @mutate supabase/functions/send-notification-email/index.ts |       await logSkip('failed', `seed boundary check failed, not sent: ${why}`) |       await logSkip('failed', `seed_boundary_check_failed: ${why}`)
// @mutate supabase/functions/send-notification-email/index.ts |       await postSlackOpsAlert({\n        kind: 'custom',\n        severity: 'critical',\n        title: 'Notification email refused |      void ({\n        kind: 'custom',\n        severity: 'critical',\n        title: 'Notification email refused
// @mutate supabase/migrations/20260923130621_seed_boundary_honest_skips_and_monitor.sql |   RETURN public.notification_crosses_seed_boundary(p_recipient, p_job_id, p_link, NULL); |   RETURN public.notification_crosses_seed_boundary(p_recipient, p_job_id, NULL, NULL);
// @mutate supabase/migrations/20260923130621_seed_boundary_honest_skips_and_monitor.sql |   IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN |   IF false THEN
// @mutate supabase/migrations/20260923130621_seed_boundary_honest_skips_and_monitor.sql | admin_notification_crosses_seed_boundary(uuid, uuid, text) FROM PUBLIC, anon; | admin_notification_crosses_seed_boundary(uuid, uuid, text) FROM PUBLIC;
// @mutate supabase/migrations/20260923130621_seed_boundary_honest_skips_and_monitor.sql |      AND l.error_message LIKE 'seed boundary check failed%';\n\n  IF v_24h = 0 THEN |      AND l.error_message LIKE 'seed_boundary_check_failed%';\n\n  IF v_24h = 0 THEN
// @mutate supabase/migrations/20260923130621_seed_boundary_honest_skips_and_monitor.sql |   ELSIF p_source = 'seed-boundary-check-failed' THEN |   ELSIF p_source = 'seed-boundary-check-failed-x' THEN
// @mutate supabase/migrations/20260923130621_seed_boundary_honest_skips_and_monitor.sql |     PERFORM cron.schedule('seed-boundary-failures', '41 * * * *', |     PERFORM cron.schedule('seed-boundary-failures', '41 3 1 1 *',
// @mutate .github/workflows/functions-deploy.yml |         run: node scripts/check-edge-rpcs-live.mjs --wait 300\n |         run: echo skipped\n
// @mutate supabase/functions/create-notification/index.ts |         p_actor: user.id, |         p_actor: null,
// @mutate supabase/functions/create-notification/index.ts |     if (crossesSeed === true) { |     if (crossesSeed === "never") {
// @mutate supabase/functions/daily-match-digest/index.ts | .from("notifications").insert(notifications) | .from("notifications").insert(notifications); await supabase.from("notifications").insert({ user_id: userId, title, message, type: "job_match" })

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const FN_ROOT = join(ROOT, "supabase", "functions");
const FIX = "20260923121354_seed_subject_never_notifies_real.sql";
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = new Map(files.map((f) => [f, blankSqlComments(readFileSync(join(MIG, f), "utf8"))]));
const ws = (s: string) => s.replace(/\s+/g, " ").trim();

// ── SQL inventory: the NEWEST definition of every public function ──────────
type Def = { file: string; body: string; order: number };
const newest = new Map<string, Def>();
const dropped = new Map<string, number>();
{
  let order = 0;
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi;
  const drop = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi;
  for (const file of files) {
    const sql = sqlOf.get(file)!;
    const events: Array<{ at: number; kind: "create" | "drop"; name: string; body?: string }> = [];
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
      if (!tag) continue;
      const open = tag.index! + tag[0].length;
      const close = rest.indexOf(tag[1], open);
      events.push({ at: m.index!, kind: "create", name: m[1].toLowerCase(), body: rest.slice(open, close) });
    }
    for (const m of sql.matchAll(drop)) events.push({ at: m.index!, kind: "drop", name: m[1].toLowerCase() });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      order++;
      if (e.kind === "create") newest.set(e.name, { file, body: e.body!, order });
      else dropped.set(e.name, order);
    }
  }
}
const liveDef = (name: string): Def | null => {
  const d = newest.get(name);
  if (!d) return null;
  const drop = dropped.get(name);
  return drop !== undefined && drop > d.order ? null : d;
};
const liveFunctions = [...newest.keys()].filter((n) => liveDef(n));

// A row CARRIES its subject when the trigger can read it: a job_id column, or
// a link naming a job or an actor.
const LINK_SUBJECT = /[?&](?:job|jobId|quickApply|userId|offerTo|user)=|\/jobs\//;
const INSERT_NOTIF_SQL = /INSERT\s+INTO\s+(?:public\.)?notifications\s*\(([^)]*)\)/gi;

type Site = { key: string; carries: boolean; text: string };
function sqlSites(): Site[] {
  const out: Site[] = [];
  for (const name of liveFunctions) {
    const { body } = liveDef(name)!;
    let k = 0;
    for (const m of body.matchAll(INSERT_NOTIF_SQL)) {
      k++;
      const cols = m[1].toLowerCase();
      const carries = /\bjob_id\b/.test(cols) || (/\blink\b/.test(cols) && LINK_SUBJECT.test(body));
      out.push({ key: `sql:${name}#${k}`, carries, text: body });
    }
  }
  return out;
}

// ── TS inventory: edge functions AND the client (src/) ─────────────────────
const tsFiles = [...walkSource([FN_ROOT]), ...walkSource([join(ROOT, "src")])].filter(
  (f) => !/(^|\/)(__tests__|tests?)\/|\.test\.tsx?$|src\/integrations\/supabase\/types\.ts$/.test(relative(ROOT, f)),
);
const codeOf = new Map(tsFiles.map((f) => [f, blankComments(readFileSync(f, "utf8"))]));
const rel = (f: string) => relative(ROOT, f);
const INSERT_NOTIF_TS = /from\(\s*["']notifications["']\s*\)\s*\.(?:insert|upsert)\(\s*/g;
function tsSites(): Site[] {
  const out: Site[] = [];
  for (const f of tsFiles) {
    const src = codeOf.get(f)!;
    let k = 0;
    for (const m of src.matchAll(INSERT_NOTIF_TS)) {
      k++;
      const after = src.slice(m.index! + m[0].length);
      // An inline object/array literal: judge the literal. A variable (rows
      // built earlier): judge the whole file.
      const window = /^[[{]/.test(after) ? after.slice(0, 900) : src;
      const carries = /\bjob_id\b/.test(window) || LINK_SUBJECT.test(window);
      out.push({ key: `ts:${rel(f)}#${k}`, carries, text: window });
    }
  }
  return out;
}

// ── Producers that do NOT carry their subject, classified ──────────────────
// NONE: the row has no seed subject to carry. It is about the recipient's own
// account (their payout, subscription, verification, warning), or an operator
// broadcast. Anything about a JOB or a counterpart belongs in KNOWN_GAP.
const NO_SEED_SUBJECT: Record<string, string> = {
  "ts:supabase/functions/admin-update-email/index.ts#1": "own sign-in email changed by an admin",
  "ts:supabase/functions/admin-update-email/index.ts#2": "own email updated by an admin",
  "ts:supabase/functions/cash-out-credits/index.ts#1": "own referral-credit cash-out",
  "ts:supabase/functions/expire-subscriptions/index.ts#1": "own subscription expired",
  "ts:supabase/functions/instant-payout/index.ts#1": "own instant payout",
  "ts:supabase/functions/stripe-connect/index.ts#1": "own payout method removed",
  "ts:supabase/functions/stripe-connect/index.ts#2": "own payout account reset",
  "ts:supabase/functions/stripe-idv-webhook/index.ts#1": "own identity verified",
  "ts:supabase/functions/stripe-idv-webhook/index.ts#3": "own identity under review",
  "ts:supabase/functions/stripe-webhook/handlers/accountUpdated.ts#1": "own payout account ready",
  "ts:supabase/functions/stripe-webhook/handlers/accountUpdated.ts#2": "own payout account verified",
  "ts:supabase/functions/stripe-webhook/handlers/accountUpdated.ts#3": "own payout account needs attention",
  "ts:supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts#2": "own background check started",
  "ts:supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts#1": "own duplicate fee refunded",
  "ts:supabase/functions/weekly-helper-report/index.ts#1": "own weekly stats",
  "ts:src/components/admin/adminusers/useAdminUserActions.ts#1": "own ban lifted (admin actor, never seed)",
  "sql:review_credential#1": "own credential reviewed",
  "sql:fan_out_broadcast_to_notifications#1": "admin broadcast",
  "sql:sweep_pending_broadcast_fan_outs#1": "admin broadcast",
  "sql:sweep_expired_auto_bans#1": "own restriction lifted",
  "sql:apply_consequence_ladder#1": "own warning",
  "sql:apply_message_scan_consequence#1": "own message hidden",
  "sql:admin_reverse_violation#1": "own warning removed",
};
// DIGEST: one row about MANY jobs; the producer must exclude seed jobs for
// non-seed recipients itself (asserted below).
const DIGEST_FILTERS_SEED: Record<string, string> = {
  "sql:sweep_daily_job_digest#1": "New jobs in <parish>: counts seed jobs only for seed recipients (Q137)",
};
// KNOWN_GAP: about a job or a counterpart, but the row does not carry it, so
// the trigger cannot judge it. EXACT (two-way). Closing one = add job_id (or a
// job/actor link) to its insert and delete its line here. Follow-up: Q139.
// @two-way src/test/seedNeverNotifiesReal.test.ts:const staleClassified =
const KNOWN_GAP: Record<string, string> = {
  "ts:supabase/functions/arrival-confirm-reminder/index.ts#1": "job",
  "ts:supabase/functions/auto-expire-jobs/index.ts#2": "job",
  "ts:supabase/functions/auto-expire-jobs/index.ts#3": "job",
  "ts:supabase/functions/charge-recurring-visits/index.ts#2": "series job",
  "ts:supabase/functions/check-pro-subscription/index.ts#1": "referred account (actor)",
  "ts:supabase/functions/create-payment/index.ts#12": "job",
  "ts:supabase/functions/execute-dispute-split/index.ts#1": "job",
  "ts:supabase/functions/payment-confirm-reminder/index.ts#1": "job",
  "ts:supabase/functions/process-scheduled-payouts/index.ts#2": "job (admin alert)",
  "ts:supabase/functions/process-scheduled-payouts/index.ts#4": "job (admin alert)",
  "ts:supabase/functions/release-payout/index.ts#1": "job (admin alert)",
  "ts:supabase/functions/release-payout/index.ts#2": "job (admin alert)",
  "ts:supabase/functions/release-payout/index.ts#3": "job (admin alert)",
  "ts:supabase/functions/review-nag-cron/index.ts#1": "job",
  "ts:supabase/functions/stalled-completion-reminder/index.ts#1": "job",
  "ts:supabase/functions/stripe-idv-webhook/index.ts#2": "member (admin alert)",
  "ts:supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts#1": "job (admin alert)",
  "ts:supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts#2": "job (admin alert)",
  "ts:supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts#1": "job (admin alert)",
  "ts:supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts#1": "job (tip)",
  "ts:supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts#3": "donor (actor)",
  "ts:supabase/functions/void-cancelled-payments/index.ts#1": "job",
  "ts:supabase/functions/void-cancelled-payments/index.ts#2": "job",
  "sql:check_referral_bonus#1": "job",
  "sql:check_referral_bonus#2": "job",
  "sql:check_referral_bonus#3": "job",
  "sql:check_referral_bonus#4": "job",
  "sql:track_revision_scope_creep#1": "job",
  "sql:track_revision_scope_creep#2": "job",
  "sql:notify_poster_on_status_change#1": "job",
  "sql:notify_helper_on_tip#1": "job",
  "sql:notify_helper_on_direct_offer#1": "job",
  "sql:notify_helper_application_viewed#1": "job",
  "sql:respond_to_direct_offer#1": "job",
  "sql:expire_unanswered_offers#1": "job",
  "sql:expire_unanswered_offers#2": "job",
  "sql:sweep_dayof_confirm_reminders#1": "job",
  "sql:sweep_dayof_confirm_reminders#2": "job",
  "sql:sweep_dayof_confirm_reminders#3": "job",
  "sql:apply_job_denial_consequence#1": "job",
  "sql:sweep_release_last_chance#1": "job",
  "sql:helper_abort_job#1": "job",
  "sql:helper_abort_job#2": "job",
  "sql:apply_low_rating_flag#1": "member (admin alert)",
  "sql:apply_consequence_ladder#2": "member (admin alert)",
};

const sites = [...sqlSites(), ...tsSites()];
const uncarried = sites.filter((s) => !s.carries).map((s) => s.key).sort();
const classified = [...Object.keys(NO_SEED_SUBJECT), ...Object.keys(DIGEST_FILTERS_SEED), ...Object.keys(KNOWN_GAP)].sort();

// ── Senders outside the notifications table ────────────────────────────────
const sqlCalling = (needle: string) => liveFunctions.filter((n) => liveDef(n)!.body.includes(needle)).sort();
const tsCalling = (re: RegExp) => tsFiles.filter((f) => re.test(codeOf.get(f)!)).map(rel).sort();
// Email senders other than the notification mail. Each mails an account about
// ITSELF (or support / marketing), never about a job or a counterpart; the
// gift-card mail names a donor and is a KNOWN gap (Q139).
const EMAIL_SENDERS: Record<string, string> = {
  "supabase/functions/_shared/resend.ts": "the transport itself",
  "supabase/functions/send-notification-email/index.ts": "CHOKE POINT: asks notification_crosses_seed_boundary first",
  "supabase/functions/auth-email-hook/index.ts": "own auth mail",
  "supabase/functions/contact-support/index.ts": "to the support inbox",
  "supabase/functions/engagement-automations/index.ts": "own-account nudges + operator digest",
  "supabase/functions/notify-email-change/index.ts": "own email change",
  "supabase/functions/process-email-queue/index.ts": "drains the queue the senders above fill",
  "supabase/functions/send-account-status-email/index.ts": "own account status",
  "supabase/functions/send-marketing-blast/index.ts": "admin-authored marketing",
  "supabase/functions/admin-update-email/index.ts": "own email changed by an admin",
  "supabase/functions/admin-user-actions/index.ts": "own verification / ID re-upload / password reset / formal warning",
  "supabase/functions/_shared/giftCardEmail.ts": "KNOWN GAP (Q139): names the donor",
};

describe("Q137: a seed subject never notifies a real person", () => {
  it("the inventory is real (floors)", () => {
    const sqlFns = new Set(sites.filter((s) => s.key.startsWith("sql:")).map((s) => s.key.split("#")[0]));
    // Live 2026-09-23 (pg_proc bodies that INSERT into notifications): 44
    // functions; the repo's newest definitions name the same 44.
    expect(sqlFns.size).toBeGreaterThan(40);
    expect(sites.filter((s) => s.key.startsWith("sql:")).length).toBeGreaterThan(55);
    expect(sites.filter((s) => s.key.startsWith("ts:supabase/functions/")).length).toBeGreaterThan(65);
    expect(sites.filter((s) => s.key.startsWith("ts:src/")).length).toBeGreaterThan(2);
    expect(sites.filter((s) => s.carries).length).toBeGreaterThan(40);
    expect(Object.keys(EMAIL_SENDERS).length).toBeGreaterThan(8);
  });

  it("every producer that does not carry its subject is classified, exactly (two-way)", () => {
    const missing = uncarried.filter((k) => !classified.includes(k));
    // A classified producer that now carries its subject (or is gone): remove its line.
    const staleClassified = classified.filter((k) => !uncarried.includes(k));
    expect({ missing, stale: staleClassified }).toEqual({ missing: [], stale: [] });
    expect(new Set(classified).size).toBe(classified.length);
  });

  it("a digest producer filters seed jobs itself", () => {
    for (const key of Object.keys(DIGEST_FILTERS_SEED)) {
      const site = sites.find((s) => s.key === key);
      expect(site, key).toBeTruthy();
      expect(ws(site!.text), `${key} must exclude seed jobs for non-seed recipients`).toMatch(
        /AND \(NOT nj\.is_seed OR COALESCE\(p\.is_seed, false\)\)/,
      );
    }
  });

  it("push leaves the database only through the notifications row", () => {
    expect(sqlCalling("send-push-notification")).toEqual(["fan_out_push_on_notification"]);
    expect(tsCalling(/functions\/v1\/send-push-notification/)).toEqual(["supabase/functions/admin-test-push/index.ts"]);
  });

  it("every SQL email producer also writes the notifications row (the email sender re-checks)", () => {
    const emailers = sqlCalling("send-notification-email");
    expect(emailers).toEqual(["notify_helpers_on_job_post", "notify_on_application", "notify_saved_searches_on_new_job"]);
    for (const fn of emailers) expect(/INSERT\s+INTO\s+(?:public\.)?notifications\b/i.test(liveDef(fn)!.body), fn).toBe(true);
  });

  it("every email sender outside send-notification-email is listed, exactly", () => {
    const senders = tsCalling(/sendWithResend\(|queueEmail\(|["']enqueue_email["']|api\.resend\.com/);
    expect(senders).toEqual(Object.keys(EMAIL_SENDERS).sort());
  });

  it("the choke points exist in the newest definitions", () => {
    const fix = sqlOf.get(FIX);
    expect(fix, "migration present").toBeTruthy();
    const trg = ws(liveDef("notifications_seed_boundary")!.body);
    expect(trg).toMatch(/v_cross := public\.notification_crosses_seed_boundary\(NEW\.user_id, NEW\.job_id, NEW\.link\);/);
    expect(trg).toMatch(/EXCEPTION WHEN OTHERS THEN v_cross := true;/);
    expect(trg).toMatch(/IF v_cross THEN .* RETURN NULL; END IF; RETURN NEW;/);
    const q = ws(liveDef("match_digest_queue_seed_boundary")!.body);
    expect(q).toMatch(/v_cross := public\.notification_crosses_seed_boundary\(NEW\.user_id, NEW\.job_id, NULL\);/);
    expect(q).toMatch(/EXCEPTION WHEN OTHERS THEN v_cross := true;/);
    expect(q).toMatch(/IF v_cross THEN .* RETURN NULL; END IF; RETURN NEW;/);
    const all = files.map((f) => sqlOf.get(f)!).join("\n");
    const lastTrigger = (name: string) =>
      [...all.matchAll(new RegExp(`CREATE\\s+TRIGGER\\s+(\\w+)\\s+(BEFORE|AFTER)\\s+INSERT\\s+ON\\s+public\\.(\\w+)\\s+FOR\\s+EACH\\s+ROW\\s+EXECUTE\\s+FUNCTION\\s+public\\.${name}\\(`, "gi"))].pop();
    const t1 = lastTrigger("notifications_seed_boundary");
    expect(t1?.slice(1)).toEqual(["trg_notifications_seed_boundary", "BEFORE", "notifications"]);
    const t2 = lastTrigger("match_digest_queue_seed_boundary");
    expect(t2?.slice(1)).toEqual(["trg_match_digest_queue_seed_boundary", "BEFORE", "match_digest_queue"]);
    // BEFORE triggers fire in name order: the boundary must sort after the one
    // that recovers job_id from the link.
    expect(t1![1] > "trg_notifications_fill_job_id").toBe(true);
    const later = files.filter((f) => f > FIX).map((f) => sqlOf.get(f)!).join("\n");
    expect(later).not.toMatch(/DROP\s+TRIGGER\s+(IF\s+EXISTS\s+)?trg_(notifications|match_digest_queue)_seed_boundary/i);
    const b = ws(liveDef("notification_crosses_seed_boundary")!.body);
    expect(b).toMatch(/v_job := COALESCE\(p_job_id, public\.notification_job_id_from_link\(p_link\)\);/);
    expect(b).toContain("(?:userId|offerTo|user)=");
    expect(b).toMatch(/v_actor := COALESCE\(p_actor, v_actor_text::uuid\);/);
    expect(ws(fix!)).toContain(
      "REVOKE ALL ON FUNCTION public.notification_crosses_seed_boundary(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;",
    );
  });

  it("send-notification-email and create-notification ask the boundary before they send / insert", () => {
    const mail = codeOf.get(join(FN_ROOT, "send-notification-email", "index.ts"))!;
    const ask = mail.indexOf("'notification_crosses_seed_boundary'");
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(mail.indexOf("rpc('enqueue_email'"));
    expect(ask).toBeLessThan(mail.indexOf("sendWithResend("));
    expect(ws(mail)).toContain("if (seedCheckError || typeof crossesSeed !== 'boolean') {");
    // Q159: NO error code falls through to a send (PGRST202 used to).
    expect(mail).not.toMatch(/PGRST202/);
    expect(ws(mail)).toMatch(/if \(crossesSeed === true\) \{ await logSkip\('suppressed_seed'/);
    const cn = codeOf.get(join(FN_ROOT, "create-notification", "index.ts"))!;
    const ask2 = cn.indexOf('"notification_crosses_seed_boundary"');
    expect(ask2).toBeGreaterThan(0);
    expect(ask2).toBeLessThan(cn.indexOf('.from("notifications")'));
    expect(ws(cn)).toContain("p_actor: user.id,");
    expect(ws(cn)).toMatch(/if \(crossesSeed === true\) \{ return new Response/);
  });
});

// ── Q157 / Q159 / Q160 (review of Q137, 2026-09-23) ─────────────────────────
const HONEST = "20260923130621_seed_boundary_honest_skips_and_monitor.sql";
describe("Q157/Q159/Q160: the seed boundary is honest and observable", () => {
  it("Q157: admins can ask the trigger's exact question, and only admins", () => {
    const d = liveDef("admin_notification_crosses_seed_boundary");
    expect(d, "admin_notification_crosses_seed_boundary defined").toBeTruthy();
    const b = ws(d!.body);
    // Same arguments as trg_notifications_seed_boundary (user_id, job_id, link; no actor).
    expect(b).toContain("RETURN public.notification_crosses_seed_boundary(p_recipient, p_job_id, p_link, NULL);");
    expect(b).toMatch(/IF NOT COALESCE\(public\.has_role\(auth\.uid\(\), 'admin'::public\.app_role\), false\) THEN RAISE EXCEPTION/);
    const mig = ws(sqlOf.get(HONEST)!);
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.admin_notification_crosses_seed_boundary(uuid, uuid, text) FROM PUBLIC, anon;");
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.admin_notification_crosses_seed_boundary(uuid, uuid, text) TO authenticated, service_role;");
    // The client asks it BEFORE the insert and treats TRUE as a skip.
    const admin = codeOf.get(join(ROOT, "src", "components", "admin", "AdminJobs.tsx"))!;
    const ask = admin.indexOf('"admin_notification_crosses_seed_boundary"');
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(admin.indexOf('.from("notifications").insert(row)'));
  });

  it("Q160: every writer of a check-failure row uses the prefix the monitor reads", () => {
    const PREFIX = "seed boundary check failed";
    const trg = liveDef("notifications_seed_boundary")!.body;
    const q = liveDef("match_digest_queue_seed_boundary")!.body;
    for (const [name, body] of [["notifications_seed_boundary", trg], ["match_digest_queue_seed_boundary", q]] as const) {
      expect(body, name).toContain(`v_reason := '${PREFIX}, dropped: ' || SQLERRM;`);
    }
    const mail = codeOf.get(join(FN_ROOT, "send-notification-email", "index.ts"))!;
    expect(mail).toContain("await logSkip('failed', `" + PREFIX + ", not sent: ${why}`)");
    // A deliberate suppression must NOT match the prefix, or every seed skip pages.
    expect("seed subject to a non-seed recipient".startsWith(PREFIX)).toBe(false);
    const chk = ws(liveDef("check_seed_boundary_failures")!.body);
    expect(chk).toContain(`AND l.error_message LIKE '${PREFIX}%';`);
    expect(chk).toContain("jsonb_build_object('source', 'seed-boundary-check-failed', 'area', 'notifications')");
    expect(chk).toMatch(/IF v_reported IS NULL OR v_newest > v_reported THEN INSERT INTO public\.error_logs/);
    const cond = ws(liveDef("ops_alert_condition")!.body);
    expect(cond).toMatch(
      new RegExp(`ELSIF p_source = 'seed-boundary-check-failed' THEN IF p_probe_only THEN RETURN true; END IF; RETURN EXISTS \\( SELECT 1 FROM public\\.notification_logs l WHERE l\\.created_at > now\\(\\) - interval '24 hours' AND l\\.error_message LIKE '${PREFIX}%'\\);`),
    );
    const mig = ws(sqlOf.get(HONEST)!);
    expect(mig).toContain("PERFORM cron.schedule('seed-boundary-failures', '41 * * * *', 'SELECT public.check_seed_boundary_failures();');");
    expect(mig).toContain("VALUES ('seed-boundary-failures', interval '3 hours',");
  });

  it("Q159: the email path fails closed on every check error, and says so", () => {
    const mail = codeOf.get(join(FN_ROOT, "send-notification-email", "index.ts"))!;
    const refuse = mail.indexOf("if (seedCheckError || typeof crossesSeed !== 'boolean') {");
    expect(refuse).toBeGreaterThan(0);
    const branch = mail.slice(refuse, mail.indexOf("if (crossesSeed === true) {", refuse));
    expect(branch).toContain("postSlackOpsAlert(");
    expect(branch).toContain("status: 503");
    expect(refuse).toBeLessThan(mail.indexOf("sendWithResend("));
  });

  it("Q159: functions-deploy fails while an RPC an edge function calls is missing on prod, before uploading", () => {
    const wf = readFileSync(join(ROOT, ".github", "workflows", "functions-deploy.yml"), "utf8");
    const step = wf.indexOf("run: node scripts/check-edge-rpcs-live.mjs --wait 300\n");
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(wf.indexOf("- name: Deploy each function"));
    const block = wf.slice(wf.lastIndexOf("- name:", step), step);
    expect(block).not.toMatch(/continue-on-error/);
    // The script's inventory is derived from source, so it covers this RPC.
    const script = readFileSync(join(ROOT, "scripts", "check-edge-rpcs-live.mjs"), "utf8");
    expect(script).toContain("/\\.rpc\\(\\s*[\"'`]([a-z_][a-z_0-9]*)[\"'`]/g");
    expect(script).toContain("process.exit(1);");
  });
});
