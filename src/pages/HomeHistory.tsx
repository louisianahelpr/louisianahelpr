import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, DollarSign, Calendar, Home } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuthReady } from "@/hooks/useAuthReady";
import { unwrap } from "@/lib/supabaseResult";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { formatTimestamp, formatPrice } from "@/lib/format";
import { categoryColors, categoryLabels } from "@/components/activity/activityConstants";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { JobCardSkeleton } from "@/components/SkeletonLoaders";
import { ErrorState } from "@/components/ui/ErrorState";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface CompletedJobWithHelper extends Job {
  helperName: string | null;
}

function formatDate(dateStr: string | null): string {
  return dateStr ? formatTimestamp(dateStr) : "Unknown date";
}

function groupByYear(jobs: CompletedJobWithHelper[]): { year: number; jobs: CompletedJobWithHelper[] }[] {
  const map = new Map<number, CompletedJobWithHelper[]>();
  for (const job of jobs) {
    const year = new Date(job.created_at).getFullYear();
    if (!map.has(year)) map.set(year, []);
    map.get(year)!.push(job);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, jobs]) => ({ year, jobs }));
}

const HomeHistory = () => {
  usePageTitle("Home History — Helpr");
  const navigate = useNavigate();
  const { user } = useAuthReady();
  const userId = user?.id;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["home-history", userId],
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      if (!userId) return [] as CompletedJobWithHelper[];

      // Fetch completed jobs where this user is the poster (customer)
      const jobsRes = await supabase
        .from("jobs")
        .select("*")
        .eq("customer_id", userId)
        .eq("status", "completed")
        .order("created_at", { ascending: false });
      const jobs = unwrap(jobsRes) as Job[];

      if (jobs.length === 0) return [] as CompletedJobWithHelper[];

      // Fetch accepted applications for these jobs to get helper names
      const jobIds = jobs.map((j) => j.id);
      const appsRes = await supabase
        .from("applications")
        .select("job_id, helper_id")
        .in("job_id", jobIds)
        .eq("status", "accepted");
      const apps = unwrap(appsRes) as { job_id: string; helper_id: string }[];

      // Collect helper profile IDs
      const helperIds = [...new Set(apps.map((a) => a.helper_id))];
      let profileMap = new Map<string, string>();
      if (helperIds.length > 0) {
        const profilesRes = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", helperIds);
        const profiles = unwrap(profilesRes) as { user_id: string; full_name: string | null }[];
        profileMap = new Map(profiles.map((p) => [p.user_id, p.full_name ?? "Someone"]));
      }

      // Build a job_id → helper name lookup
      const helperByJob = new Map<string, string>();
      for (const app of apps) {
        helperByJob.set(app.job_id, profileMap.get(app.helper_id) ?? "Someone");
      }

      return jobs.map((j) => ({
        ...j,
        helperName: helperByJob.get(j.id) ?? null,
      })) as CompletedJobWithHelper[];
    },
  });

  const grouped = useMemo(() => groupByYear(data ?? []), [data]);
  const loading = isLoading && !data;

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        title="Home History"
        eyebrow="Your maintenance record"
        onBack={() => navigate("/profile")}
        showBrand
        rightSlot={<NotificationPanel />}
        // Mirrors the body container below (max-w-5xl, px-4 → lg:px-8 → xl:px-12).
        // Without it the header defaulted to a 90rem container and the title sat
        // outside the 5xl column it heads.
        width="5xl-p4"
      />

      <div className="mx-auto max-w-5xl px-4 lg:px-8 xl:px-12 pb-10 space-y-8 mt-2">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <JobCardSkeleton key={i} />)}
          </div>
        )}

        {isError && !loading && (
          <ErrorState
            variant="inline"
            title="Couldn't load your home history"
            onRetry={() => refetch()}
          />
        )}

        {!loading && !isError && (data ?? []).length === 0 && (
          <div
            className="flex flex-col items-center justify-center gap-4 rounded-ds-lg px-6 py-12 text-center"
            style={{
              background: "hsl(var(--parchment) / 0.55)",
              border: "1px solid hsl(var(--olivewood) / 0.12)",
            }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: "hsl(var(--bark) / 0.10)" }}
            >
              <Home className="w-8 h-8" style={{ color: "hsl(var(--bark))" }} />
            </div>
            <div className="space-y-1">
              <p className="font-display italic font-bold text-ds-17" style={{ color: "hsl(var(--ink-deep))" }}>
                No completed jobs yet
              </p>
              <p
                className="font-serif italic text-ds-13 leading-snug max-w-[26rem]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                When a job is done, it lives here forever — your home&rsquo;s permanent service history.
              </p>
            </div>
            <BarkPillButton onClick={() => navigate("/post-job")} className="mt-1">
              Post your first job
            </BarkPillButton>
          </div>
        )}

        {!loading && !isError && grouped.map(({ year, jobs }) => (
          <section key={year}>
            {/* Year group header */}
            <div className="flex items-center gap-3 mb-3">
              <span
                className="font-display italic font-bold text-ds-13"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {year}
              </span>
              <div className="flex-1 h-px" style={{ background: "hsl(var(--olivewood) / 0.12)" }} />
              <span className="text-ds-10 text-muted-foreground">{jobs.length} {jobs.length === 1 ? "job" : "jobs"}</span>
            </div>

            {/* Timeline */}
            <div className="relative pl-5">
              {/* Vertical connector line */}
              <div
                className="absolute left-[7px] top-3 bottom-3 w-px"
                style={{ background: "hsl(var(--olivewood) / 0.15)" }}
              />

              <div className="space-y-3">
                {jobs.map((job) => {
                  const Icon = getCategoryIcon(job.category);
                  const cat = job.category ?? "other";
                  const colors = categoryColors[cat] ?? categoryColors["other"];
                  const label = categoryLabels[cat] ?? "Other";

                  return (
                    <div key={job.id} className="relative">
                      {/* Timeline dot */}
                      <div
                        className="absolute -left-5 top-4 w-3.5 h-3.5 rounded-full border-2 z-10"
                        style={{
                          background: "hsl(var(--parchment))",
                          borderColor: "hsl(var(--bark) / 0.35)",
                        }}
                      />

                      {/* Job card. DELIBERATE deviation from the
                          `rounded-2xl liquid-glass p-5` card convention: this
                          is the shared parchment "record" surface used by
                          /work-record and /benefits (see the note on
                          BenefitsPage's cardStyle). liquid-glass's opaque
                          white fill would make these timeline entries read as
                          app cards floating over the page rather than as
                          entries on a single sheet. */}
                      <div
                        className="rounded-ds-lg p-4 space-y-2.5"
                        style={{
                          background: "hsl(var(--parchment) / 0.70)",
                          border: "1px solid hsl(var(--olivewood) / 0.10)",
                          boxShadow: "0 1px 3px hsl(var(--olivewood) / 0.06), 0 4px 10px -4px hsl(var(--olivewood) / 0.08)",
                        }}
                      >
                        {/* Top row: category badge + title */}
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`shrink-0 w-9 h-9 rounded-ds-md flex items-center justify-center ${colors.badge} border`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                              <span
                                className={`inline-flex items-center text-ds-10 font-semibold rounded-full px-2 py-0.5 border ${colors.badge}`}
                              >
                                {label}
                              </span>
                            </div>
                            <p className="text-ds-14 font-semibold leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
                              {job.title}
                            </p>
                            {job.helperName && (
                              <p className="text-ds-11 text-muted-foreground mt-0.5">
                                done by{" "}
                                <span className="font-semibold" style={{ color: "hsl(var(--bark))" }}>
                                  {job.helperName}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Meta row */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inline-flex items-center gap-1 text-ds-11 text-muted-foreground">
                            <Calendar className="w-3 h-3 shrink-0" />
                            {formatDate(job.created_at)}
                          </span>
                          {(job.budget ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 text-ds-11 font-medium" style={{ color: "hsl(var(--bark))" }}>
                              <DollarSign className="w-3 h-3 shrink-0" />
                              {formatPrice(job.budget ?? 0)}
                            </span>
                          )}
                          {job.location && (
                            <span className="inline-flex items-center gap-1 text-ds-11 text-muted-foreground">
                              <MapPin className="w-3 h-3 shrink-0" />
                              {job.parish ?? job.location}
                            </span>
                          )}
                        </div>

                        {/* Description excerpt */}
                        {job.description?.trim() && (
                          <p
                            className="font-serif italic text-ds-12 leading-snug line-clamp-2"
                            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                          >
                            {job.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default HomeHistory;
