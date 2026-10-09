import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * Sign-up step-1 email capture (owner 2026-10-09, "Save it, follow up once").
 *
 * After step 1 passes validation the email (never the password) goes to the
 * record-signup-lead edge function, which saves it in public.signup_leads
 * (service_role only). If the visitor never finishes, signup-lead-reminders
 * sends ONE "Finish signing up" email after 24 hours.
 *
 * Fire-and-forget: this never throws and never blocks sign-up. A failure is
 * report()ed, except a 429 (the per-address rate limit doing its job).
 */

/** Where the visitor came from: `utm_source`, else the referrer's host, else "direct". */
export function signupLeadSource(search: string, referrer: string): string {
  const utm = new URLSearchParams(search).get("utm_source")?.trim();
  if (utm) return utm.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 64) || "direct";
  try {
    const host = referrer ? new URL(referrer).hostname.toLowerCase() : "";
    // Our own pages (landing -> sign-up) are not a source.
    const ours = host === "louisianahelpr.com" || host.endsWith(".louisianahelpr.com") || host === window.location.hostname;
    if (host && !ours) {
      return host.replace(/[^a-z0-9._-]/g, "").slice(0, 64);
    }
  } catch {
    // An unparseable referrer is no source at all; fall through to "direct".
  }
  return "direct";
}

function statusOf(error: unknown): number | null {
  const ctx = (error as { context?: { status?: unknown } } | null)?.context;
  return typeof ctx?.status === "number" ? ctx.status : null;
}

/**
 * Save `email` as a lead. `replaces` is the address this visitor captured
 * earlier in the same sign-up (they went Back and corrected a typo): the
 * server drops that lead while it is fresh and untouched, so the typo is
 * never mailed.
 */
export async function captureSignupLead(email: string, source: string, replaces?: string | null): Promise<void> {
  const next = email.trim().toLowerCase();
  const prev = replaces?.trim().toLowerCase() || null;
  try {
    const { error } = await supabase.functions.invoke("record-signup-lead", {
      body: { email: next, source, ...(prev && prev !== next ? { replaces: prev } : {}) },
    });
    if (error && statusOf(error) !== 429) {
      report(error, { tags: { source: "signupLead.capture" }, context: { status: statusOf(error) } });
    }
  } catch (err) {
    report(err, { tags: { source: "signupLead.capture" } });
  }
}
