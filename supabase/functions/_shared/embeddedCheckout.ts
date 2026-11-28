/**
 * Stripe Embedded Checkout on the WEBSITE (owner 2026-11-27: "checkout should never leave the app/site, like
 * Vinted/Depop"; plan ~/.lh-shots/in-app-pay-plan-1127.md, phase W).
 *
 * Every flow keeps its Checkout Session: the same line items, metadata, expiry, tax, wallet customer and webhook
 * (`checkout.session.completed` fires the same for an embedded session). The only differences are how the page is
 * shown and how it hands back:
 *
 *   hosted   (today, and ALWAYS for the native app and old builds): `success_url` + `cancel_url`, answered `{ url }`.
 *   embedded (the website, behind the `embedded_checkout` switch):  `ui_mode: "embedded"` + `return_url`, answered
 *            `{ client_secret, publishable_key }`; the page mounts Stripe's form inside our own sheet.
 *
 * Old app builds only understand `{ url }`, so a request gets an embedded page only when it ASKS for one
 * (`embedded: true`, sent by the new web client only), is not native, the switch is on for the verified caller,
 * and a publishable key exists for the Stripe mode the session is made in. Any other request is answered exactly as
 * before. A failed switch read is "off" (featureEnabledForUser fails closed), so a failure here can only ever fall
 * back to the hosted page, never refuse a payment.
 */
import { isNativeRequest } from "./appUrl.ts";
import { featureEnabledForUser, type FeatureSwitchClient, type VerifiedUser } from "./featureSwitch.ts";
import { sessionIdMode, type StripeMode } from "./stripeMode.ts";

export type CheckoutSurface = "hosted" | "embedded";

/** The hidden switch (src/config/featureSwitches.ts; created 'testers' by its migration). */
const EMBEDDED_CHECKOUT_SWITCH = "embedded_checkout";

/**
 * The TEST-mode publishable key of the Helpr Stripe account (acct_1RQbAfKp2H4b7tEC). A publishable key is public by
 * design (Stripe.js ships it to every browser); it can only create tokens, never read or move money. Read from the
 * apiKey Stripe itself embeds in a test Checkout page, 2026-11-27. STRIPE_TEST_PUBLISHABLE_KEY overrides it.
 */
const TEST_PUBLISHABLE_KEY = "pk_test_51RQbAfKp2H4b7tECIl2pb9vmX7zyykkOuv8vDNvUFqT0IJfHb0LWRdZCVznH60rbZstlOK8W1vhLCSH9hKTNpZFM008UyHetLA";

/**
 * The publishable key for one Stripe mode, or null when none is configured (or it is not a key of THAT mode: a
 * test key on a live session would show Stripe's test form against a live payment). LIVE has no committed default:
 * it comes from the STRIPE_PUBLISHABLE_KEY secret, and until that is set every live request stays on the hosted page.
 */
function publishableKeyFor(mode: StripeMode): string | null {
  const raw = (mode === "live"
    ? Deno.env.get("STRIPE_PUBLISHABLE_KEY")
    : Deno.env.get("STRIPE_TEST_PUBLISHABLE_KEY") ?? TEST_PUBLISHABLE_KEY)?.trim();
  return raw && new RegExp(`^pk_${mode}_[A-Za-z0-9]+$`).test(raw) ? raw : null;
}

/** The new web client asks with `embedded: true`; a native request never gets one, whatever it sends. */
function asksForEmbedded(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { embedded?: unknown }).embedded === true
    && !isNativeRequest(body);
}

/** Which page this request gets. "hosted" unless every condition in the header holds. */
export async function checkoutSurface(
  client: FeatureSwitchClient,
  user: VerifiedUser,
  body: unknown,
  mode: StripeMode,
): Promise<CheckoutSurface> {
  if (!asksForEmbedded(body)) return "hosted";
  if (!publishableKeyFor(mode)) return "hosted";
  return (await featureEnabledForUser(client, EMBEDDED_CHECKOUT_SWITCH, user)) ? "embedded" : "hosted";
}

/**
 * The redirect half of `checkout.sessions.create`'s params. Embedded: Stripe sends the buyer's tab to `return_url`
 * (our own page, never tagged native: only the website mounts it) once paid; there is no cancel page, the sheet's
 * own close button is the way back. Hosted: exactly today's pair.
 *
 * The caller builds every URL with buildRedirectUrl on a LITERAL path (src/test/deepLinkOneRouter.test.ts proves each
 * one is a route the app serves), so this only picks: `hosted` is today's {success_url, cancel_url} as built,
 * `returnUrl` the embedded return page (built with native = false).
 */
export function surfaceRedirects(
  surface: CheckoutSurface,
  hosted: { success_url: string; cancel_url: string },
  returnUrl: string,
): { ui_mode: "embedded"; return_url: string } | { success_url: string; cancel_url: string } {
  return surface === "embedded" ? { ui_mode: "embedded", return_url: returnUrl } : hosted;
}

/** Suffix for an idempotency key, so two taps in one second asking for different surfaces never share a key. */
export function surfaceKeySuffix(surface: CheckoutSurface): string {
  return surface === "embedded" ? ":embedded" : "";
}

type SessionLike = { id?: string | null; status?: string | null; ui_mode?: string | null; url?: string | null; client_secret?: string | null };

/**
 * True when an existing OPEN session can be handed to this request as it is: an embedded session (with its client
 * secret) to an embedded request, a hosted session (with its url) to anyone else. A session of the other kind is
 * not reusable: the caller closes it first, then makes a new one, exactly as for a page that changed.
 */
export function pageServes(session: SessionLike, surface: CheckoutSurface): boolean {
  if (session.status !== "open") return false;
  return surface === "embedded"
    ? session.ui_mode === "embedded" && typeof session.client_secret === "string" && session.client_secret.length > 0
    : session.ui_mode !== "embedded" && typeof session.url === "string" && session.url.length > 0;
}

/**
 * The answer for a page `pageServes` accepted (or one just made for this surface). The publishable key is the one of
 * the mode the SESSION is in (read from its id), so the form and the session can never disagree on mode.
 */
export function pageAnswer(session: SessionLike, surface: CheckoutSurface): { url: string } | { client_secret: string; publishable_key: string } | null {
  if (surface === "hosted") return typeof session.url === "string" && session.url ? { url: session.url } : null;
  const mode = sessionIdMode(session.id ?? null);
  const key = mode ? publishableKeyFor(mode) : null;
  return key && typeof session.client_secret === "string" && session.client_secret
    ? { client_secret: session.client_secret, publishable_key: key }
    : null;
}
