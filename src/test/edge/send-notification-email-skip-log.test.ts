/**
 * Q855 (2) — a failed skip-log write in send-notification-email reaches the
 * ops alert ledger.
 *
 * When the function holds an email back (a seed subject to a real recipient,
 * a failed seed-boundary check), the `log_notification` skip row is the only
 * record that it did and why. lh-silent-failure (2026-09-30, at landing
 * a4a341007) found `logSkip` only console.error'd a failed write, so the skip
 * vanished from notification_logs with nothing anywhere an operator reads.
 * Contract: a failed skip write calls postSlackOpsAlert (which records the
 * ledger occurrence) once, naming the status; a successful one does not.
 *
 * Runs the REAL function source through the edge harness.
 */
// @mutate supabase/functions/send-notification-email/index.ts |           oncePerDayKey: 'send-notification-email:log-skip-failed', |           oncePerDayKey: 'send-notification-email:log-skip-failed', seed: true,
// @mutate supabase/functions/send-notification-email/index.ts |       if (skipLogError) { |       if (false) {
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, postSlackOpsAlert } from "./mocks/shared";
import { resetEmailMocks, sendWithResend } from "./mocks/email";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    RESEND_API_KEY: "re_test",
  });
  return loadEdgeFunction("send-notification-email");
}

async function send(fn: EdgeHarness) {
  return fn.fetch(
    fn.request({
      headers: { Authorization: "Bearer service-key" },
      body: { user_id: "real-user-1", title: "Arrival confirmed", message: "Your Helpr arrived", type: "work_status" },
    }),
  );
}

type AlertInput = { title?: string; fields?: Record<string, unknown>; seed?: boolean };
const skipAlerts = () =>
  postSlackOpsAlert.mock.calls
    .map((c) => c[0] as AlertInput)
    .filter((a) => String(a.title ?? "").startsWith("Notification log write failed"));

describe("send-notification-email: a failed skip-log write is not silent (Q855)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    postSlackOpsAlert.mockClear();
    resetEmailMocks();
    sendWithResend.mockClear();
    resetEnv();
    scenario.reads.notification_preferences = { rows: [{ user_id: "real-user-1", email_work_status: true }] };
    scenario.reads.profiles = { rows: [{ email: "real.user@gmail.com", full_name: "Real User" }] };
    scenario.reads.suppressed_emails = { rows: [] };
    // A seed subject to a real recipient: the email is held back and logged as a skip.
    scenario.rpc.notification_crosses_seed_boundary = true;
  });

  it("the skip is held back and its failed log write raises one ledger-recorded alert", async () => {
    scenario.rpcErrors!.log_notification = { message: "permission denied for table notification_logs", code: "42501" };
    const fn = await load();
    const res = await send(fn);
    expect(await res.json()).toMatchObject({ skipped: true, reason: "seed_subject" });
    const alerts = skipAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].fields).toMatchObject({ status: "suppressed_seed", error: "permission denied for table notification_logs" });
    expect(alerts[0].seed, "a real alert, not a seed-digest row").toBeFalsy();
  });

  it("a skip whose log write lands raises nothing", async () => {
    const fn = await load();
    const res = await send(fn);
    expect(await res.json()).toMatchObject({ skipped: true, reason: "seed_subject" });
    expect(skipAlerts()).toHaveLength(0);
    const logged = (scenario.rpcCalls ?? []).filter((c) => c.name === "log_notification");
    expect(logged.length, "the skip row was written").toBeGreaterThan(0);
  });
});
