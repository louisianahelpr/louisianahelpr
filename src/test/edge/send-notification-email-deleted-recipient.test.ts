/**
 * Q2302 (ledger d21db97e9f06): "Notification log write failed: a skipped email left no record". Measured on prod
 * (read-only SQL, 2026-11-02): the one occurrence (2026-10-21 14:10:29Z) sits inside the privacy journey's run
 * (SEED Privacy Journey accounts made and deleted at 14:09-14:11). The recipient's account was deleted between the
 * notification and its email, so the preference-row upsert failed on notification_preferences_user_id_fkey (23503,
 * FK to auth.users ON DELETE CASCADE), and the skip row could not be written either: notification_logs.user_id has
 * the same FK. A deleted account is not a failure: there is no one to email and nothing a log row may point at. The
 * function now answers "skipped: recipient_deleted" (200), writes no log row and raises no alert. Any other
 * preference failure still logs, alerts and answers 500.
 *
 * @mutate supabase/functions/send-notification-email/index.ts |     if (ensureError?.code === '23503') { |     if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, postSlackOpsAlert } from "./mocks/shared";
import { resetEmailMocks, sendWithResend } from "./mocks/email";

async function load(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", RESEND_API_KEY: "re_test" });
  return loadEdgeFunction("send-notification-email");
}

const send = (fn: EdgeHarness) =>
  fn.fetch(
    fn.request({
      headers: { Authorization: "Bearer service-key" },
      body: { user_id: "gone-user-1", title: "Arrival confirmed", message: "Your Helpr arrived", type: "work_status" },
    }),
  );

const logCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "log_notification");

describe("send-notification-email: an email to a deleted account is skipped quietly (Q2302)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    postSlackOpsAlert.mockClear();
    resetEmailMocks();
    sendWithResend.mockClear();
    resetEnv();
    scenario.rpc.notification_crosses_seed_boundary = false;
    scenario.reads.suppressed_emails = { rows: [] };
  });

  it("the account is gone (FK 23503): skipped, no log row, no alert, no email", async () => {
    scenario.writeErrors.notification_preferences = {
      message: 'insert or update on table "notification_preferences" violates foreign key constraint "notification_preferences_user_id_fkey"',
      code: "23503",
    };
    scenario.rpcErrors!.log_notification = { message: 'violates foreign key constraint "notification_logs_user_id_fkey"', code: "23503" };
    const fn = await load();
    const res = await send(fn);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: true, reason: "recipient_deleted" });
    expect(logCalls()).toHaveLength(0);
    expect(postSlackOpsAlert).not.toHaveBeenCalled();
    expect(sendWithResend).not.toHaveBeenCalled();
  });

  it("any other preference failure still logs the skip and answers 500", async () => {
    scenario.writeErrors.notification_preferences = { message: "permission denied for table notification_preferences", code: "42501" };
    const fn = await load();
    const res = await send(fn);
    expect(res.status).toBe(500);
    const logged = logCalls();
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged[0])).toContain("preference_row_ensure_failed");
    expect(sendWithResend).not.toHaveBeenCalled();
  });
});
