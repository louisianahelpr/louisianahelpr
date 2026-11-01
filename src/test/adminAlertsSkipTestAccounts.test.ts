/**
 * Test stuff never reaches an admin's bell (owner, 2026-10-30, top priority:
 * "test stuff must NEVER show in admin or on the owner's notifications").
 *
 * On 2026-10-30 the owner saw "New member joined" for mailinator audit
 * throwaways nobody had marked is_seed, and "Declutter problem reported" /
 * "Declutter refund to decide" alerts from test-account orders. Migration
 * 20261030143141 fixed it at the source; this guard keeps EVERY function that
 * notifies admins covered.
 *
 * The inventory is built from the migrations (the NEWEST definition of every
 * function whose body names the admin role and writes a notification), and
 * every member is classified exactly, both ways. Each class is checked against
 * the code, not taken on trust:
 *   link     every '/admin...' link it writes names its subject (user= or
 *            job=), so the notification gate (notification_crosses_seed_boundary)
 *            drops a test subject's alert;
 *   caller   it runs as the signed-in member whose action raised the alert
 *            (it reads auth.uid()), and the gate drops an admin alert a test
 *            member's own action raised;
 *   explicit it calls public.is_test_subject() itself (it can run with no
 *            signed-in member and with a bare '/admin' link);
 *   sum      its alert is about a total, not a person: every function it
 *            reads the total from leaves out test subjects' rows;
 *   gap      NOT yet covered: the exact list still to fix (queue item in
 *            docs/OPEN.md). A fix moves a name out; a new admin notifier with
 *            no skip fails until it is classified. Migration 20261030150104
 *            closed the last five (2026-10-30), so the list is empty.
 */
// @mutate supabase/migrations/20261030143141_admin_alerts_skip_test_accounts.sql |   IF v_admin_row AND (SELECT auth.uid()) IS NOT NULL |   IF false AND (SELECT auth.uid()) IS NOT NULL
// @mutate supabase/migrations/20261030143141_admin_alerts_skip_test_accounts.sql | AND v_actor <> p_recipient AND public.is_test_subject(v_actor) THEN | AND v_actor <> p_recipient AND public.is_test_member(v_actor) THEN
// @mutate supabase/migrations/20261030143141_admin_alerts_skip_test_accounts.sql |     IF NOT (public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN |     IF true THEN
// @mutate supabase/migrations/20261031152136_new_member_daily_summary.sql |   IF v_seed OR public.is_test_subject(p_user_id) THEN |   IF v_seed THEN
// @mutate supabase/migrations/20261030150104_admin_alerts_skip_test_gaps.sql |       IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN |       IF NOT (o.is_seed) THEN
// @mutate supabase/migrations/20261030150104_admin_alerts_skip_test_gaps.sql |   IF NOT (public.is_test_subject(_uid) OR public.is_test_subject(_customer) OR public.is_test_subject(_helper)) THEN |   IF true THEN
// @mutate supabase/migrations/20261030150104_admin_alerts_skip_test_gaps.sql |                     WHERE NOT d.is_seed AND d.status = 'handed_over'\n                      AND NOT public.is_test_subject(d.buyer_id) AND NOT public.is_test_subject(d.seller_id) |                     WHERE NOT d.is_seed AND d.status = 'handed_over'
// @mutate supabase/migrations/20261030150104_admin_alerts_skip_test_gaps.sql |     OR public.is_test_subject(_opener_id); |     OR false;
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "../../supabase/migrations");

