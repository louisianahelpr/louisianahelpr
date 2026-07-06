import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { checkProximity } from "@/lib/locationUtils";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { fetchProfile } from "@/hooks/useProfile";
import { fireSuccessMoment } from "@/lib/successMoment";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Job, AppliedApp } from "@/components/activity/activityConstants";
import type { OptimisticJobCache } from "./types";

/**
 * Dependencies for the in-progress → completion → review lifecycle handlers,
 * extracted verbatim from useActivityActions. Cache helpers, per-action state
 * setters and the parent data (postedJobs/appliedApps/helperNames/…) are
 * passed in so every handler behaves identically to its in-hook original.
 */
export interface LifecycleHandlersDeps extends OptimisticJobCache {
  user: SupaUser | null;
  postedJobs: Job[];
  appliedApps: AppliedApp[];
  refresh: () => void | Promise<unknown>;
  setStatusFilter: (filter: string) => void;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  setCompletingJobId: (id: string | null) => void;
  setReportingNoShow: (v: boolean) => void;
  setNoShowJobId: (id: string | null) => void;
  setCancelDialogJob: (job: Job | null) => void;
  setCompletionPromptJob: (v: { job: Job; revieweeId: string; revieweeName: string } | null) => void;
  setReviewTarget: (v: { id: string; name: string } | null) => void;
  setReviewJob: (job: Job | null) => void;
  setConfirmingArrivalJobId: (id: string | null) => void;
  setConfirmingWorkingJobId: (id: string | null) => void;
}

