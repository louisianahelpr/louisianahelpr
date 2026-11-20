/**
 * "Member since Mar 2025" (owner 11-20, Declutter item page polish #6) from an ISO date, for the seller card a member
 * sees (DeclutterSellerCard, from get_safe_profiles) and the one a guest sees (DeclutterGuestSeller, from
 * declutter_guest_seller_card's member_since, given only when the seller has a public profile page). Null when there
 * is no usable date. Central time, as every other date a member reads.
 */
import { getLang } from "@/lib/i18n/language";
import { wordInLang } from "@/lib/i18n/inLang";

export function memberSinceLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Design audit r2 #35: the date is in the reader's language too.
  const es = getLang() === "es";
  const date = d.toLocaleDateString(es ? "es-US" : "en-US", { month: "short", year: "numeric", timeZone: "America/Chicago" });
  return wordInLang("ip.memberSince", `Member since ${date}`, { date });
}
