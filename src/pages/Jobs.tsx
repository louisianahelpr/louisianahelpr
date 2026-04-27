import { useEffect, useState } from "react";

import { MapPin, Calendar, DollarSign, ArrowRight, Search, Briefcase, Lock, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getCityState } from "@/lib/locationUtils";
import { parseLocalDate } from "@/lib/dateUtils";

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
  const PAGE_SIZE = 30;

  const fetchJobs = async (offset = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("open_jobs_safe" as any)
      .select("id, title, category, location, budget, date_needed, is_urgent, created_at, expires_at")
      .gte("date_needed", today)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1) as { data: PublicJob[] | null };
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

      {/* pt-20 sits flush under the fixed Navbar (h-14 + safe-area). pb-32
          leaves room for the floating glass MobileNav on native + mobile web. */}
      <main className="pt-20 pb-32 md:pb-safe-nav px-5">
        <div className="container mx-auto max-w-5xl">
          {/* Header — title + live count vertically centered with a "Live" pill on the right. */}
          <div className="flex items-center justify-between gap-4 mb-6 md:mb-8 mt-2 md:mt-6 animate-in fade-in slide-in-from-bottom-4 duration-400">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl squircle bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Briefcase className="w-5 h-5 text-primary" strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl md:text-3xl font-display font-bold text-foreground leading-tight truncate">
                  Browse Tasks
                </h1>
                <p className="text-xs md:text-sm text-muted-foreground leading-tight mt-0.5">
                  <span className="font-semibold text-primary tabular-nums">{filtered.length}</span> available right now
                </p>
              </div>
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
                      className={`inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-all duration-200 btn-press squircle border ${
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
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-border bg-card p-5 h-40 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="glass-card squircle rounded-[24px] py-14 px-6 text-center space-y-4 max-w-md mx-auto">
              <div className="w-16 h-16 mx-auto rounded-2xl squircle bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center shadow-sm">
                <Search className="w-7 h-7 text-primary" strokeWidth={2.25} />
              </div>
              <div className="space-y-1.5">
                <p className="text-base font-display font-bold text-foreground">
                  No tasks found in your area yet
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Try adjusting your filters or check back soon — new tasks are posted across Louisiana every day.
                </p>
              </div>
              {(search || selectedCategory) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setSearch(""); setSelectedCategory(null); }}
                  className="squircle rounded-full"
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((job, i) => (
                <div
                  key={job.id}
                  className="rounded-2xl border border-border bg-card p-5 space-y-3 hover:border-primary/30 hover:shadow-md transition-all group relative animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'both' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground line-clamp-1 text-sm">
                      {job.title}
                    </h3>
                    {job.is_urgent && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">
                        Urgent
                      </Badge>
                    )}
                  </div>

                  <Badge variant="secondary" className="text-xs">
                    {categoryLabels[job.category] || job.category}
                  </Badge>

                  <div className="space-y-1.5 text-xs text-muted-foreground">
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
                    <p className="text-xs font-medium text-foreground">Sign up to apply</p>
                    <Button
                      size="sm"
                      variant="default"
                      className="text-xs"
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
              <h3 className="text-lg font-bold text-foreground">Ready to get started?</h3>
              <p className="text-sm text-muted-foreground">
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
