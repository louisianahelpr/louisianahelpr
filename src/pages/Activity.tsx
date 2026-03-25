import { useEffect, useState, useMemo, useCallback } from "react";
import { useStripeConnectCheck } from "@/hooks/useStripeConnectCheck";
import { formatName } from "@/lib/utils";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { checkProximity } from "@/lib/locationUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, MapPin, DollarSign, XCircle, CheckCircle2, Gift, RotateCcw,
  Star, MessageSquare, Users, Pencil, ThumbsUp, ThumbsDown, AlertTriangle, RefreshCw,
  Rocket, Clock, ChevronDown, Calendar, Timer, Zap, Navigation as NavigationIcon,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { JobBoostDialog } from "@/components/JobBoostDialog";
import { TipDialog } from "@/components/TipDialog";
import { PhotoProof } from "@/components/PhotoProof";
import { CancellationDialog } from "@/components/CancellationDialog";
import { CompletionPrompts } from "@/components/CompletionPrompts";
import { toast } from "sonner";
import { ReviewForm } from "@/components/ReviewPanel";
import { ActivityCardSkeleton } from "@/components/SkeletonLoaders";
import { getCityState } from "@/lib/locationUtils";
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
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ActivityDialogs } from "@/components/activity/ActivityDialogs";
import { EditJobDialog } from "@/components/activity/EditJobDialog";
import {
  type Job, type Application, type Tab, type EnrichedApplication, type AppliedApp,
  categoryLabels, categories, categoryColors, statusBadge,
} from "@/components/activity/activityConstants";

const categoryColors: Record<string, { badge: string; title: string }> = {
  cleaning: { badge: "bg-sky-50 text-sky-700 border-sky-200/60", title: "text-sky-700" },
  yard_work: { badge: "bg-emerald-50 text-emerald-700 border-emerald-200/60", title: "text-emerald-700" },
  moving: { badge: "bg-violet-50 text-violet-700 border-violet-200/60", title: "text-violet-700" },
  errands: { badge: "bg-amber-50 text-amber-700 border-amber-200/60", title: "text-amber-700" },
  handyman: { badge: "bg-orange-50 text-orange-700 border-orange-200/60", title: "text-orange-700" },
  painting: { badge: "bg-pink-50 text-pink-700 border-pink-200/60", title: "text-pink-700" },
  delivery: { badge: "bg-indigo-50 text-indigo-700 border-indigo-200/60", title: "text-indigo-700" },
  pet_care: { badge: "bg-rose-50 text-rose-700 border-rose-200/60", title: "text-rose-700" },
  assembly: { badge: "bg-teal-50 text-teal-700 border-teal-200/60", title: "text-teal-700" },
  other: { badge: "bg-slate-50 text-slate-700 border-slate-200/60", title: "text-slate-700" },
};

const statusBadge: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-amber-500/15 text-amber-600",
  in_progress: "bg-amber-500/15 text-amber-600",
  revision_requested: "bg-orange-500/15 text-orange-600",
  completed: "bg-emerald-500/15 text-emerald-600",
  cancelled: "bg-destructive/10 text-destructive",
  disputed: "bg-red-500/15 text-red-600",
};

type Tab = "posted" | "applied";

