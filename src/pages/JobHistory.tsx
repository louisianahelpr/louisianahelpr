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
import { unwrap } from "@/lib/supabaseResult";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];


const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-accent/20 text-accent-foreground",
  in_progress: "bg-accent/20 text-accent-foreground",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

type HistoryTab = "all" | "posted" | "worked";
type StatusFilter = "all" | "open" | "in_progress" | "completed" | "cancelled";

const JobHistory = () => {
  usePageTitle("Job History — Helpr");
  const navigate = useNavigate();
  const [tab, setTab] = useState<HistoryTab>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // React Query: cached for 30s, instant on revisit, refresh in background.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["job-history"],
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { navigate("/login"); return { posted: [] as Job[], worked: [] as Job[] }; }
      const [postedRes, workedRes] = await Promise.all([
        supabase.from("jobs").select("*").eq("customer_id", user.id).order("created_at", { ascending: false }),
        supabase.from("jobs").select("*").eq("helper_id", user.id).order("created_at", { ascending: false }),
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
    { key: "open", label: "Open" },
    { key: "in_progress", label: "In Progress" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ];

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow="Your archive"
        title="Job History"
        meta="Everything you've completed or closed"
      />

      <main className="container mx-auto px-5 py-6">
        <div className="max-w-3xl mx-auto space-y-4">

          {/* Tabs */}
          <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 px-3 py-2 rounded-md text-ds-13 font-medium transition-colors ${
                  tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
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
                className={`px-3 py-1.5 rounded-full text-ds-11 font-medium transition-colors ${
                  statusFilter === s.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
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
            />
          ) : (
            <div className="space-y-3">
              <p className="text-ds-11 text-muted-foreground">{jobs.length} job{jobs.length !== 1 ? "s" : ""}</p>
              {jobs.map((job) => (
                <div key={`${job.id}-${job._source}`} className="rounded-ds-md liquid-glass p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-foreground">{job.title}</h3>
                        <span className={`text-ds-11 px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>
                          {job.status.replace("_", " ")}
                        </span>
                        <span className="text-ds-11 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">
                          {job._source === "posted" ? "Posted" : "Worked"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-ds-11 text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(job.date_needed).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1 font-medium text-foreground"><DollarSign className="w-3 h-3" /> ${job.budget}</span>
                      </div>
                      <p className="text-ds-11 text-muted-foreground mt-2 line-clamp-1">{job.description}</p>
                    </div>
                    <p className="text-ds-11 text-muted-foreground whitespace-nowrap">
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
