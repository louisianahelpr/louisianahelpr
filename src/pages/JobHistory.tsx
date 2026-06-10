import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, DollarSign, Calendar, ClipboardList } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import { JobCardSkeleton } from "@/components/SkeletonLoaders";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { StatusBadge } from "@/components/StatusBadge";
import { jobStatusLabel } from "@/lib/statusLabels";
import { unwrap } from "@/lib/supabaseResult";
import { useAuthReady } from "@/hooks/useAuthReady";
import { queryKeys } from "@/lib/queryKeys";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

type HistoryTab = "all" | "posted" | "worked";
type StatusFilter = "all" | "open" | "in_progress" | "completed" | "cancelled";

const JobHistory = () => {
  usePageTitle("Job History — Helpr");
  const navigate = useNavigate();
  const { user } = useAuthReady();
  const userId = user?.id;
  const [tab, setTab] = useState<HistoryTab>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // React Query: cached for 30s, instant on revisit, refresh in background.
  // Key is user-scoped: the IDB persister keeps successful queries for 24h,
  // so a bare ["job-history"] would rehydrate the prior user's posts/work
  // history into the next user's session on a shared device.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.jobHistory.byUser(userId),
    enabled: !!userId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      if (!userId) { navigate("/login"); return { posted: [] as Job[], worked: [] as Job[] }; }
      const [postedRes, workedRes] = await Promise.all([
        supabase.from("jobs").select("*").eq("customer_id", userId).order("created_at", { ascending: false }),
        supabase.from("jobs").select("*").eq("helper_id", userId).order("created_at", { ascending: false }),
      ]);
      const posted = unwrap(postedRes) as Job[];
      const worked = unwrap(workedRes) as Job[];
      return { posted, worked };
    },
  });

  const postedJobs = useMemo(() => data?.posted ?? [], [data]);
  const workedJobs = useMemo(() => data?.worked ?? [], [data]);
  const loading = isLoading && !data;

  const jobs = useMemo(() => {
    let merged: (Job & { _source: "posted" | "worked" })[] = [];
    if (tab === "all" || tab === "posted") {
      merged = [...merged, ...postedJobs.map((j) => ({ ...j, _source: "posted" as const }))];
    }
    if (tab === "all" || tab === "worked") {
      merged = [...merged, ...workedJobs.map((j) => ({ ...j, _source: "worked" as const }))];
    }
    // Deduplicate
    const seen = new Set<string>();
    merged = merged.filter((j) => {
      if (seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    });
    if (statusFilter !== "all") {
      merged = merged.filter((j) => j.status === statusFilter);
    }
    return merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [tab, statusFilter, postedJobs, workedJobs]);

  const tabs: { key: HistoryTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "posted", label: "Posted" },
    { key: "worked", label: "Worked" },
  ];

  const statuses: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: jobStatusLabel("open") },
    { key: "in_progress", label: jobStatusLabel("in_progress") },
    { key: "completed", label: jobStatusLabel("completed") },
    { key: "cancelled", label: jobStatusLabel("cancelled") },
  ];

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow="Your archive"
        title="Job History"
        meta="Everything you've completed or closed"
      />

      <main className="container mx-auto px-5 py-6">
        <div className="max-w-lg mx-auto space-y-4">

          {/* Tabs */}
          <div className="flex gap-1 liquid-glass rounded-ds-sm p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 min-h-[44px] px-3 py-2 rounded-md text-ds-13 font-medium transition-colors glass-press ${
                  tab === t.key ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Status filter pills */}
          <div className="flex flex-wrap gap-1.5">
            {statuses.map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={`inline-flex items-center min-h-[36px] px-3.5 py-1.5 rounded-full text-ds-11 font-medium transition-colors glass-press ${
                  statusFilter === s.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-secondary-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              <JobCardSkeleton />
              <JobCardSkeleton />
              <JobCardSkeleton />
            </div>
          ) : isError ? (
            <div className="flex">
              <ErrorState onRetry={() => refetch()} />
            </div>
          ) : jobs.length === 0 ? (
            <EmptyState
              variant="inline"
              icon={ClipboardList}
              eyebrow="Quiet archive"
              title="Nothing here yet."
              body="Completed and closed jobs will collect in your archive."
              action={
                <BarkPillButton onClick={() => navigate("/dashboard")}>
                  Browse open jobs
                </BarkPillButton>
              }
            />
          ) : (
            <div className="space-y-3">
              <p className="text-ds-11 text-muted-foreground">{jobs.length} job{jobs.length !== 1 ? "s" : ""}</p>
              {jobs.map((job) => (
                <div key={`${job.id}-${job._source}`} className="rounded-ds-md liquid-glass p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h2 className="font-semibold text-foreground break-words">{job.title}</h2>
                        <StatusBadge status={job.status} className="text-ds-11 shrink-0" />
                        <span className="text-ds-11 px-2 py-0.5 rounded-full bg-[hsl(var(--bark)/0.08)] text-[hsl(var(--bark))] border border-[hsl(var(--bark)/0.18)] font-medium shrink-0">
                          {job._source === "posted" ? "Posted" : "Worked"}
                        </span>
                      </div>
                      {/* Meta row — two-line layout on SE (320 px): budget +
                          date on the first line, full location below.
                          On wider phones everything fits on one row. */}
                      <div className="text-ds-11 text-muted-foreground mt-1 space-y-0.5">
                        <div className="flex items-center flex-wrap gap-x-2.5 gap-y-0.5">
                          <span className="flex items-center gap-1 font-semibold text-foreground">
                            <DollarSign className="w-3 h-3 shrink-0" />${job.budget}
                          </span>
                          <span className="opacity-40">·</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 shrink-0" />
                            {new Date(job.date_needed).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        </div>
                        <span className="flex items-center gap-1 min-w-0">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{job.location}</span>
                        </span>
                      </div>
                      {job.description?.trim() && (
                        <p className="text-ds-11 text-muted-foreground mt-2 line-clamp-1">{job.description}</p>
                      )}
                    </div>
                    <p className="text-ds-11 text-muted-foreground whitespace-nowrap shrink-0">
                      {new Date(job.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default JobHistory;
