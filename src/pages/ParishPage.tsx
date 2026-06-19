import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MapPin, Briefcase, Users, CheckCircle, Star, ArrowRight, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import PublicLayout from "@/components/marketing/PublicLayout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { avatarGradientFor } from "@/lib/avatarGradient";
import { cn } from "@/lib/utils";
import { formatName } from "@/lib/utils";
import { report } from "@/lib/errorLogger";
import { formatCategory } from "@/lib/format";

// Map URL slug → canonical parish name stored in the `parish` column of jobs
const SLUG_TO_PARISH: Record<string, string> = {
  orleans: "Orleans",
  jefferson: "Jefferson",
  "east-baton-rouge": "East Baton Rouge",
  "st-tammany": "St. Tammany",
  caddo: "Caddo",
  calcasieu: "Calcasieu",
  lafayette: "Lafayette",
  ouachita: "Ouachita",
};

function formatBudget(budget: number) {
  return budget >= 1000 ? `$${(budget / 1000).toFixed(1)}k` : `$${budget}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const ParishPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const parishName = slug ? (SLUG_TO_PARISH[slug] ?? null) : null;
  const displayParishName = parishName ? `${parishName} Parish` : "Parish";

  usePageTitle(`${parishName ?? "Parish"} Parish — Helpr Community`);

  const { data, isLoading } = useQuery({
    queryKey: ["parish", slug],
    enabled: !!parishName,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!parishName) throw new Error("Unknown parish slug");

      // 1. Open jobs in the parish (up to 6 for display)
      const openJobsRes = await supabase
        .from("jobs")
        .select("id, title, budget, category, created_at")
        .ilike("parish", parishName)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(6);

      if (openJobsRes.error) {
        report(openJobsRes.error, {
          severity: "warning",
          tags: { area: "parish_page.open_jobs" },
          context: { parish: parishName },
        });
      }

      // 2. Total open job count (head query)
      const openCountRes = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .ilike("parish", parishName)
        .eq("status", "open");

      // 3. Total completed job count in parish
      const completedCountRes = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .ilike("parish", parishName)
        .eq("status", "completed");

      // 4. Top helpers via existing RPC — pass the parish name
      const helpersRes = await supabase.rpc("get_top_helpers_by_parish", {
        p_parish: parishName,
        p_limit: 3,
      });
      if (helpersRes.error && helpersRes.error.code !== "PGRST202") {
        report(helpersRes.error, {
          severity: "warning",
          tags: { area: "parish_page.top_helpers" },
          context: { parish: parishName },
        });
      }

      // 5. Active helper count from helper_preferred_parishes
      const activeHelpersRes = await supabase
        .from("helper_preferred_parishes")
        .select("id", { count: "exact", head: true })
        .ilike("parish", parishName);

      return {
        openJobs: (openJobsRes.data ?? []) as Array<{
          id: string;
          title: string;
          budget: number;
          category: string;
          created_at: string;
        }>,
        openCount: openCountRes.count ?? 0,
        completedCount: completedCountRes.count ?? 0,
        activeHelpers: activeHelpersRes.count ?? 0,
        topHelpers: (helpersRes.data ?? []) as Array<{
          user_id: string;
          full_name: string;
          avatar_url: string;
          avg_rating: number;
          completed_jobs: number;
          review_count: number;
          bio: string;
        }>,
      };
    },
  });

  // Unknown slug → 404-like empty
  if (!parishName) {
    return (
      <PublicLayout showCtaBand={false}>
        <PageHeader eyebrow="Louisiana Helpr" title="Parish not found" />
        <main className="container mx-auto px-5 py-8 max-w-2xl">
          <EmptyState
            variant="inline"
            icon={MapPin}
            title="We don't recognize that parish"
            body="Try one of the eight supported Louisiana parishes."
            action={
              <Button onClick={() => navigate("/parishes")} variant="outline" size="sm" className="rounded-full squircle">
                Browse parishes
              </Button>
            }
          />
        </main>
      </PublicLayout>
    );
  }

  const openJobs = data?.openJobs ?? [];
  const openCount = data?.openCount ?? 0;
  const completedCount = data?.completedCount ?? 0;
  const activeHelpers = data?.activeHelpers ?? 0;
  const topHelpers = data?.topHelpers ?? [];

  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Louisiana Helpr Community"
        title={displayParishName}
        meta={
          isLoading ? (
            <span className="animate-pulse">Loading stats…</span>
          ) : (
            <>
              <span className="font-display italic font-semibold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                {openCount}
              </span>{" "}
              open{" "}
              <span style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>{" "}
              <span className="font-display italic font-semibold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                {activeHelpers}
              </span>{" "}
              active helpers{" "}
              <span style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>{" "}
              <span className="font-display italic font-semibold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                {completedCount}
              </span>{" "}
              done
            </>
          )
        }
      />

      <main className="container mx-auto px-5 py-6 max-w-2xl space-y-8">

        {/* ── Open Jobs Section ───────────────────────────────────── */}
        <section aria-labelledby="open-jobs-heading">
          <div className="flex items-center justify-between mb-3">
            <h2
              id="open-jobs-heading"
              className="text-ds-15 font-semibold"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Open jobs
            </h2>
            {openCount > 0 && (
              <Link
                to={`/jobs?parish=${encodeURIComponent(parishName)}`}
                className="text-ds-11 font-medium flex items-center gap-1 hover:underline"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                See all <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-ds-md liquid-glass p-4 animate-pulse">
                  <div className="h-4 w-2/3 bg-muted/40 rounded mb-2" />
                  <div className="h-3 w-1/3 bg-muted/30 rounded" />
                </div>
              ))}
            </div>
          ) : openJobs.length === 0 ? (
            <div
              className="rounded-ds-md liquid-glass p-6 text-center space-y-3"
              role="status"
            >
              <Briefcase className="w-8 h-8 mx-auto" style={{ color: "hsl(var(--burnt-sienna) / 0.45)" }} />
              <div>
                <p className="text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                  No open jobs yet
                </p>
                <p className="text-ds-11 mt-1" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                  Be the first to post in {displayParishName}.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full squircle"
                onClick={() => navigate("/post-job")}
              >
                Post the first job in {displayParishName}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {openJobs.map((job) => {
                const Icon = getCategoryIcon(job.category);
                return (
                  <Link
                    key={job.id}
                    to={`/jobs?parish=${encodeURIComponent(parishName)}`}
                    className="flex items-center gap-3 rounded-ds-md liquid-glass p-4 hover:ring-1 hover:ring-primary/20 transition-all group"
                    aria-label={`${job.title} — ${formatBudget(job.budget)}`}
                  >
                    <div
                      className="w-9 h-9 rounded-ds-sm flex items-center justify-center shrink-0"
                      style={{
                        background: "hsl(var(--burnt-sienna) / 0.08)",
                        border: "0.5px solid hsl(var(--burnt-sienna) / 0.18)",
                      }}
                    >
                      <Icon className="w-4 h-4" style={{ color: "hsl(var(--burnt-sienna))" }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-ds-13 font-semibold truncate" style={{ color: "hsl(var(--ink-deep))" }}>
                        {job.title}
                      </p>
                      <p className="text-ds-11 mt-0.5 flex items-center gap-1.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                        <Clock className="w-3 h-3 shrink-0" />
                        {timeAgo(job.created_at)}
                        <span style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
                        <span>{formatCategory(job.category)}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className="text-ds-15 font-display italic font-bold tabular-nums"
                        style={{ color: "hsl(var(--ink-deep))" }}
                      >
                        {formatBudget(job.budget)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Local Helpers Section ───────────────────────────────── */}
        <section aria-labelledby="local-helpers-heading">
          <div className="flex items-center justify-between mb-3">
            <h2
              id="local-helpers-heading"
              className="text-ds-15 font-semibold"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Top local helpers
            </h2>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-ds-md liquid-glass p-4 animate-pulse flex items-center gap-3">
                  <div className="w-10 h-10 rounded-ds-pill bg-muted/40 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/2 bg-muted/40 rounded" />
                    <div className="h-3 w-1/3 bg-muted/30 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : topHelpers.length === 0 ? (
            <div className="rounded-ds-md liquid-glass p-5 text-center" role="status">
              <Users className="w-6 h-6 mx-auto mb-2" style={{ color: "hsl(var(--olivewood) / 0.45)" }} />
              <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                No helpers yet in {displayParishName}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {topHelpers.map((helper) => {
                const displayName = formatName(helper.full_name);
                const initials = (helper.full_name || "?")
                  .split(" ")
                  .map((w: string) => w[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);
                return (
                  <Link
                    key={helper.user_id}
                    to={`/user/${helper.user_id}`}
                    className="flex items-center gap-3 rounded-ds-md liquid-glass p-4 hover:ring-1 hover:ring-primary/20 transition-all"
                    aria-label={`View ${displayName}'s profile`}
                  >
                    {helper.avatar_url ? (
                      <img
                        src={helper.avatar_url}
                        alt={`${displayName} avatar`}
                        loading="lazy"
                        decoding="async"
                        className="w-10 h-10 rounded-ds-pill squircle object-cover shrink-0"
                        style={{ boxShadow: "0 0 0 1.5px hsl(var(--bark) / 0.15)" }}
                      />
                    ) : (
                      <div
                        className={cn(
                          "w-10 h-10 rounded-ds-pill squircle bg-gradient-to-br flex items-center justify-center shrink-0 text-ds-13 font-display italic font-bold",
                          avatarGradientFor(helper.user_id),
                        )}
                        style={{ color: "hsl(var(--ink-deep))", boxShadow: "0 0 0 1.5px hsl(var(--bark) / 0.15)" }}
                      >
                        {initials}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-ds-13 font-semibold truncate" style={{ color: "hsl(var(--ink-deep))" }}>
                        {displayName}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                        {helper.avg_rating > 0 && (
                          <>
                            <Star className="w-3 h-3" style={{ fill: "hsl(var(--gold-warm))", color: "hsl(var(--gold-warm))" }} />
                            <span className="font-medium tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                              {helper.avg_rating.toFixed(1)}
                            </span>
                            <span style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
                          </>
                        )}
                        <CheckCircle className="w-3 h-3" style={{ color: "hsl(var(--sage))" }} />
                        <span>
                          <span className="font-semibold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                            {helper.completed_jobs}
                          </span>{" "}
                          {helper.completed_jobs === 1 ? "job" : "jobs"} done
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.45)" }} />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ── CTA Row ─────────────────────────────────────────────── */}
        <div
          className="rounded-ds-lg liquid-glass p-5 space-y-3"
          style={{
            backgroundImage:
              "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.06) 0%, transparent 55%)",
          }}
        >
          <p className="text-ds-13 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Join the {displayParishName} community on Helpr — hire local or earn locally.
          </p>
          <div className="flex gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full squircle flex-1 min-w-0"
              onClick={() => navigate("/jobs")}
            >
              Browse all jobs
            </Button>
            <Button
              variant="hero"
              size="sm"
              className="rounded-full squircle flex-1 min-w-0"
              onClick={() => navigate("/post-job")}
            >
              Post a job
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>

      </main>
    </PublicLayout>
  );
};

export default ParishPage;
