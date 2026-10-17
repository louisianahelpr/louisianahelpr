/**
 * Q1817: "Job auto-cancelled" reached the poster in the app and by push only.
 *
 * Measured on prod for job 5d43debf (auto-expire-jobs, 2026-10-11 15:00:01Z):
 * notification_logs held one push row and no email row, and email_send_log had
 * no row for that poster. auto-expire-jobs wrote the notification with
 * insertNotifications and never called send-notification-email, and no
 * notifications trigger sends email, so a poster who was not in the app never
 * heard that their PAID job had been cancelled.
 *
 * Runs the REAL function source through the edge harness; the email call is
 * recorded in mocks/shared.ts `notificationEmails`, never sent.
 *
 * The second describe is the CLASS guard: every notification an edge function
 * writes whose title says "cancel" is classified, both ways, and each one that
 * goes to the poster about their own job must be emailed by its file.
 */
// @mutate supabase/functions/auto-expire-jobs/index.ts |       if (job.customer_id) { |       if (false) {
// @mutate supabase/functions/auto-expire-jobs/index.ts |             if (sent?.success === false) { |             if (false) {
// @mutate supabase/functions/auto-expire-jobs/index.ts |       if (!noticeLanded) { |       if (false) {
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, notificationEmails, notificationEmailAnswer } from "./mocks/shared";
import { blankComments } from "../helpers/blankNonCode";

const CRON_SECRET = "cron-secret-expire-email";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("auto-expire-jobs");
}

function cronRequest(fn: EdgeHarness): Request {
  return fn.request({
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    url: "https://edge.test/auto-expire-jobs",
  });
}

/** One open job, dated last week, in step 2's `select("*")` read only. */
function seedPastOpenJob(row: Record<string, unknown>) {
  scenario.reads.jobs = {
    rows: [],
    selectOverrides: [
      // Step 1 is the only read that names accepted_at: nothing to re-open.
      { includes: "accepted_at", result: { rows: [] } },
      { includes: "*", result: { rows: [row] } },
    ],
  };
  scenario.writeSelectRows.jobs = [{ id: row.id }];
  scenario.rpc.start_underfilled_crews = 0;
  scenario.rpc.expire_unanswered_offers = 0;
  scenario.rpc.expire_pending_direct_offers = 0;
}

const lastWeek = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" })
  .format(new Date(Date.now() - 7 * 24 * 3_600_000));

describe("auto-expire-jobs · Q1817: the auto-cancel notice is emailed to the poster", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
  });

  it("a FUNDED open job past its date is cancelled and its poster gets the notice by email", async () => {
    const fn = await load();
    seedPastOpenJob({
      id: "job-past", title: "Mow the lawn", customer_id: "poster-1", status: "open",
      payment_status: "escrow", date_needed: lastWeek, expires_at: null, is_group_job: false,
    });
    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    const inApp = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert")
      .map((w) => w.payload as Record<string, unknown>);
    expect(inApp.map((n) => n.title)).toEqual(["Job auto-cancelled"]);
    expect(notificationEmails).toHaveLength(1);
    expect(notificationEmails[0]).toMatchObject({
      user_id: "poster-1", job_id: "job-past", title: "Job auto-cancelled", type: "job_updates", link: "/post-job",
    });
  });

  // lh-silent-failure review of a94132b78: the failure branches, each shown able to fail.
  const funded = (over: Record<string, unknown> = {}) => ({
    id: "job-past", title: "Mow the lawn", customer_id: "poster-1", status: "open",
    payment_status: "escrow", date_needed: lastWeek, expires_at: null, is_group_job: false, ...over,
  });

  it("an email the sender answers 200 success:false (queue and direct send both failed) is a defect", async () => {
    const fn = await load();
    seedPastOpenJob(funded());
    notificationEmailAnswer.body = { success: false, reason: "send_failed" };
    const body = await (await fn.fetch(cronRequest(fn))).text();
    expect(notificationEmails).toHaveLength(1);
    expect(body).toContain("auto-cancel email for job job-past: not sent (send_failed)");
  });

  it("an email the sender skipped (opted out or seed boundary) is not a defect", async () => {
    const fn = await load();
    seedPastOpenJob(funded());
    notificationEmailAnswer.body = { success: true, skipped: true };
    const body = await (await fn.fetch(cronRequest(fn))).text();
    expect(body).not.toContain("auto-cancel email");
  });

  it("an email answered HTTP 500 is a defect", async () => {
    const fn = await load();
    seedPastOpenJob(funded());
    notificationEmailAnswer.status = 500;
    notificationEmailAnswer.body = { error: "boom" };
    const body = await (await fn.fetch(cronRequest(fn))).text();
    expect(body).toContain("auto-cancel email for job job-past: HTTP 500");
  });

  it("an in-app row that fails is a defect, and the email still goes out (the only channel left)", async () => {
    const fn = await load();
    seedPastOpenJob(funded());
    scenario.writeErrors.notifications = { message: "insert failed" };
    const body = await (await fn.fetch(cronRequest(fn))).text();
    expect(body).toContain("auto-cancel notice for job job-past was not written");
    expect(notificationEmails).toHaveLength(1);
  });

  it("a funded job whose poster is gone sends no email", async () => {
    const fn = await load();
    seedPastOpenJob(funded({ customer_id: null }));
    await fn.fetch(cronRequest(fn));
    expect(notificationEmails).toHaveLength(0);
  });

  it("a cancel that matched no row (someone else moved the job) sends no notice and no email", async () => {
    const fn = await load();
    seedPastOpenJob(funded());
    scenario.writeSelectRows.jobs = [];
    await fn.fetch(cronRequest(fn));
    expect(scenario.writes.filter((w) => w.table === "notifications")).toHaveLength(0);
    expect(notificationEmails).toHaveLength(0);
  });

  it("control: a never-funded job is closed quietly, with no notice and no email", async () => {
    const fn = await load();
    seedPastOpenJob({
      id: "job-draft", title: "Unpaid draft", customer_id: "poster-1", status: "open",
      payment_status: "unpaid", date_needed: lastWeek, expires_at: null, is_group_job: false,
    });
    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(scenario.writes.filter((w) => w.table === "notifications")).toHaveLength(0);
    expect(notificationEmails).toHaveLength(0);
  });
});

