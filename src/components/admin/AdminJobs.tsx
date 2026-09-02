import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage, isWriteRejected } from "@/lib/mutationResult";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Flag, CheckCircle2, Briefcase } from "lucide-react";
import { logAdminAction } from "@/lib/adminAudit";
import { toast } from "sonner";
import type { Job } from "./adminJobs/types";
import { detectFlags, getResolvedFlags, saveResolvedFlags, isStaleOnly } from "./adminJobs/adminJobsHelpers";
import { AdminViewShell, AdminCard, AdminFilterStrip } from "./AdminViewShell";
import { JobListItem } from "./adminJobs/JobListItem";
import { JobDetailDialog } from "./adminJobs/JobDetailDialog";
import { RemoveJobDialog } from "./adminJobs/RemoveJobDialog";
import { RefundJobDialog } from "./adminJobs/RefundJobDialog";
import { StatusOverrideDialog } from "./adminJobs/StatusOverrideDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireBiometric } from "@/lib/biometricGate";
import { report } from "@/lib/errorLogger";

/**
 * Where an admin notification about a job should land, per RECIPIENT.
 *
 * Two things were wrong at the three call sites below, and neither is visible
 * from the producer side:
 *
 * 1. THE SURFACE WAS THE OTHER PARTY'S. `/my-jobs` is the HELPER surface
 *    (`Activity defaultTab="applied"`, App.tsx:170); the poster's is
 *    `/my-posts` (App.tsx:171). Every notice addressed to
 *    `detailJob.customer_id` — the poster — linked to `/my-jobs`, a screen
 *    built from that user's *applications*, where their own posted job cannot
 *    appear at all. The helper's notices went to `/dashboard` (Browse), which
 *    is not wrong so much as silent: it says nothing about the job that just
 *    changed under them.
 *
 * 2. THE BUCKET WAS THE WRONG ONE. Both Activity routes open on "Needs You"
 *    (`defaultStatusFilterFor`, activityConstants.ts). An admin-removed job is
 *    Cancelled and an override lands in Done/Cancelled/Needs You depending on
 *    the target status — essentially never Needs You. And no fixed `?filter=`
 *    can fix that from here: which bucket a job is in is a question about its
 *    LIVE state ("whose move is it?"), and the answer keeps changing while the
 *    notification sits unread.
 *
 * `?job=<id>` is the one shape that is always right and stays right — the
 * deep-link effect in src/pages/Activity.tsx resolves the live bucket at open
 * time. It is what every other producer in the app was swept onto in
 * 20260831232514_notification_links_land_on_the_right_spot.sql; these two call
 * sites were the last ones still writing a bare surface.
 *
 * The CASE-on-the-recipient is the same fix that migration applied to
 * `block_user_and_settle` (entry 39), which had the identical defect: one
 * hard-coded surface for a notification that can be addressed to either party.
 */
const activityLinkFor = (role: "poster" | "helper", jobId: string): string =>
  role === "poster" ? `/my-posts?job=${jobId}` : `/my-jobs?job=${jobId}`;

/**
 * Insert one admin notification, and refuse to let it fail silently.
 *
 * These inserts used to be a bare `await supabase.from("notifications")
 * .insert({...})` with the result thrown on the floor — the shape CLAUDE.md
 * forbids twice over: the `error` half was dropped, and a null `error` proves
 * nothing on its own. This notification is the ONLY signal the poster and the
 * helpr ever get that an admin removed or re-statused their job; a dropped
 * insert means the job changes under them with no explanation at all.
 *
 * Best-effort by design: the job write has already landed by the time we get
 * here, so a failed notify must not report the admin action as failed (same
 * rule as AdminUsers.unbanUser). It is *surfaced* instead — `unwrapMutation`
 * reports it to error_logs, and the admin gets a toast naming which party was
 * not told, so they can reach out by hand.
 */
