/**
 * Q840 — send-notification-email never hands a test or seed recipient to Resend.
 *
 * Measured on prod before this gate (email_send_log, status='sent', last 7
 * days to 2026-09-30): 279 of 282 sends went to mailinator fixture inboxes or
 * is_seed accounts, spending the Resend quota quota-monitor alarms on.
 *
 * Contract, run through the REAL function source and the REAL predicate:
 *   - a fixture address (mailinator) is logged 'suppressed', not enqueued, not sent;
 *   - an is_seed profile at an ordinary address is suppressed the same way;
 *   - a real user's email is still enqueued (the gate does not break real mail).
 */
// @mutate supabase/functions/send-notification-email/index.ts |     if (await isTestRecipient(supabase, profile.email)) { |     if (false) {
// @mutate supabase/functions/_shared/testRecipient.ts | const FIXTURE_ADDRESS = /(?:@mailinator\.com$\|@helpr\.test$\|^eli\.test\.)/i | const FIXTURE_ADDRESS = /(?:@helpr\.test$\|^eli\.test\.)/i
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
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
      body: { user_id: "user-1", title: "New application", message: "Someone applied", type: "application" },
    }),
  );
}

const enqueued = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "enqueue_email").length;
const logRows = () =>
  (scenario.rpcCalls ?? []).filter((c) => c.name === "log_notification").map((c) => c.args as Record<string, unknown>);
const sendLog = () =>
  scenario.writes
    .filter((w) => w.table === "email_send_log" && w.op === "insert")
    .map((w) => w.payload as Record<string, unknown>);

function profile(email: string, isSeed: boolean) {
  scenario.reads.profiles = {
    rows: [{ email, full_name: "Someone" }],
    // The predicate's own read: profiles.is_seed for that address.
    selectOverrides: [{ includes: "is_seed", result: { rows: isSeed ? [{ is_seed: true }] : [] } }],
  };
}

describe("send-notification-email: test and seed recipients are never mailed (Q840)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    sendWithResend.mockClear();
    resetEnv();
    scenario.reads.notification_preferences = { rows: [{ user_id: "user-1", email_job_applications: true }] };
    scenario.reads.suppressed_emails = { rows: [] };
  });

  it("a mailinator fixture inbox is logged suppressed, never enqueued or sent", async () => {
    profile("helpr-e2e-poster@mailinator.com", false);
    const fn = await load();
    const res = await send(fn);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: true, reason: "test_recipient" });
    expect(enqueued(), "never put on the queue").toBe(0);
    expect(sendWithResend, "never handed to Resend").not.toHaveBeenCalled();
    expect(sendLog().some((r) => r.status === "suppressed" && r.recipient_email === "helpr-e2e-poster@mailinator.com")).toBe(true);
    expect(sendLog().some((r) => r.status === "pending" || r.status === "sent")).toBe(false);
    expect(logRows().some((r) => r._status === "suppressed" && r._error === "test_recipient")).toBe(true);
  }, 10_000);

  it("an is_seed account at an ordinary address is suppressed the same way", async () => {
    profile("seed-admin@louisianahelpr.com", true);
    const fn = await load();
    const res = await send(fn);
    expect(await res.json()).toMatchObject({ skipped: true, reason: "test_recipient" });
    expect(enqueued()).toBe(0);
    expect(sendWithResend).not.toHaveBeenCalled();
    expect(sendLog().some((r) => r.status === "suppressed")).toBe(true);
  }, 10_000);

  it("a real user's notification is still enqueued", async () => {
    profile("real.user@gmail.com", false);
    const fn = await load();
    const res = await send(fn);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, delivery: "queued" });
    expect(enqueued()).toBe(1);
    expect(sendLog().some((r) => r.status === "suppressed")).toBe(false);
  }, 10_000);
});
