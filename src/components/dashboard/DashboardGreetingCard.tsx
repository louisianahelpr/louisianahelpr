import { Search } from "lucide-react";

interface DashboardGreetingCardProps {
  recommendedCount: number;
  isRefreshing: boolean;
  /** True when 0 jobs match the current filters — shows the "watching for" chip. */
  hasNoFilteredJobs: boolean;
  topSavedSearch: { name: string } | null;
  onWatchingClick: () => void;
}

/**
 * Greeting title-card block. Pure presentation lifted verbatim out of
 * Dashboard's `titleCard` slot — the condensed greeting line, the
 * date·picks·updating eyebrow, and the "watching for" saved-search chip.
 */
const DashboardGreetingCard = ({
  recommendedCount,
  isRefreshing,
  hasNoFilteredJobs,
  topSavedSearch,
  onWatchingClick,
}: DashboardGreetingCardProps) => {
  return (
    <>
      {/* The big "Good evening, <name>." headline was removed — the
          section name now lives in the top bar (Instagram/Facebook
          pattern), so this surface keeps only the small info eyebrow
          (date · picks · syncing) and the "watching for" chip. */}
      <p
        className="truncate font-sans font-semibold uppercase"
        style={{
          fontSize: "0.62rem",
          letterSpacing: "0.16em",
          color: "hsl(var(--olivewood) / 0.8)",
        }}
      >
        {/* Full date so the eyebrow is informative even when no jobs
            are nearby (avoids triple "0 jobs" redundancy across the
            greeting eyebrow, Browse-Tasks header, and empty-state
            card on quiet days). Job count only appears when > 0. */}
        {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        {/* Job count intentionally omitted here — it's already shown in
            the Browse Tasks header below ("N jobs"), so repeating it in
            the greeting eyebrow was redundant. Keep only the unique
            "picked for you" stat, which doesn't appear elsewhere. */}
        {recommendedCount > 0 && (
          <>
            {" · "}
            {recommendedCount} picked for you
          </>
        )}
        {/* Stale-while-revalidate signal — a tiny pulsing dot + tag
            shows up only while a background refetch runs on top of
            cached data. Proof the feed is syncing without blanking
            the surface. Hidden during the first load (the skeleton
            already speaks for that). */}
        {isRefreshing && (
          <span
            className="ml-2 inline-flex items-center gap-1 normal-case"
            style={{ letterSpacing: "0.08em" }}
            aria-live="polite"
          >
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: "hsl(var(--burnt-sienna))" }}
            />
            <span style={{ color: "hsl(var(--burnt-sienna) / 0.85)" }}>
              Updating
            </span>
          </span>
        )}
      </p>
      {/* "Watching for" chip — only shown when 0 jobs nearby and
          the user has an active saved search. Reframes the empty
          state as intentional rather than confusing. */}
      {hasNoFilteredJobs && topSavedSearch && (
        // Wrapped in a min-w-0 flex container so a long saved-search
        // name truncates instead of forcing the title card wider
        // than its column at large Dynamic Type sizes.
        <div className="mt-2 flex min-w-0 max-w-full">
          <button
            type="button"
            onClick={onWatchingClick}
            className="inline-flex min-h-[36px] min-w-0 max-w-full items-center gap-1.5 px-3 py-1.5 rounded-full active:opacity-70 transition-opacity"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.10)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.24)",
            }}
          >
            <Search className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.25} />
            <span
              className="text-[0.7rem] font-sans font-semibold tracking-wide truncate min-w-0"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              Watching for: {topSavedSearch.name}
            </span>
          </button>
        </div>
      )}
    </>
  );
};

export default DashboardGreetingCard;
