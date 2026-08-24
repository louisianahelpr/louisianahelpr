import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { MapPin, TrendingUp } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";

interface ParishRow {
  parish: string;
  active_jobs: number;
  completed_jobs_30d: number;
  revenue_30d: number;
  helper_count: number;
}

const AdminParishActivity = () => {
  const [rows, setRows] = useState<ParishRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = unwrap(await supabase.rpc("get_parish_activity", { p_limit: 5 }));
      setRows((data as ParishRow[]) || []);
    } catch (err) {
      // Don't let a failed RPC fall through to the "No parish activity
      // yet" empty state — that reads as real data and hides the outage.
      report(err, { tags: { source: "AdminParishActivity.load" } });
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rounded-ds-md liquid-glass p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-ds-sm bg-accent/10 flex items-center justify-center">
            <MapPin className="w-4 h-4 text-accent" />
          </div>
          <div>
            <p className="text-ds-13 font-semibold text-foreground">Hot Parishes</p>
            <p className="text-ds-11 text-muted-foreground">Top 5 by recent activity</p>
          </div>
        </div>
        <span className="text-ds-10 font-medium text-muted-foreground uppercase tracking-wider">Last 30d</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-ds-sm" />)}
        </div>
      ) : loadError ? (
        <ErrorState
          variant="inline"
          title="We couldn't load parish activity."
          body="Tap Try again. Job and Helpr counts are safe — this is just a fetch hiccup."
          onRetry={() => void load()}
          retryDisabled={loading}
        />
      ) : rows.length === 0 ? (
        <EmptyState
            variant="inline"
            icon={MapPin}
            title="No parish activity yet"
            body="Activity appears once jobs are posted around the state."
          />
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div
              key={r.parish}
              className="flex items-center gap-3 px-3 py-2.5 rounded-ds-sm hover:bg-muted/40 transition-colors"
            >
              <span className="text-ds-13 font-bold text-muted-foreground w-5 tabular-nums">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-ds-13 font-medium text-foreground truncate">{r.parish}</p>
                <p className="text-ds-11 text-muted-foreground">
                  {r.active_jobs} active · {r.helper_count} Helpr{r.helper_count === 1 ? "" : "s"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-ds-13 font-bold text-foreground tabular-nums">${formatPrice(r.revenue_30d)}</p>
                <p className="text-ds-11 text-primary flex items-center gap-0.5 justify-end">
                  <TrendingUp className="w-2.5 h-2.5" />
                  {r.completed_jobs_30d} job{r.completed_jobs_30d === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminParishActivity;