// ── The class: every "cancel" notification an edge function writes ───────────
//
// Kinds:
//   poster-emailed  goes to the poster about their own job; its file must send
//                   it through send-notification-email (or announceRefund,
//                   which emails).
//   helper          goes to the Helpr (their own notices are a separate
//                   question, not this item's).
//   admin           goes to an admin (support work), not the poster.
//   ops             a Slack/ops alert title (postSlackOpsAlert), not a user notice.
const ROOT = join(__dirname, "..", "..", "..");
const FN_DIR = join(ROOT, "supabase", "functions");

type Kind = "poster-emailed" | "helper" | "admin" | "ops";
const CANCEL_NOTICES: Array<{ file: string; title: string; kind: Kind }> = [
  { file: "auto-expire-jobs/index.ts", title: "Job auto-cancelled", kind: "poster-emailed" },
  { file: "create-payment/index.ts", title: "Job cancelled", kind: "helper" },
  // The cancellation fee paid to the Helpr (told to the Helpr); its failed transfer (told to an admin).
  { file: "_shared/crewBlockFees.ts", title: "Cancellation fee received", kind: "helper" },
  { file: "void-cancelled-payments/index.ts", title: "Cancellation fee received", kind: "helper" },
  { file: "void-cancelled-payments/index.ts", title: "Cancellation fee received", kind: "helper" },
  { file: "void-cancelled-payments/index.ts", title: "Cancellation fee transfer failed", kind: "admin" },
  { file: "void-cancelled-payments/index.ts", title: "Cancellation fee transfer failed", kind: "admin" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "email-templates" || name === "node_modules") continue;
      out.push(...walk(p));
    } else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Every literal `title: "...cancel..."` in edge source, with whether it sits in
 * a notifications write (insertNotifications or .from("notifications")) rather
 * than a Slack alert: the nearest preceding call within 12 lines decides.
 */
function cancelTitles(): Array<{ file: string; title: string; isNotice: boolean }> {
  const found: Array<{ file: string; title: string; isNotice: boolean }> = [];
  for (const path of walk(FN_DIR)) {
    const code = blankComments(readFileSync(path, "utf8"));
    const lines = code.split("\n");
    lines.forEach((line, i) => {
      const m = /\btitle:\s*["'`]([^"'`]*cancel[^"'`]*)["'`]/i.exec(line);
      if (!m) return;
      const before = lines.slice(Math.max(0, i - 12), i + 1).join("\n");
      const notice = before.lastIndexOf("insertNotifications(");
      const table = before.lastIndexOf('from("notifications")');
      const slack = before.lastIndexOf("postSlackOpsAlert(");
      // A row built as a const first and written a few lines later
      // (`const x = { title, ... }; insertNotifications(supabase, x)`).
      const after = lines.slice(i, i + 16).join("\n");
      const laterNotice = after.indexOf("insertNotifications(");
      const laterSlack = after.indexOf("postSlackOpsAlert(");
      const builtThenWritten = /^\s*const\s+\w+\s*=\s*\{\s*$/.test(lines.slice(Math.max(0, i - 4), i).find((l) => /=\s*\{\s*$/.test(l)) ?? "") &&
        laterNotice >= 0 && (laterSlack < 0 || laterNotice < laterSlack);
      found.push({
        file: path.slice(FN_DIR.length + 1),
        title: m[1],
        isNotice: Math.max(notice, table) > slack || builtThenWritten,
      });
    });
  }
  return found;
}

describe("every edge-function cancel notice to a poster is emailed (Q1817 class)", () => {
  const all = cancelTitles();
  const notices = all.filter((t) => t.isNotice);

  it("reads the inventory from source", () => {
    expect(all.length).toBeGreaterThan(20);
    expect(notices.length).toBeGreaterThan(1);
  });

  it("every cancel notice is classified, and every classification still exists (both ways)", () => {
    const key = (t: { file: string; title: string }) => `${t.file} :: ${t.title}`;
    expect(notices.map(key).sort(), "classify each new cancel notice in CANCEL_NOTICES").toEqual(
      CANCEL_NOTICES.filter((c) => c.kind !== "ops").map(key).sort(),
    );
  });

  it("each poster cancel notice's file sends it by email", () => {
    for (const c of CANCEL_NOTICES.filter((n) => n.kind === "poster-emailed")) {
      const code = blankComments(readFileSync(join(FN_DIR, c.file), "utf8"));
      expect(/send-notification-email|announceRefund\(/.test(code), `${c.file} (${c.title}) never emails`).toBe(true);
    }
  });
});
