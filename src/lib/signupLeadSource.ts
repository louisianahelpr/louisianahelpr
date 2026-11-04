/**
 * The sign-up source rule, shared by signup_leads (signupLead.ts) and the first-touch report (signupSource.ts).
 * Its own module, with no imports, so the boot path reaches only this and not signupLead.ts (Q2705/Q2706, 11-04).
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
