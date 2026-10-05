import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import type { GiftCardRow } from "./types";

/*
 * The two gift-card list reads of GiftCard.tsx, out of the page (it paid for
 * its Q571 offline states this way; componentSizeRatchet). isError is
 * load-bearing on both: these are real, paid gift cards, and a failed read
 * must read as a failure, never as "nothing here yet".
 */

/** Gift cards I sent, newest first. */
export async function fetchSentGiftCards(userId: string): Promise<GiftCardRow[]> {
  try {
    const rows = unwrap(
      await supabase
        .from("gift_cards" as never)
        .select("*")
        .eq("donor_id", userId)
        .order("created_at", { ascending: false }),
    ) as GiftCardRow[];
    return rows;
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("PGRST202")) return [];
    report(e, { severity: "warning", tags: { source: "GiftCard.donated" } });
    throw e;
  }
}

/**
 * Gifts sent TO me: matched by resolved recipient_id OR my named email, since a
 * gift I haven't claimed yet has recipient_id = null but is visible to my email
 * via RLS. Newest first.
 */
export async function fetchReceivedGiftCards(userId: string, myEmail: string): Promise<GiftCardRow[]> {
  // Quote the email value so a reserved char in the local-part (`,` `.` `(`
  // `)`) can't break the PostgREST .or() grammar. userId is a UUID, so it
  // needs no quoting. RLS still constrains rows regardless.
  const orClause = myEmail
    ? `recipient_id.eq.${userId},recipient_email.eq."${myEmail.replace(/(["\\])/g, "\\$1")}"`
    : `recipient_id.eq.${userId}`;
  try {
    const rows = unwrap(
      await supabase
        .from("gift_cards" as never)
        .select("*")
        .or(orClause)
        .order("created_at", { ascending: false }),
    ) as GiftCardRow[];

    // Attach the donor's display name for the "from {name}" subline. We can't
    // embed it via PostgREST — gift_cards.donor_id FKs to auth.users (no
    // full_name, auth schema isn't embeddable), which 400s the whole request
    // and silently hides every gift from its recipient. So resolve names in a
    // separate, non-load-bearing profiles lookup keyed by user_id = donor_id.
    // A failure here leaves the cosmetic name null (CreditCard shows "A
    // neighbor") but never drops the gifts themselves.
    const donorIds = [...new Set(rows.map((r) => r.donor_id).filter(Boolean))];
    if (donorIds.length > 0) {
      try {
        const donors = unwrap(
          await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", donorIds),
        ) as Array<{ user_id: string; full_name: string | null }>;
        const nameById = new Map(donors.map((d) => [d.user_id, d.full_name]));
        return rows.map((r) => ({
          ...r,
          donor: { full_name: nameById.get(r.donor_id) ?? null },
        }));
      } catch {
        // Name lookup is cosmetic — never let it hide the gifts.
        return rows;
      }
    }
    return rows;
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("PGRST202")) return [];
    report(e, { severity: "warning", tags: { source: "GiftCard.received" } });
    throw e;
  }
}
