import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Calendar, Home } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuthReady } from "@/hooks/useAuthReady";
import { unwrap } from "@/lib/supabaseResult";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { formatTimestamp, formatPrice } from "@/lib/format";
import { categoryColors, categoryLabels } from "@/components/activity/activityConstants";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { JobCardSkeleton } from "@/components/SkeletonLoaders";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
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

        {/* House empty state — the same eyebrow / title / body / CTA shape
            (and shared card) that Browse and Messages use, instead of the
            bespoke copy of it this page used to carry. Same message, one
            fewer hand-rolled surface. */}
        {!loading && !isError && (data ?? []).length === 0 && (
          <EmptyState
            variant="inline"
            icon={Home}
            eyebrow="Nothing on record yet"
            title="No finished jobs yet."
            body="When a job is done it lands here for good — who came out, what it cost, and when. It's your home's permanent service history."
            action={
              <BarkPillButton onClick={() => navigate("/post-job")}>
                Post your first job
              </BarkPillButton>
            }
          />
        )}

        {/* The year rule is a DIVIDER, so it only earns its place when there
            is something to divide. With a single year on the page it labels
            the whole list twice over — every card already prints its own full
            date — and "2026 ——— 1 job" was heavier chrome than the one entry
            underneath it. Two or more years and it goes back to doing real
            work. */}
        {!loading && !isError && grouped.map(({ year, jobs }) => (
          <section key={year}>
            {grouped.length > 1 && (
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="font-sans font-semibold text-ds-13 tabular-nums"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {year}
                </span>
                <div className="flex-1 h-px" style={{ background: "hsl(var(--olivewood) / 0.12)" }} />
                <span className="text-ds-10 text-muted-foreground">{jobs.length} {jobs.length === 1 ? "job" : "jobs"}</span>
              </div>
            )}

            {/* Timeline. The spine (dot + connector line) is only drawn once
                there are at least TWO entries to connect: with one card the
                line has nothing to run between and the lone dot reads as a
                stray UI artifact hanging off the left edge rather than as a
                timeline. Below the threshold the group renders as a plain
                stack and reclaims the 20px rail. */}
            <div className={jobs.length > 1 ? "relative pl-5" : "relative"}>
              {/* Vertical connector line */}
              {jobs.length > 1 && (
                <div
                  className="absolute left-[7px] top-3 bottom-3 w-px"
                  style={{ background: "hsl(var(--olivewood) / 0.15)" }}
                />
              )}

              <div className="space-y-3">
                {jobs.map((job) => {
                  const Icon = getCategoryIcon(job.category);
                  const cat = job.category ?? "other";
                  const colors = categoryColors[cat] ?? categoryColors["other"];
                  const label = categoryLabels[cat] ?? "Other";

                  return (
                    <div key={job.id} className="relative">
                      {/* Timeline dot */}
                      {jobs.length > 1 && (
                        <div
                          className="absolute -left-5 top-4 w-3.5 h-3.5 rounded-full border-2 z-10"
                          style={{
                            background: "hsl(var(--parchment))",
                            borderColor: "hsl(var(--bark) / 0.35)",
                          }}
                        />
                      )}

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
                          {/* A currency symbol is typography, not an icon: the
                              "$" belongs in the same text node as the digits.
                              A DollarSign glyph beside the amount rendered as
                              "$ 200" — wrong stroke weight, a gap in the
                              middle of the figure, and no tabular alignment. */}
                          {(job.budget ?? 0) > 0 && (
                            <span className="inline-flex items-center text-ds-11 font-medium tabular-nums" style={{ color: "hsl(var(--bark))" }}>
                              ${formatPrice(job.budget ?? 0)}
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
