// Returns the canonical app base URL, never sourced from request headers.
// APP_URL env var can override for staging environments; falls back to the
// production domain.
//
// Never pass req.headers.get("origin") to Stripe redirect URLs — the Origin
// header is attacker-controlled, enabling open-redirect phishing attacks where
// a legitimate Stripe checkout URL bounces the user to an arbitrary domain.
//
// THIS IS ALSO THE ONE SOURCE OF TRUTH FOR EMAIL LINKS.
// Helpr's emails used to be split down the middle: send-notification-email,
// send-account-status-email, admin-user-actions and engagement-automations all
// built links on the APEX `https://louisianahelpr.com`, while auth-email-hook
// and this module used `https://www.louisianahelpr.com`. Two hosts in the same
// inbox is a phishing-detection signal, it splits analytics and cookies, and
// it means one of the two paths eats a redirect on every click. Every link in
// every email now goes through getAppUrl(); do not reintroduce a hardcoded
// domain in a template. If the canonical host ever changes, it changes HERE
// (or via the APP_URL secret) and nowhere else.
export function getAppUrl(): string {
  return Deno.env.get("APP_URL") ?? "https://www.louisianahelpr.com";
}

/**
 * Build a Stripe redirect URL, tagging it so the app can take the user back.
 *
 * WHY `native`: on iOS/Android we now open Stripe in an in-app browser sheet
 * (SFSafariViewController) rather than ejecting to Safari. When the payment
 * finishes, Stripe redirects that sheet to `success_url` — which is our own
 * website. The site renders fine, but the user is left staring at a web page
 * inside a sheet they have to dismiss by hand, and the app underneath has no
 * idea the payment happened until they do.
 *
 * A Universal Link cannot solve this: iOS deliberately does NOT re-enter an app
 * from a Universal Link opened inside that same app's SFSafariViewController.
 * A custom scheme does work, but Stripe only accepts http(s) for success_url,
 * so the hand-back has to be a two-step: Stripe → our https page (tagged
 * `native=1`) → `helpr://…` → the app closes the sheet and routes.
 *
 * The tag is additive and fail-safe. If anything in that chain doesn't fire,
 * the page simply renders as it does today and the user taps Done — i.e. the
 * worst case is exactly the current behaviour, never a lost payment.
 */
export function buildRedirectUrl(path: string, native = false): string {
  const base = `${getAppUrl()}${path}`;
  if (!native) return base;
  return `${base}${base.includes("?") ? "&" : "?"}native=1`;
}

/**
 * Read the native hint off a request body. Defaults to false so an older
 * client — or any caller that doesn't send it — keeps today's web behaviour.
 */
export function isNativeRequest(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { native?: unknown }).native === true;
}
