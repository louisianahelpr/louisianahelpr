/**
 * Q258 — the signup confirmation email is rendered ONCE and sent IMMEDIATELY.
 *
 * Before: auth-email-hook rendered the React tree twice (once for html, once
 * for `plainText: true`), then enqueued to pgmq.q_auth_emails, where the
 * process-email-queue cron ('3-58/5 * * * *') picked it up: a new user sat on
 * "Check your email" for up to 5 minutes before the mail even left.
 *
 * Contract (runs the REAL hook through the edge harness):
 *   - signup: one render, Resend called inline with a timeout under GoTrue's
 *     hook deadline, the pending email_send_log row marked 'sent', and NOTHING
 *     enqueued;
 *   - signup while Resend fails: falls back to the queue with the same
 *     message_id (a Resend blip delays the mail, never loses it);
 *   - every other auth type (recovery here) still rides the queue;
 *   - renderEmail itself renders once (html-to-text over the one markup).
 */
// @mutate supabase/functions/auth-email-hook/index.ts | const SEND_INLINE = new Set<string>(['signup']) | const SEND_INLINE = new Set<string>([])
// @mutate supabase/functions/auth-email-hook/index.ts | const { html, text } = await renderEmail(React.createElement(EmailTemplate, templateProps)) | const { html } = await renderEmail(React.createElement(EmailTemplate, templateProps)); const { text } = await renderEmail(React.createElement(EmailTemplate, templateProps))
// @mutate supabase/functions/auth-email-hook/index.ts | const INLINE_SEND_TIMEOUT_MS = 3_000 | const INLINE_SEND_TIMEOUT_MS = 10_000
// @mutate supabase/functions/auth-email-hook/index.ts |       console.error('Inline auth email send failed, falling back to queue', { |       return new Response('{}', { status: 200 }); console.error('Inline auth email send failed, falling back to queue', {
// @mutate supabase/functions/_shared/email-templates/render.ts | const text = convert(html, { selectors: plainTextSelectors }) | const text = await renderAsync(element, { plainText: true })
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, emailRenders, sendWithResend, SignupEmail, RecoveryEmail } from "./mocks/email";
import { blankNonCode } from "../helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..", "..");

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    SEND_EMAIL_HOOK_SECRET: "v1,whsec_dGVzdA==",
    RESEND_API_KEY: "re_test",
  });
  return loadEdgeFunction("auth-email-hook");
}

function hook(fn: EdgeHarness, type: string) {
  return fn.fetch(
    fn.request({
      headers: { "webhook-id": "m1", "webhook-timestamp": "1", "webhook-signature": "valid" },
      rawBody: JSON.stringify({
        user: { id: "u1", email: "new@example.test" },
        email_data: { token: "123456", token_hash: "th", redirect_to: "https://x/cb", email_action_type: type },
      }),
    }),
  );
}

const enqueues = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "enqueue_email");
const logWrites = () => scenario.writes.filter((w) => w.table === "email_send_log");

describe("auth-email-hook: signup confirmation is rendered once and sent inline (Q258)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    sendWithResend.mockReset();
    sendWithResend.mockImplementation(async () => ({ id: "resend-mock-id" }));
    resetEnv();
  });

  it("signup: one render, Resend inline with a short timeout, marked sent, nothing enqueued", async () => {
    const fn = await load();
    const res = await hook(fn, "signup");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, queued: false });
    expect(emailRenders.length, "the template is rendered exactly once").toBe(1);
    expect((emailRenders[0] as { type?: unknown }).type).toBe(SignupEmail);
    expect(sendWithResend).toHaveBeenCalledTimes(1);
    const [key, msg, timeout] = sendWithResend.mock.calls[0] as unknown as [string, Record<string, string>, number];
    expect(key).toBe("re_test");
    expect(msg).toMatchObject({ to: "new@example.test", subject: "Confirm your email", html: "<p>mock</p>", text: "mock" });
    // GoTrue's send-email hook times out at 5 s and a failed hook fails the
    // signup; the inline send must give up well before that.
    expect(timeout, "inline send has its own deadline under GoTrue's").toBeLessThanOrEqual(3_000);
    expect(enqueues(), "not queued: the 5-minute cron is off the signup path").toHaveLength(0);
    const pending = logWrites().find((w) => w.op === "insert");
    const sent = logWrites().find((w) => w.op === "update");
    expect((pending?.payload as Record<string, unknown>)?.status).toBe("pending");
    expect((sent?.payload as Record<string, unknown>)?.status).toBe("sent");
    expect(sent?.filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: "message_id", value: (pending?.payload as Record<string, unknown>).message_id })]),
    );
  });

  it("signup while Resend fails: falls back to the queue with the same message_id", async () => {
    sendWithResend.mockImplementation(async () => {
      throw new Error("Resend send timed out after 3000ms");
    });
    const fn = await load();
    const res = await hook(fn, "signup");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, queued: true });
    expect(sendWithResend).toHaveBeenCalledTimes(1);
    expect(enqueues()).toHaveLength(1);
    const pending = logWrites().find((w) => w.op === "insert")?.payload as Record<string, unknown>;
    const payload = (enqueues()[0].args as { queue_name: string; payload: Record<string, unknown> });
    expect(payload.queue_name).toBe("auth_emails");
    expect(payload.payload.message_id).toBe(pending.message_id);
    expect(logWrites().some((w) => w.op === "update" && (w.payload as Record<string, unknown>).status === "sent")).toBe(false);
  });

  it("recovery still rides the queue (the inline path is the signup confirmation only)", async () => {
    const fn = await load();
    const res = await hook(fn, "recovery");
    expect(res.status).toBe(200);
    expect(emailRenders.length).toBe(1);
    expect((emailRenders[0] as { type?: unknown }).type).toBe(RecoveryEmail);
    expect(sendWithResend).not.toHaveBeenCalled();
    expect(enqueues()).toHaveLength(1);
  });

  it("a bad signature is still refused before anything renders or sends", async () => {
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { "webhook-id": "m1", "webhook-timestamp": "1", "webhook-signature": "forged" },
        rawBody: JSON.stringify({ user: { email: "x@example.test" }, email_data: { email_action_type: "signup" } }),
      }),
    );
    expect(res.status).toBe(401);
    expect(sendWithResend).not.toHaveBeenCalled();
    expect(emailRenders.length).toBe(0);
  });

  it("renderEmail renders the React tree once (text converted from the same markup)", () => {
    const src = blankNonCode(readFileSync(join(ROOT, "supabase/functions/_shared/email-templates/render.ts"), "utf8"));
    const renders = src.match(/\brenderAsync\s*\(/g) ?? [];
    expect(renders.length, "one renderAsync call in renderEmail").toBe(1);
    expect(src).toMatch(/\bconvert\s*\(\s*html\s*,/);
  });
});
