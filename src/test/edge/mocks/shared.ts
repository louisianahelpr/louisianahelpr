/**
 * Test doubles for the edge functions' `../_shared/*` helpers.
 *
 * `rate-limit.ts` and `slack-alerts.ts` are real Deno modules that themselves
 * import Deno-only globals. The harness rewrites imports of those files to
 * this module so the function under test gets controllable, network-free
 * versions.
 */
import { vi } from "vitest";

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

/** Captures every Slack ops alert the function tried to post. */
export const slackAlerts: unknown[] = [];

/** Fire-and-forget Slack alert stub — records the input, never throws. */
export const postSlackOpsAlert = vi.fn(async (input: unknown) => {
  slackAlerts.push(input);
});
