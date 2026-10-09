import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { functionErrorMessage, unwrap } from "@/lib/supabaseResult";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Flag, CheckCircle2, Briefcase, Ghost, Users, FlaskConical } from "lucide-react";
import { logAdminAction } from "@/lib/adminAudit";
import { toast } from "sonner";
import { warnIfGiftNotReturned } from "./giftRestoreWarning";
import type { Job } from "./adminJobs/types";
import { detectFlags, getResolvedFlags, saveResolvedFlags, isStaleOnly, isGhostJob, isActivePaidJob } from "./adminJobs/adminJobsHelpers";
import { AdminViewShell, AdminCard, AdminFilterStrip } from "./AdminViewShell";
import { JobListItem } from "./adminJobs/JobListItem";
import { JobDetailDialog } from "./adminJobs/JobDetailDialog";
import { RemoveJobDialog } from "./adminJobs/RemoveJobDialog";
import { RefundJobDialog } from "./adminJobs/RefundJobDialog";
import { StatusOverrideDialog } from "./adminJobs/StatusOverrideDialog";
import { activityLinkFor, notifyJobParty } from "./adminJobs/notifyJobParty";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireBiometric } from "@/lib/biometricGate";
import { report } from "@/lib/errorLogger";
import { JOB_READABLE_COLUMNS, readJobsAheadOfDb, readableJobRows } from "@/lib/jobColumns";
import { ADMIN_DELETED_ACCOUNT_LABEL } from "@/lib/deletedPerson";
import { userFacingError } from "@/lib/userFacingError";
import { lifecycleErrorMessage } from "@/lib/lifecycleErrors";


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
  // The refund dialog asks the ledger the same question create-payment's
  // escrowAlreadyMovedTheOtherWay asks: is there a pending or paid payout
  // row? payment_status alone is wrong both ways (a released job whose only
  // transfer failed can still be fully refunded; a payout_pending job with a
  // transfer in flight cannot). undefined while loading or on error: the
  // dialog then falls back to payment_status.
  const refundJobId = refundOpen ? detailJob?.id : undefined;
  const [payoutMoved, setPayoutMoved] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    setPayoutMoved(undefined);
    if (!refundJobId) return;
    let live = true;
    void (async () => {
      try {
        const rows = unwrap(
          await supabase.from("payout_transfers").select("id")
            .eq("job_id", refundJobId).in("status", ["pending", "paid"]).limit(1),
        );
        if (live) setPayoutMoved((rows ?? []).length > 0);
      } catch (err) {
        report(err, { severity: "warning", tags: { source: "AdminJobs.payoutMoved" }, context: { jobId: refundJobId } });
      }
    })();
    return () => { live = false; };
  }, [refundJobId]);
  const [refunding, setRefunding] = useState(false);
  // Manual status override — admins can re-open, mark complete, or
  // cancel a job out of band. Tracked separately from the regular
  // remove flow so the audit row captures the new target status.
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<"open" | "completed" | "cancelled">("open");
  const [overrideReason, setOverrideReason] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [filter, setFilter] = useState<"all" | "flagged" | "resolved" | "ghost" | "active" | "test">("active");
  // Applications per job, loaded for the Active tab (admins read every application row).
  // null = not loaded (or failed): cards then show no count rather than a stale or wrong one.
  const [applicantCounts, setApplicantCounts] = useState<Map<string, number> | null>(null);
  const [jobFlags, setJobFlags] = useState<Map<string, string[]>>(new Map());
  const [resolvedFlags, setResolvedFlags] = useState<Set<string>>(getResolvedFlags());

  useEffect(() => {
    const load = async () => {
      // Q1461: + materials_note for the job dialog, through readJobsAheadOfDb
      // (a database behind this build answers 42703; it asks again without).
      const { data, error } = await readJobsAheadOfDb(`${JOB_READABLE_COLUMNS}, materials_note`, (columns) => supabase
        .from("jobs")
        // Named columns: `*` includes offered_to_helper_id, which is not
        // selectable (20260915045110) and 42501s the whole read.
        .select(columns)
        .order("created_at", { ascending: false }));
      if (error) {
        console.error("[AdminJobs] load:", error);
        toast.error("Couldn't load jobs — refresh to retry.");
      } else if (data) {
        // Cast, not `.overrideTypes()`: see the note in src/lib/jobColumns.ts.
        const rows = readableJobRows<Job>(data);
        setJobs(rows);
        const flagMap = new Map<string, string[]>();
        for (const job of rows) {
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
    if (posterId === null) setPosterName(ADMIN_DELETED_ACCOUNT_LABEL);
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

      // The status trigger logs a bare job_status_override when the status
      // actually changes; this row carries WHAT the admin did and WHY (Q76).
      await logAdminAction("remove_job", "job", detailJob.id, {
        from_status: detailJob.status,
        reason: deleteReason.trim(),
        customer_id: detailJob.customer_id,
        helper_id: detailJob.helper_id,
      });

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
            job_id: detailJob.id,
          },
          "the poster",
          { jobId: detailJob.id, adminAction: "remove_job" },
        );
      }

      // Also notify the helper if assigned. This used to land on /home
      // (Browse), which never mentions the job they just lost.
      if (detailJob.helper_id) {
        await notifyJobParty(
          {
            user_id: detailJob.helper_id,
            title: "Job removed by admin",
            message: `The job "${detailJob.title}" you were assigned to was removed by an admin.`,
            type: "warning",
            link: activityLinkFor("helper", detailJob.id),
            job_id: detailJob.id,
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
    } catch (err: unknown) {
      toast.error(mutationErrorMessage(err, userFacingError(err, "Couldn't remove that job — try again.")));
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
      toast.error(`Partial amount $${parsedDollars.toFixed(2)} exceeds job total $${Number(detailJob.budget).toFixed(2)}.`);
      return;
    }
    const isPartial = partialCents !== null && partialCents < totalCents;

    // Face ID / Touch ID gate: an admin refund moves real money back out of Stripe
    // and cancels the job. No undo. Runs after the amount validation so a rejected
    // form never raises an OS prompt. No-op on web. On device it prompts whenever
    // the device can authenticate its owner at all — falling back to the passcode
    // when biometry is unavailable or locked out (see requireBiometric).
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
      // A non-2xx leaves `error` a FunctionsHttpError whose .message is
      // "Edge Function returned a non-2xx status code"; the function's own
      // sentence (a 409 guard, a 429) is in the body. See functionErrorMessage.
      if (error) throw new Error(await functionErrorMessage(error, "Couldn't issue that refund — try again"));
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      warnIfGiftNotReturned(data);
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
      const msg = userFacingError(err, "Couldn't issue that refund — try again.");
      report(err, { tags: { source: "money.adminRefund", action: "admin_refund_general", screen: "/admin" }, context: { jobId: detailJob.id, partial: isPartial } });
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
      const updates: TablesUpdate<"jobs"> = { status: overrideStatus };
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
      // The status predicate below (Q760) makes the override a compare-and-set
      // on the status the admin was looking at. Without it an override
      // decided on a stale view (the job was accepted, completed or disputed
      // after the list loaded) silently overwrote the newer state. Zero rows
      // means someone changed the job first: unwrapMutation throws, the admin
      // is told to reload, and nobody is notified. Covered by
      // scripts/check-race-class.mjs (src/test/raceClassGuard.test.ts).
      unwrapMutation(
        await supabase
          .from("jobs")
          .update(updates)
          .eq("id", detailJob.id)
          .eq("status", previousStatus)
          .select("id"),
        {
          action: "override this job's status",
          rejectedMessage:
            "Someone changed this job while you were looking, so its status wasn't overridden. Reload the list to see where it is now.",
          context: { jobId: detailJob.id, fromStatus: previousStatus, toStatus: overrideStatus },
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
            job_id: detailJob.id,
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
      // accept_required (Q1180): an offer the Helpr has not accepted cannot be pushed forward, even by an admin.
      toast.error(lifecycleErrorMessage(err) ?? mutationErrorMessage(err, "Couldn't override status — try again."));
    } finally {
      setOverriding(false);
    }
  };

  // TEST JOBS LIVE IN THEIR OWN TAB (owner, 2026-10-09: "add a category for
  // test jobs in filters bc I only want to see the real jobs"). Every other
  // tab, and every count on them, is real jobs only.
  const realJobs = jobs.filter((j) => j.is_seed !== true);
  const testJobs = jobs.filter((j) => j.is_seed === true);
  const realIds = new Set(realJobs.map((j) => j.id));
  const flaggedIds = [...jobFlags.keys()].filter((id) => realIds.has(id) && !resolvedFlags.has(id));
  const flaggedCount = flaggedIds.length;
  const resolvedCount = [...jobFlags.keys()].filter((id) => realIds.has(id) && resolvedFlags.has(id)).length;
  // Ghosts: open to helpers, no money behind them. Computed from the job row
  // rather than read out of `jobFlags` so the tab still lists them after an
  // admin has resolved the flag — resolving a ghost means "I have looked at
  // it", not "the job is funded now", and the class has to stay countable
  // until the row actually leaves the open/unfunded state.
  const ghostJobs = realJobs.filter(isGhostJob);
  const activeJobs = realJobs.filter(isActivePaidJob);
  const activeJobIds = activeJobs.map((j) => j.id).join(",");
  useEffect(() => {
    setApplicantCounts(null);
    if (!activeJobIds) return;
    let cancelled = false;
    void (async () => {
      // One exact head-count per job (code review: reading the rows and
      // counting here would silently cap at PostgREST's row limit).
      const ids = activeJobIds.split(",");
      const results = await Promise.all(
        ids.map((id) => supabase.from("applications").select("id", { count: "exact", head: true }).eq("job_id", id)),
      );
      if (cancelled) return;
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        console.error("[AdminJobs] applicant counts:", failed.error);
        toast.error("Couldn't load applicant counts — refresh to retry.");
        return;
      }
      setApplicantCounts(new Map(ids.map((id, i) => [id, results[i].count ?? 0])));
    })();
    return () => { cancelled = true; };
  }, [activeJobIds]);
  const baseJobs =
    filter === "flagged"
      ? realJobs.filter((j) => jobFlags.has(j.id) && !resolvedFlags.has(j.id))
      : filter === "resolved"
      ? realJobs.filter((j) => jobFlags.has(j.id) && resolvedFlags.has(j.id))
      : filter === "ghost"
      ? ghostJobs
      : filter === "active"
      ? activeJobs
      : filter === "test"
      ? testJobs
      : realJobs;
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
    // Real, paid, not finished: each card shows its applicant count (owner, 2026-10-09).
    { id: "active", label: "Active", count: activeJobs.length, icon: Users },
    { id: "flagged", label: "Flagged", count: flaggedCount, icon: Flag },
    { id: "resolved", label: "Resolved", count: resolvedCount, icon: CheckCircle2 },
    // "all" was already a valid filter value with no control to reach it, so
    // the full job list was unreachable from this screen.
    // Its own tab because it is its own CLASS of problem: every other filter
    // here sorts jobs by what a person did, this one by what our checkout
    // failed to do. Buried among moderation flags it reads as one more banner.
    { id: "ghost", label: "Ghosts", count: ghostJobs.length, icon: Ghost },
    { id: "all", label: "All", count: realJobs.length, icon: Briefcase },
    { id: "test", label: "Test", count: testJobs.length, icon: FlaskConical },
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

      {/* surface="none": every JobListItem below is its own bordered
          `bg-card`, so the default card drew white bordered cards inside a
          white bordered card (measured 5 nested pairs at 375 and 1440).
          Owner, 2026-09-11: keep the groups, drop the outer card. The inline
          EmptyState stays painted — with no outer card it IS the card. */}
      <AdminCard
        surface="none"
        title={filter === "active" ? "Active Jobs" : filter === "test" ? "Test Jobs" : filter === "flagged" ? "Flagged Jobs" : filter === "resolved" ? "Resolved Flags" : filter === "ghost" ? "Ghost Jobs — open with no escrow" : "All Jobs"}
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
            applicantCount={filter === "active" ? applicantCounts?.get(job.id) : undefined}
          />
        ))}
        {filteredJobs.length === 0 && (
          <EmptyState
            variant="inline"
            icon={Briefcase}
            title={
              filter === "active"
                ? "No active jobs"
                : filter === "test"
                  ? "No test jobs"
                  : filter === "flagged"
                    ? "No flagged jobs"
                    : filter === "ghost"
                      ? "No ghost jobs"
                      : "No jobs found"
            }
            body={
              filter === "active"
                ? "No paid job is open or in progress right now."
                : filter === "flagged"
                ? "Nothing has tripped a moderation flag."
                : filter === "ghost"
                  // A meaningful zero, not a shrug: this tab being empty is the
                  // healthy state and says something worth knowing — every job
                  // helpers can currently apply to has money behind it.
                  ? "Every open job has escrow behind it. Nothing is live that couldn't be paid out."
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
        payoutMoved={payoutMoved}
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
