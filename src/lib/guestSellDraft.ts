import { signupUrlFor } from "@/lib/jobIntent";

/**
 * Owner 2026-11-21 ("let them post and sell and before it will be submitted make them sign up so they can see how it's
 * set up"): a guest can fill a Declutter listing before signing up, the same way a job post works (guestPostDraft.ts).
 *
 * The listing is kept on the device by the one-item sell screen's own saving (useSellSaved: IndexedDB, photos too), so
 * it survives a reload, the sign-up email round-trip and an app restart. Nothing goes to the server first: no photo
 * upload, no AI draft (its edge function needs an account), no draft row. At Post the guest is asked to sign up; the
 * sign-up carries `/declutter/sell?resume=draft` as its redirect (rememberSignupRedirect, spent by postAuthDestination
 * once the email is verified, Apple included), and the sell screen brings the listing back and opens at Post.
 * Guard: src/test/guestSellDraftSurvivesSignup.test.tsx.
 */
export const GUEST_SELL_RESUME_PATH = "/declutter/sell?resume=draft";

/** The ?reason= Signup reads to say the listing is kept (signupSubtitle). */
const GUEST_SELL_REASON = "sell";

/** Where a guest's "Create your free account" goes. */
export function guestSellSignupUrl(): string {
  return `${signupUrlFor(GUEST_SELL_RESUME_PATH)}&reason=${GUEST_SELL_REASON}`;
}

/** Where a guest who already has an account goes: Log in, back to the kept listing. */
export const GUEST_SELL_LOGIN_URL = `/login?redirect=${encodeURIComponent(GUEST_SELL_RESUME_PATH)}`;

/**
 * The sell links a guest can fill before signing up: one new item (priced or free). Sell a bunch, the chooser, a saved
 * draft (?item=) and answering a Wanted post (?answer=) all read or write the member's own rows, so they still ask for
 * an account first.
 */
export function guestCanSell(params: URLSearchParams): boolean {
  return !params.get("mode") && !params.get("item") && !params.get("answer");
}
