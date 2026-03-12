import { useEffect, useState } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, MapPin, DollarSign, XCircle, CheckCircle2, Gift, RotateCcw,
  Star, MessageSquare, Users, Pencil, ThumbsUp, ThumbsDown, AlertTriangle, RefreshCw,
  Rocket, Clock,
} from "lucide-react";
import { JobBoostDialog } from "@/components/JobBoostDialog";
import { TipDialog } from "@/components/TipDialog";
import { PhotoProof } from "@/components/PhotoProof";
import { CancellationDialog } from "@/components/CancellationDialog";
import { CompletionPrompts } from "@/components/CompletionPrompts";
import { toast } from "sonner";
import { ReviewForm } from "@/components/ReviewPanel";
import { ActivityCardSkeleton } from "@/components/SkeletonLoaders";
import { ScopeAgreement } from "@/components/ScopeAgreement";
import { AddonRequests } from "@/components/AddonRequests";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobMilestones } from "@/components/JobMilestones";
import { JobCheckins } from "@/components/JobCheckins";
import { JobTracking } from "@/components/JobTracking";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";
import { ResponseDeadlineDialog } from "@/components/ResponseDeadlineDialog";
import { DisputeDialog } from "@/components/DisputeDialog";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
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
  revision_requested: "bg-destructive/10 text-destructive",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
  disputed: "bg-destructive/15 text-destructive",
};

type Tab = "posted" | "applied";

