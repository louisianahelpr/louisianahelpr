import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Jobs whose checkout never landed — the poster's drafts.
 *
 * Owner, 2026-09-21: "a job can never be posted if it was enver paid for", and
 * on where an unpaid one belongs: "It would be in post a job, drafts. The job
 * can never be posted anywhere or move forward until it's paid."
 *
 * WHY THIS HOOK HAD TO EXIST THE MOMENT THE FILTER LANDED. `jobIsUnfundedDraft`
 * removed these rows from My Posts, which was right — every browse feed already
 * filtered them out, so My Posts was showing a healthy card in "Waiting" for a
 * job no Helpr could ever see. But removing them with nowhere to go left an
 * abandoned checkout INVISIBLE, with no route back to paying for it. That is a
 * worse state than the bug, and it is this hook's whole reason to exist.
 *
 * Three payment states, one fact: the money never landed. `unpaid` never
 * completed, `abandoned` walked away, `failed` had the card declined. Kept in
 * step with `jobIsUnfundedDraft` (activityFilters.ts) and `unfundedNoticeCause`
 * (UnfundedJobNotice.tsx) — three readings of one rule, and a job that slips
 * between them is invisible on every surface at once.
 */
export interface UnpaidJobDraft {
  id: string;
  title: string;
  category: string;
  budget: number;
  created_at: string;
}

/** The payment states that mean the money never landed. */
export const UNPAID_DRAFT_PAYMENT_STATES = ["unpaid", "abandoned", "failed"] as const;

const unpaidDraftsKey = (userId: string | undefined) => ["unpaid-job-drafts", userId] as const;

/**
 * Short, because this list changes the moment a checkout completes and the
 * poster comes straight back to this screen from Stripe. A minute of staleness
 * here would show a paid job as still owing money.
 */
const UNPAID_DRAFTS_STALE_MS = 5_000;

async function fetchUnpaidJobDrafts(userId: string): Promise<UnpaidJobDraft[]> {
  const rows = unwrap(
    await supabase
      .from("jobs")
      .select("id, title, category, budget, created_at")
      .eq("customer_id", userId)
      .eq("status", "open")
      .in("payment_status", [...UNPAID_DRAFT_PAYMENT_STATES])
      .order("created_at", { ascending: false }),
  );
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    category: String(r.category ?? "other"),
    budget: Number(r.budget ?? 0),
    created_at: String(r.created_at ?? ""),
  }));
}

/**
 * The current user's unpaid job drafts, newest first.
 *
 * Returns `null` while loading and `[]` when there are none, so the caller can
 * skip the row entirely rather than flashing an empty one — the same contract
 * `useRecentPostedJobs` uses, deliberately, since they render side by side.
 *
 * `unwrap()` throws rather than handing back `[]`, so a failed read surfaces as
 * an error instead of quietly telling a poster they have nothing to pay for.
 */
export function useUnpaidJobDrafts(): UnpaidJobDraft[] | null {
  const { user } = useCurrentUser();

  const { data, isPending } = useQuery({
    queryKey: unpaidDraftsKey(user?.id),
    enabled: !!user?.id,
    staleTime: UNPAID_DRAFTS_STALE_MS,
    queryFn: () => fetchUnpaidJobDrafts(user!.id),
  });

  // Signed out is not "loading" — there is no poster to owe anything.
  if (!user?.id) return [];
  return isPending ? null : (data ?? []);
}
