/**
 * The payment page an edge function answered with (in-app pay plan phase W, owner 2026-11-27: "checkout should
 * never leave the app/site, like Vinted/Depop").
 *
 *   hosted   `{ url }`: Stripe's own page. The app ALWAYS gets this (in-app browser sheet, openExternalUrl), and so
 *            does the website while the embedded_checkout switch is off for the member.
 *   embedded `{ client_secret, publishable_key }`: Stripe's form mounted inside our own sheet on the website
 *            (src/components/payments/EmbeddedCheckoutSheet.tsx). Same Checkout Session, same webhook.
 *
 * The server decides (supabase/functions/_shared/embeddedCheckout.ts); the client only ASKS, with `embedded: true`,
 * and must handle either answer, since the server may still say hosted (switch off for this member, no key for the
 * session's mode).
 */
import { isNativePlatform } from "@/lib/nativeInit";

export type CheckoutPage =
  | { kind: "hosted"; url: string }
  | { kind: "embedded"; clientSecret: string; publishableKey: string };

/**
 * Whether to ask for an embedded page. Never in the native app: a genuine native capability, not a layout branch
 * (CLAUDE.md "Phone web == native app"). The app's WKWebView carries the Capacitor bridge, which turns off Apple Pay
 * inside an iframe, and the app's own in-app payment sheet is a later phase; the app keeps the hosted page in
 * SFSafariViewController, where Apple Pay works today.
 */
export function asksForEmbeddedCheckout(switchOn: boolean): boolean {
  return switchOn && !isNativePlatform;
}

/** Read the page out of a function's answer; null when it carries neither kind. */
export function checkoutPageFrom(data: Record<string, unknown>): CheckoutPage | null {
  const secret = data.client_secret;
  const key = data.publishable_key;
  if (typeof secret === "string" && /^cs_(test|live)_/.test(secret) && typeof key === "string" && /^pk_(test|live)_/.test(key)) {
    // The form and the session must be in the same Stripe mode; a mismatch would show a form that cannot pay.
    return secret.slice(3, 7) === key.slice(3, 7) ? { kind: "embedded", clientSecret: secret, publishableKey: key } : null;
  }
  if (typeof data.url === "string" && data.url) return { kind: "hosted", url: data.url };
  return null;
}
