/**
 * Test doubles for the edge functions' `../_shared/*` helpers.
 *
 * `rate-limit.ts`, `slack-alerts.ts`, and `cors.ts` are real Deno modules
 * that themselves import Deno-only globals. The harness rewrites imports of
 * those files to this module so the function under test gets controllable,
 * network-free versions.
 */
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// cors.ts re-exports (real values — no Deno APIs needed)
// ---------------------------------------------------------------------------

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export const corsHeadersFull: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export function errorResponse(
  message: string,
  status: number,
  headers: Record<string, string>,
): Response {
  return jsonResponse({ error: message }, status, headers);
}

/**
 * Controls what `checkRateLimit` returns. Default: allowed. Set
 * `rateLimitState.allowed = false` to exercise the 429 branch.
 */
export const rateLimitState = {
  allowed: true,
  remaining: 9,
  retryAfter: 60,
};

export function resetSharedMocks() {
  rateLimitState.allowed = true;
  rateLimitState.remaining = 9;
  rateLimitState.retryAfter = 60;
  slackAlerts.length = 0;
  postSlackOpsAlert.mockClear();
  pifGiftEmails.length = 0;
  sendPifGiftEmail.mockClear();
}

export async function checkRateLimit(): Promise<{
  allowed: boolean;
  remaining: number;
  retryAfter?: number;
}> {
  return {
    allowed: rateLimitState.allowed,
    remaining: rateLimitState.remaining,
    retryAfter: rateLimitState.retryAfter,
  };
}

export function rateLimitResponse(
  retryAfter: number,
  corsHeaders: Record<string, string>,
) {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    },
  );
}

// appUrl.ts re-export — returns a stable test origin so redirect-URL assertions
// are deterministic and don't depend on the Origin request header.
export function getAppUrl(): string {
  return "https://www.louisianahelpr.com";
}

/** Captures every Slack ops alert the function tried to post. */
export const slackAlerts: unknown[] = [];

/** Fire-and-forget Slack alert stub — records the input, never throws. */
export const postSlackOpsAlert = vi.fn(async (input: unknown) => {
  slackAlerts.push(input);
});

/** Captures every Pay-It-Forward gift email the function tried to send. */
export const pifGiftEmails: unknown[] = [];

/**
 * pifGiftEmail.ts re-export — records the send attempt and reports success
 * so the webhook's `if (!emailed)` warning branch stays quiet in tests. The
 * real helper does network I/O (Resend), so it's mocked network-free.
 */
export const sendPifGiftEmail = vi.fn(async (opts: unknown) => {
  pifGiftEmails.push(opts);
  return true;
});
