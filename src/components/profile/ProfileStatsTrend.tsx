// Profile stats trend — small Recharts area chart showing jobs
// completed + dollars earned/spent over a chosen window (30d / 90d / 12mo).
//
// Lives inside a collapsed disclosure on the Profile landing's hero
// trust strip so it doesn't push everything else down the page on a
// brand-new helper. Self-fetches its own data so the parent doesn't
// have to thread per-window props down the tree.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { helperTakeHomeDollars } from "@/lib/helperEarnings";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown } from "lucide-react";

type Window = "30d" | "90d" | "12mo";

interface ProfileStatsTrendProps {
  helperId: string;
  // Fee % to apply when a job row predates the per-job helper_fee_percent
  // column. Tier-derived by the caller so every earnings surface agrees.
  feeFallbackPercent: number;
}

interface JobRow {
  id: string;
  helper_id: string | null;
  customer_id: string | null;
  status: string;
  budget: number;
  platform_fee_amount: number | null;
  helper_fee_percent: number | null;
  helpers_needed: number | null;
  is_group_job: boolean | null;
  urgent_fee: number | null;
  helper_completed_at: string | null;
  poster_completed_at: string | null;
  created_at: string;
}

const WINDOW_LABEL: Record<Window, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "12mo": "12 months",
};