type Kind = "link" | "caller" | "explicit" | "sum" | "gap";
const ADMIN_NOTIFIERS: Record<string, Kind> = {
  apply_consequence_ladder: "link",
  apply_low_rating_flag: "link",
  auto_escalate_reports: "link",
  auto_restrict_repeat_violators: "link",
  block_user_and_settle: "link",
  declutter_answer_no_show: "caller", // 20261031004529: the seller answering a buyer's no-show report
  declutter_alert_overdue_checks: "explicit", // 20261101042045: listings on sale 45+ min with no check; NOT is_test_subject(i.seller_id) and NOT is_seed in the select
  declutter_handover_sweep: "explicit", // 20261031004529: the 60-day held sale
  declutter_helpr_answer_no_show: "explicit", // 20261031134217: the Helpr answers a seller's "didn't come"; is_test_subject on buyer, seller and caller, and is_seed
  declutter_hold_unchecked_listings: "explicit", // 20261031152545: a reserved or sold listing never checked; is_test_subject on the seller
  declutter_problem_add_side: "caller",
  declutter_record_ai_check: "explicit", // 20261031152545: a flag after a buyer paid; is_test_subject on the seller
  declutter_refund_request_to_admin: "explicit",
  declutter_report_problem: "caller",
  declutter_withdraw_problem: "caller",
  detect_stuck_payments: "link",
  enforce_retained_payment_ban: "explicit",
  helpr_task_cant_finish: "explicit", // 20261031231150 (BUY-36): a Helpr with the item reports a problem; is_seed on task and order, is_test_subject on buyer, seller and Helpr
  helpr_task_seller_return_answer: "explicit", // 20261031231150 (BUY-36): the seller says it did not come back; is_seed on task and order, is_test_subject on buyer, seller and Helpr
  helpr_task_sweep: "explicit", // 20261031231150 (BUY-36): a stalled can't-finish delivery; is_seed on the task, is_test_subject on customer, pickup contact and Helpr
  facilitator_threshold_check: "sum",
  notify_admins_support_ticket: "explicit",
  open_dispute_as: "explicit",
  rentals_submit_landlord_id: "caller",
  rentals_submit_ownership_proof: "caller",
  rpc_escalate_dispute: "link",
  send_new_member_daily_summary: "explicit",
  settle_one_off_jobs_for_banned_account: "link",
  shop_refund_sweep: "explicit",
  shops_report_not_received: "caller",
  sweep_idv_review_waiting: "link",
  sweep_open_ban_settlement_reviews: "explicit",
};

/** Newest body of every public function across the migrations (any dollar-quote tag). */
function newestBodies(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(DIR, file), "utf8");
    let m: RegExpExecArray | null;
    head.lastIndex = 0;
    while ((m = head.exec(sql))) {
      const as = /\bAS\s+(\$[A-Za-z_]*\$)/gi;
      as.lastIndex = m.index + m[0].length;
      const a = as.exec(sql);
      if (!a) continue;
      const end = sql.indexOf(a[1], a.index + a[0].length);
      if (end < 0) continue;
      out.set(m[1], { file, body: blankSqlComments(sql.slice(a.index + a[0].length, end)) });
    }
  }
  return out;
}

