import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  LogOut, Search, X, Flag, MapPin, Calendar, DollarSign,
  SlidersHorizontal, ChevronDown, ChevronUp, Clock, XCircle,
  Shield, ClipboardList, Briefcase, CheckCircle2, Gift, RotateCcw, Star, MessageSquare, Users, Pencil, ThumbsUp, ThumbsDown,
} from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { ReviewForm, ReviewList } from "@/components/ReviewPanel";
import NotificationPanel from "@/components/NotificationPanel";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Application = Database["public"]["Tables"]["applications"]["Row"];

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

const categories = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }));

const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-accent/20 text-accent-foreground",
  in_progress: "bg-accent/20 text-accent-foreground",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

type Tab = "browse" | "posted" | "applied";

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<SupaUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("browse");

  // Browse state
  const [allJobs, setAllJobs] = useState<(Job & { posterName?: string; posterReviewCount?: number; posterAvgRating?: number })[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [maxBudget, setMaxBudget] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reportJobId, setReportJobId] = useState<string | null>(null);

  // Posted jobs state
  const [postedJobs, setPostedJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<(Application & { profiles?: { full_name: string | null; skills: string | null; hourly_rate: number | null; user_id: string } | null; reviewCount?: number; avgRating?: number })[]>([]);
  const [completingJobId, setCompletingJobId] = useState<string | null>(null);
  const [tipJobId, setTipJobId] = useState<string | null>(null);
  const [tipAmount, setTipAmount] = useState("");
  const [tipping, setTipping] = useState(false);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);

  // Edit job state
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("other");
  const [editLocation, setEditLocation] = useState("");
  const [editDateNeeded, setEditDateNeeded] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEstimatedHours, setEditEstimatedHours] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [editSpecialReq, setEditSpecialReq] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Applied jobs state
  const [appliedApps, setAppliedApps] = useState<(Application & { job?: Job | null; posterName?: string })[]>([]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/login"); return; }
      setUser(session.user);
      await loadData(session.user.id);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) { navigate("/login"); return; }
      setUser(session.user);
      loadData(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const loadData = async (userId: string) => {
    const [profileRes, rolesRes, openJobsRes, postedRes, appsRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("jobs").select("*").eq("status", "open").order("created_at", { ascending: false }),
      supabase.from("jobs").select("*").eq("customer_id", userId).order("created_at", { ascending: false }),
      supabase.from("applications").select("*").eq("helper_id", userId).order("created_at", { ascending: false }),
    ]);

    if (profileRes.data) setProfile(profileRes.data);
    setIsAdmin(rolesRes.data?.some((r) => r.role === "admin") ?? false);

    // Enrich open jobs with poster first name and reviews
    if (openJobsRes.data && openJobsRes.data.length > 0) {
      const posterIds = [...new Set(openJobsRes.data.map((j) => j.customer_id))];
      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", posterIds),
        supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", posterIds),
      ]);
      const nameMap = new Map(profilesRes.data?.map((p) => [p.user_id, (p.full_name || "User").split(" ")[0]]) || []);
      const reviewMap = new Map<string, number[]>();
      reviewsRes.data?.forEach((r) => {
        if (!reviewMap.has(r.reviewee_id)) reviewMap.set(r.reviewee_id, []);
        reviewMap.get(r.reviewee_id)!.push(r.rating);
      });
      setAllJobs(openJobsRes.data.map((j) => {
        const ratings = reviewMap.get(j.customer_id) || [];
        return {
          ...j,
          posterName: nameMap.get(j.customer_id) || "User",
          posterReviewCount: ratings.length,
          posterAvgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
        };
      }));
    } else {
      setAllJobs([]);
    }

    if (postedRes.data) setPostedJobs(postedRes.data);

    // Enrich applied apps with job data and poster names
    if (appsRes.data && appsRes.data.length > 0) {
      const jobIds = [...new Set(appsRes.data.map((a) => a.job_id))];
      const { data: jobs } = await supabase.from("jobs").select("*").in("id", jobIds);
      const jobMap = new Map(jobs?.map((j) => [j.id, j]) || []);
      const posterIds = [...new Set(jobs?.map((j) => j.customer_id) || [])];
      let posterNameMap = new Map<string, string>();
      if (posterIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", posterIds);
        posterNameMap = new Map(profiles?.map((p) => [p.user_id, (p.full_name || "User").split(" ")[0]]) || []);
      }
      setAppliedApps(appsRes.data.map((a) => {
        const job = jobMap.get(a.job_id) || null;
        return { ...a, job, posterName: job ? posterNameMap.get(job.customer_id) || "User" : "User" };
      }));
    } else {
      setAppliedApps([]);
    }

    setLoading(false);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  // Browse actions
  const handleApply = async (jobId: string) => {
    if (!user) { navigate("/login"); return; }
    const { error } = await supabase.from("applications").insert({ job_id: jobId, helper_id: user.id, message: "I'd like to help with this task!" });
    if (error) {
      if (error.code === "23505") toast.error("You've already applied.");
      else toast.error(error.message);
    } else {
      toast.success("Application sent!");
      loadData(user.id);
    }
  };

  // Helper approve/deny an accepted offer
  const handleHelperResponse = async (app: Application, accept: boolean) => {
    if (!user) return;
    if (accept) {
      // Helper accepts - job stays in_progress
      toast.success("You accepted the job!");
    } else {
      // Helper rejects - revert job to open, reset helper, revert application
      await supabase.from("applications").update({ status: "rejected" }).eq("id", app.id);
      await supabase.from("jobs").update({ status: "open", helper_id: null }).eq("id", app.job_id);
      toast.info("You declined the job. The poster can select someone else.");
      loadData(user.id);
    }
  };

  // Posted jobs actions
  const loadApplications = async (job: Job) => {
    setSelectedJob(job);
    const { data: apps } = await supabase.from("applications").select("*").eq("job_id", job.id);
    if (apps && apps.length > 0) {
      const helperIds = apps.map((a) => a.helper_id);
      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, skills, hourly_rate").in("user_id", helperIds),
        supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", helperIds),
      ]);
      const reviewMap = new Map<string, number[]>();
      reviewsRes.data?.forEach((r) => {
        if (!reviewMap.has(r.reviewee_id)) reviewMap.set(r.reviewee_id, []);
        reviewMap.get(r.reviewee_id)!.push(r.rating);
      });
      setApplications(apps.map((app) => {
        const prof = profilesRes.data?.find((p) => p.user_id === app.helper_id) || null;
        const ratings = reviewMap.get(app.helper_id) || [];
        return {
          ...app,
          profiles: prof,
          reviewCount: ratings.length,
          avgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
        };
      }));
    } else {
      setApplications([]);
    }
  };

  const acceptApplication = async (app: Application & { profiles?: any }) => {
    await supabase.from("applications").update({ status: "accepted" }).eq("id", app.id);
    await supabase.from("jobs").update({ status: "accepted", helper_id: app.helper_id }).eq("id", selectedJob!.id);
    // Don't reject others yet - wait for helper to confirm
    toast.success("Offer sent to helper! Waiting for their confirmation.");
    setSelectedJob(null);
    setApplications([]);
    if (user) loadData(user.id);
  };

  const cancelJob = async (jobId: string) => {
    const { error } = await supabase.from("jobs").update({ status: "cancelled" }).eq("id", jobId);
    if (error) toast.error("Failed to cancel");
    else { toast.success("Job cancelled"); if (user) loadData(user.id); }
  };

  const repostJob = async (jobId: string) => {
    const { error } = await supabase.from("jobs").update({ status: "open", helper_id: null }).eq("id", jobId);
    if (error) toast.error("Failed to repost");
    else { toast.success("Job reposted!"); if (user) loadData(user.id); }
  };

  const completeJob = async (jobId: string) => {
    setCompletingJobId(jobId);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "release", jobId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Job completed! Helper receives $${data.helperPayout.toFixed(2)}`);
      if (user) loadData(user.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to complete job");
    } finally {
      setCompletingJobId(null);
    }
  };

  const sendTip = async (jobId: string) => {
    const amount = parseFloat(tipAmount);
    if (isNaN(amount) || amount <= 0) { toast.error("Enter a valid amount"); return; }
    setTipping(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "tip", jobId, amount } });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to create tip");
    } finally {
      setTipping(false);
    }
  };

  // Edit job
  const openEditJob = (job: Job) => {
    setEditJob(job);
    setEditTitle(job.title);
    setEditDescription(job.description);
    setEditCategory(job.category);
    setEditLocation(job.location);
    setEditDateNeeded(job.date_needed);
    setEditStartTime(job.start_time || "");
    setEditEstimatedHours(job.estimated_hours?.toString() || "");
    setEditBudget(job.budget.toString());
    setEditSpecialReq(job.special_requirements || "");
  };

  const saveEditJob = async () => {
    if (!editJob) return;
    setEditSaving(true);
    const { error } = await supabase.from("jobs").update({
      title: editTitle.trim(),
      description: editDescription.trim(),
      category: editCategory as any,
      location: editLocation.trim(),
      date_needed: editDateNeeded,
      start_time: editStartTime || null,
      estimated_hours: editEstimatedHours ? parseFloat(editEstimatedHours) : null,
      budget: parseFloat(editBudget),
      special_requirements: editSpecialReq.trim() || null,
    }).eq("id", editJob.id);
    setEditSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Job updated!");
      setEditJob(null);
      if (user) loadData(user.id);
    }
  };

  const clearFilters = () => { setSearchQuery(""); setSelectedCategory(null); setMaxBudget(""); setLocationFilter(""); };
  const activeFilterCount = [searchQuery, selectedCategory, maxBudget, locationFilter].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const filteredJobs = allJobs.filter((job) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!job.title.toLowerCase().includes(q) && !job.description.toLowerCase().includes(q)) return false;
    }
    if (selectedCategory && job.category !== selectedCategory) return false;
    if (maxBudget && job.budget > parseFloat(maxBudget)) return false;
    if (locationFilter && !job.location.toLowerCase().includes(locationFilter.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Loading...</p></div>;
  }

  const firstName = (profile?.full_name || user?.user_metadata?.full_name || "User").split(" ")[0];
  const approvalStatus = (profile as any)?.approval_status || "pending";

  if (!isAdmin && approvalStatus !== "approved") {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
          <div className="container mx-auto flex items-center justify-between h-16 px-4">
            <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
            <Button variant="ghost" size="icon" onClick={handleLogout}><LogOut className="w-4 h-4" /></Button>
          </div>
        </header>
        <main className="container mx-auto px-4 py-12">
          <div className="max-w-lg mx-auto text-center space-y-6">
            {approvalStatus === "pending" ? (
              <>
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto"><Clock className="w-8 h-8 text-primary" /></div>
                <h1 className="text-2xl font-display font-bold text-foreground">Profile under review</h1>
                <p className="text-muted-foreground">Thanks for signing up, {firstName}! Your profile is being reviewed.</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto"><XCircle className="w-8 h-8 text-destructive" /></div>
                <h1 className="text-2xl font-display font-bold text-foreground">Profile not approved</h1>
                <p className="text-muted-foreground">Unfortunately, your profile was not approved. Please contact support.</p>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "browse", label: "Browse", count: filteredJobs.length },
    { key: "posted", label: "My Posted", count: postedJobs.length },
    { key: "applied", label: "Applied", count: appliedApps.length },
  ];

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <Link to="/dashboard" className="text-2xl font-display font-bold text-primary">Helpr</Link>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
                <Shield className="w-4 h-4 text-destructive" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => navigate("/post-job")} className="hidden sm:flex">
              <Briefcase className="w-4 h-4 mr-1" /> Post task
            </Button>
            <NotificationPanel />
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-lg font-display font-semibold text-foreground">Hi, {firstName} 👋</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/schedule")} className="text-xs">
                <Calendar className="w-3.5 h-3.5 mr-1" /> Schedule
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate("/job-history")} className="text-xs">
                <ClipboardList className="w-3.5 h-3.5 mr-1" /> History
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className={`ml-1.5 text-xs ${tab === t.key ? "text-primary" : "text-muted-foreground"}`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* BROWSE TAB */}
          {tab === "browse" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search tasks…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 pr-10" />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button onClick={() => setFiltersOpen(!filtersOpen)} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
                  <SlidersHorizontal className="w-4 h-4" /><span>Filters</span>
                  {activeFilterCount > 0 && <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">{activeFilterCount}</span>}
                  <span className="flex-1" />
                  {filtersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {filtersOpen && (
                  <div className="space-y-4 pt-2 border-t border-border">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Category</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(categoryLabels).map(([key, label]) => (
                          <button key={key} onClick={() => setSelectedCategory(selectedCategory === key ? null : key)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${selectedCategory === key ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Location</p>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                          <Input placeholder="Any location" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="pl-9 text-sm" />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Max budget</p>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                          <Input type="number" placeholder="No limit" value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} className="pl-9 text-sm" />
                        </div>
                      </div>
                    </div>
                    {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Clear all</Button>}
                  </div>
                )}
                {!filtersOpen && hasFilters && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCategory && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{categoryLabels[selectedCategory]}<button onClick={() => setSelectedCategory(null)}><X className="w-3 h-3" /></button></span>}
                    {locationFilter && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{locationFilter}<button onClick={() => setLocationFilter("")}><X className="w-3 h-3" /></button></span>}
                    {maxBudget && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">≤ ${maxBudget}<button onClick={() => setMaxBudget("")}><X className="w-3 h-3" /></button></span>}
                  </div>
                )}
              </div>

              {filteredJobs.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">{hasFilters ? "No tasks match your filters." : "No open tasks right now."}</p>
                  {hasFilters && <Button variant="outline" className="mt-4" onClick={clearFilters}>Clear filters</Button>}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredJobs.map((job) => (
                    <div key={job.id} className="rounded-xl border border-border bg-card p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-foreground">{job.title}</h3>
                            <Badge variant="secondary" className="text-xs">{categoryLabels[job.category] || job.category}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">{job.description}</p>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(job.date_needed).toLocaleDateString()}</span>
                            <span className="flex items-center gap-1 font-medium text-foreground"><DollarSign className="w-3 h-3" /> ${job.budget}</span>
                          </div>
                          {/* Poster info */}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                            <span>Posted by <span className="font-medium text-foreground">{job.posterName}</span></span>
                            {job.posterReviewCount !== undefined && job.posterReviewCount > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Star className="w-3 h-3 fill-accent text-accent" />
                                {job.posterAvgRating?.toFixed(1)} ({job.posterReviewCount})
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Button size="sm" onClick={() => handleApply(job.id)}>Apply</Button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setReportJobId(job.id)}><Flag className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* POSTED TAB */}
          {tab === "posted" && (
            <div className="space-y-4">
              {postedJobs.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground mb-4">You haven't posted any tasks yet.</p>
                  <Button onClick={() => navigate("/post-job")}>Post your first task</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {postedJobs.map((job) => (
                    <div key={job.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="font-semibold text-foreground">{job.title}</h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>{job.status.replace("_", " ")}</span>
                            {job.payment_status === "released" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">Paid</span>}
                          </div>
                          <p className="text-sm text-muted-foreground">${job.budget} · {job.location}</p>
                        </div>
                        <div className="flex gap-1.5 flex-wrap justify-end">
                          {(job.status === "open" || job.status === "accepted") && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => openEditJob(job)}><Pencil className="w-4 h-4" /></Button>
                              <Button size="sm" variant="outline" onClick={() => loadApplications(job)}><Users className="w-4 h-4 mr-1" /> Applicants</Button>
                              <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => cancelJob(job.id)}><XCircle className="w-4 h-4" /></Button>
                            </>
                          )}
                          {job.status === "in_progress" && (
                            <>
                              <Button size="sm" onClick={() => completeJob(job.id)} disabled={completingJobId === job.id}>
                                <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === job.id ? "…" : "Complete"}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4" /></Button>
                              <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => cancelJob(job.id)}><XCircle className="w-4 h-4" /></Button>
                            </>
                          )}
                          {job.status === "cancelled" && <Button size="sm" variant="outline" onClick={() => repostJob(job.id)}><RotateCcw className="w-4 h-4 mr-1" /> Repost</Button>}
                          {job.status === "completed" && job.helper_id && <Button size="sm" variant="outline" onClick={() => setReviewJob(job)}><Star className="w-4 h-4 mr-1" /> Review</Button>}
                        </div>
                      </div>
                      {job.status === "completed" && job.payment_status === "released" && (
                        <div className="border-t border-border pt-3">
                          {tipJobId === job.id ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <Input type="number" min="1" placeholder="$" value={tipAmount} onChange={(e) => setTipAmount(e.target.value)} className="max-w-[80px]" />
                              <Button size="sm" onClick={() => sendTip(job.id)} disabled={tipping}>{tipping ? "…" : "Send"}</Button>
                              <Button size="sm" variant="ghost" onClick={() => { setTipJobId(null); setTipAmount(""); }}>Cancel</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => { setTipJobId(job.id); setTipAmount(""); }}><Gift className="w-4 h-4 mr-1" /> Tip</Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Applicants panel */}
              {selectedJob && (
                <div className="border border-border rounded-xl bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display font-semibold text-foreground">Applicants for "{selectedJob.title}"</h2>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedJob(null)}>Close</Button>
                  </div>
                  {applications.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No applications yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {applications.map((app) => (
                        <div key={app.id} className="p-3 rounded-lg border border-border space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-foreground">{(app.profiles?.full_name || "Helper").split(" ")[0]}</p>
                              {app.profiles?.skills && <p className="text-xs text-muted-foreground">{app.profiles.skills}</p>}
                              {app.proposed_rate && <p className="text-xs text-muted-foreground">${app.proposed_rate}/hr</p>}
                              {app.message && <p className="text-sm text-muted-foreground mt-1">{app.message}</p>}
                              {/* Applicant reviews */}
                              {app.reviewCount !== undefined && app.reviewCount > 0 && (
                                <div className="flex items-center gap-1 mt-1">
                                  <Star className="w-3 h-3 fill-accent text-accent" />
                                  <span className="text-xs text-muted-foreground">{app.avgRating?.toFixed(1)} ({app.reviewCount} reviews)</span>
                                </div>
                              )}
                              {app.reviewCount === 0 && <p className="text-xs text-muted-foreground mt-1">No reviews yet</p>}
                            </div>
                            {app.status === "pending" && <Button size="sm" onClick={() => acceptApplication(app)}>Select</Button>}
                            {app.status === "accepted" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">Selected</span>}
                            {app.status === "rejected" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-destructive/10 text-destructive">Declined</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* APPLIED TAB */}
          {tab === "applied" && (
            <div className="space-y-3">
              {appliedApps.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground mb-4">You haven't applied to any tasks yet.</p>
                  <Button onClick={() => setTab("browse")}>Browse tasks</Button>
                </div>
              ) : (
                appliedApps.map((app) => (
                  <div key={app.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold text-foreground">{app.job?.title || "Task"}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                            app.status === "accepted" ? "bg-primary/10 text-primary"
                            : app.status === "rejected" ? "bg-destructive/10 text-destructive"
                            : "bg-secondary text-secondary-foreground"
                          }`}>{app.status}</span>
                          {app.job && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[app.job.status] || ""}`}>
                              {app.job.status.replace("_", " ")}
                            </span>
                          )}
                        </div>
                        {app.job && (
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {app.job.location}</span>
                            <span className="flex items-center gap-1 font-medium text-foreground"><DollarSign className="w-3 h-3" /> ${app.job.budget}</span>
                            <span>Posted by <span className="font-medium text-foreground">{app.posterName}</span></span>
                          </div>
                        )}
                        {app.message && <p className="text-sm text-muted-foreground mt-1">{app.message}</p>}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {/* Helper can accept or decline when selected (status=accepted, job=accepted) */}
                        {app.status === "accepted" && app.job?.status === "accepted" && (
                          <>
                            <Button size="sm" onClick={async () => {
                              await supabase.from("jobs").update({ status: "in_progress" }).eq("id", app.job_id);
                              // Reject other pending applications
                              await supabase.from("applications").update({ status: "rejected" }).eq("job_id", app.job_id).neq("id", app.id);
                              toast.success("Job accepted! You can now message the poster.");
                              if (user) loadData(user.id);
                            }}>
                              <ThumbsUp className="w-4 h-4 mr-1" /> Accept
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive" onClick={() => handleHelperResponse(app, false)}>
                              <ThumbsDown className="w-4 h-4 mr-1" /> Decline
                            </Button>
                          </>
                        )}
                        {app.status === "accepted" && app.job?.status === "in_progress" && (
                          <Button size="sm" variant="outline" onClick={() => navigate("/messages")}>
                            <MessageSquare className="w-4 h-4 mr-1" /> Message
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </main>

      {reportJobId && <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />}
      {reviewJob && reviewJob.helper_id && <ReviewForm open={!!reviewJob} onClose={() => setReviewJob(null)} jobId={reviewJob.id} revieweeId={reviewJob.helper_id} revieweeName="Helper" />}

      {/* Edit Job Dialog */}
      <Dialog open={!!editJob} onOpenChange={() => setEditJob(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Edit Job</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editTitle">Title</Label>
              <Input id="editTitle" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editDesc">Description</Label>
              <Textarea id="editDesc" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editLoc">Location</Label>
              <Input id="editLoc" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date needed</Label>
                <Input type="date" value={editDateNeeded} onChange={(e) => setEditDateNeeded(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Start time</Label>
                <Input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Est. hours</Label>
                <Input type="number" step="0.5" value={editEstimatedHours} onChange={(e) => setEditEstimatedHours(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Budget ($)</Label>
                <Input type="number" value={editBudget} onChange={(e) => setEditBudget(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Special requirements</Label>
              <Textarea value={editSpecialReq} onChange={(e) => setEditSpecialReq(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditJob(null)}>Cancel</Button>
            <Button onClick={saveEditJob} disabled={editSaving}>{editSaving ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dashboard;
