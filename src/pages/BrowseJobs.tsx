import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, Calendar, DollarSign, ArrowLeft, Search, X, Flag, SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

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

const BrowseJobs = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [maxBudget, setMaxBudget] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const fetchJobs = async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false });

      if (!error && data) setJobs(data);
      setLoading(false);
    };
    fetchJobs();
  }, []);

  const handleApply = async (jobId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate("/login"); return; }

    // New helpr safety limits: max 3 active jobs until 3 verified completions with 4+ stars
    const [activeJobsRes, completedRes, reviewsRes] = await Promise.all([
      supabase.from("applications").select("id", { count: "exact" }).eq("helper_id", user.id).eq("status", "accepted"),
      supabase.from("jobs").select("id", { count: "exact" }).eq("helper_id", user.id).eq("status", "completed"),
      supabase.from("reviews").select("rating").eq("reviewee_id", user.id),
    ]);

    const activeCount = activeJobsRes.count || 0;
    const completedCount = completedRes.count || 0;
    const ratings = reviewsRes.data || [];
    const goodRatings = ratings.filter(r => r.rating >= 4).length;
    const isNewHelpr = completedCount < 3 || goodRatings < 3;

    if (isNewHelpr && activeCount >= 3) {
      toast.error("New helprs can only have 3 active jobs. Complete more jobs with 4+ star ratings to unlock full access.");
      return;
    }

    const { error } = await supabase.from("applications").insert({
      job_id: jobId,
      helper_id: user.id,
      message: "I'd like to help with this task!",
    });

    if (error) {
      if (error.code === "23505") {
        toast.error("You've already applied to this job.");
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success("Application sent!");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setMaxBudget("");
    setLocationFilter("");
  };

  const activeFilterCount = [searchQuery, selectedCategory, maxBudget, locationFilter].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const filteredJobs = jobs.filter((job) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!job.title.toLowerCase().includes(q) && !job.description.toLowerCase().includes(q)) return false;
    }
    if (selectedCategory && job.category !== selectedCategory) return false;
    if (maxBudget && job.budget > parseFloat(maxBudget)) return false;
    if (locationFilter && !job.location.toLowerCase().includes(locationFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Browse tasks</h1>
            <p className="text-muted-foreground mt-1">Find tasks in your area and apply</p>
          </div>

          {/* Search & Filters */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            {/* Search bar — always visible */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Toggle filters */}
            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
              <span className="flex-1" />
              {filtersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {/* Collapsible filter panel */}
            {filtersOpen && (
              <div className="space-y-4 pt-2 border-t border-border">
                {/* Category */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Category</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(categoryLabels).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedCategory(selectedCategory === key ? null : key)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          selectedCategory === key
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Location & Budget row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Location</p>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Any location"
                        value={locationFilter}
                        onChange={(e) => setLocationFilter(e.target.value)}
                        className="pl-9 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Max budget</p>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        type="number"
                        placeholder="No limit"
                        value={maxBudget}
                        onChange={(e) => setMaxBudget(e.target.value)}
                        className="pl-9 text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Clear all */}
                {hasFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                    <X className="w-4 h-4 mr-1" /> Clear all filters
                  </Button>
                )}
              </div>
            )}

            {/* Active filter pills (shown when collapsed) */}
            {!filtersOpen && hasFilters && (
              <div className="flex flex-wrap gap-1.5">
                {selectedCategory && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    {categoryLabels[selectedCategory]}
                    <button onClick={() => setSelectedCategory(null)}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {locationFilter && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    {locationFilter}
                    <button onClick={() => setLocationFilter("")}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {maxBudget && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    ≤ ${maxBudget}
                    <button onClick={() => setMaxBudget("")}><X className="w-3 h-3" /></button>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Results */}
          {loading ? (
            <p className="text-muted-foreground">Loading tasks…</p>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground">
                {hasFilters ? "No tasks match your filters." : "No open tasks right now. Check back soon!"}
              </p>
              {hasFilters && (
                <Button variant="outline" className="mt-4" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{filteredJobs.length} task{filteredJobs.length !== 1 ? "s" : ""} found</p>
              {filteredJobs.map((job) => (
                <div key={job.id} className="rounded-xl border border-border bg-card p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground text-lg">{job.title}</h3>
                        <Badge variant="secondary" className="text-xs">
                          {categoryLabels[job.category] || job.category}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{job.description}</p>
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground pt-1">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" /> {job.location}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" /> {new Date(job.date_needed).toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1 font-medium text-foreground">
                          <DollarSign className="w-3.5 h-3.5" /> ${job.budget}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button size="sm" onClick={() => handleApply(job.id)}>
                        Apply
                      </Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setReportJobId(job.id)}>
                        <Flag className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {reportJobId && (
        <ReportDialog
          open={!!reportJobId}
          onClose={() => setReportJobId(null)}
          reportedType="job"
          reportedId={reportJobId}
        />
      )}
    </div>
  );
};

export default BrowseJobs;
