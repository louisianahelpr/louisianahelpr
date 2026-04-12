import { useEffect, useState, useMemo, useCallback } from "react";
import { useStripeConnectCheck } from "@/hooks/useStripeConnectCheck";
import { formatName } from "@/lib/utils";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { checkProximity } from "@/lib/locationUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ActivityCardSkeleton } from "@/components/SkeletonLoaders";
import { Search } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useActivityData } from "@/hooks/useActivityData";
import { ActivityDialogs } from "@/components/activity/ActivityDialogs";
import { PostedJobsTab } from "@/components/activity/PostedJobsTab";
import { AppliedJobsTab } from "@/components/activity/AppliedJobsTab";
import {
  type Job, type Application, type Tab, type EnrichedApplication,
  categoryLabels, categories, categoryColors, statusBadge,
} from "@/components/activity/activityConstants";

const Activity = ({ defaultTab = "posted" }: { defaultTab?: "posted" | "applied" }) => {
  usePageTitle(defaultTab === "posted" ? "My Posts — Helpr" : "My Jobs — Helpr");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useCurrentUser();
  const [searchQuery, setSearchQuery] = useState("");
  const tab = defaultTab as Tab;
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const paramFilter = searchParams.get("filter");
    if (paramFilter) return paramFilter;
    return defaultTab === "applied" ? "pending" : "open";
  });

  const {
    loading, postedJobs, appliedApps, applicantCounts,
    startRequestedJobIds, helperNames, completedJobMeta,
    declinedJobIds, helperReviewedJobIds, refresh,
  } = useActivityData(user);

  // UI state
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [completingJobId, setCompletingJobId] = useState<string | null>(null);
  const [onTheWayLoading, setOnTheWayLoading] = useState<string | null>(null);
  const [arrivedLoading, setArrivedLoading] = useState<string | null>(null);
  const [startJobLoading, setStartJobLoading] = useState<string | null>(null);
  const [reportingNoShow, setReportingNoShow] = useState(false);

  // Dialog state
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<EnrichedApplication[]>([]);
  const [inlineApplicants, setInlineApplicants] = useState<Record<string, EnrichedApplication[]>>({});
  const [loadingApplicants, setLoadingApplicants] = useState<Record<string, boolean>>({});
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [boostJobId, setBoostJobId] = useState<string | null>(null);
  const [enhancedTipJobId, setEnhancedTipJobId] = useState<string | null>(null);
  const [enhancedTipHelperName, setEnhancedTipHelperName] = useState("");
  const [noShowJobId, setNoShowJobId] = useState<string | null>(null);
  const [cancelDialogJob, setCancelDialogJob] = useState<Job | null>(null);
  const [revisionJobId, setRevisionJobId] = useState<string | null>(null);
  const [deadlineDialogApp, setDeadlineDialogApp] = useState<(Application & { profiles?: any }) | null>(null);
  const [completionPromptJob, setCompletionPromptJob] = useState<{ job: Job; revieweeId: string; revieweeName: string } | null>(null);
  const [disputeJob, setDisputeJob] = useState<Job | null>(null);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; name: string } | null>(null);
  const [helperReviewJob, setHelperReviewJob] = useState<{ jobId: string; posterId: string; posterName: string } | null>(null);

  const { checkHelperStripeConnect, checking: checkingStripe } = useStripeConnectCheck();

  // --- Action handlers ---

  const fetchApplicants = async (jobId: string): Promise<EnrichedApplication[]> => {
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
      const enriched = apps.map((app) => {
        const prof = profilesRes.data?.find((p) => p.user_id === app.helper_id) || null;
        const ratings = reviewMap.get(app.helper_id) || [];
        return { ...app, profiles: prof, reviewCount: ratings.length, avgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0 };
      });
      // Boosted Visibility: Pro/Elite helpers appear first in applicant lists
      const tierOrder = (tier: string | null | undefined) => tier === "elite" ? 3 : tier === "pro" ? 2 : tier === "basic" ? 1 : 0;
      enriched.sort((a, b) => tierOrder(a.profiles?.subscription_tier) - tierOrder(b.profiles?.subscription_tier));
      enriched.reverse();
      return enriched;
    }
    return [];
  };

  const loadApplications = async (job: Job) => {
    setSelectedJob(job);
    const enriched = await fetchApplicants(job.id);
    setApplications(enriched);
  };

  const loadInlineApplicants = async (jobId: string) => {
    if (inlineApplicants[jobId]) return;
    setLoadingApplicants(prev => ({ ...prev, [jobId]: true }));
    const enriched = await fetchApplicants(jobId);
    setInlineApplicants(prev => ({ ...prev, [jobId]: enriched }));
    setLoadingApplicants(prev => ({ ...prev, [jobId]: false }));
  };

  const acceptApplication = async (app: EnrichedApplication) => {
    setDeadlineDialogApp(app);
  };

  const confirmAcceptWithDeadline = async (deadlineHours: number, initialMessage?: string) => {
    if (!deadlineDialogApp || !selectedJob || !user) return;
    const deadline = new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString();
    await supabase.from("applications").update({ status: "accepted" }).eq("id", deadlineDialogApp.id);
    await supabase.from("jobs").update({ status: "accepted", helper_id: deadlineDialogApp.helper_id, response_deadline: deadline } as any).eq("id", selectedJob.id);
    if (initialMessage) {
      await supabase.from("messages").insert({ job_id: selectedJob.id, sender_id: user.id, receiver_id: deadlineDialogApp.helper_id, content: initialMessage });
    }
    await createNotification({ user_id: deadlineDialogApp.helper_id, title: "📋 New job offer!", message: `You've been selected for "${selectedJob.title}". Respond within ${deadlineHours} hour${deadlineHours > 1 ? "s" : ""} or the offer expires.`, type: "info", link: "/activity?tab=applied&filter=offered" });
    toast.success(`Offer sent! Helpr has ${deadlineHours}h to respond.`);
    setDeadlineDialogApp(null);
    setSelectedJob(null);
    setApplications([]);
    setInlineApplicants(prev => { const copy = { ...prev }; delete copy[selectedJob.id]; return copy; });
    refresh();
  };

  const handleHelperResponse = async (app: Application, accept: boolean) => {
    if (!user) return;
    if (accept) {
      const stripeCheck = await checkHelperStripeConnect();
      if (!stripeCheck.ok) { toast.error(stripeCheck.reason); return; }
      await supabase.from("jobs").update({ helper_confirmed_at: new Date().toISOString(), response_deadline: null } as any).eq("id", app.job_id);
      await supabase.from("applications").update({ status: "rejected" }).eq("job_id", app.job_id).neq("id", app.id);
      toast.success("Job accepted! You can start when ready or it will auto-start on the scheduled date.");
      refresh();
    } else {
      const { data: existing } = await supabase.from("user_violations").select("id").eq("user_id", user.id).eq("violation_type", "job_denial");
      const priorCount = existing?.length || 0;
      let actionTaken = "none";
      // Softened: 5 strikes with graduated warnings before ban
      if (priorCount >= 4) actionTaken = "permanent_ban";
      else if (priorCount >= 2) actionTaken = "warning";
      await supabase.from("user_violations").insert({ user_id: user.id, violation_type: "job_denial", description: `Declined job offer: "${(app as any).job?.title || "Unknown"}"`, job_id: app.job_id, action_taken: actionTaken });
      if (actionTaken === "warning") {
        const warningNum = priorCount + 1;
        await supabase.from("profiles").update({ ban_status: "warned" } as any).eq("user_id", user.id);
        await createNotification({ user_id: user.id, title: `⚠️ Decline Warning (${warningNum}/4)`, message: `You've declined ${warningNum} job offer${warningNum > 1 ? "s" : ""}. Declining ${5 - warningNum} more will result in a permanent ban.`, type: "warning", link: "/profile" });
        toast.warning(`Warning ${warningNum}/4: You've declined a job offer.`);
      } else if (actionTaken === "permanent_ban") {
        await supabase.from("user_bans").insert({ user_id: user.id, ban_type: "permanent", reason: "Declined 5 job offers after being selected", banned_by: user.id });
        await supabase.from("profiles").update({ ban_status: "permanently_banned" } as any).eq("user_id", user.id);
        toast.error("Your account has been permanently banned due to repeated job offer declines.");
      }
      if (actionTaken !== "none") {
        const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
        if (adminRoles) {
          for (const admin of adminRoles) {
            await createNotification({ user_id: admin.user_id, title: "⚠️ Helpr declined job offer", message: `Helpr declined offer (${priorCount + 1} total). Action: ${actionTaken}.`, type: "warning", link: "/admin" });
          }
        }
      }
      await supabase.from("applications").update({ status: "rejected" }).eq("id", app.id);
      await supabase.from("jobs").update({ status: "open", helper_id: null, response_deadline: null } as any).eq("id", app.job_id);
      toast.info("You declined the job. The poster can select someone else.");
      refresh();
    }
  };

  const tryCancelJob = async (job: Job) => {
    const { data: tracking } = await supabase.from("job_tracking").select("status").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1);
    const trackingStatus = (tracking as any[])?.[0]?.status;
    if (trackingStatus && ["on_the_way", "arrived", "working", "done"].includes(trackingStatus)) {
      toast.error("This job can't be cancelled — the helpr is already on the way or working.", { duration: 5000 });
      return;
    }
    setCancelDialogJob(job);
  };

  const completeJob = async (jobId: string) => {
    setCompletingJobId(jobId);
    try {
      const isHelper = appliedApps.some(a => a.job_id === jobId && a.helper_id === user?.id);
      if (isHelper) {
        const job = appliedApps.find(a => a.job_id === jobId)?.job;
        if (job) {
          // GPS proximity check with photo fallback
          const proximity = await checkProximity((job as any).latitude, (job as any).longitude);
          if (!proximity.allowed) {
            // Check if helper has a verified arrival check-in (GPS or photo fallback)
            const { data: arrivalCheckins } = await supabase
              .from("job_checkins")
              .select("id")
              .eq("job_id", jobId)
              .eq("user_id", user!.id)
              .in("type", ["arrival", "arrival_photo"])
              .limit(1);

            if (!arrivalCheckins?.length) {
              const miles = ((proximity.distance || 0) / 5280).toFixed(1);
              toast.error(
                `You must be within 500ft of the job site or have a verified arrival check-in. You're ~${miles} miles away. If your GPS is off, use the "Check In with Photo" option.`,
                { duration: 8000 }
              );
              return;
            }
          }

          // Require after-photos for jobs $50+
          if (job.budget >= 50) {
            const { data: jobData } = await supabase
              .from("jobs")
              .select("proof_after_urls")
              .eq("id", jobId)
              .single();
            const afterPhotos = (jobData as any)?.proof_after_urls || [];
            if (afterPhotos.length === 0) {
              toast.error("After-photos are required for jobs $50+. Please upload proof photos before marking complete.", { duration: 6000 });
              return;
            }
          }
        }
      }
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "release", jobId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.bothDone) toast.success("Job completed! Payment released.");
      else toast.success("You've marked this job as complete. Waiting for the other party to confirm.");
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to complete job");
    } finally {
      setCompletingJobId(null);
    }
  };

  const resolveRevision = async (jobId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "resolve_revision", jobId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Revision resolved! Job is back in progress.");
      refresh();
    } catch (err: any) { toast.error(err.message || "Failed to resolve revision"); }
  };

  const startJob = async (jobId: string) => {
    if (!user || startJobLoading) return;
    setStartJobLoading(jobId);
    const job = [...postedJobs, ...appliedApps.map(a => a.job)].find(j => j?.id === jobId);
    if (job) {
      const isFlexible = !!(job as any).is_flexible_schedule;
      const now = new Date();
      const today = now.toISOString().split("T")[0];
      if (job.date_needed && today < job.date_needed) {
        toast.error(`This job is scheduled for ${new Date(job.date_needed + "T00:00").toLocaleDateString()}. You can't start it before that date.`, { duration: 5000 });
        setStartJobLoading(null); return;
      }
      if (!isFlexible && job.start_time && today === job.date_needed) {
        const [h, m] = job.start_time.split(":").map(Number);
        const scheduledTime = new Date(now); scheduledTime.setHours(h, m, 0, 0);
        if (now < scheduledTime) {
          toast.error(`This job is scheduled to start at ${scheduledTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. You can't start before the scheduled time.`, { duration: 5000 });
          setStartJobLoading(null); return;
        }
      }
      const proximity = await checkProximity((job as any).latitude, (job as any).longitude);
      if (!proximity.allowed) {
        const miles = ((proximity.distance || 0) / 5280).toFixed(1);
        toast.error(`You must be within 500ft of the job site to start. You're currently ~${miles} miles away.`, { duration: 6000 });
        setStartJobLoading(null); return;
      }
    }
    await supabase.from("job_checkins").insert({ job_id: jobId, user_id: user.id, type: "start_request", note: "Helper started the job" });
    await supabase.from("jobs").update({ status: "in_progress" } as any).eq("id", jobId);
    if (job) {
      await createNotification({ user_id: job.customer_id, title: "🚀 Job started!", message: `Your helpr has started working on "${job.title}".`, type: "success", link: "/activity?tab=posted&filter=in_progress" });
    }
    toast.success("Job started! You're now in progress.");
    refresh();
    setStartJobLoading(null);
  };

  const confirmStartJob = async (jobId: string) => {
    const { error } = await supabase.from("jobs").update({ status: "in_progress" } as any).eq("id", jobId);
    if (error) toast.error("Failed to confirm start");
    else {
      const job = postedJobs.find(j => j.id === jobId);
      if (job?.helper_id) {
        await createNotification({ user_id: job.helper_id, title: "✅ Job started!", message: `The poster confirmed "${job.title}" has started.`, type: "success", link: "/activity?tab=applied&filter=in_progress" });
      }
      toast.success("Job started! It's now in progress.");
      refresh();
    }
  };

  const confirmArrival = async (jobId: string) => {
    const { error } = await supabase.from("jobs").update({ poster_confirmed_arrival_at: new Date().toISOString() } as any).eq("id", jobId);
    if (error) { toast.error("Failed to confirm arrival"); return; }
    const job = postedJobs.find(j => j.id === jobId);
    if (job?.helper_id) {
      await createNotification({ user_id: job.helper_id, title: "✅ Arrival confirmed", message: `The poster confirmed you've arrived for "${job.title}".`, type: "success", link: "/activity?tab=applied&filter=in_progress" });
    }
    toast.success("Arrival confirmed!");
    refresh();
  };

  const confirmWorking = async (jobId: string) => {
    const { error } = await supabase.from("jobs").update({ poster_confirmed_working_at: new Date().toISOString() } as any).eq("id", jobId);
    if (error) { toast.error("Failed to confirm"); return; }
    const job = postedJobs.find(j => j.id === jobId);
    if (job?.helper_id) {
      await createNotification({ user_id: job.helper_id, title: "✅ Work confirmed", message: `The poster confirmed you're working on "${job.title}".`, type: "success", link: "/activity?tab=applied&filter=in_progress" });
    }
    toast.success("Confirmed helpr is working!");
    refresh();
  };

  const markOnTheWay = async (jobId: string) => {
    if (!user || onTheWayLoading) return;
    setOnTheWayLoading(jobId);
    const { error } = await supabase.from("jobs").update({ helper_on_the_way_at: new Date().toISOString() } as any).eq("id", jobId);
    if (error) { toast.error("Failed to update"); setOnTheWayLoading(null); return; }
    const job = appliedApps.find(a => a.job_id === jobId)?.job;
    if (job) {
      await createNotification({ user_id: job.customer_id, title: "🚗 Helpr is on the way!", message: `Your helpr is headed to "${job.title}".`, type: "info", link: "/activity?tab=posted&filter=accepted" });
    }
    toast.success("You're on your way!");
    refresh();
    setOnTheWayLoading(null);
  };

  const markArrived = async (jobId: string) => {
    if (!user || arrivedLoading) return;
    setArrivedLoading(jobId);
    const { error } = await supabase.from("jobs").update({ helper_arrived_at: new Date().toISOString(), status: "in_progress" } as any).eq("id", jobId);
    if (error) { toast.error("Failed to update"); setArrivedLoading(null); return; }
    const job = appliedApps.find(a => a.job_id === jobId)?.job;
    if (job) {
      await createNotification({ user_id: job.customer_id, title: "📍 Helpr has arrived!", message: `Your helpr has arrived for "${job.title}".`, type: "success", link: "/activity?tab=posted&filter=in_progress" });
    }
    toast.success("You've arrived! Job is now in progress.");
    refresh();
    setArrivedLoading(null);
  };

  const handleNoShow = async (jobId: string) => {
    if (!user) return;
    setReportingNoShow(true);
    try {
      const job = postedJobs.find((j) => j.id === jobId);
      if (!job?.helper_id) return;
      const { data: existing } = await (supabase.from("user_violations" as any) as any).select("id").eq("user_id", job.helper_id).eq("violation_type", "no_show");
      const priorCount = (existing as any[] | null)?.length || 0;
      await (supabase.from("user_violations" as any) as any).insert({ user_id: job.helper_id, violation_type: "no_show", description: `No-show for job: ${job.title}`, job_id: jobId, reported_by: user.id, action_taken: priorCount >= 1 ? "permanent_ban" : "warning" });
      if (priorCount >= 1) {
        await (supabase.from("user_bans" as any) as any).insert({ user_id: job.helper_id, ban_type: "permanent", reason: "Repeated no-show violations", banned_by: user.id });
        await supabase.from("profiles").update({ ban_status: "permanently_banned" } as any).eq("user_id", job.helper_id);
      } else {
        await supabase.from("profiles").update({ ban_status: "warned" } as any).eq("user_id", job.helper_id);
      }
      await createNotification({ user_id: job.helper_id, title: priorCount >= 1 ? "⛔ Account banned for no-show" : "⚠️ No-show warning", message: priorCount >= 1 ? "Your account has been permanently banned for repeated no-shows." : `You received a no-show warning for "${job.title}".`, type: "warning", link: "/profile" });
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRoles) {
        for (const admin of adminRoles) {
          await createNotification({ user_id: admin.user_id, title: "🚫 No-show reported", message: `Helpr no-show for "${job.title}". ${priorCount >= 1 ? "Auto-banned." : "Warning issued."}`, type: "warning", link: "/admin" });
        }
      }
      await supabase.from("jobs").update({ status: "open", helper_id: null }).eq("id", jobId);
      toast.success("No-show reported. Job reopened.");
      refresh();
    } catch (err: any) { toast.error(err.message || "Failed to report no-show"); }
    finally { setReportingNoShow(false); setNoShowJobId(null); }
  };

  const openReviewForPosted = async (job: Job) => {
    if (!job.helper_id) return;
    const { data: helperProfile } = await supabase.from("profiles").select("full_name").eq("user_id", job.helper_id).single();
    setReviewTarget({ id: job.helper_id, name: formatName(helperProfile?.full_name, "Helpr") });
    setReviewJob(job);
  };

  // --- Filters ---
  const postedStatusFilters = useMemo(() => [
    { key: "open", label: "Open", color: "bg-primary/15 text-primary border-primary/30" },
    { key: "offered", label: "Offered", color: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    { key: "accepted", label: "Accepted", color: "bg-primary/15 text-primary border-primary/30" },
    { key: "in_progress", label: "In Progress", color: "bg-accent/15 text-accent-foreground border-accent/30" },
    { key: "revision_requested", label: "Revision", color: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
    { key: "disputed", label: "Disputed", color: "bg-red-500/15 text-red-600 border-red-500/30" },
    { key: "completed", label: "Completed", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
  ], []);

  const appliedStatusFilters = useMemo(() => [
    { key: "pending", label: "Pending", color: "bg-secondary text-secondary-foreground border-border" },
    { key: "offered", label: "Offered", color: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    { key: "accepted", label: "Accepted", color: "bg-primary/15 text-primary border-primary/30" },
    { key: "in_progress", label: "In Progress", color: "bg-accent/15 text-accent-foreground border-accent/30" },
    { key: "revision", label: "Revision", color: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
    { key: "disputed", label: "Disputed", color: "bg-red-500/15 text-red-600 border-red-500/30" },
    { key: "completed", label: "Completed", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
    { key: "not_selected", label: "Not Selected", color: "bg-destructive/15 text-destructive border-destructive/30" },
  ], []);

  const searchLower = searchQuery.toLowerCase().trim();

  const filteredPostedJobs = useMemo(() =>
    postedJobs.filter((j) => {
      // Status filter
      let statusMatch = false;
      if (statusFilter === "offered") statusMatch = j.status === "accepted" && !(j as any).helper_confirmed_at;
      else if (statusFilter === "accepted") statusMatch = j.status === "accepted" && !!(j as any).helper_confirmed_at;
      else statusMatch = j.status === statusFilter;
      if (!statusMatch) return false;
      // Search filter
      if (searchLower) {
        return j.title.toLowerCase().includes(searchLower) || j.description.toLowerCase().includes(searchLower) || j.location.toLowerCase().includes(searchLower);
      }
      return true;
    }), [postedJobs, statusFilter, searchLower]);

  const filteredAppliedApps = useMemo(() => {
    const query = searchLower;
    return appliedApps.filter((a) => {
      let statusMatch = false;
      if (statusFilter === "pending") statusMatch = a.status === "pending" && a.job?.status !== "cancelled";
      else if (statusFilter === "offered") statusMatch = a.status === "accepted" && a.job?.status === "accepted" && !(a.job as any)?.helper_confirmed_at;
      else if (statusFilter === "accepted") statusMatch = a.status === "accepted" && a.job?.status === "accepted" && !!(a.job as any)?.helper_confirmed_at;
      else if (statusFilter === "in_progress") statusMatch = a.status === "accepted" && a.job?.status === "in_progress";
      else if (statusFilter === "disputed") statusMatch = a.status === "accepted" && a.job?.status === "disputed";
      else if (statusFilter === "revision") statusMatch = a.status === "accepted" && a.job?.status === "revision_requested";
      else if (statusFilter === "completed") statusMatch = a.status === "accepted" && a.job?.status === "completed";
      else if (statusFilter === "not_selected") statusMatch = a.status === "rejected" || a.job?.status === "cancelled";
      if (!statusMatch) return false;
      if (query && a.job) {
        return a.job.title.toLowerCase().includes(query) || a.job.description.toLowerCase().includes(query) || a.job.location.toLowerCase().includes(query);
      }
      return true;
    });
  }, [appliedApps, statusFilter, searchLower]);

  const appliedCounts = useMemo(() => {
    const counts: Record<string, number> = { pending: 0, offered: 0, accepted: 0, in_progress: 0, revision: 0, completed: 0, disputed: 0, not_selected: 0 };
    appliedApps.forEach((a) => {
      if (a.status === "pending" && a.job?.status !== "cancelled") counts.pending++;
      else if (a.status === "accepted" && a.job?.status === "accepted" && !(a.job as any)?.helper_confirmed_at) counts.offered++;
      else if (a.status === "accepted" && a.job?.status === "accepted" && !!(a.job as any)?.helper_confirmed_at) counts.accepted++;
      else if (a.status === "accepted" && a.job?.status === "in_progress") counts.in_progress++;
      else if (a.status === "accepted" && a.job?.status === "disputed") counts.disputed++;
      else if (a.status === "accepted" && a.job?.status === "revision_requested") counts.revision++;
      else if (a.status === "accepted" && a.job?.status === "completed") counts.completed++;
      else if (a.status === "rejected" || a.job?.status === "cancelled") counts.not_selected++;
    });
    return counts;
  }, [appliedApps]);

  const postedCounts = useMemo(() => {
    const counts: Record<string, number> = { open: 0, offered: 0, accepted: 0, in_progress: 0, revision_requested: 0, completed: 0, cancelled: 0, disputed: 0 };
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
            {[1, 2, 3, 4].map((i) => <ActivityCardSkeleton key={i} />)}
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

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks by title, description, or location…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>

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
                <button key={f.key} onClick={() => setStatusFilter(f.key)}
                  className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${statusFilter === f.key ? f.color : "bg-secondary text-muted-foreground border-transparent hover:text-foreground"}`}>
                  {f.label}
                  {count > 0 && (
                    <span className={`ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold ${statusFilter === f.key ? "bg-foreground/10" : "bg-muted-foreground/15"}`}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {tab === "posted" && (
            filteredPostedJobs.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-4">{postedJobs.length === 0 ? "You haven't posted any tasks yet." : "No tasks match this filter."}</p>
                {postedJobs.length === 0 && <Button onClick={() => navigate("/post-job")}>Post your first task</Button>}
              </div>
            ) : (
              <PostedJobsTab
                jobs={filteredPostedJobs}
                applicantCounts={applicantCounts}
                expandedJobId={expandedJobId}
                setExpandedJobId={setExpandedJobId}
                helperNames={helperNames}
                completedJobMeta={completedJobMeta}
                startRequestedJobIds={startRequestedJobIds}
                userId={user!.id}
                onBoost={setBoostJobId}
                onEdit={setEditJob}
                onCancel={tryCancelJob}
                onComplete={completeJob}
                completingJobId={completingJobId}
                onRevision={setRevisionJobId}
                onNoShow={setNoShowJobId}
                onTip={(jobId, name) => { setEnhancedTipJobId(jobId); setEnhancedTipHelperName(name); }}
                onReview={openReviewForPosted}
                onDispute={setDisputeJob}
                onConfirmStart={confirmStartJob}
                onConfirmArrival={confirmArrival}
                onConfirmWorking={confirmWorking}
                onLoadApplications={loadApplications}
                selectedJob={selectedJob}
                setSelectedJob={setSelectedJob}
                applications={applications}
                onAcceptApplication={acceptApplication}
                onLoadInlineApplicants={loadInlineApplicants}
                inlineApplicants={inlineApplicants}
                loadingApplicants={loadingApplicants}
              />
            )
          )}

          {tab === "applied" && (
            <AppliedJobsTab
              apps={filteredAppliedApps}
              expandedJobId={expandedJobId}
              setExpandedJobId={setExpandedJobId}
              startRequestedJobIds={startRequestedJobIds}
              helperReviewedJobIds={helperReviewedJobIds}
              userId={user!.id}
              onHelperResponse={handleHelperResponse}
              onMarkOnTheWay={markOnTheWay}
              onTheWayLoading={onTheWayLoading}
              onMarkArrived={markArrived}
              arrivedLoading={arrivedLoading}
              onStartJob={startJob}
              startJobLoading={startJobLoading}
              onComplete={completeJob}
              completingJobId={completingJobId}
              onResolveRevision={resolveRevision}
              onHelperReview={(jobId, posterId, posterName) => setHelperReviewJob({ jobId, posterId, posterName })}
            />
          )}
        </div>
      </main>

      <ActivityDialogs
        user={user ? { id: user.id } : null}
        revisionJobId={revisionJobId}
        setRevisionJobId={setRevisionJobId}
        onRevisionRequested={refresh}
        editJob={editJob}
        setEditJob={setEditJob}
        boostJobId={boostJobId}
        setBoostJobId={setBoostJobId}
        enhancedTipJobId={enhancedTipJobId}
        enhancedTipHelperName={enhancedTipHelperName}
        setEnhancedTipJobId={setEnhancedTipJobId}
        setEnhancedTipHelperName={setEnhancedTipHelperName}
        noShowJobId={noShowJobId}
        setNoShowJobId={setNoShowJobId}
        onNoShow={handleNoShow}
        reportingNoShow={reportingNoShow}
        cancelDialogJob={cancelDialogJob}
        setCancelDialogJob={setCancelDialogJob}
        completionPromptJob={completionPromptJob}
        setCompletionPromptJob={setCompletionPromptJob}
        deadlineDialogApp={deadlineDialogApp}
        setDeadlineDialogApp={setDeadlineDialogApp}
        onDeadlineConfirm={confirmAcceptWithDeadline}
        disputeJob={disputeJob}
        setDisputeJob={setDisputeJob}
        reviewJob={reviewJob}
        reviewTarget={reviewTarget}
        setReviewJob={setReviewJob}
        setReviewTarget={setReviewTarget}
        helperReviewJob={helperReviewJob}
        setHelperReviewJob={setHelperReviewJob}
        onRefresh={refresh}
      />
    </div>
  );
};

export default Activity;
