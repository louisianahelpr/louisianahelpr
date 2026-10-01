import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/** Statuses a gift can be spent from — the gate in `redeem_gift_card`. */
const CLAIMABLE_GIFT_STATUSES = new Set(["sent", "available"]);

export interface SpendableGiftCards {
  /** The signed-in user these gifts belong to (undefined when signed out). */
  userId: string | undefined;
  /** Ids of the spendable gifts, sorted, so a set of them has one spelling. */
  ids: string[];
  /** True once the read has answered (or will never run: no user). */
  settled: boolean;
}

const NONE: string[] = [];

/**
 * Gift cards this user can actually spend, for the gift card banner
 * (GiftCardTeaser, at the top of Post a Job).
 *
 * Lifted out of the Dashboard's side queries when the banner moved from /home
 * to /post-job (owner, 2026-10-01): ONE definition of "a gift waiting for
 * you", so the banner cannot count one thing on one screen and another
 * somewhere else.
 *
 * This used to count `status='available' AND parish=<user's parish>` —
 * a counter that could not be non-zero. `parish` is NULL on every directed
 * gift (the column belongs to the world-readable "parish pool" model that
 * migration 20260705190000 replaced), and migration 20260831233515 then
 * normalised every paid, directed 'available' row to 'sent'. Both halves of
 * the predicate now select nothing, so the banner read 0 forever and a
 * recipient holding a real $75 gift was told nothing on the screen they
 * open first.
 *
 * A counter that structurally cannot be non-zero is a defect class here,
 * not a cosmetic one — it renders an outage as an all-clear. So this counts
 * the thing that exists: gifts addressed to THIS user (by resolved id, or by
 * the email they were sent to before claiming), funded, unspent, and
 * unexpired — the same conditions `redeem_gift_card` will check when they go
 * to use one.
 *
 * The status/expiry filtering happens in JS rather than as a second
 * PostgREST `.or()`: gift rows per user are a handful, and stacking two
 * `or=` params to express "(mine) AND (unexpired)" is exactly the kind of
 * grammar that fails quietly and takes the count to zero again.
 *
 * The query key keeps its `gift-card-count` head: GiftCard.tsx invalidates
 * that prefix after a claim so the banner stops announcing a claimed gift.
 */
export function useSpendableGiftCards(): SpendableGiftCards {
  const { user } = useCurrentUser();
  const userId = user?.id;
  const userEmail = user?.email;
  const query = useQuery({
    queryKey: ["gift-card-count", userId, userEmail],
    queryFn: async (): Promise<string[]> => {
      if (!userId) return NONE;
      try {
        // Quote the email so a reserved char in the local part can't break
        // the .or() grammar — same guard GiftCard's received-gifts query
        // uses. RLS constrains the rows regardless.
        const orClause = userEmail
          ? `recipient_id.eq.${userId},recipient_email.eq."${userEmail.replace(/(["\\])/g, "\\$1")}"`
          : `recipient_id.eq.${userId}`;
        const { data, error } = await supabase
          .from("gift_cards" as never)
          .select("id, status, payment_status, expires_at")
          .or(orClause);
        if (error && (error as { code?: string }).code === "PGRST202") return NONE;
        // None stays the safe default, but the failure has to be observable —
        // a dropped error made a broken count look like "no credits here".
        if (error) {
          report(error, { severity: "warning", tags: { source: "useSpendableGiftCards" } });
          return NONE;
        }
        const rows = (data ?? []) as Array<{
          id: string;
          status: string;
          payment_status: string | null;
          expires_at: string | null;
        }>;
        const now = Date.now();
        return rows
          .filter(
            (r) =>
              r.payment_status === "paid" &&
              CLAIMABLE_GIFT_STATUSES.has(r.status) &&
              (!r.expires_at || new Date(r.expires_at).getTime() > now),
          )
          .map((r) => r.id)
          .sort();
      } catch (e) {
        report(e, { severity: "warning", tags: { source: "useSpendableGiftCards" } });
        return NONE;
      }
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
  return {
    userId,
    ids: query.data ?? NONE,
    // A disabled query (no user) is idle and counts as answered.
    settled: query.fetchStatus === "idle" || query.status !== "pending",
  };
}