const BODIES = newestBodies();
const notifiesAdmins = (b: string) =>
  /role\s*=\s*'admin'/.test(b) && /INSERT\s+INTO\s+(?:public\.)?notifications|declutter_notify\s*\(|notify_admins/i.test(b);
const INVENTORY = [...BODIES.entries()].filter(([, v]) => notifiesAdmins(v.body)).map(([k]) => k).sort();
/** A sum-class alert's totals: each named function must leave test subjects out. */
const SUM_SOURCES: Record<string, string[]> = {
  facilitator_threshold_check: ["facilitated_la_sales_cents"],
};
/** Every `FROM public.<orders> <alias>` in the body is followed by a test skip on that alias's buyer and seller. */
function sumSkipsTestParties(b: string): boolean {
  const froms = [...b.matchAll(/FROM\s+public\.(\w*orders)\s+(\w+)/g)];
  if (froms.length === 0) return false;
  return froms.every(([, , alias]) =>
    new RegExp(`NOT public\\.is_test_subject\\(${alias}\\.buyer_id\\) AND NOT public\\.is_test_subject\\(${alias}\\.seller_id\\)`).test(b),
  );
}
const adminLinks = (b: string) => [...b.matchAll(/'(\/admin[^']*)'/g)].map((m) => m[1]);

describe("every function that notifies admins skips test accounts", () => {
  it("reads a plausible inventory (guards the parser)", () => {
    expect(BODIES.size).toBeGreaterThan(800);
    expect(INVENTORY.length).toBeGreaterThan(15);
    expect(INVENTORY).toContain("send_new_member_daily_summary");
  });

  it("every admin notifier is classified, exactly (both ways)", () => {
    expect(INVENTORY).toEqual(Object.keys(ADMIN_NOTIFIERS).sort());
  });

  it("the notification gate drops a test subject in an admin alert", () => {
    const gate = BODIES.get("notification_crosses_seed_boundary")?.body ?? "";
    // the actor named in the link or by the caller: any test subject, not only is_seed
    expect(gate).toMatch(/v_actor\s*<>\s*p_recipient\s+AND\s+public\.is_test_subject\(v_actor\)/);
    // admin-facing rows: the job's parties and the signed-in member who raised it
    expect(gate).toMatch(/v_admin_row\s*:=\s*COALESCE\(p_link, ''\) LIKE '\/admin%'/);
    expect(gate).toMatch(/public\.is_test_subject\(j\.customer_id\)\s+OR\s+public\.is_test_subject\(j\.helper_id\)/);
    expect(gate).toMatch(/IF v_admin_row AND \(SELECT auth\.uid\(\)\) IS NOT NULL[\s\S]*public\.is_test_subject\(\(SELECT auth\.uid\(\)\)\)/);
    const subject = BODIES.get("is_test_subject")?.body ?? "";
    expect(subject).toMatch(/public\.is_test_member\(p_user_id\)/);
    expect(subject).toMatch(/public\.is_fixture_email\(u\.email\)/);
  });

  it("each class holds in the code", () => {
    const wrong: string[] = [];
    for (const [fn, kind] of Object.entries(ADMIN_NOTIFIERS)) {
      const b = BODIES.get(fn)?.body ?? "";
      if (kind === "link") {
        const bare = adminLinks(b).filter((l) => !/[?&](user|job)=/.test(l));
        if (adminLinks(b).length === 0 || bare.length > 0) wrong.push(`${fn}: link class but writes ${JSON.stringify(bare)}`);
      } else if (kind === "caller") {
        if (!/auth\.uid\(\)/.test(b)) wrong.push(`${fn}: caller class but never reads auth.uid()`);
      } else if (kind === "explicit") {
        if (!/public\.is_test_subject\(/.test(b)) wrong.push(`${fn}: explicit class but never calls is_test_subject`);
      } else if (kind === "sum") {
        const sums = SUM_SOURCES[fn] ?? [];
        if (sums.length === 0) wrong.push(`${fn}: sum class but no SUM_SOURCES entry`);
        for (const src of sums) {
          if (!new RegExp(`public\\.${src}\\(`).test(b)) wrong.push(`${fn}: sum class but never reads ${src}`);
          if (!sumSkipsTestParties(BODIES.get(src)?.body ?? "")) wrong.push(`${src}: a total behind ${fn} counts test subjects' rows`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("the gap list is exact: a fixed function leaves it", () => {
    // A 'gap' that now calls is_test_subject, or whose links all name a subject,
    // is covered: move it to its real class (the list only shrinks).
    const covered = Object.entries(ADMIN_NOTIFIERS)
      .filter(([, k]) => k === "gap")
      .filter(([fn]) => {
        const b = BODIES.get(fn)?.body ?? "";
        const links = adminLinks(b);
        return /public\.is_test_subject\(/.test(b) || (links.length > 0 && links.every((l) => /[?&](user|job)=/.test(l)));
      })
      .map(([fn]) => fn);
    expect(covered).toEqual([]);
    expect(Object.values(ADMIN_NOTIFIERS).filter((k) => k === "gap").length).toBe(0);
  });

  it("the Slack page for a dispute skips the same test subjects as the admin bell", () => {
    const b = BODIES.get("notify_ops_dispute_filed")?.body ?? "";
    expect(b).toMatch(/OR public\.is_test_subject\(_opener_id\)/);
    expect(b).toMatch(/public\.is_test_subject\(j\.customer_id\) OR public\.is_test_subject\(j\.helper_id\)/);
    expect(b).toMatch(/IF coalesce\(v_seed, false\) THEN/);
  });
});