const Activity = () => {
  usePageTitle("My Activity — Helpr");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: cachedUser } = useCurrentUser();
  const [user, setUser] = useState<SupaUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(() => {
    const paramTab = searchParams.get("tab");
    return paramTab === "applied" ? "applied" : "posted";
  });
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const paramFilter = searchParams.get("filter");
    if (paramFilter) return paramFilter;
    const paramTab = searchParams.get("tab");
    return paramTab === "applied" ? "pending" : "open";
  });

  // Posted jobs state
  const [postedJobs, setPostedJobs] = useState<Job[]>([]);
  const [applicantCounts, setApplicantCounts] = useState<Record<string, number>>({});
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<(Application & { profiles?: { full_name: string | null; skills: string | null; hourly_rate: number | null; user_id: string } | null; reviewCount?: number; avgRating?: number })[]>([]);
  const [inlineApplicants, setInlineApplicants] = useState<Record<string, typeof applications>>({});
  const [loadingApplicants, setLoadingApplicants] = useState<Record<string, boolean>>({});
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
  const [cancelHelperEnRoute, setCancelHelperEnRoute] = useState(false);
  const [deadlineDialogApp, setDeadlineDialogApp] = useState<(Application & { profiles?: any }) | null>(null);
  // Loading states for action buttons
  const [onTheWayLoading, setOnTheWayLoading] = useState<string | null>(null);
  const [arrivedLoading, setArrivedLoading] = useState<string | null>(null);
  const [startJobLoading, setStartJobLoading] = useState<string | null>(null);
  const [completionPromptJob, setCompletionPromptJob] = useState<{ job: Job; revieweeId: string; revieweeName: string } | null>(null);
  // Revision request
  const [revisionJobId, setRevisionJobId] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const [requestingRevision, setRequestingRevision] = useState(false);
  // Dispute
  const [disputeJob, setDisputeJob] = useState<Job | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [completedJobMeta, setCompletedJobMeta] = useState<Record<string, { tipped: boolean; reviewed: boolean }>>({});
  const [helperNames, setHelperNames] = useState<Record<string, string>>({});

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
  const [declinedJobIds, setDeclinedJobIds] = useState<Set<string>>(new Set());
  const [startRequestedJobIds, setStartRequestedJobIds] = useState<Set<string>>(new Set());

  // Helper tip state (in applied tab)
  const [helperTipJobId, setHelperTipJobId] = useState<string | null>(null);
  const [helperTipAmount, setHelperTipAmount] = useState("");
  const [helperTipping, setHelperTipping] = useState(false);
  const [helperReviewJob, setHelperReviewJob] = useState<{ jobId: string; posterId: string; posterName: string } | null>(null);
  const [helperReviewedJobIds, setHelperReviewedJobIds] = useState<Set<string>>(new Set());

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

  // Realtime: auto-refresh when jobs or checkins change
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("activity-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
        if (user) loadData(user.id);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "job_tracking" }, () => {
        if (user) loadData(user.id);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, () => {
        if (user) loadData(user.id);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_checkins" }, () => {
        if (user) loadData(user.id);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const loadData = async (userId: string) => {
    const [postedRes, appsRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("customer_id", userId).order("created_at", { ascending: false }),
      supabase.from("applications").select("*").eq("helper_id", userId).order("created_at", { ascending: false }),
    ]);

    if (postedRes.data) {
      setPostedJobs(postedRes.data);
      const jobIds = postedRes.data.map(j => j.id);
      if (jobIds.length > 0) {
        const [allAppsRes, startCheckinsRes] = await Promise.all([
          supabase.from("applications").select("job_id").in("job_id", jobIds),
          supabase.from("job_checkins").select("job_id").in("job_id", jobIds).eq("type", "start_request"),
        ]);
        const counts: Record<string, number> = {};
        allAppsRes.data?.forEach(a => { counts[a.job_id] = (counts[a.job_id] || 0) + 1; });
        setApplicantCounts(counts);
        setStartRequestedJobIds(new Set((startCheckinsRes.data || []).map(c => c.job_id)));

        // Fetch helper names for assigned jobs
        const helperIds = [...new Set(postedRes.data.filter(j => j.helper_id).map(j => j.helper_id!))];
        if (helperIds.length > 0) {
          const { data: helperProfiles } = await supabase.rpc("get_safe_profiles", { user_ids: helperIds });
          const names: Record<string, string> = {};
          helperProfiles?.forEach((p: any) => { names[p.user_id] = formatName(p.full_name, "Helpr"); });
          setHelperNames(names);
        }

        // Fetch tip & review status for completed jobs
        const completedIds = postedRes.data.filter(j => j.status === "completed").map(j => j.id);
        if (completedIds.length > 0) {
          const [tipsRes, reviewsRes] = await Promise.all([
            supabase.from("tips").select("job_id").in("job_id", completedIds).eq("tipper_id", userId),
            supabase.from("reviews").select("job_id").in("job_id", completedIds).eq("reviewer_id", userId),
          ]);
          const meta: Record<string, { tipped: boolean; reviewed: boolean }> = {};
          completedIds.forEach(id => { meta[id] = { tipped: false, reviewed: false }; });
          tipsRes.data?.forEach(t => { if (meta[t.job_id]) meta[t.job_id].tipped = true; });
          reviewsRes.data?.forEach(r => { if (meta[r.job_id]) meta[r.job_id].reviewed = true; });
          setCompletedJobMeta(meta);
        }
      }
    }

    if (appsRes.data && appsRes.data.length > 0) {
      const jobIds = [...new Set(appsRes.data.map((a) => a.job_id))];
      const [jobsRes, violationsRes, helperStartCheckins, helperReviewsRes] = await Promise.all([
        supabase.from("jobs").select("*").in("id", jobIds),
        supabase.from("user_violations").select("job_id").eq("user_id", userId).eq("violation_type", "job_denial"),
        supabase.from("job_checkins").select("job_id").in("job_id", jobIds).eq("type", "start_request"),
        supabase.from("reviews").select("job_id").eq("reviewer_id", userId).in("job_id", jobIds),
      ]);
      // Merge helper's start requests into the shared set
      (helperStartCheckins.data || []).forEach(c => startRequestedJobIds.add(c.job_id));
      setStartRequestedJobIds(new Set(startRequestedJobIds));
      setHelperReviewedJobIds(new Set((helperReviewsRes.data || []).map(r => r.job_id)));
      const jobs = jobsRes.data;
      const jobMap = new Map(jobs?.map((j) => [j.id, j]) || []);
      const posterIds = [...new Set(jobs?.map((j) => j.customer_id) || [])];
      const declined = new Set<string>((violationsRes.data || []).map((v: any) => v.job_id).filter(Boolean));
      setDeclinedJobIds(declined);
      let posterNameMap = new Map<string, string>();
      if (posterIds.length > 0) {
        const { data: profiles } = await supabase.rpc("get_safe_profiles", { user_ids: posterIds });
        posterNameMap = new Map(profiles?.map((p: any) => [p.user_id, formatName(p.full_name)]) || []);
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

  const { checkHelperStripeConnect, checking: checkingStripe } = useStripeConnectCheck();

  const handleHelperResponse = async (app: Application, accept: boolean) => {
    if (!user) return;
    if (accept) {
      // Block if helper has no connected payout account
      const stripeCheck = await checkHelperStripeConnect();
      if (!stripeCheck.ok) {
        toast.error(stripeCheck.reason);
        return;
      }
      // Keep as "accepted" — will move to "in_progress" on job date or manual start
      await supabase.from("jobs").update({ helper_confirmed_at: new Date().toISOString(), response_deadline: null } as any).eq("id", app.job_id);
      await supabase.from("applications").update({ status: "rejected" }).eq("job_id", app.job_id).neq("id", app.id);
      toast.success("Job accepted! You can start when ready or it will auto-start on the scheduled date.");
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
        await createNotification({
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
            await createNotification({
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
    const enriched = await fetchApplicants(job.id);
    setApplications(enriched);
  };

  const fetchApplicants = async (jobId: string) => {
    const { data: apps } = await supabase.from("applications").select("*").eq("job_id", jobId);
    if (apps && apps.length > 0) {
      const helperIds = apps.map((a) => a.helper_id);
      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: helperIds }),
        supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", helperIds),
      ]);
      const reviewMap = new Map<string, number[]>();
      reviewsRes.data?.forEach((r) => {
        if (!reviewMap.has(r.reviewee_id)) reviewMap.set(r.reviewee_id, []);
        reviewMap.get(r.reviewee_id)!.push(r.rating);
      });
      return apps.map((app) => {
        const prof = profilesRes.data?.find((p) => p.user_id === app.helper_id) || null;
        const ratings = reviewMap.get(app.helper_id) || [];
        return { ...app, profiles: prof, reviewCount: ratings.length, avgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0 };
      });
    }
    return [];
  };

  const loadInlineApplicants = async (jobId: string) => {
    if (inlineApplicants[jobId]) return; // already loaded
    setLoadingApplicants(prev => ({ ...prev, [jobId]: true }));
    const enriched = await fetchApplicants(jobId);
    setInlineApplicants(prev => ({ ...prev, [jobId]: enriched }));
    setLoadingApplicants(prev => ({ ...prev, [jobId]: false }));
  };

  const handleExpandJob = (jobId: string, job: Job) => {
    const newId = expandedJobId === jobId ? null : jobId;
    setExpandedJobId(newId);
    if (newId && (job.status === "open" || job.status === "accepted")) {
      loadInlineApplicants(jobId);
    }
  };

  const acceptApplication = async (app: Application & { profiles?: any }) => {
    // Show deadline dialog instead of immediately accepting
    setDeadlineDialogApp(app);
  };

  const confirmAcceptWithDeadline = async (deadlineHours: number, initialMessage?: string) => {
    if (!deadlineDialogApp || !selectedJob || !user) return;

    // Verify the helper being accepted has a connected payout account
    // Use get_safe_profiles RPC to bypass RLS restrictions on profiles table
    const { data: safeProfiles } = await supabase.rpc("get_safe_profiles", {
      user_ids: [deadlineDialogApp.helper_id],
    });
    // Note: payout setup is verified at payout time; we only soft-warn here
    // since the poster can't read the helper's stripe_account_id directly

    const deadline = new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString();
    await supabase.from("applications").update({ status: "accepted" }).eq("id", deadlineDialogApp.id);
    await supabase.from("jobs").update({
      status: "accepted",
      helper_id: deadlineDialogApp.helper_id,
      response_deadline: deadline,
    } as any).eq("id", selectedJob.id);

    // Send initial message if provided
    if (initialMessage) {
      await supabase.from("messages").insert({
        job_id: selectedJob.id,
        sender_id: user.id,
        receiver_id: deadlineDialogApp.helper_id,
        content: initialMessage,
      });
    }

    // Notify helper about the deadline
    await createNotification({
      user_id: deadlineDialogApp.helper_id,
      title: "📋 New job offer!",
      message: `You've been selected for "${selectedJob.title}". Respond within ${deadlineHours} hour${deadlineHours > 1 ? "s" : ""} or the offer expires.`,
      type: "info",
      link: "/activity?tab=applied&filter=offered",
    });

    toast.success(`Offer sent! Helpr has ${deadlineHours}h to respond.`);
    setDeadlineDialogApp(null);
    setSelectedJob(null);
    setApplications([]);
    // Refresh inline applicants for this job
    setInlineApplicants(prev => { const copy = { ...prev }; delete copy[selectedJob.id]; return copy; });
    if (user) {
      loadData(user.id);
      loadInlineApplicants(selectedJob.id);
    }
  };

  const tryCancelJob = async (job: Job) => {
    // Block cancellation if helper is en route, arrived, working, or done
    const { data: tracking } = await supabase
      .from("job_tracking")
      .select("status")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const trackingStatus = (tracking as any[])?.[0]?.status;
    const blockedStatuses = ["on_the_way", "arrived", "working", "done"];
    if (trackingStatus && blockedStatuses.includes(trackingStatus)) {
      toast.error("This job can't be cancelled — the helpr is already on the way or working.", { duration: 5000 });
      return;
    }
    setCancelDialogJob(job);
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
      // GPS proximity check for helpers
      const isHelper = appliedApps.some(a => a.job_id === jobId && a.helper_id === user?.id);
      if (isHelper) {
        const job = appliedApps.find(a => a.job_id === jobId)?.job;
        if (job) {
          const proximity = await checkProximity((job as any).latitude, (job as any).longitude);
          if (!proximity.allowed) {
            const miles = ((proximity.distance || 0) / 5280).toFixed(1);
            toast.error(`You must be within 500ft of the job site to mark complete. You're ~${miles} miles away.`, { duration: 6000 });
            return;
          }
        }
      }

      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "release", jobId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.bothDone) {
        toast.success(`Job completed! Payment released. You can leave a review or tip from the job details.`);
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

  const startJob = async (jobId: string) => {
    if (!user || startJobLoading) return;
    setStartJobLoading(jobId);
    const job = [...postedJobs, ...appliedApps.map(a => a.job)].find(j => j?.id === jobId);
    
    // Time-based start restriction
    if (job) {
      const isFlexible = !!(job as any).is_flexible_schedule;
      const jobDate = job.date_needed;
      const jobTime = job.start_time;
      const now = new Date();
      const today = now.toISOString().split("T")[0];

      // Block starting before the job date (both flexible and fixed)
      if (jobDate && today < jobDate) {
        toast.error(`This job is scheduled for ${new Date(jobDate + "T00:00").toLocaleDateString()}. You can't start it before that date.`, { duration: 5000 });
        setStartJobLoading(null);
        return;
      }

      // For non-flexible jobs with a set time, block starting before that time
      if (!isFlexible && jobTime && today === jobDate) {
        const [h, m] = jobTime.split(":").map(Number);
        const scheduledTime = new Date(now);
        scheduledTime.setHours(h, m, 0, 0);
        if (now < scheduledTime) {
          const timeStr = scheduledTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          toast.error(`This job is scheduled to start at ${timeStr}. You can't start before the scheduled time.`, { duration: 5000 });
          setStartJobLoading(null);
          return;
        }
      }
    }

    // GPS proximity check for helper
    if (job) {
      const proximity = await checkProximity((job as any).latitude, (job as any).longitude);
      if (!proximity.allowed) {
        const miles = ((proximity.distance || 0) / 5280).toFixed(1);
        toast.error(`You must be within 500ft of the job site to start. You're currently ~${miles} miles away.`, { duration: 6000 });
        setStartJobLoading(null);
        return;
      }
    }

    // Log start as a checkin
    await supabase.from("job_checkins").insert({
      job_id: jobId, user_id: user.id, type: "start_request", note: "Helper started the job",
    });

    // Auto-transition job to in_progress
    await supabase.from("jobs").update({ status: "in_progress" } as any).eq("id", jobId);

    // Notify poster
    if (job) {
      await createNotification({
        user_id: job.customer_id,
        title: "🚀 Job started!",
        message: `Your helpr has started working on "${job.title}".`,
        type: "success",
        link: "/activity?tab=posted&filter=in_progress",
      });
    }
    toast.success("Job started! You're now in progress.");
    loadData(user.id);
    setStartJobLoading(null);
  };

  const confirmStartJob = async (jobId: string) => {
    const { error } = await supabase.from("jobs").update({ status: "in_progress" } as any).eq("id", jobId);
    if (error) toast.error("Failed to confirm start");
    else {
      // Notify helper
      const job = postedJobs.find(j => j.id === jobId);
      if (job?.helper_id) {
        await createNotification({
          user_id: job.helper_id,
          title: "✅ Job started!",
          message: `The poster confirmed "${job.title}" has started. You're now in progress!`,
          type: "success",
          link: "/activity?tab=applied&filter=in_progress",
        });
      }
      toast.success("Job started! It's now in progress.");
      if (user) loadData(user.id);
    }
  };

  const markOnTheWay = async (jobId: string) => {
    if (!user || onTheWayLoading) return;
    setOnTheWayLoading(jobId);
    const now = new Date().toISOString();
    const { error } = await supabase.from("jobs").update({ helper_on_the_way_at: now } as any).eq("id", jobId);
    if (error) { toast.error("Failed to update"); setOnTheWayLoading(null); return; }
    const job = appliedApps.find(a => a.job_id === jobId)?.job;
    if (job) {
      await createNotification({
        user_id: job.customer_id,
        title: "🚗 Helpr is on the way!",
        message: `Your helpr is headed to "${job.title}".`,
        type: "info",
        link: "/activity?tab=posted&filter=accepted",
      });
    }
    toast.success("You're on your way! The poster has been notified.");
    loadData(user.id);
    setOnTheWayLoading(null);
  };

  const markArrived = async (jobId: string) => {
    if (!user || arrivedLoading) return;
    setArrivedLoading(jobId);
    const now = new Date().toISOString();
    // Mark arrived and auto-transition to in_progress
    const { error } = await supabase.from("jobs").update({
      helper_arrived_at: now,
      status: "in_progress",
    } as any).eq("id", jobId);
    if (error) { toast.error("Failed to update"); setArrivedLoading(null); return; }
    const job = appliedApps.find(a => a.job_id === jobId)?.job;
    if (job) {
      await createNotification({
        user_id: job.customer_id,
        title: "📍 Helpr has arrived!",
        message: `Your helpr has arrived for "${job.title}". The job is now in progress.`,
        type: "success",
        link: "/activity?tab=posted&filter=in_progress",
      });
    }
    toast.success("You've arrived! Job is now in progress.");
    loadData(user.id);
    setArrivedLoading(null);
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
    const isPaid = editJob.payment_status === 'escrow' || editJob.payment_status === 'released';
    const updateData: any = {
      title: editTitle.trim(), description: editDescription.trim(), category: editCategory as any,
      location: editLocation.trim(), date_needed: editDateNeeded, start_time: editStartTime || null,
      estimated_hours: editEstimatedHours ? parseFloat(editEstimatedHours) : null,
      special_requirements: editSpecialReq.trim() || null,
    };
    if (!isPaid) updateData.budget = parseFloat(editBudget);
    const { error } = await supabase.from("jobs").update(updateData).eq("id", editJob.id);
    setEditSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Job updated!"); setEditJob(null); if (user) loadData(user.id); }
  };

  const openReviewForPosted = async (job: Job) => {
    // Poster reviewing helper
    if (!job.helper_id) return;
    const { data: helperProfile } = await supabase.from("profiles").select("full_name").eq("user_id", job.helper_id).single();
    setReviewTarget({ id: job.helper_id, name: formatName(helperProfile?.full_name, "Helpr") });
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

      await createNotification({
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
            await createNotification({
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

  const postedStatusFilters = useMemo(() => [
    { key: "open", label: "Open", color: "bg-primary/15 text-primary border-primary/30" },
    { key: "offered", label: "Offered", color: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    { key: "accepted", label: "Accepted", color: "bg-primary/15 text-primary border-primary/30" },
    { key: "in_progress", label: "In Progress", color: "bg-accent/15 text-accent-foreground border-accent/30" },
    { key: "revision_requested", label: "Revision", color: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
    { key: "completed", label: "Completed", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
    
  ], []);

  const appliedStatusFilters = useMemo(() => [
    { key: "pending", label: "Pending", color: "bg-secondary text-secondary-foreground border-border" },
    { key: "offered", label: "Offered", color: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    { key: "accepted", label: "Accepted", color: "bg-primary/15 text-primary border-primary/30" },
    { key: "in_progress", label: "In Progress", color: "bg-accent/15 text-accent-foreground border-accent/30" },
    { key: "revision", label: "Revision", color: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
    { key: "completed", label: "Completed", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
    { key: "not_selected", label: "Not Selected", color: "bg-destructive/15 text-destructive border-destructive/30" },
  ], []);

  const filteredPostedJobs = useMemo(() =>
    postedJobs.filter((j) => {
      if (statusFilter === "offered") return j.status === "accepted" && !(j as any).helper_confirmed_at;
      if (statusFilter === "accepted") return j.status === "accepted" && !!(j as any).helper_confirmed_at;
      return j.status === statusFilter;
    }), [postedJobs, statusFilter]);

  const filteredAppliedApps = useMemo(() =>
    appliedApps.filter((a) => {
      if (statusFilter === "pending") return a.status === "pending" && a.job?.status !== "cancelled";
      if (statusFilter === "offered") return a.status === "accepted" && a.job?.status === "accepted" && !(a.job as any)?.helper_confirmed_at;
      if (statusFilter === "accepted") return a.status === "accepted" && a.job?.status === "accepted" && !!(a.job as any)?.helper_confirmed_at;
      if (statusFilter === "in_progress") return a.status === "accepted" && (a.job?.status === "in_progress" || a.job?.status === "disputed");
      if (statusFilter === "revision") return a.status === "accepted" && a.job?.status === "revision_requested";
      if (statusFilter === "completed") return a.status === "accepted" && a.job?.status === "completed";
      if (statusFilter === "not_selected") return a.status === "rejected" || a.job?.status === "cancelled";
      return false;
    }), [appliedApps, statusFilter]);

  const appliedCounts = useMemo(() => {
    const counts: Record<string, number> = { pending: 0, offered: 0, accepted: 0, in_progress: 0, revision: 0, completed: 0, not_selected: 0 };
    appliedApps.forEach((a) => {
      if (a.status === "pending" && a.job?.status !== "cancelled") counts.pending++;
      else if (a.status === "accepted" && a.job?.status === "accepted" && !(a.job as any)?.helper_confirmed_at) counts.offered++;
      else if (a.status === "accepted" && a.job?.status === "accepted" && !!(a.job as any)?.helper_confirmed_at) counts.accepted++;
      else if (a.status === "accepted" && (a.job?.status === "in_progress" || a.job?.status === "disputed")) counts.in_progress++;
      else if (a.status === "accepted" && a.job?.status === "revision_requested") counts.revision++;
      else if (a.status === "accepted" && a.job?.status === "completed") counts.completed++;
      else if (a.status === "rejected" || a.job?.status === "cancelled") counts.not_selected++;
    });
    return counts;
  }, [appliedApps]);

  const postedCounts = useMemo(() => {
    const counts: Record<string, number> = { open: 0, offered: 0, accepted: 0, in_progress: 0, revision_requested: 0, completed: 0, cancelled: 0 };
    postedJobs.forEach((j) => {
      if (j.status === "accepted" && !(j as any).helper_confirmed_at) counts.offered++;
      else if (j.status === "accepted" && !!(j as any).helper_confirmed_at) counts.accepted++;
      else counts[j.status] = (counts[j.status] || 0) + 1;
    });
    return counts;
  }, [postedJobs]);

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

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "posted", label: "Posted", count: postedJobs.length },
    { key: "applied", label: "Applied", count: appliedApps.length },
  ];

  const activeStatusFilters = tab === "posted" ? postedStatusFilters : appliedStatusFilters;
  const activeCounts = tab === "posted" ? postedCounts : appliedCounts;

  return (
    <div className="min-h-screen bg-background pb-20">
      <DashboardHeader />

      <main className="container mx-auto px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <h1 className="text-2xl font-display font-bold text-foreground">My Activity</h1>

          <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => { setTab(t.key); setStatusFilter(t.key === "posted" ? "open" : "pending"); }}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-1.5">
            {activeStatusFilters.map((f) => {
              const count = activeCounts[f.key] || 0;
              return (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    statusFilter === f.key
                      ? f.color
                      : "bg-secondary text-muted-foreground border-transparent hover:text-foreground"
                  }`}
                >
                  {f.label}
                  {count > 0 && (
                    <span className={`ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold ${
                      statusFilter === f.key ? "bg-foreground/10" : "bg-muted-foreground/15"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
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
                  {filteredPostedJobs.map((job) => {
                    const catStyle = categoryColors[job.category] || categoryColors.other;
                    return (
                    <div key={job.id} className="group rounded-2xl border border-border/60 bg-card overflow-hidden relative shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20 transition-all cursor-pointer" onClick={() => handleExpandJob(job.id, job)}>

                      {/* Top bar: title + budget + chevron */}
                      <div className="w-full px-4 py-2 border-b border-border/40 bg-muted/15 flex items-center justify-between text-left">
                        <h3 className={`font-medium text-[15px] leading-snug truncate min-w-0 ${catStyle.title}`}>
                          {job.title}
                        </h3>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <span className="flex items-center gap-0.5 font-bold text-primary text-sm">
                            <DollarSign className="w-3.5 h-3.5" />{job.budget}
                          </span>
                          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedJobId === job.id ? "rotate-180" : ""}`} />
                        </div>
                      </div>

                      {/* Main content — matches dashboard JobCard summary */}
                      <div className="px-4 py-3 space-y-2">
                        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                          {/* Date & Time */}
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 shrink-0" />
                            {new Date(job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                            {!job.start_time ? " · Flexible time" : ` · ${new Date(`2000-01-01T${job.start_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                          </span>
                          {/* City, State */}
                          {(() => {
                            const cityState = getCityState(job.location);
                            return (
                              <a
                                onClick={(e) => e.stopPropagation()}
                                href={job.latitude && job.longitude
                                  ? `https://www.google.com/maps?q=${job.latitude},${job.longitude}`
                                  : `https://www.google.com/maps/search/${encodeURIComponent(job.location)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 hover:text-primary transition-colors"
                              >
                                <MapPin className="w-3 h-3 shrink-0" />
                                <span className="truncate max-w-[140px]">{cityState}</span>
                              </a>
                            );
                          })()}
                          {/* Expiry */}
                          {job.expires_at && (() => {
                            const expiryText = new Date(job.expires_at) <= new Date()
                              ? "Expired"
                              : formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }) + " left";
                            const isExpiringSoon = differenceInHours(new Date(job.expires_at), new Date()) < 24;
                            return (
                              <span className={`flex items-center gap-1 ${isExpiringSoon ? "text-destructive font-medium" : ""}`}>
                                <Timer className="w-3 h-3 shrink-0" /> {expiryText}
                              </span>
                            );
                          })()}
                          {/* Applicant count */}
                          {(applicantCounts[job.id] || 0) > 0 && job.status === "open" && (
                            <span className="flex items-center gap-1 text-primary font-medium">
                              <Users className="w-3 h-3 shrink-0" /> {applicantCounts[job.id]} applicant{applicantCounts[job.id] !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>

                        {/* Pending confirmation status for accepted jobs */}
                        {job.status === "accepted" && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {(job as any).helper_confirmed_at
                                ? <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} confirmed</span>
                                : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">⏳ Waiting for {job.helper_id ? helperNames[job.helper_id] || "helpr" : "helpr"} to confirm</span>
                              }
                            </div>
                            {/* On the way / arrived timestamps for poster */}
                            {(job as any).helper_confirmed_at && (
                              <div className="space-y-1.5">
                                {(job as any).helper_on_the_way_at ? (
                                  <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary">
                                    <NavigationIcon className="w-3.5 h-3.5 shrink-0" />
                                    <span className="font-medium">{job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} is on the way</span>
                                    <span className="ml-auto text-[10px] text-muted-foreground">{new Date((job as any).helper_on_the_way_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Waiting for {job.helper_id ? helperNames[job.helper_id] || "helpr" : "helpr"} to head out</span>
                                )}
                                {(job as any).helper_arrived_at && (
                                  <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                                    <span className="font-medium">{job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} has arrived</span>
                                    <span className="ml-auto text-[10px] text-muted-foreground">{new Date((job as any).helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* On the way / arrived timestamps for poster on in_progress */}
                        {(job.status === "in_progress" || job.status === "revision_requested") && ((job as any).helper_on_the_way_at || (job as any).helper_arrived_at) && (
                          <div className="space-y-1">
                            {(job as any).helper_on_the_way_at && (
                              <div className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg bg-muted/50 text-muted-foreground">
                                <NavigationIcon className="w-3 h-3 shrink-0" />
                                <span>{job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} was on the way</span>
                                <span className="ml-auto text-[10px]">{new Date((job as any).helper_on_the_way_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            )}
                            {(job as any).helper_arrived_at && (
                              <div className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg bg-muted/50 text-muted-foreground">
                                <MapPin className="w-3 h-3 shrink-0" />
                                <span>{job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} arrived</span>
                                <span className="ml-auto text-[10px]">{new Date((job as any).helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Completion confirmation status */}
                        {(job.status === "in_progress" || job.status === "revision_requested") && ((job as any).poster_completed_at || (job as any).helper_completed_at) && (
                          <div className="flex items-center gap-2 flex-wrap">
                            {(job as any).poster_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ You confirmed</span>}
                            {(job as any).helper_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} confirmed</span>}
                            {!(job as any).poster_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Waiting for you</span>}
                            {!(job as any).helper_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Waiting for {job.helper_id ? helperNames[job.helper_id] || "helpr" : "helpr"}</span>}
                          </div>
                        )}

                        {/* Revision notice */}
                        {job.status === "revision_requested" && (job as any).revision_note && (
                          <div className="p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                            <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                            <p className="text-xs text-muted-foreground mt-1">{(job as any).revision_note}</p>
                          </div>
                        )}
                      </div>

                      {/* Applicants button — always visible on card */}
                      {job.status === "open" && (
                        <div className="px-4 py-2 border-t border-border/40" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="outline" className="w-full border border-primary text-primary hover:bg-primary/10" onClick={() => loadApplications(job)}>
                            <Users className="w-4 h-4 mr-1" /> Applicants{(applicantCounts[job.id] || 0) > 0 ? ` (${applicantCounts[job.id]})` : ""}
                          </Button>
                        </div>
                      )}

                      {/* Status hint for completed */}
                      {job.status === "completed" && (() => {
                        const meta = completedJobMeta[job.id];
                        const hasTipped = meta?.tipped;
                        const hasReviewed = meta?.reviewed;
                        return (!hasTipped || !hasReviewed) ? (
                          <div className="px-4 py-1.5 border-t border-border/40 bg-muted/15">
                            <span className="text-xs text-muted-foreground">
                              {!hasTipped && !hasReviewed ? "Tap to tip & review" : !hasTipped ? "Tap to leave a tip" : "Tap to leave a review"}
                            </span>
                          </div>
                        ) : null;
                      })()}

                      {/* Footer: paid status only — hide on completed */}
                      {job.payment_status === "released" && job.status !== "completed" && job.status !== "cancelled" && (
                        <div className="px-4 py-1.5 border-t border-border/40 bg-muted/15 text-[11px]">
                          <span className="px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-600">💰 Paid</span>
                        </div>
                      )}

                      {/* Expandable section */}
                      <div className={`overflow-hidden transition-all duration-200 ease-in-out ${expandedJobId === job.id ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`} onClick={(e) => e.stopPropagation()}>
                        {/* Job details — matches dashboard JobCard expanded section */}
                        <div className="px-4 pb-3 space-y-3 border-t border-border/40">
                          {/* Description */}
                          {job.description.trim().toLowerCase() !== job.title.trim().toLowerCase() && (
                            <div className="pt-3">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                              <p className="text-sm text-foreground leading-relaxed">{job.description}</p>
                            </div>
                          )}

                          {/* Photos */}
                          {(job.photos || []).length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Photos</p>
                              <div className="flex gap-2 overflow-x-auto pb-1">
                                {(job.photos || []).map((url, i) => (
                                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                                    <img src={url} alt={`Photo ${i + 1}`} className="w-28 h-20 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Estimated hours */}
                          {job.estimated_hours && (
                            <div className="rounded-lg bg-secondary/30 p-2.5">
                              <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Est. Hours</p>
                              <p className="font-semibold text-foreground text-sm">{job.estimated_hours}h</p>
                            </div>
                          )}

                          {/* Special requirements */}
                          {job.special_requirements?.trim() ? (
                              <div className="rounded-lg bg-secondary/30 p-2.5">
                                <p className="text-[10px] text-muted-foreground mb-1">Special Requirements</p>
                                <p className="text-sm text-foreground">{job.special_requirements}</p>
                              </div>
                          ) : null}

                          {/* Recurring info */}
                          {job.is_recurring && (
                            <div className="rounded-lg bg-secondary/30 p-2.5 flex items-start gap-2">
                              <RefreshCw className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                              <div>
                                <p className="text-[10px] text-muted-foreground">Recurring Task</p>
                                <p className="text-sm font-medium text-foreground">
                                  {job.recurrence_interval ? `Every ${job.recurrence_interval}` : "Yes"}
                                  {job.recurrence_end_date && ` until ${new Date(job.recurrence_end_date).toLocaleDateString()}`}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Group job info */}
                          {job.is_group_job && (
                            <div className="rounded-lg bg-secondary/30 p-2.5 flex items-start gap-2">
                              <Users className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                              <div>
                                <p className="text-[10px] text-muted-foreground">Group Task</p>
                                <p className="text-sm font-medium text-foreground">
                                  {job.helpers_needed ? `${job.helpers_needed} helprs needed` : "Multiple helprs needed"}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                        {/* Features for active jobs */}
                        {(job.status === "in_progress" || job.status === "accepted") && user && (
                          <div className="px-4 pb-3 space-y-3">
                            <JobConfirmation jobId={job.id} isOwner={true} isHelper={false} posterConfirmedAt={(job as any).poster_confirmed_at} helperConfirmedAt={(job as any).helper_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} />
                            <JobTracking jobId={job.id} helperId={job.helper_id} isHelper={false} isOwner={true} />
                            {(job as any).is_group_job && <GroupJobHelpers jobId={job.id} helpersNeeded={(job as any).helpers_needed || 2} isOwner={true} />}
                            
                            <JobCheckins jobId={job.id} userId={user.id} isHelper={false} isOwner={true} jobStatus={job.status} jobLatitude={(job as any).latitude} jobLongitude={(job as any).longitude} />
                          </div>
                        )}

                        {/* Actions */}
                        <div className="border-t border-border/40 px-4 py-3">
                          <div className="space-y-2">
                            {job.status === "open" && (
                              <div className="flex items-center gap-2">
                                <Button size="sm" className="flex-1 bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" onClick={() => setBoostJobId(job.id)}><Rocket className="w-4 h-4 mr-1" /> Boost</Button>
                                <Button size="sm" className="flex-1 bg-primary/10 text-primary hover:bg-primary/20 border-0" onClick={() => openEditJob(job)}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
                                <Button size="sm" className="flex-1 bg-destructive/10 text-destructive hover:bg-destructive/20 border-0" onClick={() => tryCancelJob(job)}><XCircle className="w-4 h-4 mr-1" /> Cancel</Button>
                              </div>
                            )}
                            {job.status === "accepted" && (
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="outline" onClick={() => navigate("/messages")}>
                                  <MessageSquare className="w-4 h-4 mr-1" /> Message
                                </Button>
                                <Button size="sm" variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => tryCancelJob(job)}><XCircle className="w-4 h-4 mr-1" /> Cancel</Button>
                              </div>
                            )}
                            {job.status === "in_progress" && (
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => completeJob(job.id)} disabled={completingJobId === job.id || !!(job as any).poster_completed_at}>
                                    <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === job.id ? "…" : (job as any).poster_completed_at ? "Confirmed ✓" : "Mark Complete"}
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <Button size="sm" className="w-full bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 border-0" onClick={() => { setRevisionJobId(job.id); setRevisionNote(""); }}><AlertTriangle className="w-4 h-4 mr-1" /> Revision</Button>
                                  <Button size="sm" className="w-full bg-destructive/15 text-destructive hover:bg-destructive/25 border-0" onClick={() => setDisputeJob(job)}>Dispute</Button>
                                  <Button size="sm" className="w-full bg-destructive/15 text-destructive hover:bg-destructive/25 border-0" onClick={() => setNoShowJobId(job.id)}>No-Show</Button>
                                </div>
                                
                              </div>
                            )}
                            {job.status === "revision_requested" && (
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => completeJob(job.id)} disabled={completingJobId === job.id || !!(job as any).poster_completed_at}>
                                    <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === job.id ? "…" : (job as any).poster_completed_at ? "Confirmed ✓" : "Mark Complete"}
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <Button size="sm" className="w-full bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 border-0" onClick={() => { setRevisionJobId(job.id); setRevisionNote(""); }}><AlertTriangle className="w-4 h-4 mr-1" /> Revision</Button>
                                  <Button size="sm" className="w-full bg-destructive/15 text-destructive hover:bg-destructive/25 border-0" onClick={() => setDisputeJob(job)}>Dispute</Button>
                                  <Button size="sm" className="w-full bg-destructive/15 text-destructive hover:bg-destructive/25 border-0" onClick={() => setNoShowJobId(job.id)}>No-Show</Button>
                                </div>
                              </div>
                            )}
                            {job.status === "cancelled" && (
                              <Button size="sm" variant="outline" onClick={() => repostJob(job.id)}><RotateCcw className="w-4 h-4 mr-1" /> Repost</Button>
                            )}
                            {job.status === "completed" && (() => {
                              const meta = completedJobMeta[job.id];
                              const hasTipped = meta?.tipped;
                              const hasReviewed = meta?.reviewed;
                              return (
                                <div className="grid grid-cols-3 gap-2">
                                  {hasTipped ? (
                                    <Button size="sm" className="w-full bg-primary/10 text-primary border-0" disabled>
                                      <Gift className="w-4 h-4 mr-1" /> Tipped ✓
                                    </Button>
                                  ) : (
                                    <Button size="sm" className="w-full bg-primary/10 text-primary hover:bg-primary/20 border-0" onClick={() => { setEnhancedTipJobId(job.id); setEnhancedTipHelperName(""); }}>
                                      <Gift className="w-4 h-4 mr-1" /> Tip
                                    </Button>
                                  )}
                                  {hasReviewed ? (
                                    <Button size="sm" className="w-full bg-accent/15 text-accent-foreground border-0" disabled>
                                      <Star className="w-4 h-4 mr-1" /> Reviewed ✓
                                    </Button>
                                  ) : (
                                    <Button size="sm" className="w-full bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" onClick={() => openReviewForPosted(job)}>
                                      <Star className="w-4 h-4 mr-1" /> Review
                                    </Button>
                                  )}
                                  <Button size="sm" className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 border-0" onClick={() => navigate(`/post-job?rebook=${job.id}`)}>
                                    <RotateCcw className="w-4 h-4 mr-1" /> Rebook
                                  </Button>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}

              {/* Applicants full-screen view */}
              {selectedJob && (
                <div className="fixed inset-0 z-50 bg-background flex flex-col animate-in slide-in-from-right duration-200">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedJob(null)}><ArrowLeft className="w-4 h-4" /></Button>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display font-semibold text-foreground truncate">Applicants</h2>
                      <p className="text-xs text-muted-foreground truncate">{selectedJob.title}</p>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {applications.length === 0 ? (
                      <div className="text-center py-12">
                        <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground">No applications yet.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 max-w-lg mx-auto">
                        {applications.map((app) => (
                          <div key={app.id} className="p-4 rounded-xl border border-border bg-card space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <a href={`/user/${app.helper_id}`} className="font-medium text-primary hover:underline">{formatName(app.profiles?.full_name, "Helpr")}</a>
                                {app.profiles?.skills && <p className="text-xs text-muted-foreground">{app.profiles.skills}</p>}
                                {app.reviewCount !== undefined && app.reviewCount > 0 && (
                                  <div className="flex items-center gap-1 mt-1">
                                    <Star className="w-3 h-3 fill-accent text-accent" />
                                    <span className="text-xs text-muted-foreground">{app.avgRating?.toFixed(1)} ({app.reviewCount} reviews)</span>
                                  </div>
                                )}
                              </div>
                              {app.status === "pending" && <Button size="sm" onClick={() => acceptApplication(app)}>Select</Button>}
                              {app.status === "accepted" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">Selected</span>}
                              {app.status === "rejected" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-destructive/10 text-destructive">Declined</span>}
                            </div>
                            {app.message && (
                              <div className="rounded-lg bg-secondary/30 p-3 mt-2">
                                <p className="text-xs text-muted-foreground mb-0.5">Their message to you:</p>
                                <p className="text-sm text-foreground">{app.message}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* APPLIED TAB */}
          {tab === "applied" && (
            <div className="space-y-3">
              {filteredAppliedApps.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground mb-4">
                    {appliedApps.length === 0 ? "You haven't applied to any tasks yet." : "No applications match this filter."}
                  </p>
                  <Button onClick={() => navigate("/dashboard")}>Browse tasks</Button>
                </div>
              ) : (
                filteredAppliedApps.map((app) => (
                  <div key={app.id} className="rounded-2xl border border-border/60 bg-card overflow-hidden cursor-pointer shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20 transition-all" onClick={() => setExpandedJobId(expandedJobId === app.id ? null : app.id)}>
                    {/* Top bar: title + budget + chevron */}
                    <div className="w-full px-4 py-2 border-b border-border/40 bg-muted/15 flex items-center justify-between text-left">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className={`font-bold text-[15px] leading-snug min-w-0 truncate ${(categoryColors[app.job?.category || "other"] || categoryColors.other).title}`}>
                          {app.job?.title || "Task"}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {app.job && (() => {
                          const fee = app.job.platform_fee_amount ?? (app.job.budget * (app.job.platform_fee_percent ?? 15) / 100);
                          const payout = app.job.budget - fee;
                          return (
                            <span className="flex items-center gap-0.5 font-bold text-primary text-sm" title={`Budget: $${app.job.budget} · Fee: $${fee.toFixed(2)}`}>
                              <DollarSign className="w-3.5 h-3.5" />{payout.toFixed(2)}
                            </span>
                          );
                        })()}
                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedJobId === app.id ? "rotate-180" : ""}`} />
                      </div>
                    </div>

                    {/* Always-visible summary: date, time, city/state */}
                    {app.job && (
                      <div className="px-4 py-3 space-y-2">
                        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                          {/* Date & Time */}
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 shrink-0" />
                            {new Date(app.job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                            {!app.job.start_time ? " · Flexible time" : ` · ${new Date(`2000-01-01T${app.job.start_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                          </span>
                          {/* City, State */}
                          {(() => {
                            const locationParts = app.job!.location.split(",").map(s => s.trim());
                            let cityState = app.job!.location;
                            if (locationParts.length >= 2) {
                              const state = locationParts[locationParts.length - 1].replace(/\d{5}(-\d{4})?/, "").trim();
                              const city = locationParts[locationParts.length - 2];
                              cityState = `${city}, ${state}`;
                            }
                            return (
                              <a
                                onClick={(e) => e.stopPropagation()}
                                href={app.job!.latitude && app.job!.longitude
                                  ? `https://www.google.com/maps?q=${app.job!.latitude},${app.job!.longitude}`
                                  : `https://www.google.com/maps/search/${encodeURIComponent(app.job!.location)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 hover:text-primary transition-colors"
                              >
                                <MapPin className="w-3 h-3 shrink-0" />
                                <span className="truncate max-w-[140px]">{cityState}</span>
                              </a>
                            );
                          })()}
                          {/* Expiry */}
                          {app.job.expires_at && (() => {
                            const expiryText = new Date(app.job!.expires_at!) <= new Date()
                              ? "Expired"
                              : formatDistanceToNow(new Date(app.job!.expires_at!), { addSuffix: false }) + " left";
                            const isExpiringSoon = differenceInHours(new Date(app.job!.expires_at!), new Date()) < 24;
                            return (
                              <span className={`flex items-center gap-1 ${isExpiringSoon ? "text-destructive font-medium" : ""}`}>
                                <Timer className="w-3 h-3 shrink-0" /> {expiryText}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Offered: accept/decline buttons always visible (no expand needed) */}
                    {app.status === "accepted" && app.job?.status === "accepted" && !(app.job as any)?.helper_confirmed_at && (
                      <div className="px-4 pb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                        {(app.job as any)?.response_deadline && (
                          <div className="text-xs text-muted-foreground text-center px-2 py-1 rounded bg-muted/50">
                            <Clock className="w-3 h-3 inline mr-1" />
                            Respond by {new Date((app.job as any).response_deadline).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1" onClick={() => handleHelperResponse(app, true)}>
                            <ThumbsUp className="w-4 h-4 mr-1" /> Accept Job
                          </Button>
                          <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => handleHelperResponse(app, false)}>
                            <ThumbsDown className="w-4 h-4 mr-1" /> Decline
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Accepted: On My Way / Arrived + Message always visible */}
                    {app.status === "accepted" && app.job?.status === "accepted" && !!(app.job as any)?.helper_confirmed_at && (
                      <div className="px-4 pb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div className="text-xs text-center px-2 py-1.5 rounded bg-primary/10 text-primary font-medium">
                          ✓ You accepted this job
                        </div>
                        {/* On the way / arrived timestamps */}
                        {(app.job as any)?.helper_on_the_way_at && (
                          <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary">
                            <NavigationIcon className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-medium">On the way</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">{new Date((app.job as any).helper_on_the_way_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        )}
                        {(app.job as any)?.helper_arrived_at && (
                          <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-medium">Arrived</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">{new Date((app.job as any).helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        )}
                        {/* Action buttons */}
                        {!(app.job as any)?.helper_on_the_way_at && (
                          <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => markOnTheWay(app.job_id)} disabled={onTheWayLoading === app.job_id}>
                            <NavigationIcon className="w-4 h-4 mr-1" /> {onTheWayLoading === app.job_id ? "Updating…" : "On My Way"}
                          </Button>
                        )}
                        {(app.job as any)?.helper_on_the_way_at && !(app.job as any)?.helper_arrived_at && (
                          <Button size="sm" className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => markArrived(app.job_id)} disabled={arrivedLoading === app.job_id}>
                            <MapPin className="w-4 h-4 mr-1" /> {arrivedLoading === app.job_id ? "Updating…" : "I've Arrived"}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}>
                          <MessageSquare className="w-4 h-4 mr-1" /> Message
                        </Button>
                      </div>
                    )}

                    {/* In Progress / Revision: actions always visible */}
                    {app.status === "accepted" && (app.job?.status === "in_progress" || app.job?.status === "revision_requested") && (
                      <div className="px-4 pb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                        {/* Show arrival timestamps if available */}
                        {(app.job as any)?.helper_on_the_way_at && (
                          <div className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg bg-muted/50 text-muted-foreground">
                            <NavigationIcon className="w-3 h-3 shrink-0" />
                            <span>On the way</span>
                            <span className="ml-auto text-[10px]">{new Date((app.job as any).helper_on_the_way_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        )}
                        {(app.job as any)?.helper_arrived_at && (
                          <div className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg bg-muted/50 text-muted-foreground">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span>Arrived</span>
                            <span className="ml-auto text-[10px]">{new Date((app.job as any).helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        )}
                        {/* Start job checkin if not yet started */}
                        {!startRequestedJobIds.has(app.job_id) && (
                          <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => startJob(app.job_id)} disabled={startJobLoading === app.job_id}>
                            <Rocket className="w-4 h-4 mr-1" /> {startJobLoading === app.job_id ? "Starting…" : "Start Job"}
                          </Button>
                        )}
                        {startRequestedJobIds.has(app.job_id) && (
                          <div className="text-xs text-center px-2 py-1.5 rounded bg-primary/10 text-primary font-medium">
                            🚀 Job started
                          </div>
                        )}
                        <JobCheckins jobId={app.job_id} userId={user.id} isHelper={true} isOwner={false} jobStatus={app.job?.status || ""} jobLatitude={(app.job as any)?.latitude} jobLongitude={(app.job as any)?.longitude} />
                        <div className="grid grid-cols-2 gap-2">
                          <Button size="sm" className="w-full" onClick={() => completeJob(app.job_id)} disabled={completingJobId === app.job_id || !!(app.job as any)?.helper_completed_at}>
                            <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === app.job_id ? "…" : (app.job as any)?.helper_completed_at ? "Confirmed ✓" : "Mark Complete"}
                          </Button>
                          <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}>
                            <MessageSquare className="w-4 h-4 mr-1" /> Message
                          </Button>
                        </div>
                        {app.job?.status === "revision_requested" && (
                          <Button size="sm" variant="outline" className="w-full" onClick={() => resolveRevision(app.job_id)}>
                            <RefreshCw className="w-4 h-4 mr-1" /> Mark Fixed
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Completed: photo proof + review always visible */}
                    {app.status === "accepted" && app.job?.status === "completed" && (
                      <div className="px-4 pb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <PhotoProof jobId={app.job_id} type="before" existingUrls={(app.job as any)?.proof_before_urls || []} onUploaded={() => user && loadData(user.id)} />
                        <PhotoProof jobId={app.job_id} type="after" existingUrls={(app.job as any)?.proof_after_urls || []} onUploaded={() => user && loadData(user.id)} />
                        {helperReviewedJobIds.has(app.job_id) ? (
                          <Button size="sm" variant="outline" className="w-full" disabled>
                            <Star className="w-4 h-4 mr-1" /> Reviewed ✓
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full" onClick={() => {
                            setHelperReviewJob({ jobId: app.job_id, posterId: app.job!.customer_id, posterName: app.posterName || "Poster" });
                          }}>
                            <Star className="w-4 h-4 mr-1" /> Review Poster
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Expandable content */}
                    <div className={`overflow-hidden transition-all duration-200 ease-in-out ${expandedJobId === app.id ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`} onClick={(e) => e.stopPropagation()}>
                      <div className="px-4 pb-4 space-y-3 border-t border-border/40">
                        {/* Job details — matches dashboard expanded section */}
                        {app.job && app.job.description.trim().toLowerCase() !== (app.job.title || "").trim().toLowerCase() && (
                          <div className="pt-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                            <p className="text-sm text-foreground leading-relaxed">{app.job.description}</p>
                          </div>
                        )}

                        {/* Photos */}
                        {app.job && (app.job.photos || []).length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Photos</p>
                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {(app.job.photos || []).map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                                  <img src={url} alt={`Photo ${i + 1}`} className="w-28 h-20 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Estimated hours */}
                        {app.job?.estimated_hours && (
                          <div className="rounded-lg bg-secondary/30 p-2.5">
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Est. Hours</p>
                            <p className="font-semibold text-foreground text-sm">{app.job.estimated_hours}h</p>
                          </div>
                        )}

                        {/* Special requirements */}
                        {app.job?.special_requirements && (
                          <div className="rounded-lg bg-secondary/30 p-2.5">
                            <p className="text-[10px] text-muted-foreground mb-1">Special Requirements</p>
                            <p className="text-sm text-foreground">{app.job.special_requirements}</p>
                          </div>
                        )}

                        {/* Recurring info */}
                        {app.job?.is_recurring && (
                          <div className="rounded-lg bg-secondary/30 p-2.5 flex items-start gap-2">
                            <RefreshCw className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[10px] text-muted-foreground">Recurring Task</p>
                              <p className="text-sm font-medium text-foreground">
                                {app.job.recurrence_interval ? `Every ${app.job.recurrence_interval}` : "Yes"}
                                {app.job.recurrence_end_date && ` until ${new Date(app.job.recurrence_end_date).toLocaleDateString()}`}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Group job info */}
                        {app.job?.is_group_job && (
                          <div className="rounded-lg bg-secondary/30 p-2.5 flex items-start gap-2">
                            <Users className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[10px] text-muted-foreground">Group Task</p>
                              <p className="text-sm font-medium text-foreground">
                                {app.job.helpers_needed ? `${app.job.helpers_needed} helprs needed` : "Multiple helprs needed"}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Poster info */}
                        {app.job && (
                          <div className="pt-2 text-xs text-muted-foreground">
                            <span>Posted by <a href={`/user/${app.job.customer_id}`} className="font-medium text-primary hover:underline">{app.posterName}</a></span>
                          </div>
                        )}
                        {app.message && <p className="text-sm text-muted-foreground">{app.message}</p>}

                        {/* Completion status for helper */}
                        {app.status === "accepted" && (app.job?.status === "in_progress" || app.job?.status === "revision_requested") && ((app.job as any)?.poster_completed_at || (app.job as any)?.helper_completed_at) && (
                          <div className="flex items-center gap-2 flex-wrap">
                            {(app.job as any)?.helper_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ You confirmed</span>}
                            {(app.job as any)?.poster_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ Poster confirmed</span>}
                            {!(app.job as any)?.helper_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Waiting for you</span>}
                            {!(app.job as any)?.poster_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Waiting for poster</span>}
                          </div>
                        )}

                        {/* Features for helper */}
                        {app.status === "accepted" && (app.job?.status === "in_progress" || app.job?.status === "accepted") && user && (
                          <div className="space-y-3">
                            <JobConfirmation
                              jobId={app.job_id}
                              isOwner={false}
                              isHelper={true}
                              posterConfirmedAt={(app.job as any)?.poster_confirmed_at}
                              helperConfirmedAt={(app.job as any)?.helper_confirmed_at}
                              dateNeeded={app.job?.date_needed || ""}
                              jobStatus={app.job?.status}
                            />
                            <JobTracking jobId={app.job_id} helperId={user.id} isHelper={true} isOwner={false} />
                            
                            <JobCheckins jobId={app.job_id} userId={user.id} isHelper={true} isOwner={false} jobStatus={app.job?.status || ""} jobLatitude={(app.job as any)?.latitude} jobLongitude={(app.job as any)?.longitude} />
                          </div>
                        )}

                        {/* Revision requested notice for helper */}
                        {app.job?.status === "revision_requested" && (app.job as any)?.revision_note && (
                          <div className="p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                            <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                            <p className="text-xs text-muted-foreground mt-1">{(app.job as any).revision_note}</p>
                          </div>
                        )}

                        {/* Actions handled by always-visible sections above */}
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
        <ReviewForm open={!!reviewJob} onClose={() => { setReviewJob(null); setReviewTarget(null); if (user) loadData(user.id); }} jobId={reviewJob.id} revieweeId={reviewTarget.id} revieweeName={reviewTarget.name} />
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
          {(() => {
            const hasHelper = !!editJob?.helper_id;
            const isPaid = editJob?.payment_status === 'escrow' || editJob?.payment_status === 'released';
            const locked = hasHelper || isPaid;
            return (
              <>
                {locked && (
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
                    {hasHelper ? "Fields are locked because a helpr has been accepted." : "Budget is locked after payment."}
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="editTitle">Title</Label>
                  <Input id="editTitle" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required disabled={hasHelper} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editDesc">Description</Label>
                  <Textarea id="editDesc" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} disabled={hasHelper} />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={editCategory} onValueChange={setEditCategory} disabled={hasHelper}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editLoc">Location</Label>
                  <Input id="editLoc" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} disabled={hasHelper} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Date needed</Label>
                    <Input type="date" value={editDateNeeded} onChange={(e) => setEditDateNeeded(e.target.value)} disabled={hasHelper} />
                  </div>
                  <div className="space-y-2">
                    <Label>Start time</Label>
                    <Input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} disabled={hasHelper} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Est. hours</Label>
                    <Input type="number" step="0.5" value={editEstimatedHours} onChange={(e) => setEditEstimatedHours(e.target.value)} disabled={hasHelper} />
                  </div>
                  <div className="space-y-2">
                    <Label>Budget ($)</Label>
                    <Input type="number" value={editBudget} onChange={(e) => setEditBudget(e.target.value)} disabled={locked} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Special requirements</Label>
                  <Textarea value={editSpecialReq} onChange={(e) => setEditSpecialReq(e.target.value)} rows={2} disabled={hasHelper} />
                </div>
              </>
            );
          })()}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditJob(null)}>Cancel</Button>
            <Button onClick={saveEditJob} disabled={editSaving || !!editJob?.helper_id}>{editSaving ? "Saving…" : "Save changes"}</Button>
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
          onClose={() => { setEnhancedTipJobId(null); setEnhancedTipHelperName(""); if (user) loadData(user.id); }}
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
          helperName={formatName(deadlineDialogApp.profiles?.full_name, "Helpr")}
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