const Activity = () => {
  usePageTitle("My Activity — Helpr");
  const navigate = useNavigate();
  const { user: cachedUser } = useCurrentUser();
  const [user, setUser] = useState<SupaUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("posted");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Posted jobs state
  const [postedJobs, setPostedJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<(Application & { profiles?: { full_name: string | null; skills: string | null; hourly_rate: number | null; user_id: string } | null; reviewCount?: number; avgRating?: number })[]>([]);
  const [completingJobId, setCompletingJobId] = useState<string | null>(null);
  const [tipJobId, setTipJobId] = useState<string | null>(null);
  const [tipAmount, setTipAmount] = useState("");
  const [tipping, setTipping] = useState(false);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; name: string } | null>(null);
  const [boostJobId, setBoostJobId] = useState<string | null>(null);
  const [enhancedTipJobId, setEnhancedTipJobId] = useState<string | null>(null);
  const [enhancedTipHelperName, setEnhancedTipHelperName] = useState("");
  const [noShowJobId, setNoShowJobId] = useState<string | null>(null);
  const [reportingNoShow, setReportingNoShow] = useState(false);
  const [cancelDialogJob, setCancelDialogJob] = useState<Job | null>(null);
  const [deadlineDialogApp, setDeadlineDialogApp] = useState<(Application & { profiles?: any }) | null>(null);
  const [completionPromptJob, setCompletionPromptJob] = useState<{ job: Job; revieweeId: string; revieweeName: string } | null>(null);
  // Revision request
  const [revisionJobId, setRevisionJobId] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const [requestingRevision, setRequestingRevision] = useState(false);
  // Dispute
  const [disputeJob, setDisputeJob] = useState<Job | null>(null);

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
  const [appliedApps, setAppliedApps] = useState<(Application & { job?: (Job & { revision_note?: string | null }) | null; posterName?: string })[]>([]);

  // Helper tip state (in applied tab)
  const [helperTipJobId, setHelperTipJobId] = useState<string | null>(null);
  const [helperTipAmount, setHelperTipAmount] = useState("");
  const [helperTipping, setHelperTipping] = useState(false);
  const [helperReviewJob, setHelperReviewJob] = useState<{ jobId: string; posterId: string; posterName: string } | null>(null);

  // Seed from cache for instant render
  useEffect(() => {
    if (cachedUser && !user) {
      setUser(cachedUser);
      loadData(cachedUser.id);
    }
  }, [cachedUser]);

  useEffect(() => {
    const init = async () => {
      if (user) return; // already seeded from cache
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      setUser(session.user);
      await loadData(session.user.id);
    };
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return;
      setUser(session.user);
      loadData(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = async (userId: string) => {
    const [postedRes, appsRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("customer_id", userId).order("created_at", { ascending: false }),
      supabase.from("applications").select("*").eq("helper_id", userId).order("created_at", { ascending: false }),
    ]);

    if (postedRes.data) setPostedJobs(postedRes.data);

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
        return { ...a, job: job as any, posterName: job ? posterNameMap.get(job.customer_id) || "User" : "User" };
      }));
    } else {
      setAppliedApps([]);
    }
    setLoading(false);
  };

  const handleHelperResponse = async (app: Application, accept: boolean) => {
    if (!user) return;
    if (accept) {
      await supabase.from("jobs").update({ status: "in_progress", response_deadline: null } as any).eq("id", app.job_id);
      await supabase.from("applications").update({ status: "rejected" }).eq("job_id", app.job_id).neq("id", app.id);
      toast.success("Job accepted! You can now message the poster.");
      loadData(user.id);
    } else {
      // Track denial as violation
      const { data: existing } = await supabase
        .from("user_violations")
        .select("id")
        .eq("user_id", user.id)
        .eq("violation_type", "job_denial");
      const priorCount = existing?.length || 0;

      let actionTaken = "none";
      if (priorCount >= 2) actionTaken = "permanent_ban";
      else if (priorCount >= 1) actionTaken = "warning";

      // Log the violation
      await supabase.from("user_violations").insert({
        user_id: user.id,
        violation_type: "job_denial",
        description: `Declined job offer: "${(app as any).job?.title || "Unknown"}"`,
        job_id: app.job_id,
        action_taken: actionTaken,
      });

      // Apply penalties: 1st & 2nd = warning, 3rd = permanent ban
      if (actionTaken === "warning") {
        const warningNum = priorCount + 1; // 1st or 2nd
        await supabase.from("profiles").update({ ban_status: "warned" } as any).eq("user_id", user.id);
        await supabase.from("notifications").insert({
          user_id: user.id,
          title: `⚠️ Decline Warning (${warningNum}/2)`,
          message: `You've declined ${warningNum} job offer${warningNum > 1 ? "s" : ""}. One more decline will result in a permanent ban.`,
          type: "warning",
          link: "/profile",
        });
        toast.warning(`Warning ${warningNum}/2: You've declined a job offer. A 3rd decline will result in a permanent ban.`);
      } else if (actionTaken === "permanent_ban") {
        await supabase.from("user_bans").insert({
          user_id: user.id,
          ban_type: "permanent",
          reason: "Declined 3 job offers after being selected",
          banned_by: user.id,
        });
        await supabase.from("profiles").update({ ban_status: "permanently_banned" } as any).eq("user_id", user.id);
        toast.error("Your account has been permanently banned due to 3 job offer declines.");
      }

      // Notify admins
      if (actionTaken !== "none") {
        const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
        if (adminRoles) {
          for (const admin of adminRoles) {
            await supabase.from("notifications").insert({
              user_id: admin.user_id,
              title: "⚠️ Helpr declined job offer",
              message: `Helpr declined offer (${priorCount + 1} total). Action: ${actionTaken}.`,
              type: "warning",
              link: "/admin",
            });
          }
        }
      }

      // Reopen job
      await supabase.from("applications").update({ status: "rejected" }).eq("id", app.id);
      await supabase.from("jobs").update({ status: "open", helper_id: null, response_deadline: null } as any).eq("id", app.job_id);
      toast.info("You declined the job. The poster can select someone else.");
      loadData(user.id);
    }
  };

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
        return { ...app, profiles: prof, reviewCount: ratings.length, avgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0 };
      }));
    } else {
      setApplications([]);
    }
  };

  const acceptApplication = async (app: Application & { profiles?: any }) => {
    // Show deadline dialog instead of immediately accepting
    setDeadlineDialogApp(app);
  };

  const confirmAcceptWithDeadline = async (deadlineHours: number) => {
    if (!deadlineDialogApp || !selectedJob) return;
    const deadline = new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString();
    await supabase.from("applications").update({ status: "accepted" }).eq("id", deadlineDialogApp.id);
    await supabase.from("jobs").update({
      status: "accepted",
      helper_id: deadlineDialogApp.helper_id,
      response_deadline: deadline,
    } as any).eq("id", selectedJob.id);

    // Notify helper about the deadline
    await supabase.from("notifications").insert({
      user_id: deadlineDialogApp.helper_id,
      title: "📋 New job offer!",
      message: `You've been selected for "${selectedJob.title}". Respond within ${deadlineHours} hour${deadlineHours > 1 ? "s" : ""} or the offer expires.`,
      type: "info",
      link: "/activity",
    });

    toast.success(`Offer sent! Helpr has ${deadlineHours}h to respond.`);
    setDeadlineDialogApp(null);
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
      if (data?.bothDone) {
        toast.success(`Job completed! Payment released.`);
        // Trigger completion prompts (review + tip)
        const job = postedJobs.find(j => j.id === jobId) || appliedApps.find(a => a.job_id === jobId)?.job;
        if (job && user) {
          const isHelper = appliedApps.some(a => a.job_id === jobId && a.helper_id === user.id);
          const revieweeId = isHelper ? job.customer_id : (job.helper_id || "");
          if (revieweeId) {
            const { data: prof } = await supabase.from("profiles").select("full_name").eq("user_id", revieweeId).single();
            setCompletionPromptJob({ job: job as Job, revieweeId, revieweeName: (prof?.full_name || "User").split(" ")[0] });
          }
        }
      } else {
        toast.success("You've marked this job as complete. Waiting for the other party to confirm.");
      }
      if (user) loadData(user.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to complete job");
    } finally {
      setCompletingJobId(null);
    }
  };

  const requestRevision = async () => {
    if (!revisionJobId) return;
    setRequestingRevision(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: { action: "request_revision", jobId: revisionJobId, note: revisionNote.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Revision requested!");
      setRevisionJobId(null);
      setRevisionNote("");
      if (user) loadData(user.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to request revision");
    } finally {
      setRequestingRevision(false);
    }
  };

  const resolveRevision = async (jobId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: { action: "resolve_revision", jobId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Revision resolved! Job is back in progress.");
      if (user) loadData(user.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to resolve revision");
    }
  };

  const sendTip = async (jobId: string, quickAmount?: number) => {
    const amount = quickAmount || parseFloat(tipAmount);
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

  const sendHelperTip = async (jobId: string) => {
    const amount = parseFloat(helperTipAmount);
    if (isNaN(amount) || amount <= 0) { toast.error("Enter a valid amount"); return; }
    setHelperTipping(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "tip", jobId, amount } });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to create tip");
    } finally {
      setHelperTipping(false);
    }
  };

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
      title: editTitle.trim(), description: editDescription.trim(), category: editCategory as any,
      location: editLocation.trim(), date_needed: editDateNeeded, start_time: editStartTime || null,
      estimated_hours: editEstimatedHours ? parseFloat(editEstimatedHours) : null,
      budget: parseFloat(editBudget), special_requirements: editSpecialReq.trim() || null,
    }).eq("id", editJob.id);
    setEditSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Job updated!"); setEditJob(null); if (user) loadData(user.id); }
  };

  const openReviewForPosted = async (job: Job) => {
    // Poster reviewing helper
    if (!job.helper_id) return;
    const { data: helperProfile } = await supabase.from("profiles").select("full_name").eq("user_id", job.helper_id).single();
    setReviewTarget({ id: job.helper_id, name: (helperProfile?.full_name || "Helpr").split(" ")[0] });
    setReviewJob(job);
  };

  const handleNoShow = async (jobId: string) => {
    if (!user) return;
    setReportingNoShow(true);
    try {
      const job = postedJobs.find((j) => j.id === jobId);
      if (!job?.helper_id) return;

      const { data: existing } = await (supabase.from("user_violations" as any) as any)
        .select("id").eq("user_id", job.helper_id).eq("violation_type", "no_show");
      const priorCount = (existing as any[] | null)?.length || 0;

      await (supabase.from("user_violations" as any) as any).insert({
        user_id: job.helper_id, violation_type: "no_show",
        description: `No-show for job: ${job.title}`, job_id: jobId,
        reported_by: user.id, action_taken: priorCount >= 1 ? "permanent_ban" : "warning",
      });

      if (priorCount >= 1) {
        await (supabase.from("user_bans" as any) as any).insert({
          user_id: job.helper_id, ban_type: "permanent",
          reason: "Repeated no-show violations", banned_by: user.id,
        });
        await supabase.from("profiles").update({ ban_status: "permanently_banned" } as any).eq("user_id", job.helper_id);
      } else {
        await supabase.from("profiles").update({ ban_status: "warned" } as any).eq("user_id", job.helper_id);
      }

      await supabase.from("notifications").insert({
        user_id: job.helper_id,
        title: priorCount >= 1 ? "⛔ Account banned for no-show" : "⚠️ No-show warning",
        message: priorCount >= 1
          ? "Your account has been permanently banned for repeated no-shows."
          : `You received a no-show warning for "${job.title}". Another no-show will result in a permanent ban.`,
        type: "warning", link: "/profile",
      });

      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRoles) {
        for (const admin of adminRoles) {
          await supabase.from("notifications").insert({
            user_id: admin.user_id, title: "🚫 No-show reported",
            message: `Helpr no-show for "${job.title}". ${priorCount >= 1 ? "Auto-banned." : "Warning issued."}`,
            type: "warning", link: "/admin",
          });
        }
      }

      await supabase.from("jobs").update({ status: "open", helper_id: null }).eq("id", jobId);
      toast.success("No-show reported. Job reopened so you can pick another applicant.");
      loadData(user.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to report no-show");
    } finally {
      setReportingNoShow(false);
      setNoShowJobId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <DashboardHeader />
        <main className="container mx-auto px-4 py-4">
          <div className="max-w-3xl mx-auto space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <ActivityCardSkeleton key={i} />
            ))}
          </div>
        </main>
      </div>
    );
  }

  const postedStatusFilters = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "accepted", label: "Accepted" },
    { key: "in_progress", label: "In Progress" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
    { key: "disputed", label: "Disputed" },
  ];

  const appliedStatusFilters = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "accepted", label: "Accepted" },
    { key: "rejected", label: "Rejected" },
  ];

  const filteredPostedJobs = statusFilter === "all"
    ? postedJobs
    : postedJobs.filter((j) => j.status === statusFilter);

  const filteredAppliedApps = statusFilter === "all"
    ? appliedApps
    : appliedApps.filter((a) => {
        if (statusFilter === "pending" || statusFilter === "accepted" || statusFilter === "rejected") {
          return a.status === statusFilter;
        }
        return true;
      });

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "posted", label: "Posted", count: postedJobs.length },
    { key: "applied", label: "Applied", count: appliedApps.length },
  ];

  const activeStatusFilters = tab === "posted" ? postedStatusFilters : appliedStatusFilters;

  return (
    <div className="min-h-screen bg-background pb-20">
      <DashboardHeader />

      <main className="container mx-auto px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <h1 className="text-2xl font-display font-bold text-foreground">My Activity</h1>

          <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => { setTab(t.key); setStatusFilter("all"); }}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {t.label}
                <span className={`ml-1.5 text-xs ${tab === t.key ? "text-primary" : "text-muted-foreground"}`}>{t.count}</span>
              </button>
            ))}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {activeStatusFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* POSTED TAB */}
          {tab === "posted" && (
            <div className="space-y-4">
              {filteredPostedJobs.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground mb-4">
                    {postedJobs.length === 0 ? "You haven't posted any tasks yet." : "No tasks match this filter."}
                  </p>
                  {postedJobs.length === 0 && <Button onClick={() => navigate("/post-job")}>Post your first task</Button>}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPostedJobs.map((job) => (
                    <div key={job.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="font-semibold text-foreground">{job.title}</h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>{job.status.replace(/_/g, " ")}</span>
                            {job.payment_status === "released" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">Paid</span>}
                          </div>
                          <p className="text-sm text-muted-foreground">${job.budget} · {job.location}</p>
                          {/* Show who has confirmed completion */}
                          {(job.status === "in_progress" || job.status === "revision_requested") && ((job as any).poster_completed_at || (job as any).helper_completed_at) && (
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                              {(job as any).poster_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ You confirmed</span>}
              {(job as any).helper_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ Helpr confirmed</span>}
                               {!(job as any).poster_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Waiting for you</span>}
                               {!(job as any).helper_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Waiting for helpr</span>}
                            </div>
                          )}
                          {/* New features for posted jobs */}
                          {(job.status === "in_progress" || job.status === "accepted") && user && (
                            <div className="mt-3 space-y-3">
                              <JobConfirmation
                                jobId={job.id}
                                isOwner={true}
                                isHelper={false}
                                posterConfirmedAt={(job as any).poster_confirmed_at}
                                helperConfirmedAt={(job as any).helper_confirmed_at}
                                dateNeeded={job.date_needed}
                              />
                              <JobTracking jobId={job.id} helperId={job.helper_id} isHelper={false} isOwner={true} />
                              {(job as any).is_group_job && (
                                <GroupJobHelpers jobId={job.id} helpersNeeded={(job as any).helpers_needed || 2} isOwner={true} />
                              )}
                              <ScopeAgreement jobId={job.id} isOwner={true} isHelper={false} />
                              <AddonRequests jobId={job.id} isOwner={true} isHelper={false} userId={user.id} />
                              <JobMilestones jobId={job.id} isOwner={true} isHelper={false} totalBudget={job.budget} />
                              <JobCheckins jobId={job.id} userId={user.id} isHelper={false} isOwner={true} jobStatus={job.status} jobLatitude={(job as any).latitude} jobLongitude={(job as any).longitude} />
                            </div>
                          )}
                          {job.status === "revision_requested" && (job as any).revision_note && (
                            <div className="mt-2 p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                              <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                              <p className="text-xs text-muted-foreground mt-1">{(job as any).revision_note}</p>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1.5 flex-wrap justify-end">
                          {job.status === "open" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => setBoostJobId(job.id)}><Rocket className="w-4 h-4 mr-1" /> Boost</Button>
                              <Button size="sm" variant="outline" onClick={() => openEditJob(job)}><Pencil className="w-4 h-4" /></Button>
                              <Button size="sm" variant="outline" onClick={() => loadApplications(job)}><Users className="w-4 h-4 mr-1" /> Applicants</Button>
                              <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setCancelDialogJob(job)}><XCircle className="w-4 h-4" /></Button>
                            </>
                          )}
                          {job.status === "accepted" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => loadApplications(job)}><Users className="w-4 h-4 mr-1" /> Applicants</Button>
                              <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setCancelDialogJob(job)}><XCircle className="w-4 h-4" /></Button>
                            </>
                          )}
                          {(job.status === "in_progress" || job.status === "revision_requested") && (
                            <>
                              <Button size="sm" onClick={() => completeJob(job.id)} disabled={completingJobId === job.id || !!(job as any).poster_completed_at}>
                                <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === job.id ? "…" : (job as any).poster_completed_at ? "Confirmed ✓" : "Mark Complete"}
                              </Button>
                                {job.status === "in_progress" && (
                                  <>
                                    <Button size="sm" variant="outline" onClick={() => { setRevisionJobId(job.id); setRevisionNote(""); }}>
                                      <AlertTriangle className="w-4 h-4 mr-1" /> Revision
                                    </Button>
                                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10"
                                      onClick={() => setDisputeJob(job)}>
                                      Dispute
                                    </Button>
                                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10"
                                      onClick={() => setNoShowJobId(job.id)}>
                                      No-Show
                                    </Button>
                                  </>
                                )}
                              <Button size="sm" variant="outline" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4" /></Button>
                              <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setCancelDialogJob(job)}><XCircle className="w-4 h-4" /></Button>
                            </>
                          )}
                          {job.status === "cancelled" && <Button size="sm" variant="outline" onClick={() => repostJob(job.id)}><RotateCcw className="w-4 h-4 mr-1" /> Repost</Button>}
                          {job.status === "completed" && job.payment_status !== "released" && job.helper_id && (
                            <Button size="sm" variant="outline" onClick={() => openReviewForPosted(job)}><Star className="w-4 h-4 mr-1" /> Review</Button>
                          )}
                        </div>
                      </div>
                      {/* Completed: tip & review */}
                      {job.status === "completed" && job.payment_status === "released" && (
                        <div className="border-t border-border pt-3 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => sendTip(job.id, 5)} disabled={tipping}>
                              <Gift className="w-3.5 h-3.5 mr-1" /> $5
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => sendTip(job.id, 10)} disabled={tipping}>
                              <Gift className="w-3.5 h-3.5 mr-1" /> $10
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => sendTip(job.id, 20)} disabled={tipping}>
                              <Gift className="w-3.5 h-3.5 mr-1" /> $20
                            </Button>
                            {tipJobId === job.id ? (
                              <div className="flex items-center gap-2">
                                <Input type="number" min="1" placeholder="Custom $" value={tipAmount} onChange={(e) => setTipAmount(e.target.value)} className="max-w-[90px]" />
                                <Button size="sm" onClick={() => sendTip(job.id)} disabled={tipping}>{tipping ? "…" : "Send"}</Button>
                                <Button size="sm" variant="ghost" onClick={() => { setTipJobId(null); setTipAmount(""); }}>✕</Button>
                              </div>
                            ) : (
                              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setTipJobId(job.id); setTipAmount(""); }}>Custom</Button>
                            )}
                            {job.helper_id && (
                              <Button size="sm" variant="outline" onClick={() => openReviewForPosted(job)} className="ml-auto">
                                <Star className="w-3.5 h-3.5 mr-1" /> Review
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => navigate(`/post-job?rebook=${job.id}`)}>
                              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Rebook
                            </Button>
                          </div>
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
                              <a href={`/user/${app.helper_id}`} className="font-medium text-primary hover:underline">{(app.profiles?.full_name || "Helpr").split(" ")[0]}</a>
                              {app.profiles?.skills && <p className="text-xs text-muted-foreground">{app.profiles.skills}</p>}
                              {app.proposed_rate && <p className="text-xs text-muted-foreground">${app.proposed_rate}/hr</p>}
                              {app.message && <p className="text-sm text-muted-foreground mt-1">{app.message}</p>}
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
                  <Button onClick={() => navigate("/dashboard")}>Browse tasks</Button>
                </div>
              ) : (
                appliedApps.map((app) => (
                  <div key={app.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
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
                              {app.job.status.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                        {app.job && (
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {app.job.location}</span>
                            <span className="flex items-center gap-1 font-medium text-foreground"><DollarSign className="w-3 h-3" /> ${app.job.budget}</span>
                            <span>Posted by <a href={`/user/${app.job?.customer_id}`} className="font-medium text-primary hover:underline">{app.posterName}</a></span>
                          </div>
                        )}
                        {app.message && <p className="text-sm text-muted-foreground mt-1">{app.message}</p>}

                        {/* Completion status for helper */}
                        {app.status === "accepted" && (app.job?.status === "in_progress" || app.job?.status === "revision_requested") && ((app.job as any)?.poster_completed_at || (app.job as any)?.helper_completed_at) && (
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            {(app.job as any)?.helper_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ You confirmed</span>}
                            {(app.job as any)?.poster_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ Poster confirmed</span>}
                            {!(app.job as any)?.helper_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Waiting for you</span>}
                            {!(app.job as any)?.poster_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Waiting for poster</span>}
                          </div>
                        )}

                        {/* New features for helper */}
                        {app.status === "accepted" && (app.job?.status === "in_progress" || app.job?.status === "accepted") && user && (
                          <div className="mt-3 space-y-3">
                            <JobConfirmation
                              jobId={app.job_id}
                              isOwner={false}
                              isHelper={true}
                              posterConfirmedAt={(app.job as any)?.poster_confirmed_at}
                              helperConfirmedAt={(app.job as any)?.helper_confirmed_at}
                              dateNeeded={app.job?.date_needed || ""}
                            />
                            <JobTracking jobId={app.job_id} helperId={user.id} isHelper={true} isOwner={false} />
                            <ScopeAgreement jobId={app.job_id} isOwner={false} isHelper={true} />
                            <AddonRequests jobId={app.job_id} isOwner={false} isHelper={true} userId={user.id} />
                            <JobMilestones jobId={app.job_id} isOwner={false} isHelper={true} totalBudget={app.job?.budget || 0} />
                            <JobCheckins jobId={app.job_id} userId={user.id} isHelper={true} isOwner={false} jobStatus={app.job?.status || ""} jobLatitude={(app.job as any)?.latitude} jobLongitude={(app.job as any)?.longitude} />
                          </div>
                        )}

                        {/* Revision requested notice for helper */}
                        {app.job?.status === "revision_requested" && (app.job as any)?.revision_note && (
                          <div className="mt-2 p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                            <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                            <p className="text-xs text-muted-foreground mt-1">{(app.job as any).revision_note}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {app.status === "accepted" && app.job?.status === "accepted" && (
                          <div className="flex flex-col gap-1.5">
                            {(app.job as any)?.response_deadline && (
                              <div className="text-xs text-muted-foreground text-center px-2 py-1 rounded bg-muted/50">
                                <Clock className="w-3 h-3 inline mr-1" />
                                Respond by {new Date((app.job as any).response_deadline).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            )}
                            <Button size="sm" onClick={() => handleHelperResponse(app, true)}>
                              <ThumbsUp className="w-4 h-4 mr-1" /> Accept
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive" onClick={() => handleHelperResponse(app, false)}>
                              <ThumbsDown className="w-4 h-4 mr-1" /> Decline
                            </Button>
                          </div>
                        )}
                        {app.status === "accepted" && (app.job?.status === "in_progress" || app.job?.status === "revision_requested") && (
                          <>
                            <PhotoProof jobId={app.job_id} type="before" existingUrls={(app.job as any)?.proof_before_urls || []} onUploaded={() => user && loadData(user.id)} />
                            <PhotoProof jobId={app.job_id} type="after" existingUrls={(app.job as any)?.proof_after_urls || []} onUploaded={() => user && loadData(user.id)} />
                            <Button size="sm" onClick={() => completeJob(app.job_id)} disabled={completingJobId === app.job_id || !!(app.job as any)?.helper_completed_at}>
                              <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === app.job_id ? "…" : (app.job as any)?.helper_completed_at ? "Confirmed ✓" : "Mark Complete"}
                            </Button>
                            {app.job?.status === "revision_requested" && (
                              <Button size="sm" variant="outline" onClick={() => resolveRevision(app.job_id)}>
                                <RefreshCw className="w-4 h-4 mr-1" /> Mark Fixed
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => navigate("/messages")}>
                              <MessageSquare className="w-4 h-4 mr-1" /> Message
                            </Button>
                          </>
                        )}
                        {app.status === "accepted" && app.job?.status === "completed" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => {
                              setHelperReviewJob({ jobId: app.job_id, posterId: app.job!.customer_id, posterName: app.posterName || "Poster" });
                            }}>
                              <Star className="w-4 h-4 mr-1" /> Review
                            </Button>
                          </>
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

      {/* Poster reviewing helper */}
      {reviewJob && reviewTarget && (
        <ReviewForm open={!!reviewJob} onClose={() => { setReviewJob(null); setReviewTarget(null); }} jobId={reviewJob.id} revieweeId={reviewTarget.id} revieweeName={reviewTarget.name} />
      )}

      {/* Helper reviewing poster */}
      {helperReviewJob && (
        <ReviewForm open={!!helperReviewJob} onClose={() => setHelperReviewJob(null)} jobId={helperReviewJob.jobId} revieweeId={helperReviewJob.posterId} revieweeName={helperReviewJob.posterName} />
      )}

      {/* Revision Request Dialog */}
      <Dialog open={!!revisionJobId} onOpenChange={() => setRevisionJobId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Request Revision</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Describe what needs to be fixed or redone. The helpr will be notified.</p>
            <Textarea value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} placeholder="Please fix…" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevisionJobId(null)}>Cancel</Button>
            <Button onClick={requestRevision} disabled={requestingRevision || !revisionNote.trim()}>
              {requestingRevision ? "Sending…" : "Request Revision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Boost Dialog */}
      {boostJobId && (
        <JobBoostDialog
          jobId={boostJobId}
          open={!!boostJobId}
          onClose={() => setBoostJobId(null)}
          onBoosted={() => { if (user) loadData(user.id); }}
        />
      )}

      {/* Enhanced Tip Dialog */}
      {enhancedTipJobId && (
        <TipDialog
          jobId={enhancedTipJobId}
          helperName={enhancedTipHelperName}
          open={!!enhancedTipJobId}
          onClose={() => { setEnhancedTipJobId(null); setEnhancedTipHelperName(""); }}
        />
      )}

      {/* No-Show Confirmation Dialog */}
      <Dialog open={!!noShowJobId} onOpenChange={() => setNoShowJobId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" /> Report No-Show
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Are you sure the helpr didn't show up? This will:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
              <li>Issue a <span className="font-medium text-foreground">warning</span> to the helpr (1st offense) or a <span className="font-medium text-destructive">permanent ban</span> (2nd offense)</li>
              <li>Reopen your job so you can pick another applicant</li>
              <li>Notify the admin team</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNoShowJobId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => noShowJobId && handleNoShow(noShowJobId)} disabled={reportingNoShow}>
              {reportingNoShow ? "Reporting…" : "Confirm No-Show"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancellation Dialog */}
      {cancelDialogJob && user && (
        <CancellationDialog
          jobId={cancelDialogJob.id}
          jobTitle={cancelDialogJob.title}
          jobDate={cancelDialogJob.date_needed}
          jobBudget={cancelDialogJob.budget}
          userId={user.id}
          hasHelper={!!cancelDialogJob.helper_id}
          open={!!cancelDialogJob}
          onClose={() => setCancelDialogJob(null)}
          onCancelled={() => { if (user) loadData(user.id); }}
        />
      )}

      {/* Completion Prompts (review + tip) */}
      {completionPromptJob && user && (
        <CompletionPrompts
          jobId={completionPromptJob.job.id}
          jobTitle={completionPromptJob.job.title}
          revieweeId={completionPromptJob.revieweeId}
          revieweeName={completionPromptJob.revieweeName}
          userId={user.id}
          onDone={() => setCompletionPromptJob(null)}
        />
      )}

      {/* Response Deadline Dialog */}
      {deadlineDialogApp && (
        <ResponseDeadlineDialog
          open={!!deadlineDialogApp}
          helperName={deadlineDialogApp.profiles?.full_name?.split(" ")[0] || "Helpr"}
          onConfirm={confirmAcceptWithDeadline}
          onClose={() => setDeadlineDialogApp(null)}
        />
      )}

      {/* Dispute Dialog */}
      {disputeJob && user && (
        <DisputeDialog
          jobId={disputeJob.id}
          jobTitle={disputeJob.title}
          userId={user.id}
          open={!!disputeJob}
          onClose={() => setDisputeJob(null)}
          onDisputed={() => { if (user) loadData(user.id); }}
        />
      )}
    </div>
  );
};

export default Activity;