export function ProfileStatsTrend({ helperId, feeFallbackPercent }: ProfileStatsTrendProps) {
  const [open, setOpen] = useState(false);
  const [win, setWin] = useState<Window>("30d");

  const { data: jobs = [], isLoading } = useQuery<JobRow[]>({
    queryKey: ["profile", "statsTrend", helperId],
    queryFn: async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      const { data, error } = await supabase
        .from("jobs")
        .select("id, helper_id, customer_id, status, budget, platform_fee_amount, helper_fee_percent, helpers_needed, is_group_job, urgent_fee, helper_completed_at, poster_completed_at, created_at")
        .eq("status", "completed")
        .or(`helper_id.eq.${helperId},customer_id.eq.${helperId}`)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: true });
      if (error) return [];
      return (data as JobRow[]) ?? [];
    },
    enabled: open && !!helperId,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  const data = useMemo(() => {
    const now = new Date();
    let bucketCount: number;
    let bucketSizeMs: number;
    let labelFmt: (d: Date) => string;
    if (win === "30d") {
      bucketCount = 30; bucketSizeMs = 86400_000;
      labelFmt = (d) => d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    } else if (win === "90d") {
      bucketCount = 13; bucketSizeMs = 7 * 86400_000;
      labelFmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } else {
      bucketCount = 12; bucketSizeMs = 30 * 86400_000;
      labelFmt = (d) => d.toLocaleDateString("en-US", { month: "short" });
    }

    const buckets: { label: string; bucketStart: number; jobs: number; earned: number; spent: number }[] = [];
    for (let i = bucketCount - 1; i >= 0; i--) {
      const start = now.getTime() - i * bucketSizeMs;
      const d = new Date(start);
      buckets.push({ label: labelFmt(d), bucketStart: start, jobs: 0, earned: 0, spent: 0 });
    }

    jobs.forEach((j) => {
      const rawTs = j.poster_completed_at ?? j.helper_completed_at ?? j.created_at;
      const t = new Date(rawTs).getTime();
      if (t < buckets[0].bucketStart - bucketSizeMs) return;
      let idx = -1;
      for (let i = 0; i < buckets.length; i++) {
        if (t >= buckets[i].bucketStart - bucketSizeMs / 2 && t < buckets[i].bucketStart + bucketSizeMs / 2) {
          idx = i;
          break;
        }
      }
      if (idx === -1 && t >= buckets[buckets.length - 1].bucketStart) idx = buckets.length - 1;
      if (idx === -1) return;

      if (j.helper_id === helperId) {
        buckets[idx].jobs += 1;
        buckets[idx].earned += helperTakeHomeDollars(j, feeFallbackPercent);
      }
      if (j.customer_id === helperId) {
        buckets[idx].spent += j.budget;
      }
    });

    return buckets.map((b) => ({
      label: b.label,
      jobs: b.jobs,
      earned: Math.round(b.earned * 100) / 100,
      spent: Math.round(b.spent * 100) / 100,
    }));
  }, [jobs, win, feeFallbackPercent, helperId]);

  const isEmpty = data.every((d) => d.jobs === 0 && d.earned === 0 && d.spent === 0);

  return (
    <div
      className="mt-3.5 pt-3.5"
      style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 active:opacity-70 transition-opacity"
      >
        <span
          className="font-serif italic uppercase text-ds-9"
          style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
        >
          Activity trend
        </span>
        <span
          className="inline-flex items-center gap-1 text-ds-11 font-semibold"
          style={{ color: "hsl(var(--bark))" }}
        >
          {open ? "Hide" : "View"}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-full"
            style={{
              background: "hsl(var(--ivory-sand) / 0.4)",
              border: "0.5px solid hsl(var(--olivewood) / 0.08)",
            }}
          >
            {(["30d", "90d", "12mo"] as const).map((w) => {
              const active = w === win;
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWin(w)}
                  className="flex-1 px-2 h-6 rounded-full text-ds-11 font-sans font-semibold transition-all"
                  style={
                    active
                      ? {
                          background: "hsl(var(--bark))",
                          color: "hsl(var(--parchment))",
                          boxShadow: "var(--elev-bark-flat)",
                        }
                      : { color: "hsl(var(--olivewood) / 0.8)" }
                  }
                  aria-pressed={active}
                  aria-label={`Show last ${WINDOW_LABEL[w]}`}
                >
                  {w === "12mo" ? "12mo" : w}
                </button>
              );
            })}
          </div>

          <div
            className="rounded-ds-md p-3"
            style={{
              background: "hsla(0, 0%, 100%, 0.55)",
              border: "0.5px solid hsl(var(--olivewood) / 0.10)",
            }}
          >
            {isLoading ? (
              <div className="h-[120px] flex items-center justify-center">
                <Skeleton className="h-3 w-32 rounded" />
              </div>
            ) : isEmpty ? (
              <p
                className="font-serif italic text-center py-6 text-ds-12"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                No activity in the last {WINDOW_LABEL[win]}.
              </p>
            ) : (
              <div className="h-[120px] w-full">
                <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                  <AreaChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                    <defs>
                      <linearGradient id="profileStatsEarnedFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(20, 60%, 50%)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(20, 60%, 50%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="profileStatsSpentFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--stormy-sky))" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="hsl(var(--stormy-sky))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="hsl(var(--olivewood))" strokeOpacity={0.06} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "hsl(var(--olivewood))" }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "hsl(var(--olivewood))" }}
                      axisLine={false}
                      tickLine={false}
                      width={32}
                      tickFormatter={(v: number) => (v >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${v}`)}
                    />
                    <Tooltip
                      formatter={(value, key) =>
                        String(key) === "earned"
                          ? [`$${Number(value).toFixed(2)}`, "Earned"]
                          : String(key) === "spent"
                            ? [`$${Number(value).toFixed(2)}`, "Spent"]
                            : [String(value), "Jobs"]
                      }
                      contentStyle={{
                        background: "hsl(var(--ivory-sand) / 0.95)",
                        border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                        borderRadius: 8,
                        fontSize: "0.72rem",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="spent"
                      stroke="hsl(var(--stormy-sky))"
                      strokeWidth={1.5}
                      fill="url(#profileStatsSpentFill)"
                    />
                    <Area
                      type="monotone"
                      dataKey="earned"
                      stroke="hsl(20, 60%, 50%)"
                      strokeWidth={2}
                      fill="url(#profileStatsEarnedFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProfileStatsTrend;
