import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Flag, CheckCircle2, Briefcase } from "lucide-react";
import { logAdminAction } from "@/lib/adminAudit";
import { toast } from "sonner";
import type { Job } from "./adminJobs/types";
import { detectFlags, getResolvedFlags, saveResolvedFlags } from "./adminJobs/adminJobsHelpers";
import { JobListItem } from "./adminJobs/JobListItem";
import { JobDetailDialog } from "./adminJobs/JobDetailDialog";
import { RemoveJobDialog } from "./adminJobs/RemoveJobDialog";
import { RefundJobDialog } from "./adminJobs/RefundJobDialog";
import { StatusOverrideDialog } from "./adminJobs/StatusOverrideDialog";
import { EmptyState } from "@/components/ui/EmptyState";

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
    toast.success("Flag marked as resolved");
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
    const ids = [job.customer_id, job.helper_id].filter(Boolean) as string[];
    if (ids.length > 0) {
      const { data, error } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
      if (error) {
        console.error("[AdminJobs] openJob profiles:", error);
      } else if (data) {
        const map = new Map(data.map((p) => [p.user_id, formatName(p.full_name)]));
        setPosterName(map.get(job.customer_id) || "Unknown");
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
      const { error } = await supabase
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
        .eq("id", detailJob.id);

      if (error) throw error;

      // Notify the job poster
      await supabase.from("notifications").insert({
        user_id: detailJob.customer_id,
        title: "Job removed by admin",
        message: `Your job "${detailJob.title}" was removed. Reason: ${deleteReason}`,
        type: "warning",
        link: "/my-jobs",
      });

      // Also notify the helper if assigned
      if (detailJob.helper_id) {
        await supabase.from("notifications").insert({
          user_id: detailJob.helper_id,
          title: "Job removed by admin",
          message: `The job "${detailJob.title}" you were assigned to was removed by an admin.`,
          type: "warning",
          link: "/dashboard",
        });
      }

      // Update local state
      setJobs((prev) => prev.map((j) => j.id === detailJob.id ? { ...j, status: "cancelled", cancellation_reason: `[Admin removed] ${deleteReason}` } : j));
      toast.success("Job removed and poster notified");
      setDeleteOpen(false);
      setDeleteReason("");
      setDetailJob(null);
    } catch (err: any) {
      toast.error("Couldn't remove that job: " + err.message);
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
      toast.success(isPartial
        ? `Partial refund of $${parsedDollars.toFixed(2)} issued`
        : "Refund issued and parties notified");
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

      const { error } = await (supabase.from("jobs").update as any)(updates).eq("id", detailJob.id);
      if (error) throw error;

      await logAdminAction("manual_status_override", "job", detailJob.id, {
        from_status: previousStatus,
        to_status: overrideStatus,
        reason: overrideReason.trim(),
      });

      // Notify both parties so they aren't surprised by the change.
      const parties = [detailJob.customer_id, detailJob.helper_id].filter(Boolean) as string[];
      for (const uid of parties) {
        await supabase.from("notifications").insert({
          user_id: uid,
          title: `Admin updated your job status`,
          message: `"${detailJob.title}" was set to ${overrideStatus} by an admin. Reason: ${overrideReason.trim()}`,
          type: "info",
          link: uid === detailJob.customer_id ? "/my-jobs" : "/dashboard",
        });
      }

      setJobs((prev) => prev.map((j) => j.id === detailJob.id ? { ...j, ...updates } as Job : j));
      toast.success(`Job status set to ${overrideStatus}`);
      setOverrideOpen(false);
      setOverrideReason("");
      setOverrideStatus("open");
      setDetailJob(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't override status — try again";
      toast.error(msg);
    } finally {
      setOverriding(false);
    }
  };

  const flaggedIds = [...jobFlags.keys()].filter((id) => !resolvedFlags.has(id));
  const flaggedCount = flaggedIds.length;
  const resolvedCount = [...jobFlags.keys()].filter((id) => resolvedFlags.has(id)).length;
  const filteredJobs =
    filter === "flagged"
      ? jobs.filter((j) => jobFlags.has(j.id) && !resolvedFlags.has(j.id))
      : filter === "resolved"
      ? jobs.filter((j) => jobFlags.has(j.id) && resolvedFlags.has(j.id))
      : jobs;

  if (loading) return <p className="text-muted-foreground">Loading jobs…</p>;

  return (
    <div className="space-y-6">
      {jobFlags.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={filter === "flagged" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("flagged")}
              className="gap-1.5"
            >
              <Flag className="w-3.5 h-3.5" />
              Flagged ({flaggedCount})
            </Button>
            <Button
              variant={filter === "resolved" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("resolved")}
              className="gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Resolved ({resolvedCount})
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">

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
      </div>

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
    </div>
  );
};

export default AdminJobs;
