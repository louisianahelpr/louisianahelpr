import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { queryKeys } from "@/lib/queryKeys";

/**
 * HelperStreakBadge — small motivational nudge that rewards a string of
 * 5-star reviews. Pure-cosmetic surface: no schema, no RPC, no permissions
 * — just an aggregation of the helper's existing `reviews` rows.
 *
 * Algorithm: fetch the last `WINDOW` reviews for this reviewee (newest
 * first), then walk forward counting consecutive `rating === 5` rows until
 * we hit a sub-5 review. Returns the streak, capped at `MAX_DISPLAY`.
 *
 * Hidden when streak < `MIN_STREAK` — a "1-star streak" or "2-star streak"
 * isn't a meaningful signal and would just dilute the badge for the
 * helpers who actually earned it. Closes #84.
 *
 * The pill animation uses `motion-safe:` so users who set
 * `prefers-reduced-motion: reduce` get a static flame instead of a pulse.
 */

const WINDOW = 50;
const MIN_STREAK = 3;
const MAX_DISPLAY = 99;

interface ReviewRow {
  rating: number;
  created_at: string;
}

/**
 * Walk the reviews newest-first and count the leading run of 5-star
 * ratings. Pure function so it's trivial to unit-test from the outside.
 */
export function computeFiveStarStreak(reviews: Pick<ReviewRow, "rating">[]): number {
  let streak = 0;
  for (const r of reviews) {
    if (r.rating === 5) {
      streak += 1;
      if (streak >= MAX_DISPLAY) return MAX_DISPLAY;
    } else {
      break;
    }
  }
  return streak;
}

interface HelperStreakBadgeProps {
  helperId: string;
  /**
   * Optional className for the wrapping inline-flex pill — lets the
   * parent control margin / placement without us having to know the
   * surrounding layout.
   */
  className?: string;
}

export function HelperStreakBadge({ helperId, className }: HelperStreakBadgeProps) {
  const { data: streak = 0 } = useQuery<number>({
    queryKey: queryKeys.helperStreak.byHelper(helperId),
    queryFn: async () => {
      // Pull the most recent reviews (capped) so a helper with thousands
      // of jobs doesn't haul the whole history just for a badge. We rely
      // on the double-blind reveal filter — anything still hidden by
      // `feedback_visible_at` is "pending" and shouldn't count yet.
      const rows = unwrap(
        await supabase
          .from("reviews")
          .select("rating, created_at")
          .eq("reviewee_id", helperId)
          .lte("feedback_visible_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(WINDOW),
      ) as ReviewRow[] | null;

      return computeFiveStarStreak(rows ?? []);
    },
    enabled: !!helperId,
    // Streak doesn't move job-by-job — only when a fresh review lands.
    // A 5-min cache keeps the Earnings tab snappy across re-mounts.
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  if (streak < MIN_STREAK) return null;

  const displayCount = streak >= MAX_DISPLAY ? `${MAX_DISPLAY}+` : String(streak);
  const label = `${displayCount} 5-star streak`;
  const tooltipCopy =
    streak >= MAX_DISPLAY
      ? `${MAX_DISPLAY}+ five-star reviews in a row — that's a track record.`
      : `${streak} five-star review${streak === 1 ? "" : "s"} in a row. Nice run.`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="helper-streak-badge"
          aria-label={`${label}. Tap for details.`}
          className={[
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
            "bg-[hsl(var(--gold-warm)/0.15)] text-[hsl(var(--bark))]",
            "text-ds-11 font-semibold leading-none",
            "transition-colors hover:bg-[hsl(var(--gold-warm)/0.22)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-warm))]",
            className ?? "",
          ].join(" ")}
        >
          <Flame
            className="w-3.5 h-3.5 motion-safe:animate-pulse"
            style={{ color: "hsl(var(--gold-warm))" }}
            aria-hidden="true"
          />
          <span className="tabular-nums">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 text-ds-13 leading-relaxed font-sans"
      >
        <p className="font-semibold text-foreground mb-1 flex items-center gap-1.5">
          <Flame
            className="w-3.5 h-3.5"
            style={{ color: "hsl(var(--gold-warm))" }}
            aria-hidden="true"
          />
          5-star streak
        </p>
        <p className="text-muted-foreground">{tooltipCopy}</p>
      </PopoverContent>
    </Popover>
  );
}
