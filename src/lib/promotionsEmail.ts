/**
 * What the Promotions EMAIL switch shows (Q2299, owner 2026-10-21: the sign-up
 * email box alone is enough for the welcome and come-back emails; Promotions
 * turned off in Settings still stops them).
 *
 * notification_preferences.email_promotions is three-valued since migration
 * 20261021135832:
 *   null  never chosen: the sign-up box (profiles.marketing_consent) decides,
 *         so the switch reads ON exactly when those emails can go out;
 *   true  the member turned it on;
 *   false the member turned it off, or an unsubscribe link did.
 *
 * Showing OFF for a never-chosen member who ticked the box would be a switch
 * that says "no promotional email" while the welcome and come-back emails
 * still arrive, and the only way to stop them would be to turn it on and off
 * again. So the screen shows what the senders do, and the first press writes
 * the opposite of what is shown: an explicit choice.
 */
export function promotionsEmailOn(stored: boolean | null | undefined, marketingConsent: boolean): boolean {
  if (stored === true || stored === false) return stored;
  return marketingConsent === true;
}
