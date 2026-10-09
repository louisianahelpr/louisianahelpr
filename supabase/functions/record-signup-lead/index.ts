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

  let body: { email?: unknown; source?: unknown; replaces?: unknown };
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
