/**
 * Q171 — the seed-boundary check in send-notification-email retries PGRST002.
 *
 * send-notification-email asks notification_crosses_seed_boundary() before
 * anything else and FAILS CLOSED (503, no email) on any error (Q159). PGRST002
 * is PostgREST reloading its schema cache, which happens for a few seconds
 * after every migration deploy. The same function already retried PGRST002 on
 * its preference reads after a 2026-09-08 incident lost an "Arrival confirmed"
 * email that way; the seed check, added later, did not, so a deploy window
 * permanently dropped real notification emails.
 *
 * Contract: PGRST002 twice then an answer -> the email is sent; PGRST002 three
 * times -> still refused (503, 'seed boundary check failed' log row); any other
 * error -> refused on the first try, no retry.
 *
 * Runs the REAL function source through the edge harness.
 */
// @mutate supabase/functions/send-notification-email/index.ts |       if (!seedCheckError \|\| seedCheckError.code !== 'PGRST002' \|\| attempt === 2) break |       break
// @mutate supabase/functions/send-notification-email/index.ts |       if (!seedCheckError \|\| seedCheckError.code !== 'PGRST002' \|\| attempt === 2) break |       if (!seedCheckError) break
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, emailRenders, NotificationEmail, sendWithResend } from "./mocks/email";

const RPC = "notification_crosses_seed_boundary";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    RESEND_API_KEY: "re_test",
  });
  return loadEdgeFunction("send-notification-email");
}

/** Answer the seed check with `errors[i]` on call i, then no error. */
function seedCheckErrors(errors: Array<{ code: string; message: string } | undefined>) {
  let call = 0;
  Object.defineProperty(scenario.rpcErrors!, RPC, {
    configurable: true,
    enumerable: true,
    get: () => errors[call++],
  });
}

const seedCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === RPC).length;
const logRows = () =>
  (scenario.rpcCalls ?? []).filter((c) => c.name === "log_notification").map((c) => c.args as Record<string, unknown>);

async function send(fn: EdgeHarness) {
  return fn.fetch(
    fn.request({
      headers: { Authorization: "Bearer service-key" },
      body: { user_id: "real-user-1", title: "Arrival confirmed", message: "Your Helpr arrived", type: "work_status" },
    }),
  );
}

const PGRST002 = { code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." };

describe("send-notification-email: seed-boundary check retries PGRST002 (Q171)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    sendWithResend.mockClear();
    resetEnv();
    scenario.reads.notification_preferences = { rows: [{ user_id: "real-user-1", email_work_status: true }] };
    scenario.reads.profiles = { rows: [{ email: "real@example.com", full_name: "Real User" }] };
    scenario.reads.suppressed_emails = { rows: [] };
  });

  it("PGRST002 twice, then an answer: the email is sent", async () => {
    seedCheckErrors([PGRST002, PGRST002]);
    const fn = await load();
    const res = await send(fn);
    const body = await res.json();
    expect(seedCalls(), "the check was asked three times").toBe(3);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, delivery: "queued" });
    expect((emailRenders[0] as { type?: unknown }).type, "the notification template was rendered").toBe(NotificationEmail);
    expect(sendWithResend, "queued, so no direct-send fallback").not.toHaveBeenCalled();
    expect(logRows().some((r) => r._status === "sent")).toBe(true);
    expect(logRows().some((r) => String(r._error ?? "").startsWith("seed boundary check failed"))).toBe(false);
  }, 10_000);

  it("PGRST002 three times: still fails closed, with no email", async () => {
    seedCheckErrors([PGRST002, PGRST002, PGRST002]);
    const fn = await load();
    const res = await send(fn);
    expect(seedCalls()).toBe(3);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ skipped: true, reason: "seed_boundary_check_failed" });
    expect(logRows().some((r) => r._status === "sent")).toBe(false);
    expect(
      logRows().some((r) => r._status === "failed" && String(r._error).startsWith("seed boundary check failed, not sent: PGRST002")),
    ).toBe(true);
  }, 10_000);

  it("any other error fails closed on the first try, without retrying", async () => {
    seedCheckErrors([{ code: "PGRST202", message: "function not found" }]);
    const fn = await load();
    const res = await send(fn);
    expect(seedCalls()).toBe(1);
    expect(res.status).toBe(503);
  });
});
