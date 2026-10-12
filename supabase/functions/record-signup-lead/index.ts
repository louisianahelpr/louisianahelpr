// record-signup-lead — saves the email a visitor typed at sign-up step 1, so
// the signup-lead-reminders cron can follow up ONCE if they never finish
// (owner pop-up 2026-10-09, "Save it, follow up once").
//
// Why an edge function and not an anon-callable RPC: every anonymous WRITE in
// this repo goes through an edge function (complete-signup, contact-support,
// csp-report); every RPC granted to anon is a read. The durable rate limiter
// (_shared/rate-limit.ts) keys on the address the PLATFORM saw, which only the
// edge request carries. And the table write runs as service_role, so the Q807
// unconfirmed-email gate never refuses it for a visitor who still has an old
// unconfirmed session in the browser.
//
// Security posture:
//   * No auth (config.toml verify_jwt = false): the visitor has no account yet.
//   * Rate limited on the caller's ADDRESS alone, 10 an hour: the
//     Authorization header is stripped first, because with verify_jwt = false
//     a token's `sub` is unverified and a caller could rotate it to escape the
//     narrow bucket (code-review 2026-10-09). The reminder cron also caps each
//     run (signup-lead-reminders CAP), so a flood of captured addresses cannot
//     become a flood of mail.
//   * `replaces`: when a visitor goes Back and corrects a mistyped address,
//     the client sends the old one; record_signup_lead deletes it only while
//     it is under 2 hours old and untouched, so the typo is never mailed.
//   * The address is validated here AND in public.record_signup_lead (which
//     is service_role only and the table's only writer).
//   * The answer never depends on whether the address has an account, so this
//     is not an enumeration oracle: a valid address always gets 204.
//   * The password is never sent here.
//   * Bot check (Q1589): the capture carries a Cloudflare Turnstile token from
//     the sign-up page's widget, verified here with TURNSTILE_SECRET_KEY (the
//     same Turnstile secret Supabase Auth holds for its own CAPTCHA). The rate
//     limit alone stops one address, not a rotating-IP caller spending the
//     sending domain's reputation on strangers' inboxes. With the secret set,
//     a missing, spent or forged token is refused (403) and nothing is saved.
//     Without it the capture is saved unchecked and the gap is logged on every
//     call, so a missing secret is visible rather than quietly permanent.
import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";

/** Same shape public.record_signup_lead enforces; checked here to skip a round trip. */
const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function normalizeLeadEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (email.split("@")[0].length > 64) return null;
  return EMAIL_RE.test(email) ? email : null;
}

function normalizeLeadSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 64);
  return s.length > 0 ? s : null;
}

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's own token-size ceiling; anything longer is not a token. */
const MAX_TOKEN_LEN = 2048;
/** The `action` the sign-up page's <TurnstileField> renders with (src/pages/auth/Signup.tsx). */
const SIGNUP_ACTION = "signup";

type CaptchaVerdict = "ok" | "refused" | "misconfigured" | "unavailable";

/**
 * Spend one Turnstile token at Cloudflare. A token is single-use, so a replay
 * of a captured one is refused too. "misconfigured" is OUR fault (a wrong or
 * missing secret) and is not blamed on the visitor; "unavailable" is
 * Cloudflare not answering, which saves nothing rather than guessing.
 */
async function verifyTurnstile(secret: string, token: unknown, remoteIp: string | null): Promise<CaptchaVerdict> {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LEN) {
    // Logged, not silent: a client shipping with no site key would send no
    // token at all, and every lead would be refused here with nothing else
    // showing it (the client keeps a 403 quiet).
    console.warn(`[record-signup-lead] refused: ${typeof token === "string" && token.length > 0 ? "oversized" : "missing"} captcha_token`);
    return "refused";
  }
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set("remoteip", remoteIp);
  let outcome: { success?: unknown; action?: unknown; "error-codes"?: unknown };
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.error(`[record-signup-lead] siteverify answered ${res.status}`);
      return "unavailable";
    }
    outcome = await res.json();
  } catch (e) {
    console.error("[record-signup-lead] siteverify unreachable:", caughtMessage(e));
    return "unavailable";
  }
  // The sign-up page's widget mints tokens for action "signup"; one minted on
  // the login or password-reset form is not this form's proof.
  if (outcome?.success === true && outcome.action === SIGNUP_ACTION) return "ok";
  if (outcome?.success === true) {
    console.warn(`[record-signup-lead] refused: token minted for action ${JSON.stringify(outcome.action)}`);
    return "refused";
  }
  const codes = Array.isArray(outcome?.["error-codes"]) ? (outcome["error-codes"] as unknown[]).map(String) : [];
  if (codes.includes("missing-input-secret") || codes.includes("invalid-input-secret")) {
    console.error(`[record-signup-lead] TURNSTILE_SECRET_KEY was refused by Cloudflare: ${codes.join(",")}`);
    return "misconfigured";
  }
  console.warn(`[record-signup-lead] refused by siteverify: ${codes.join(",") || "no error code"}`);
  return "refused";
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const addressOnly = new Headers(req.headers);
  addressOnly.delete("authorization");
  const rl = await checkRateLimit(new Request(req.url, { method: req.method, headers: addressOnly }), {
    windowMs: 60 * 60_000,
    maxRequests: 10,
    ipMaxRequests: 10,
    keyPrefix: "record-signup-lead",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  let body: { email?: unknown; source?: unknown; replaces?: unknown; captcha_token?: unknown };
  try {
    body = await req.json();
  } catch {
    // An unreadable body is the caller's error, not ours: answer 400 and stop.
    return json({ error: "Invalid request" }, 400);
  }
  const email = normalizeLeadEmail(body?.email);
  if (!email) return json({ error: "Invalid email" }, 400);
  const source = normalizeLeadSource(body?.source);
  const replaces = normalizeLeadEmail(body?.replaces);

  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY")?.trim();
  if (turnstileSecret) {
    const remoteIp = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const verdict = await verifyTurnstile(turnstileSecret, body?.captcha_token, remoteIp);
    if (verdict === "refused") return json({ error: "Security check failed" }, 403);
    if (verdict === "misconfigured") return json({ error: "Could not save" }, 500);
    if (verdict === "unavailable") return json({ error: "Could not verify" }, 503);
  } else {
    console.warn("[record-signup-lead] TURNSTILE_SECRET_KEY is not set: lead saved with no bot check (Q1589)");
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { global: { fetch: boundedFetch() } },
    );
    const { error } = await supabase.rpc("record_signup_lead", {
      p_email: email,
      p_source: source,
      p_replaces: replaces,
    });
    if (error?.code === "PGRST202") {
      // The function deployed before its migration (functions-deploy and
      // db-deploy are separate workflows). Nothing to save into yet; sign-up
      // must not see an error for it.
      console.warn("[record-signup-lead] record_signup_lead not deployed yet (PGRST202); lead not saved");
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (error) {
      console.error("[record-signup-lead] record_signup_lead failed:", error.message);
      return json({ error: "Could not save" }, 500);
    }
  } catch (e) {
    console.error("[record-signup-lead] unexpected:", caughtMessage(e));
    return json({ error: "Could not save" }, 500);
  }
  return new Response(null, { status: 204, headers: corsHeaders });
});
