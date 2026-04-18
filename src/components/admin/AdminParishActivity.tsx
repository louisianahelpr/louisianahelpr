import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.rpc("get_parish_activity", { p_limit: 5 } as any);
      setRows((data as ParishRow[]) || []);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <MapPin className="w-4 h-4 text-accent-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Hot Parishes</p>
            <p className="text-[11px] text-muted-foreground">Top 5 by recent activity</p>
          </div>
        </div>
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Last 30d</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No parish activity yet.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div
              key={r.parish}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/40 transition-colors"
            >
              <span className="text-sm font-bold text-muted-foreground w-5 tabular-nums">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{r.parish}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.active_jobs} active · {r.helper_count} helpers
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-foreground tabular-nums">${r.revenue_30d.toFixed(0)}</p>
                <p className="text-[11px] text-primary flex items-center gap-0.5 justify-end">
                  <TrendingUp className="w-2.5 h-2.5" />
                  {r.completed_jobs_30d} jobs
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
