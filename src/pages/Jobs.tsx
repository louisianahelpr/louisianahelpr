import { useEffect, useState } from "react";

import { MapPin, Calendar, DollarSign, ArrowRight, Search, Lock, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { getCityState } from "@/lib/locationUtils";
import { parseLocalDate } from "@/lib/dateUtils";
import { JobCardSkeleton } from "@/components/SkeletonLoaders";
import { EmptyState } from "@/components/ui/EmptyState";

const DEBUG_AUTH = import.meta.env.DEV;

interface PublicJob {
  id: string;
  title: string;
  category: string;
  location: string;
  budget: number;
  date_needed: string;
  is_urgent: boolean | null;
  created_at: string;
  expires_at: string | null;
}

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning",
  yard_work: "Yard Work",
  moving: "Moving",
  errands: "Errands",
  handyman: "Handyman",
  painting: "Painting",
  delivery: "Delivery",
  pet_care: "Pet Care",
  assembly: "Assembly",
  other: "Other",
};

const ALL_CATEGORIES = Object.keys(categoryLabels);

const Jobs = () => {
  usePageTitle("Browse Jobs — Helpr");
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useCurrentUser();
  const PAGE_SIZE = 30;

  const fetchJobs = async (offset = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    // get_ranked_open_jobs ranks by boost (1000) + parish match (500) +
    // urgent (100) + recency (0-50). Replaces the old chronological-only
    // sort against the open_jobs_safe view. Anon callers still work — they
    // just don't get the parish-match boost.
    // Cast via `as any`: get_ranked_open_jobs is a new RPC not yet present
    // in the regenerated client types (full types regen exceeds tooling
    // output limits). Runtime contract verified server-side.
    const { data } = await (supabase.rpc as any)("get_ranked_open_jobs", { p_limit: PAGE_SIZE, p_offset: offset }) as { data: PublicJob[] | null };
    const newJobs = data || [];
    setHasMore(newJobs.length === PAGE_SIZE);
    if (append) {
      setJobs((prev) => [...prev, ...newJobs]);
    } else {
      setJobs(newJobs);
    }
    setLoading(false);
    setLoadingMore(false);
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    if (!DEBUG_AUTH) return;
    console.log("[auth] Jobs page", {
      authLoading,
      hasUser: !!user,
      userId: user?.id ?? null,
      jobsLoading: loading,
      route: window.location.pathname,
    });
  }, [authLoading, loading, user?.id]);

  const now = new Date();
  const filtered = jobs.filter((job) => {
    // Hide jobs that have expired in real-time (between fetches)
    if (job.expires_at && new Date(job.expires_at) <= now) return false;
    const matchesSearch =
      !search ||
      job.title.toLowerCase().includes(search.toLowerCase()) ||
      job.location.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !selectedCategory || job.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-premium-page">
      <Navbar />

      {/* pt-20 sits flush under the fixed Navbar (h-14 + safe-area).
          The bottom padding clears the floating MobileNav (96px) plus
          the iOS home-indicator safe area, with a 16px gap so the
          last action isn't kissing the dock. pb-32 was barely 2px
          short on notched phones. */}
      <main className="pt-20 pb-[calc(env(safe-area-inset-bottom,0px)+96px+1rem)] md:pb-safe-nav px-5">
        <div className="container mx-auto max-w-5xl">
          {/* Header — title + live count vertically centered with a "Live" pill on the right. */}
          <div className="flex items-center justify-between gap-4 mb-6 md:mb-8 mt-2 md:mt-6 animate-in fade-in slide-in-from-bottom-4 duration-400">
            <div className="flex flex-col leading-none min-w-0">
              <span
                className="font-serif italic uppercase text-[0.62rem]"
                style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
              >
                Open across Louisiana
              </span>
              <h1
                className="font-display italic font-bold leading-tight truncate mt-1"
                style={{
                  fontSize: "clamp(1.5rem, 3vw + 0.5rem, 2.25rem)",
                  color: "hsl(var(--ink-deep))",
                  letterSpacing: "-0.025em",
                }}
              >
                Browse tasks
              </h1>
              <span className="font-serif italic mt-0.5 text-[0.78rem]" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                <span className="font-semibold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>{filtered.length}</span>{" "}
                {filtered.length === 1 ? "task" : "tasks"}{" "}
                <span style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>{" "}
                Live now
              </span>
            </div>
            <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full squircle bg-primary/10 text-primary text-[11px] font-bold tracking-wider uppercase border border-primary/15 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Live
            </div>
          </div>

          {/* Search & Filters */}
          <div className="mb-5 md:mb-8 space-y-3 md:space-y-4">
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70" />
              <Input
                type="search"
                aria-label="Search jobs"
                placeholder="Search by title or location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-11 rounded-2xl squircle border-border bg-white/80 dark:bg-card/80 placeholder:text-muted-foreground/80 focus:bg-background focus:border-primary/60 focus:ring-2 focus:ring-primary/15 transition-all"
              />
            </div>

            <div className="-mx-5 px-5 overflow-x-auto scrollbar-hide overscroll-x-contain">
              <div className="flex gap-2 w-max mx-auto">
                {[{ key: null as string | null, label: "All" }, ...ALL_CATEGORIES.map((c) => ({ key: c, label: categoryLabels[c] }))].map(({ key, label }) => {
                  const isActive = selectedCategory === key;
                  return (
                    <button
                      key={label ?? "all"}
                      onClick={() => setSelectedCategory(isActive ? null : key)}
                      className={`inline-flex items-center px-3.5 py-1.5 rounded-full text-ds-11 font-semibold whitespace-nowrap shrink-0 transition-all duration-200 btn-press squircle border ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.45)]"
                          : "bg-white/60 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Jobs Grid */}
          {loading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Loading jobs">
              {Array.from({ length: 6 }).map((_, i) => (
                <JobCardSkeleton key={i} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="max-w-md mx-auto">
              <EmptyState
                variant="inline"
                icon={Search}
                title="No tasks found in your area yet"
                body="Try adjusting your filters or check back soon — new tasks are posted across Louisiana every day."
                action={
                  (search || selectedCategory) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setSearch(""); setSelectedCategory(null); }}
                      className="squircle rounded-full"
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((job, i) => (
                <div
                  key={job.id}
                  className="rounded-2xl liquid-glass p-5 space-y-3 hover:border-primary/30 hover:shadow-md transition-all group relative animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'both' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground line-clamp-1 text-ds-13">
                      {job.title}
                    </h3>
                    {job.is_urgent && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">
                        Urgent
                      </Badge>
                    )}
                  </div>

                  <Badge variant="secondary" className="text-ds-11">
                    {categoryLabels[job.category] || job.category}
                  </Badge>

                  <div className="space-y-1.5 text-ds-11 text-muted-foreground">
                    <a
                      href={`https://www.google.com/maps/search/${encodeURIComponent(getCityState(job.location))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 hover:text-primary transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MapPin className="w-3 h-3" />
                      <span className="line-clamp-1">{getCityState(job.location)}</span>
                    </a>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3" />
                      <span>{format(parseLocalDate(job.date_needed), "MMM d, yyyy")}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="w-3 h-3" />
                      <span className="font-medium text-foreground">${job.budget}</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${job.expires_at && differenceInHours(new Date(job.expires_at), new Date()) < 24 ? "text-destructive font-medium" : ""}`}>
                      <Timer className="w-3 h-3" />
                      <span>
                        {job.expires_at
                          ? new Date(job.expires_at) <= new Date()
                            ? "Expired"
                            : formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }) + " left"
                          : "Posted " + formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>

                  {/* Locked overlay on hover */}
                  <div className="absolute inset-0 rounded-2xl bg-background/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                    <Lock className="w-5 h-5 text-primary" />
                    <p className="text-ds-11 font-medium text-foreground">Sign up to apply</p>
                    <Button
                      size="sm"
                      variant="default"
                      className="text-ds-11"
                      onClick={() => navigate("/signup")}
                    >
                      Get Started
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Load More */}
          {hasMore && !loading && filtered.length > 0 && (
            <div className="text-center mt-6">
              <Button
                variant="outline"
                onClick={() => fetchJobs(jobs.length, true)}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more jobs"}
              </Button>
            </div>
          )}

          {/* CTA */}
          <div className="text-center mt-12 space-y-4">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 max-w-lg mx-auto space-y-4">
              <Lock className="w-8 h-8 text-primary mx-auto" />
              <h3 className="text-ds-17 font-bold text-foreground">Ready to get started?</h3>
              <p className="text-ds-11 text-muted-foreground">
                Sign up to apply for jobs, message posters, and start earning — or post your own task and find help today.
              </p>
              <Button
                variant="hero"
                size="lg"
                onClick={() => navigate("/signup")}
                className="group"
              >
                Sign up now
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Jobs;