export function createLifecycleHandlers(deps: LifecycleHandlersDeps) {
  const {
    user,
    postedJobs,
    appliedApps,
    refresh,
    setStatusFilter,
    helperNames,
    completedJobMeta,
    optimisticallyPatchJob,
    rollbackActivity,
    setCompletingJobId,
    setReportingNoShow,
    setNoShowJobId,
    setCancelDialogJob,
    setCompletionPromptJob,
    setReviewTarget,
    setReviewJob,
    setConfirmingArrivalJobId,
    setConfirmingWorkingJobId,
  } = deps;

  const tryCancelJob = async (job: Job) => {
    const { data: tracking, error: trackingErr } = await supabase.from("job_tracking").select("status").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1);
    // Fail CLOSED: if we can't read the tracking status we cannot prove the
    // Helpr isn't already en route/working, so block the cancel rather than
    // silently letting a false-negative through (the guard is the only thing
    // stopping a poster cancelling a job the Helpr has already started).
    if (trackingErr) {
      report(trackingErr, { tags: { area: "activity", op: "tryCancelJob.trackingRead" }, context: { jobId: job.id } });
      hapticError();
      toast.error("We couldn't check this job's status. Please try again in a moment.", { duration: 5000 });
      return;
    }
    const trackingStatus = tracking?.[0]?.status;
    if (trackingStatus && ["on_the_way", "arrived", "working", "done"].includes(trackingStatus)) {
      hapticError();
      toast.error("This job can't be cancelled — the Helpr is already on the way or working.", { duration: 5000 });
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
          const proximity = await checkProximity(job.latitude, job.longitude);
          if (!proximity.allowed) {
            // Check if helper has a verified arrival check-in (GPS or photo fallback)
            const { data: arrivalCheckins, error: arrivalErr } = await supabase
              .from("job_checkins")
              .select("id")
              .eq("job_id", jobId)
              .eq("user_id", user!.id)
              .in("type", ["arrival", "arrival_photo"])
              .limit(1);
            // Gate fails CLOSED (a read error → no proof of arrival → block),
            // but never silently: surface it so a transient failure that's
            // wrongly blocking a legit completion is traceable.
            if (arrivalErr) {
              report(arrivalErr, { tags: { area: "activity", op: "completeJob.arrivalRead" }, context: { jobId } });
            }

            if (!arrivalCheckins?.length) {
              const miles = ((proximity.distance || 0) / 5280).toFixed(1);
              hapticError();
              toast.error(
                `You need to be within 500ft of the job site (or have a verified arrival check-in) to wrap up. You're about ${miles} miles away — if your GPS is off, use "Check In with Photo" instead.`,
                { duration: 8000 }
              );
              return;
            }
          }

          // Require after-photos for jobs $50+
          if (job.budget >= 50) {
            const { data: jobData, error: proofErr } = await supabase
              .from("jobs")
              .select("proof_after_urls")
              .eq("id", jobId)
              .single();
            // Fails CLOSED (read error → treated as no after-photo → block the
            // $50+ completion), but report it so the failure isn't invisible.
            if (proofErr) {
              report(proofErr, { tags: { area: "activity", op: "completeJob.proofRead" }, context: { jobId } });
            }
            const afterPhotos = jobData?.proof_after_urls || [];
            if (afterPhotos.length === 0) {
              hapticError();
              toast.error("Add an after-photo before you mark a $50+ job complete.", { duration: 6000 });
              return;
            }
          }
        }
      }
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "release", jobId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.bothDone) {
        hapticSuccess();
        // Premium checkmark beat on every completion (self-respects reduced
        // motion). The brand confetti below is the *extra* novelty for the
        // first 3 completions only — the two layers don't conflict (centered
        // check vs. raining particles), so this isn't a double-fire.
        fireSuccessMoment({ label: "Job completed" });
        toast.success("Job completed! Payment released.");
        // Brand-tinted confetti for the first 3 completed jobs — fades to
        // silent after to avoid noise on regulars.
        const { maybeCelebrate } = await import("@/lib/celebrate");
        void maybeCelebrate("first_complete", { particleCount: 120 });
        await refresh();
        setStatusFilter("completed");

        // Tip-after-completion prompt — only for the poster (customer) side.
        // Gate on per-job relationship: the poster is the one who isn't the
        // helper on this job. Also suppress if a tip was already recorded
        // for this job (e.g. tipped earlier via the Tip button on the card).
        const isPoster = !isHelper;
        const alreadyTipped = completedJobMeta[jobId]?.tipped === true;
        if (isPoster && !alreadyTipped) {
          const postedJob = postedJobs.find((j) => j.id === jobId);
          if (postedJob?.helper_id) {
            const helperName = helperNames[postedJob.helper_id] || "your Helpr";
            hapticLight();
            setCompletionPromptJob({
              job: postedJob,
              revieweeId: postedJob.helper_id,
              revieweeName: helperName,
            });
          }
        }

        // Home-autopilot: auto-create/update a maintenance reminder for
        // the poster so they know when to re-book this category of work.
        // Fire-and-forget; PGRST202 (table not deployed) degrades silently.
        if (isPoster && user) {
          (async () => {
            try {
              const postedJob = postedJobs.find((j) => j.id === jobId);
              if (postedJob?.category) {
                const intervalDays: Record<string, number> = {
                  cleaning: 42,
                  yard_work: 14,
                  pet_care: 7,
                  handyman: 180,
                  painting: 365,
                };
                const interval = intervalDays[postedJob.category] ?? 90;
                const today = new Date().toISOString().split("T")[0];
                const nextDate = new Date(Date.now() + interval * 86400_000)
                  .toISOString()
                  .split("T")[0];
                await supabase
                  .from("home_maintenance_reminders")
                  .upsert(
                    {
                      user_id: user.id,
                      category: postedJob.category,
                      last_job_id: jobId,
                      last_completed_date: today,
                      reminder_interval_days: interval,
                      next_reminder_date: nextDate,
                      is_active: true,
                    },
                    { onConflict: "user_id,category" },
                  );
              }
            } catch {
              // Non-fatal — reminder is a nice-to-have
            }
          })();
        }

        // Milestone community posts — fire-and-forget when the helper
        // crosses a job-count threshold (10, 25, 50, 100, 200, 500).
        // Only generated when the helper is the one calling completeJob
        // (isHelper check). Swallows PGRST202 gracefully so this never
        // breaks the flow when the community_posts table isn't on prod yet.
        if (isHelper && user) {
          (async () => {
            try {
              const { count } = await supabase
                .from("jobs")
                .select("id", { count: "exact", head: true })
                .eq("helper_id", user.id)
                .eq("status", "completed");
              const completedCount = (count ?? 0);
              const milestones = [10, 25, 50, 100, 200, 500];
              if (milestones.includes(completedCount)) {
                const helperParish: string | null = null; // parish fetched separately if needed
                await supabase.from("community_posts").insert({
                  author_id: user.id,
                  post_type: "milestone",
                  body: `just completed their ${completedCount}${completedCount === 1 ? "st" : completedCount === 2 ? "nd" : completedCount === 3 ? "rd" : "th"} job on Helpr!`,
                  parish: helperParish,
                  is_approved: true,
                });
              }
            } catch {
              // Non-fatal — milestone post is a nice-to-have
            }
          })();
        }
      } else {
        hapticMedium();
        toast.success("You've marked this job as complete. Waiting for the other party to confirm.");
        await refresh();
      }
    } catch (err) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "We couldn't mark this job complete — please try again.");
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
    } catch (err) { hapticError(); toast.error(err instanceof Error ? err.message : "We couldn't resolve that revision — please try again."); }
  };

  const confirmStartJob = async (jobId: string) => {
    // Optimistic: flip the card to "In Progress" immediately.
    const snapshot = optimisticallyPatchJob(jobId, { status: "in_progress" });
    const { error } = await supabase.from("jobs").update({ status: "in_progress" }).eq("id", jobId);
    if (error) {
      rollbackActivity(snapshot);
      hapticError();
      toast.error("We couldn't start the job just now — please try again.");
    } else {
      const job = postedJobs.find(j => j.id === jobId);
      if (job?.helper_id) {
        await createNotification({ user_id: job.helper_id, title: "✅ Job started!", message: `The poster confirmed "${job.title}" has started.`, type: "success", link: "/my-jobs?filter=in_progress" });
      }
      toast.success("Job started! It's now in progress.");
      await refresh();
      setStatusFilter("in_progress");
    }
  };

  const confirmArrival = async (jobId: string) => {
    setConfirmingArrivalJobId(jobId);
    try {
      // Optimistic: mark arrival confirmed on the card right away.
      const arrivedAt = new Date().toISOString();
      const snapshot = optimisticallyPatchJob(jobId, { poster_confirmed_arrival_at: arrivedAt });
      const { error } = await supabase.from("jobs").update({ poster_confirmed_arrival_at: arrivedAt }).eq("id", jobId);
      if (error) { rollbackActivity(snapshot); hapticError(); toast.error("We couldn't confirm arrival just now — please try again."); return; }
      const job = postedJobs.find(j => j.id === jobId);
      if (job?.helper_id) {
        await createNotification({ user_id: job.helper_id, title: "✅ Arrival confirmed", message: `The poster confirmed you've arrived for "${job.title}".`, type: "success", link: "/my-jobs?filter=in_progress" });
      }
      toast.success("Arrival confirmed!");
      refresh();
    } finally {
      setConfirmingArrivalJobId(null);
    }
  };

  const confirmWorking = async (jobId: string) => {
    setConfirmingWorkingJobId(jobId);
    try {
      // Optimistic: mark "helpr working" confirmed on the card right away.
      const workingAt = new Date().toISOString();
      const snapshot = optimisticallyPatchJob(jobId, { poster_confirmed_working_at: workingAt });
      const { error } = await supabase.from("jobs").update({ poster_confirmed_working_at: workingAt }).eq("id", jobId);
      if (error) { rollbackActivity(snapshot); hapticError(); toast.error("We couldn't confirm that just now — please try again."); return; }
      const job = postedJobs.find(j => j.id === jobId);
      if (job?.helper_id) {
        await createNotification({ user_id: job.helper_id, title: "✅ Work confirmed", message: `The poster confirmed you're working on "${job.title}".`, type: "success", link: "/my-jobs?filter=in_progress" });
      }
      toast.success("Confirmed Helpr is working!");
      refresh();
    } finally {
      setConfirmingWorkingJobId(null);
    }
  };

  const handleNoShow = async (jobId: string) => {
    if (!user) return;
    setReportingNoShow(true);
    try {
      const job = postedJobs.find((j) => j.id === jobId);
      if (!job?.helper_id) return;
      const helperId = job.helper_id;

      // Atomic via the report_helper_no_show RPC (migration
      // 20260518140000): violation, ban escalation and job reopen run
      // in one transaction. Falls back to the pre-migration multi-step
      // path if the RPC isn't deployed to this environment yet.
      let actionTaken = "warning";
      const { data: rpcData, error: rpcError } = await supabase.rpc("report_helper_no_show", {
        p_job_id: jobId,
      });

      if (rpcError) {
        const msg = String(rpcError?.message ?? "");
        const rpcMissing =
          String(rpcError?.code ?? "") === "PGRST202" ||
          /could not find the function|does not exist|schema cache/i.test(msg);
        if (!rpcMissing) { hapticError(); toast.error("Couldn't report the no-show — please try again."); return; }
        // Fail CLOSED on the prior-count read: if we can't read the helper's
        // violation history we cannot correctly compute the ban escalation, so
        // abort rather than defaulting priorCount→0 and letting a repeat
        // offender who should be permanently banned escape with a warning.
        const { data: existing, error: existingErr } = await supabase.from("user_violations").select("id").eq("user_id", helperId).eq("violation_type", "no_show");
        if (existingErr) {
          report(existingErr, { tags: { area: "activity", op: "handleNoShow.priorCountRead" }, context: { jobId, helperId } });
          hapticError();
          toast.error("Couldn't report the no-show — please try again.");
          return;
        }
        const priorCount = existing?.length || 0;
        actionTaken = priorCount >= 1 ? "permanent_ban" : "warning";
        const { error: violationErr } = await supabase.from("user_violations").insert({ user_id: helperId, violation_type: "no_show", description: `No-show for job: ${job.title}`, job_id: jobId, reported_by: user.id, action_taken: actionTaken });
        if (violationErr) {
          report(violationErr, { tags: { area: "activity", op: "handleNoShow.violationInsert" }, context: { jobId, helperId, actionTaken } });
          hapticError();
          toast.error("Couldn't report the no-show — please try again.");
          return;
        }
        if (actionTaken === "permanent_ban") {
          const { error: banErr } = await supabase.from("user_bans").insert({ user_id: helperId, ban_type: "permanent", reason: "Repeated no-show violations", banned_by: user.id });
          const { error: banStatusErr } = await supabase.from("profiles").update({ ban_status: "permanently_banned" }).eq("user_id", helperId);
          if (banErr) report(banErr, { tags: { area: "activity", op: "handleNoShow.banInsert" }, context: { jobId, helperId } });
          if (banStatusErr) report(banStatusErr, { tags: { area: "activity", op: "handleNoShow.banStatusUpdate" }, context: { jobId, helperId } });
        } else {
          const { error: warnErr } = await supabase.from("profiles").update({ ban_status: "final_warning" }).eq("user_id", helperId);
          if (warnErr) report(warnErr, { tags: { area: "activity", op: "handleNoShow.warnStatusUpdate" }, context: { jobId, helperId } });
        }
        const { error: reopenErr } = await supabase.from("jobs").update({ status: "open", helper_id: null }).eq("id", jobId);
        if (reopenErr) report(reopenErr, { tags: { area: "activity", op: "handleNoShow.reopen" }, context: { jobId } });
      } else {
        actionTaken = (rpcData?.action as string) ?? "warning";
      }

      // Notifications (best-effort) — shared by both paths.
      const banned = actionTaken === "permanent_ban";
      await createNotification({ user_id: helperId, title: banned ? "⛔ Account banned for no-show" : "⚠️ No-show warning", message: banned ? "Your account has been permanently banned for repeated no-shows." : `You received a no-show warning for "${job.title}".`, type: "warning", link: "/profile" });
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      for (const admin of adminRoles ?? []) {
        await createNotification({ user_id: admin.user_id, title: "🚫 No-show reported", message: `Helpr no-show for "${job.title}". ${banned ? "Auto-banned." : "Warning issued."}`, type: "warning", link: "/admin" });
      }
      toast.success("No-show reported. Job reopened.");
      refresh();
    } catch (err) { hapticError(); toast.error(err instanceof Error ? err.message : "We couldn't report the no-show just now — please try again."); }
    finally { setReportingNoShow(false); setNoShowJobId(null); }
  };

  const openReviewForPosted = async (job: Job) => {
    if (!job.helper_id) return;
    // Use shared fetchProfile so the read goes through the same code
    // path React Query callers use. Direct supabase.from inline reads
    // fragment caching across the app — see src/hooks/useProfile.ts.
    const helperProfile = await fetchProfile(job.helper_id);
    setReviewTarget({ id: job.helper_id, name: formatName(helperProfile?.full_name, "Helpr") });
    setReviewJob(job);
  };

  return {
    tryCancelJob,
    completeJob,
    resolveRevision,
    confirmStartJob,
    confirmArrival,
    confirmWorking,
    handleNoShow,
    openReviewForPosted,
  };
}
