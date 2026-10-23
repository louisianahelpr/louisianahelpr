/**
 * Q2354 (owner 2026-10-23): an admin can send a member another verify-your-email
 * message, never stacked on one under an hour old, with a link that lands
 * where the member's own resend does (/signup-pending), and every outcome is
 * an answer the admin screen can show.
 *
 * @mutate supabase/functions/admin-resend-verification/index.ts |     if (nextAllowedAt && new Date(nextAllowedAt).getTime() > Date.now()) { |     if (false) {
 * @mutate supabase/functions/admin-resend-verification/index.ts |       options: { emailRedirectTo: `${getAppUrl()}/signup-pending` }, |
 * @mutate supabase/functions/admin-resend-verification/index.ts |       if (resendStatus === 429 \|\| resendCode === 'over_email_send_rate_limit') { |       if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const ADMIN = { id: "admin-1", email: "admin@test.com" };
const MEMBER = "member-1";

async function call() {
  const fn = await loadEdgeFunction("admin-resend-verification");
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer admin-jwt" }, body: { userId: MEMBER } }));
  return { res, body: JSON.parse(await res.text()) as Record<string, unknown> };
}

describe("admin-resend-verification (Q2354)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
    scenario.authUser = ADMIN;
    scenario.rpc.has_role = true;
    scenario.reads.profiles = { rows: [{ id: "p1", user_id: MEMBER, email: "lucy@example.com", verification_email_count: 0, email_verified: false }] };
    scenario.reads.admin_audit_log = { rows: [] };
  });

  it("sends, with the link landing on /signup-pending like the member's own resend", async () => {
    scenario.rpc.verification_email_history = { found: true, sent_count: 2, next_allowed_at: null };
    const { res } = await call();
    expect(res.status).toBe(200);
    expect(scenario.authResendCalls).toEqual([
      { type: "signup", email: "lucy@example.com", options: { emailRedirectTo: "https://www.louisianahelpr.com/signup-pending" } },
    ]);
  });

  it("refuses within an hour of the last one, says how long to wait, and sends nothing", async () => {
    scenario.rpc.verification_email_history = { found: true, sent_count: 1, next_allowed_at: new Date(Date.now() + 25 * 60_000).toISOString() };
    const { res, body } = await call();
    expect(res.status).toBe(429);
    expect(String(body.error)).toMatch(/Another one can go in (25|26) min\./);
    expect(body.next_allowed_at).toEqual(expect.any(String));
    expect(scenario.authResendCalls ?? []).toEqual([]);
  });

  it("Supabase's own per-address limit is a 429 with a plain sentence, not a 500", async () => {
    scenario.rpc.verification_email_history = { found: true, sent_count: 1, next_allowed_at: null };
    scenario.authResendError = { message: "For security purposes, you can only request this after 60 seconds.", status: 429, code: "over_email_send_rate_limit" };
    const { res, body } = await call();
    expect(res.status).toBe(429);
    expect(String(body.error)).toMatch(/limiting emails to this address/);
  });

  it("an unreadable send history fails closed (503), sends nothing", async () => {
    scenario.rpcErrors = { verification_email_history: { message: "boom" } };
    const { res } = await call();
    expect(res.status).toBe(503);
    expect(scenario.authResendCalls ?? []).toEqual([]);
  });
});
