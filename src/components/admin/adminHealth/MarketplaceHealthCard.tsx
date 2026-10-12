import { TrendingUp, ChevronUp, ChevronDown } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ErrorState } from "@/components/ui/ErrorState";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { toneTextClasses } from "@/components/admin/tones";
import { cn } from "@/lib/utils";
import { FILL_DAYS_OPTIONS } from "./types";
import { formatDelay } from "./adminHealthHelpers";
import { useFillRate } from "./useFillRate";
import { Reading } from "./Reading";

/**
 * Admin Health's "Marketplace Health" card: fill rate, median time to first
 * application and the per-parish table, over get_fill_rate_stats.
 *
 * Moved out of AdminHealth.tsx unchanged apart from its failed-read states
 * (componentSizeRatchet: AdminHealth stays under 600 lines). Hidden while the
 * RPC is not deployed (PGRST202). A failed read is not "no data": never loaded
 * shows an error with retry, loaded earlier keeps the last reading marked stale.
 * Guard: src/components/admin/AdminHealth.fillRateUnreadable.test.tsx.
 */
export function MarketplaceHealthCard() {
  const {
    fillDays, setFillDays, fillSort, fillSortAsc, fillData, fillFetching, fillLoading, sortedParishes, handleFillSort,
    fillNeverLoaded, fillStale, fillUpdatedAt, refetchFill,
  } = useFillRate();

  if (!fillData?.available) return null;
  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-primary" /> Marketplace Health</span>}
      action={
        <div className="flex items-center gap-1">
          <SegmentedControl
            ariaLabel="Fill-rate window"
            className="w-fit"
            options={FILL_DAYS_OPTIONS.map((d) => ({ value: d, label: `${d}d` }))}
            value={fillDays}
            onChange={setFillDays}
            haptic={false}
          />
          {fillFetching && <span className="ml-1 text-ds-10 text-muted-foreground motion-safe:animate-pulse">…</span>}
        </div>
      }
      contentClassName="space-y-4"
    >
      {/* A failed read is not "no data": never loaded shows an error with
          retry instead of the fallback's "—" and zeros; loaded earlier
          keeps the last reading, marked stale (same rule as Platform
          Status above). */}
      {fillStale && (
        <p className="text-ds-12 font-medium text-destructive" role="status">
          Couldn't refresh the fill rate. The numbers below are from {new Date(fillUpdatedAt).toLocaleTimeString()}.
        </p>
      )}
      {fillNeverLoaded ? (
        <ErrorState
          variant="inline"
          title="Couldn't load the fill rate"
          body="The read behind these numbers failed, so none of them is shown rather than zeros."
          onRetry={() => void refetchFill()}
        />
      ) : (<>
      {/* 3 stat cards */}
      <div className="grid grid-cols-3 gap-2 text-ds-13">
        <div className="rounded-ds-sm bg-background/50 border border-border/40 p-3 space-y-0.5">
          <div className="text-ds-10 uppercase tracking-wider text-muted-foreground">Fill Rate</div>
          <Reading pending={fillLoading} bone="h-8 w-14">
            <div className="text-ds-24 font-semibold tabular-nums">
              {fillData.fill_rate_pct !== null ? `${fillData.fill_rate_pct}%` : "—"}
            </div>
          </Reading>
          <div className="text-ds-10 text-muted-foreground">jobs with ≥1 app</div>
        </div>
        <div className="rounded-ds-sm bg-background/50 border border-border/40 p-3 space-y-0.5">
          <div className="text-ds-10 uppercase tracking-wider text-muted-foreground">Median Response</div>
          <Reading pending={fillLoading} bone="h-8 w-14">
            <div className="text-ds-24 font-semibold tabular-nums">
              {formatDelay(fillData.median_minutes_to_first_app)}
            </div>
          </Reading>
          <div className="text-ds-10 text-muted-foreground">time to first app</div>
        </div>
        <div className="rounded-ds-sm bg-background/50 border border-border/40 p-3 space-y-0.5">
          <div className="text-ds-10 uppercase tracking-wider text-muted-foreground">Jobs Tracked</div>
          <Reading pending={fillLoading} bone="h-8 w-14">
            <div className="text-ds-24 font-semibold tabular-nums">{fillData.total_jobs}</div>
            <div className="text-ds-10 text-muted-foreground">{fillData.filled_jobs} filled</div>
          </Reading>
        </div>
      </div>

      {/* Per-parish table */}
      {sortedParishes.length > 0 && (
        <div className="space-y-1.5">
          {/* Sortable header */}
          <div className="grid grid-cols-12 gap-2 px-2">
            <div className="col-span-5 text-ds-10 uppercase tracking-wider text-muted-foreground">Parish</div>
            <button
              type="button"
              onClick={() => handleFillSort("total_jobs")}
              className="col-span-3 text-right text-ds-10 uppercase tracking-wider text-muted-foreground flex items-center justify-end gap-0.5 hover:text-foreground transition-colors"
            >
              Jobs
              {fillSort === "total_jobs"
                ? (fillSortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                : null}
            </button>
            <button
              type="button"
              onClick={() => handleFillSort("fill_rate_pct")}
              className="col-span-4 text-right text-ds-10 uppercase tracking-wider text-muted-foreground flex items-center justify-end gap-0.5 hover:text-foreground transition-colors"
            >
              Fill %
              {fillSort === "fill_rate_pct"
                ? (fillSortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                : null}
            </button>
          </div>

          {sortedParishes.map((p) => {
            const pct = p.fill_rate_pct;
            const pctCls = pct === null ? "text-muted-foreground"
              : pct >= 70 ? cn("font-semibold", toneTextClasses.success)
              : pct >= 40 ? cn("font-semibold", toneTextClasses.warning)
              : "text-destructive font-semibold";
            return (
              <div key={p.parish} className="grid grid-cols-12 gap-2 items-center rounded-ds-sm border border-border/60 bg-background/40 p-2 text-ds-13">
                <div className="col-span-5 truncate text-foreground">{p.parish}</div>
                <div className="col-span-3 text-right tabular-nums">{p.total_jobs}</div>
                <div className={cn("col-span-4 text-right tabular-nums", pctCls)}>
                  {pct !== null ? `${pct}%` : "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!fillLoading && sortedParishes.length === 0 && fillData.total_jobs === 0 && (
        <p className="text-ds-11 text-muted-foreground">No job data for this period yet.</p>
      )}
      </>)}
    </AdminCard>
  );
}
