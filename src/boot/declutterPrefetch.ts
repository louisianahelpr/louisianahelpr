/**
 * Start /declutter's first screen from the ENTRY, beside the app's own download (same idea as guestJobsPrefetch.ts).
 *
 * Measured 2026-10-30 (local build, 412 wide, 1.6 Mbps / 150 ms, x4 CPU, signed-in test account): the first item
 * photo waited on a chain, page chunk -> profile -> switches -> items -> photos, so 91% of its time was waiting
 * to start. Reading items and photos at boot alone gained nearly nothing, because cards also wait for drops and
 * watching. So one read, public.declutter_first_screen (SECURITY INVOKER: the row policies decide), answers them all.
 *
 * Uses the session the app would use, sent only to the app's own Supabase, as supabase-js sends it. No usable session,
 * not deployed yet (404), or any failure: nothing is handed over and the page runs today's reads.
 *
 * NOTHING outside the entry may import this file (see guestJobsPrefetch.ts). So the switch keys are a COPY of
 * FEATURE_SWITCH_KEYS, and src/boot/declutterPrefetch.test.ts holds the two equal.
 */
import { storedSession } from "./storedSession";

/** Copy of FEATURE_SWITCH_KEYS in src/config/featureSwitches.ts (see above). */
export const FIRST_SCREEN_SWITCH_KEYS = [
  "switch_canary",
  "declutter",
  "declutter_moving_out",
  "suggest_category",
  "memberships",
  "quotes",
  "declutter_wanted",
  "declutter_price_hint",
  "shops",
  "declutter_haul_away",
  "declutter_add_helpr",
  "rentals",
  "jobs_poster_fee",
  "applicant_proof",
  "job_reach",
  "price_guidance",
  "declutter_seller_delivery",
  "come_back_emails",
  "refund_requests",
  "sms_alerts",
  "payout_setup",
  "identity_check",
  "paypal_payments",
  "payout_after_hire",
  "checkout_nudge",
  "confirm_reminders",
  "scanner_safe_confirm_links",
  "declutter_refund_requests",
  "card_hold_at_post",
  "declutter_shipping",
];
export const DECLUTTER_PREFETCH_KEY = "__lhDeclutterPrefetch";

/** Called by the entry. No-op unless this is a cold load of /declutter with a live session. */
export function startDeclutterPrefetch(pathname: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path !== "/declutter" || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const session = storedSession(Date.now() / 1000);
  if (!base || !key || !session) return;
  const answer = fetch(`${base.replace(/\/$/, "")}/rest/v1/rpc/declutter_first_screen`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_switch_keys: FIRST_SCREEN_SWITCH_KEYS }),
  })
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
    // A failed prefetch is not an error: the page runs today's reads.
    .catch(() => null);
  (window as unknown as Record<string, unknown>)[DECLUTTER_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, answer };
}
