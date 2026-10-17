/**
 * A Rentals invite link (/rentals/invite/<token>) lets whoever holds it join as
 * the tenant for 14 days, so the token never leaves the device in analytics or
 * error reports (lh-authz-rls review of 3e84eea25, #5; re-review N1, N2).
 * PostHog's sanitize_properties, Sentry's beforeSend/beforeBreadcrumb, our
 * error_logs.url (errorLogger) and analytics_events.url (analytics) run every
 * URL through this. Pure.
 */
// Literal or URL-encoded (a signed-out open redirects to /login?redirect=%2Frentals%2Finvite%2F<token>).
const INVITE = /((?:\/|%2F)rentals(?:\/|%2F)invite(?:\/|%2F))[^/?#&%\s"']+/gi;

export function redactInviteToken<T>(value: T): T {
  return (typeof value === "string" ? value.replace(INVITE, "$1[redacted]") : value) as T;
}

/** Redact every string value of a flat property bag (PostHog event properties). */
export function redactInviteProps<P extends Record<string, unknown>>(props: P): P {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) out[k] = redactInviteToken(v);
  return out as P;
}
