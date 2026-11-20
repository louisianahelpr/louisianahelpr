/**
 * The poster's ID check is asked when they SEND AN OFFER, never when they post (owner 2026-11-20; migration
 * 20261120205350_poster_id_at_offer_not_post). The server refuses with 'identity_required_to_offer' on every write that
 * puts a Helpr on the poster's job: a direct offer at post time, a hire (accept_application / at the suggested time),
 * an instant booking, a crew seat, series dates, or booking an agreed quote. Each of those call sites answers the
 * refusal here: the one ID sheet opens (reason "post": the poster's moment, now at the offer) and the words say why.
 *
 * Kept free of a static import of @/lib/identityCheck (it loads on demand, only on that refusal), like the Shops
 * reader was, so no hire screen pulls the ID sheet's chunk.
 * Guards: src/test/posterIdAtOffer.test.ts, src/test/noProactiveIdEntryPoints.test.ts.
 */
import { wordInLang } from "@/lib/i18n/inLang";

const POSTER_ID_AT_OFFER_EN = "Verify your ID with Stripe before you send an offer. It takes about 2 minutes, once. Then send it again.";

/** The words for the refusal, in the member's language once Spanish has loaded (jp.idAtOffer). */
export function posterIdAtOfferCopy(): string {
  return wordInLang("jp.idAtOffer", POSTER_ID_AT_OFFER_EN);
}

/** Is this the server's refusal of an unverified poster's offer? */
export function isPosterIdRefusal(err: unknown): boolean {
  const raw = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message;
  const m = typeof raw === "string" ? raw : "";
  return /(^|[^a-z_])identity_required_to_offer($|[^a-z_])/.test(m);
}

/**
 * Open the ID sheet for that refusal. Resolves true when it opened; false when the error is something else, or the
 * sheet could not open (ID check switched off, or its code failed to load), so the caller still shows its words.
 */
export async function openPosterIdCheckFor(err: unknown): Promise<boolean> {
  if (!isPosterIdRefusal(err)) return false;
  const { openIdentityCheck } = await import("@/lib/identityCheck");
  return openIdentityCheck("post");
}