const notifyJobParty = async (
  row: { user_id: string; title: string; message: string; type: string; link: string },
  who: "the poster" | "the helpr",
  context: Record<string, unknown>,
): Promise<void> => {
  try {
    // .select("id"): without it `data` comes back null and the row count is
    // unobservable, so unwrapMutation cannot tell a landed write from a no-op.
    unwrapMutation(await supabase.from("notifications").insert(row).select("id"), {
      action: `notify ${who}`,
      rejectedMessage: `That change is saved, but ${who} could not be notified.`,
      context,
    });
  } catch (err) {
    // WriteRejectedError is already reported by unwrapMutation; anything else
    // (transport, RLS, constraint) has not been, so report it here.
    if (!isWriteRejected(err)) {
      report(err, { severity: "error", tags: { source: "AdminJobs.notifyJobParty" }, context });
    }
    toast.error(
      mutationErrorMessage(
        err,
        `That change is saved, but ${who} couldn't be notified — tell them directly.`,
      ),
    );
  }
};

const AdminJobs = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [posterName, setPosterName] = useState("");
  const [helperName, setHelperName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundAmount, setRefundAmount] = useState(""); // empty = full refund; otherwise partial $
  const [refunding, setRefunding] = useState(false);
  // Manual status override — admins can re-open, mark complete, or
  // cancel a job out of band. Tracked separately from the regular
  // remove flow so the audit row captures the new target status.
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<"open" | "completed" | "cancelled">("open");
  const [overrideReason, setOverrideReason] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [filter, setFilter] = useState<"all" | "flagged" | "resolved">("flagged");
  const [jobFlags, setJobFlags] = useState<Map<string, string[]>>(new Map());
  const [resolvedFlags, setResolvedFlags] = useState<Set<string>>(getResolvedFlags());

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("[AdminJobs] load:", error);
        toast.error("Couldn't load jobs — refresh to retry.");
      } else if (data) {
        setJobs(data);
        const flagMap = new Map<string, string[]>();
        for (const job of data) {
          const existingFlags = job.flag_reasons || [];
          const detected = detectFlags(job);
          const allFlags = [...new Set([...existingFlags, ...detected])];
          if (allFlags.length > 0) flagMap.set(job.id, allFlags);
        }
        setJobFlags(flagMap);
      }
      setLoading(false);
    };
    load();
  }, []);

  // Deep-link from the admin user search bar: pasting a UUID jumps here
  // with `?job=<uuid>` and we auto-open that job's detail view once jobs
  // have loaded. The query-string param is stripped so navigating back
  // doesn't re-open it every time.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const target = searchParams.get("job");
    if (!target || jobs.length === 0) return;
    const job = jobs.find((j) => j.id === target);
    if (job) {
      openJob(job);
      const next = new URLSearchParams(searchParams);
      next.delete("job");
      setSearchParams(next, { replace: true });
    }
  }, [jobs, searchParams]);

  const markFlagResolved = (jobId: string) => {
    const next = new Set(resolvedFlags);
    next.add(jobId);
    setResolvedFlags(next);
    saveResolvedFlags(next);
  };

  const reopenFlag = (jobId: string) => {
    const next = new Set(resolvedFlags);
    next.delete(jobId);
    setResolvedFlags(next);
    saveResolvedFlags(next);
  };

  const openJob = async (job: Job) => {
    setDetailJob(job);
    setPosterName("");
    setHelperName("");
    // `customer_id` is nullable since 20260901033011: deleting an account
    // ANONYMISES the job rather than removing it, so the job stands as a
    // financial record with no owner. Null is not an id — it must never reach
    // `map.get`, and an admin should read the truth, not a friendly fallback.
    const posterId = job.customer_id;
    const ids = [posterId, job.helper_id].filter((id): id is string => !!id);
    if (posterId === null) setPosterName("Deleted user");
    if (ids.length > 0) {
      const { data, error } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
      if (error) {
        console.error("[AdminJobs] openJob profiles:", error);
      } else if (data) {
        const map = new Map(data.map((p) => [p.user_id, formatName(p.full_name)]));
        if (posterId) setPosterName(map.get(posterId) || "Unknown");
        if (job.helper_id) setHelperName(map.get(job.helper_id) || "Unknown");
      }
    }
  };

  const handleDelete = async () => {
    if (!detailJob || !deleteReason.trim()) return;
    setDeleting(true);

    try {
      // Soft-delete: mark as cancelled with removal reason
      const { data: { user } } = await supabase.auth.getUser();
      // .select("id"): an admin removal that matches zero rows returns
      // error === null, and both parties used to be notified that a job was
      // removed while it stayed live on the board.
      unwrapMutation(
        await supabase
          .from("jobs")
          .update({
            status: "cancelled",
            cancellation_reason: `[Admin removed] ${deleteReason}`,
            cancelled_at: new Date().toISOString(),
            cancelled_by: user?.id || null,
            removal_reason: deleteReason,
            removed_at: new Date().toISOString(),
            removed_by: user?.id || null,
          })
          .eq("id", detailJob.id)
          .select("id"),
        {
          action: "remove this job",
          rejectedMessage: "This job wasn't removed — it may have already been cancelled. Refresh the list.",
          context: { jobId: detailJob.id },
        },
      );

      // Notify the job poster — on THEIR surface (My Posts), on the job.
      // Guarded on a non-null `customer_id`: since 20260901033011 an account
      // deletion anonymises the job instead of removing it, so a job can
      // outlive its poster. There is nobody to tell, and a notification row
      // written against a null user_id has no recipient at all (same reasoning
      // as AdminReports' `reporter_exists` gate).
      if (detailJob.customer_id) {
        await notifyJobParty(
          {
            user_id: detailJob.customer_id,
            title: "Job removed by admin",
            message: `Your job "${detailJob.title}" was removed. Reason: ${deleteReason}`,
            type: "warning",
            link: activityLinkFor("poster", detailJob.id),
          },
          "the poster",
          { jobId: detailJob.id, adminAction: "remove_job" },
        );
      }

      // Also notify the helper if assigned. This used to land on /dashboard
      // (Browse), which never mentions the job they just lost.
      if (detailJob.helper_id) {
        await notifyJobParty(
          {
            user_id: detailJob.helper_id,
            title: "Job removed by admin",
            message: `The job "${detailJob.title}" you were assigned to was removed by an admin.`,
            type: "warning",
            link: activityLinkFor("helper", detailJob.id),
          },
          "the helpr",
          { jobId: detailJob.id, adminAction: "remove_job" },
        );
      }

      // Update local state
      setJobs((prev) => prev.map((j) => j.id === detailJob.id ? { ...j, status: "cancelled", cancellation_reason: `[Admin removed] ${deleteReason}` } : j));
      setDeleteOpen(false);
      setDeleteReason("");
      setDetailJob(null);
    } catch (err: any) {
      toast.error(mutationErrorMessage(err, "Couldn't remove that job: " + err.message));
    } finally {
      setDeleting(false);
    }
  };

  const handleRefund = async () => {
    if (!detailJob) return;
    // Parse the partial-amount input. Empty/0/NaN → full refund (no
    // amountCents sent). Validation against job total happens server-side.
    const parsedDollars = Number(refundAmount.trim());
    const totalCents = Math.round(Number(detailJob.budget || 0) * 100);
    const partialCents = refundAmount.trim() && parsedDollars > 0
      ? Math.round(parsedDollars * 100)
      : null;
    if (partialCents !== null && partialCents > totalCents) {
      toast.error(`Partial amount $${parsedDollars.toFixed(2)} exceeds job total $${Number(detailJob.budget).toFixed(2)}`);
      return;
    }
    const isPartial = partialCents !== null && partialCents < totalCents;

    // Face ID / Touch ID gate: an admin refund moves real money back out of
    // Stripe and cancels the job. No undo. Runs after the amount validation
    // so a rejected form never raises an OS prompt. No-op on web and on
    // devices without enrolled biometrics (see requireBiometric).
    const ok = await requireBiometric("Confirm this refund");
    if (!ok) return;

    setRefunding(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: {
          action: "admin_refund_general",
          jobId: detailJob.id,
          reason: refundReason.trim() || undefined,
          ...(isPartial ? { amountCents: partialCents } : {}),
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      if (!isPartial) {
        // Full refund cancels the job — reflect locally. Partial refund
        // leaves job state intact server-side, so don't mutate either.
        setJobs((prev) => prev.map((j) => j.id === detailJob.id
          ? { ...j, status: "cancelled" as Job["status"], payment_status: "refunded" as Job["payment_status"] }
          : j));
      }
      setRefundOpen(false);
      setRefundReason("");
      setRefundAmount("");
      setDetailJob(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't issue that refund — try again";
      toast.error(msg);
    } finally {
      setRefunding(false);
    }
  };

  const handleStatusOverride = async () => {
    if (!detailJob || !overrideReason.trim()) return;
    setOverriding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const previousStatus = detailJob.status;
      const updates: Record<string, any> = { status: overrideStatus };
      // Re-opening clears cancellation columns so the job is genuinely
      // re-bookable. Mark-complete sets completed_at if the column is
      // present; the existing column nullable defaults handle older rows.
      if (overrideStatus === "open") {
        updates.cancellation_reason = null;
        updates.cancelled_at = null;
        updates.cancelled_by = null;
      } else if (overrideStatus === "cancelled") {
        updates.cancellation_reason = `[Admin override] ${overrideReason.trim()}`;
        updates.cancelled_at = new Date().toISOString();
        updates.cancelled_by = user?.id || null;
      }

      // .select("id"): an override that matches zero rows returns
      // error === null, and both parties were then told the status changed —
      // with a deep link to a job still sitting in its old state. Same guard
      // the removal path above already carries.
      unwrapMutation(
        await (supabase.from("jobs").update as any)(updates).eq("id", detailJob.id).select("id"),
        {
          action: "override this job's status",
          rejectedMessage: "This job's status wasn't changed — it may have already moved. Refresh the list.",
          context: { jobId: detailJob.id, toStatus: overrideStatus },
        },
      );

      await logAdminAction("manual_status_override", "job", detailJob.id, {
        from_status: previousStatus,
        to_status: overrideStatus,
        reason: overrideReason.trim(),
      });

      // Notify both parties so they aren't surprised by the change. Each one
      // gets their OWN surface — the poster's My Posts, the helpr's My Jobs —
      // with the job on it, so the link resolves to whichever bucket the job
      // is in by the time it's read.
      // Type predicate rather than `as string[]`: an anonymised job (null
      // customer_id, 20260901033011) simply has one fewer party to notify.
      const parties = [detailJob.customer_id, detailJob.helper_id]
        .filter((id): id is string => !!id);
      for (const uid of parties) {
        const isPoster = uid === detailJob.customer_id;
        await notifyJobParty(
          {
            user_id: uid,
            title: `Admin updated your job status`,
            message: `"${detailJob.title}" was set to ${overrideStatus} by an admin. Reason: ${overrideReason.trim()}`,
            type: "info",
            link: activityLinkFor(isPoster ? "poster" : "helper", detailJob.id),
          },
          isPoster ? "the poster" : "the helpr",
          { jobId: detailJob.id, adminAction: "manual_status_override", toStatus: overrideStatus },
        );
      }

      setJobs((prev) => prev.map((j) => j.id === detailJob.id ? { ...j, ...updates } as Job : j));
      setOverrideOpen(false);
      setOverrideReason("");
      setOverrideStatus("open");
      setDetailJob(null);
    } catch (err) {
      // mutationErrorMessage, not err.message: a WriteRejectedError's `message`
      // is the engineering explanation ("affected 0 rows, expected 1"), and
      // `instanceof Error` is true of it — so the raw read showed that string
      // to an admin. This picks the userMessage when there is one.
      toast.error(mutationErrorMessage(err, "Couldn't override status — try again"));
    } finally {
      setOverriding(false);
    }
  };

  const flaggedIds = [...jobFlags.keys()].filter((id) => !resolvedFlags.has(id));
  const flaggedCount = flaggedIds.length;
  const resolvedCount = [...jobFlags.keys()].filter((id) => resolvedFlags.has(id)).length;
  const baseJobs =
    filter === "flagged"
      ? jobs.filter((j) => jobFlags.has(j.id) && !resolvedFlags.has(j.id))
      : filter === "resolved"
      ? jobs.filter((j) => jobFlags.has(j.id) && resolvedFlags.has(j.id))
      : jobs;
  // Staleness-only rows sink to the bottom. A passed date is the commonest flag
  // by far and the least actionable one — leaving it interleaved by created_at
  // buried the cards with real moderation flags among twenty that just needed a
  // calendar. Stable within each group: the original created_at order survives.
  const filteredJobs = [...baseJobs].sort((a, b) => {
    const aStale = isStaleOnly(jobFlags.get(a.id)) ? 1 : 0;
    const bStale = isStaleOnly(jobFlags.get(b.id)) ? 1 : 0;
    return aStale - bStale;
  });
  const staleOnlyCount = filteredJobs.filter((j) => isStaleOnly(jobFlags.get(j.id))).length;

  const FILTERS: { id: typeof filter; label: string; count: number; icon: typeof Flag }[] = [
    { id: "flagged", label: "Flagged", count: flaggedCount, icon: Flag },
    { id: "resolved", label: "Resolved", count: resolvedCount, icon: CheckCircle2 },
    // "all" was already a valid filter value with no control to reach it, so
    // the full job list was unreachable from this screen.
    { id: "all", label: "All", count: jobs.length, icon: Briefcase },
  ];

  if (loading) return <p className="text-muted-foreground">Loading jobs…</p>;

  return (
    <AdminViewShell>
      <AdminFilterStrip label="Job filter">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            variant={filter === f.id ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className="gap-1.5 shrink-0"
          >
            <f.icon className="w-3.5 h-3.5" />
            {f.label} ({f.count})
          </Button>
        ))}
      </AdminFilterStrip>

      <AdminCard
        title={filter === "flagged" ? "Flagged Jobs" : filter === "resolved" ? "Resolved Flags" : "All Jobs"}
        subtitle={
          filteredJobs.length === 0
            ? undefined
            : `${filteredJobs.length} ${filteredJobs.length === 1 ? "job" : "jobs"}${
                staleOnlyCount > 0 ? ` · ${staleOnlyCount} stale-dated, sorted last` : ""
              }`
        }
        contentClassName="space-y-3"
      >
        {filteredJobs.map((job) => (
          <JobListItem
            key={job.id}
            job={job}
            flags={jobFlags.get(job.id)}
            isResolved={resolvedFlags.has(job.id)}
            onOpen={openJob}
          />
        ))}
        {filteredJobs.length === 0 && (
          <EmptyState
            variant="inline"
            icon={Briefcase}
            title={filter === "flagged" ? "No flagged jobs" : "No jobs found"}
            body={
              filter === "flagged"
                ? "Nothing has tripped a moderation flag."
                : "Nothing matches the current filter."
            }
          />
        )}
      </AdminCard>

      {/* Job Detail Dialog */}
      <JobDetailDialog
        detailJob={detailJob}
        deleteOpen={deleteOpen}
        jobFlags={jobFlags}
        resolvedFlags={resolvedFlags}
        posterName={posterName}
        helperName={helperName}
        onClose={() => setDetailJob(null)}
        onReopenFlag={reopenFlag}
        onMarkFlagResolved={markFlagResolved}
        onOpenDelete={() => setDeleteOpen(true)}
        onOpenOverride={(job) => {
          // Pre-pick a sensible target based on current state.
          setOverrideStatus(job.status === "cancelled" ? "open" : "completed");
          setOverrideOpen(true);
        }}
        onOpenRefund={() => setRefundOpen(true)}
      />

      {/* Delete confirmation dialog */}
      <RemoveJobDialog
        open={deleteOpen}
        detailJob={detailJob}
        deleteReason={deleteReason}
        deleting={deleting}
        onOpenChange={(o) => { if (!o) { setDeleteOpen(false); setDeleteReason(""); } }}
        onReasonChange={setDeleteReason}
        onCancel={() => { setDeleteOpen(false); setDeleteReason(""); }}
        onConfirm={handleDelete}
      />

      {/* Refund confirmation dialog */}
      <RefundJobDialog
        open={refundOpen}
        detailJob={detailJob}
        refundReason={refundReason}
        refundAmount={refundAmount}
        refunding={refunding}
        onOpenChange={(o) => { if (!o) { setRefundOpen(false); setRefundReason(""); } }}
        onReasonChange={setRefundReason}
        onAmountChange={setRefundAmount}
        onCancel={() => { setRefundOpen(false); setRefundReason(""); setRefundAmount(""); }}
        onConfirm={handleRefund}
      />

      {/* Manual status override — re-open / mark complete / cancel. Refund
          stays in its own dialog (above) because the Stripe call has its
          own error surface and partial-refund affordance. */}
      <StatusOverrideDialog
        open={overrideOpen}
        detailJob={detailJob}
        overrideStatus={overrideStatus}
        overrideReason={overrideReason}
        overriding={overriding}
        onOpenChange={(o) => { if (!o) { setOverrideOpen(false); setOverrideReason(""); } }}
        onStatusChange={setOverrideStatus}
        onReasonChange={setOverrideReason}
        onCancel={() => { setOverrideOpen(false); setOverrideReason(""); }}
        onConfirm={handleStatusOverride}
      />
    </AdminViewShell>
  );
};

export default AdminJobs;
