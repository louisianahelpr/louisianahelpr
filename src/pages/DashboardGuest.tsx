import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, Briefcase, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import JobCard from "@/components/dashboard/JobCard";
import { categoryLabels } from "@/components/dashboard/JobFilters";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import type { EnrichedJob } from "@/components/dashboard/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import helprIcon from "@/assets/helpr-icon-96.webp";

/**
 * DashboardGuest — the read-only "home dashboard" iOS guests land on.
 *
 * Visually mirrors the real /dashboard (DashboardHeader, JobCard, filters)
 * so first-run users see the actual marketplace, not a marketing page or
 * a stripped-down list. Every interactive action (Apply, Save, Report,
 * card-tap details) routes to /signup so Apple's "preview before signup"
 * requirement is satisfied without exposing private data.
 *
 * We intentionally do NOT reuse Dashboard.tsx — it pervasively assumes an
 * authenticated user (Supabase calls scoped by user.id, approval gating,
 * stripe checks, etc.). Building a parallel guest surface keeps both code
 * paths simple.
 */

const ALL_CATEGORIES: Array<keyof typeof categoryLabels | string> = Object.keys(categoryLabels);

const DashboardGuest = () => {
  const navigate = useNavigate();
  usePageTitle("Browse Jobs — Helpr");

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Public open-jobs feed — no auth required (open_jobs_browse view is RLS-public).
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["guestDashboardJobs"],
    queryFn: async (): Promise<EnrichedJob[]> => {
      const { data: rawJobs } = await supabase
        .from("open_jobs_browse" as any)
        .select(
          "id, title, description, category, budget, date_needed, location, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status",
        )
        .neq("payment_status", "abandoned")
        .order("boosted_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(40);

      const rows = (rawJobs ?? []) as any[];
      if (rows.length === 0) return [];

      // Enrich with poster names + review stats so guests see the same
      // social-proof signals (avg rating, review count) authenticated users do.
      const posterIds = [...new Set(rows.map((j) => j.customer_id))];
      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        supabase
          .from("reviews")
          .select("reviewee_id, rating, jobs!inner(status)")
          .in("reviewee_id", posterIds)
          .neq("jobs.status", "cancelled"),
      ]);

      const nameMap = new Map(
        profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || [],
      );
      const reviewStatsMap = new Map<string, { count: number; avg: number }>();
      for (const r of reviewsRes.data ?? []) {
        const existing = reviewStatsMap.get(r.reviewee_id);
        if (existing) {
          existing.count += 1;
          existing.avg = (existing.avg * (existing.count - 1) + r.rating) / existing.count;
        } else {
          reviewStatsMap.set(r.reviewee_id, { count: 1, avg: r.rating });
        }
      }

      const now = new Date();
      return rows
        .filter((j) => !j.expires_at || new Date(j.expires_at) > now)
        .map((j) => {
          const isBoosted = !!j.boost_expires_at && new Date(j.boost_expires_at) > now;
          const stats = reviewStatsMap.get(j.customer_id);
          return {
            ...j,
            posterName: nameMap.get(j.customer_id) || "User",
            posterReviewCount: stats?.count ?? 0,
            posterAvgRating: stats?.avg ?? 0,
            posterCompletedJobs: 0,
            posterSubscriptionTier: null,
            isBoosted,
          } as EnrichedJob;
        });
    },
    staleTime: 60 * 1000,
  });

  // Bounce already-authenticated users straight to the real dashboard so
  // they never see the guest surface (would confuse anyone with a session).
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session?.user) navigate("/dashboard", { replace: true });
    });
    return () => { cancelled = true; };
  }, [navigate]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (selectedCategory && j.category !== selectedCategory) return false;
      if (q && !`${j.title} ${j.location} ${j.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [jobs, search, selectedCategory]);

  // All interactive actions route to signup. Toast would be noisier — a
  // direct redirect matches what authenticated users feel (immediate response).
  const requireSignup = useCallback(() => {
    navigate("/signup");
  }, [navigate]);

  return (
    <div className="min-h-screen bg-premium-page">
      {/* Mirror DashboardHeader visuals exactly so the chrome looks identical
          to the authenticated experience. We render a simplified version here
          (no logout / notifications / admin) since the user has no session. */}
      <header
        className="sticky top-0 z-40 glass border-b border-border/30 bg-background/80"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <Link to="/" className="flex items-center gap-2 group">
            <img
              src={helprIcon}
              alt="Helpr"
              className="w-8 h-8 rounded-xl shadow-md transition-transform duration-200 group-hover:scale-105"
            />
            <span className="text-lg font-display font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              Helpr
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate("/login")}
              className="text-xs h-9 rounded-xl"
            >
              Log in
            </Button>
            <Button
              size="sm"
              onClick={() => navigate("/signup")}
              className="text-xs h-9 rounded-xl"
            >
              Sign up
            </Button>
          </div>
        </div>
      </header>

      {/* pb-32 leaves room for the floating MobileNav on native + mobile web. */}
      <main className="container mx-auto px-4 pt-4 pb-32 max-w-3xl">
        {/* Greeting band — same compact style as DashboardHeader's greeting */}
        <section className="mt-2 mb-4 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-sm p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-display font-semibold text-foreground">
                Welcome to Helpr
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Browse what your Louisiana neighbors need. Sign up free to apply or post your own task.
              </p>
            </div>
          </div>
        </section>

        {/* Search */}
        <div className="mb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search jobs by title, location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 rounded-xl"
            />
          </div>
        </div>

        {/* Category chips — horizontal scroll on mobile, matches Dashboard look */}
        <div className="-mx-4 px-4 mb-5 overflow-x-auto scrollbar-hide overscroll-x-contain">
          <div className="flex gap-2 w-max">
            <Badge
              variant={selectedCategory === null ? "default" : "outline"}
              className="cursor-pointer text-xs whitespace-nowrap shrink-0 px-3 py-1.5 rounded-xl"
              onClick={() => setSelectedCategory(null)}
            >
              All
            </Badge>
            {ALL_CATEGORIES.map((cat) => (
              <Badge
                key={cat}
                variant={selectedCategory === cat ? "default" : "outline"}
                className="cursor-pointer text-xs whitespace-nowrap shrink-0 px-3 py-1.5 rounded-xl"
                onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              >
                {categoryLabels[cat]}
              </Badge>
            ))}
          </div>
        </div>

        {/* Jobs feed — same JobCard component the real dashboard renders */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full rounded-2xl" />
            ))}
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Briefcase className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No matching jobs right now</p>
            <p className="text-xs text-muted-foreground mt-1">Try clearing filters or check back later.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredJobs.map((job, idx) => (
              <JobCard
                key={job.id}
                job={job}
                effectiveFee={10}
                currentUserId={undefined}
                showApply
                onApply={requireSignup}
                onReport={requireSignup}
                onSelect={requireSignup}
                onToggleSave={requireSignup}
                index={idx}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default DashboardGuest;
