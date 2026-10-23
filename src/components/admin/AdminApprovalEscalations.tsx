import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CloudOff, ExternalLink, Hourglass } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { toneBadgeClasses } from "@/components/admin/tones";
import { isMissingRpc } from "@/components/admin/adminStalledJobs/stalledQueue";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { ADMIN_DELETED_ACCOUNT_LABEL } from "@/lib/deletedPerson";
import { requireBiometric } from "@/lib/biometricGate";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { functionInvokeError, unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";
import { formatPriceExact, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  APPROVAL_WINDOW_HOURS,
  STANDARD_PAYOUT_PHRASE,
} from "../../../supabase/functions/_shared/escrowTiming";

/**
 * WAITING ON THE POSTER'S APPROVAL — the human half of "nothing is paid without
 * the poster's approval" (owner 2026-10-23).
 *
 * auto-release-payment no longer completes and pays a job the poster never
 * approved. When the Helpr marked the work done APPROVAL_WINDOW_HOURS ago (or
 * delivered a revision fix 72 hours ago) and the poster has not answered, it
 * files a `job_approval_escalations` row, tells both sides Helpr support is
 * stepping in, and leaves the escrow held. This card is that queue
 * (`admin_approval_escalation_queue`, 20261023143240).
 *
 * Two actions, both confirmed:
 *  - Approve for the poster: the poster's own approval, made by an admin
 *    (create-payment `release` with forPoster; allowed only while the row is
 *    open, never by an admin who is on the job, audited as approve_for_poster).
 *    The payout is then sent STANDARD_PAYOUT_PHRASE.
 *  - Mark reviewed: closes the row without moving money (the admin talked to
 *    the poster, or refunded from Jobs). resolve_approval_escalation writes
 *    the audit row.
 */
export interface ApprovalEscalationRow {
  job_id: string;
  reason: string;
  title: string | null;
  customer_id: string | null;
  helper_id: string | null;
  budget: number | null;
  status: string | null;
  payment_status: string | null;
  helper_completed_at: string | null;
  revision_completed_at: string | null;
  is_group_job: boolean | null;
  escalated_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  still_waiting: boolean | null;
}

interface QueueState {
  deployed: boolean;
  rows: ApprovalEscalationRow[];
  names: Record<string, string>;
}

const EMPTY: QueueState = { deployed: true, rows: [], names: {} };

/** The words under the job's title: why it is here. */
function escalationWhy(row: ApprovalEscalationRow): string {
  return row.reason === "revision"
    ? "The Helpr delivered a requested fix and the poster didn't answer in 72 hours."
    : `The Helpr marked it done and the poster didn't answer in ${APPROVAL_WINDOW_HOURS} hours.`;
}

export function AdminApprovalEscalations() {
  const qc = useQueryClient();
  const [includeResolved] = useState(false);
  const { data, isInitialLoading, isError, refetch } = useInstantQuery<QueueState>({
    key: ["admin-approval-escalations", includeResolved],
    fallback: EMPTY,
    fetcher: async () => {
      const res = await supabase.rpc("admin_approval_escalation_queue", { p_include_resolved: includeResolved });
      if (res.error && isMissingRpc(res.error)) return { ...EMPTY, deployed: false };
      const rows = (unwrap(res) ?? []) as ApprovalEscalationRow[];
      const ids = [...new Set(rows.flatMap((r) => [r.customer_id, r.helper_id]).filter(Boolean) as string[])];
      const names: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profs, error: profsError } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
        if (profsError) report(profsError, { severity: "warning", tags: { source: "AdminApprovalEscalations.hydrateNames" } });
        (profs ?? []).forEach((p: { user_id: string; full_name: string | null }) => {
          if (p.full_name) names[p.user_id] = p.full_name;
        });
      }
      return { deployed: true, rows, names };
    },
  });

  const inFlight = useRef<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ApprovalEscalationRow | null>(null);

  const run = async (row: ApprovalEscalationRow, what: "approve" | "review") => {
    if (inFlight.current.has(row.job_id)) return;
    inFlight.current.add(row.job_id);
    setBusyId(row.job_id);
    try {
      if (what === "approve") {
        // Money: the same step-up as Quick Release (AdminDisputes). No-op on web.
        if (!(await requireBiometric("Confirm approving this job for the poster"))) return;
        const { data: out, error } = await supabase.functions.invoke("create-payment", {
          body: { action: "release", jobId: row.job_id, forPoster: true },
        });
        if (error) throw await functionInvokeError(error);
        if (out?.error) throw new Error(String(out.error));
        toast.success(out?.bothDone
          ? `Approved for the poster. The Helpr's payout is sent ${STANDARD_PAYOUT_PHRASE}; both sides were told the date.`
          : "Approved for the poster.");
      } else {
        const res = await supabase.rpc("resolve_approval_escalation", { p_job_id: row.job_id });
        if (res.error && isMissingRpc(res.error)) {
          toast.error("This queue's functions aren't deployed yet — nothing was recorded.");
          return;
        }
        if (unwrap(res) === true) toast.success("Marked reviewed. The escrow is untouched.");
        else toast("Already cleared — someone got to this one first.");
      }
      qc.invalidateQueries({ queryKey: ["admin-approval-escalations"] });
      qc.invalidateQueries({ queryKey: ["admin-stalled-job-queue"] });
    } catch (err) {
      report(err, { tags: { source: `AdminApprovalEscalations.${what}` }, context: { jobId: row.job_id } });
      toast.error(
        (what === "review" ? rpcErrorMessage("resolve_approval_escalation", err) : null) ??
          userFacingError(err, what === "approve" ? "Couldn't approve that job — nothing was moved. Try again." : "Couldn't record that review — try again."),
      );
    } finally {
      inFlight.current.delete(row.job_id);
      setBusyId((cur) => (cur === row.job_id ? null : cur));
    }
  };

  const open = data.rows.filter((r) => !r.resolved_at);

  return (
    <AdminCard
      title="Waiting on the Poster's Approval"
      subtitle="Nothing is paid without the poster's approval. These jobs passed their approval window; the money is held until you approve for the poster, refund in Jobs, or the poster answers."
      action={
        open.length > 0 ? (
          <span className={cn("inline-flex items-center justify-center rounded-full text-ds-11 font-bold px-2.5 py-1 min-w-[1.75rem]", toneBadgeClasses.danger)}>
            {open.length}
          </span>
        ) : undefined
      }
      contentClassName="space-y-4"
    >
      {isInitialLoading ? (
        <div className="flex items-center justify-center py-8">
          <HelprSpinner size={24} />
        </div>
      ) : isError ? (
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="We couldn't load the approval queue."
          body="Tap Try again. An error here means unknown, not clear — money may be held on jobs waiting for an approval."
          onRetry={() => refetch()}
        />
      ) : !data.deployed ? (
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={CloudOff}
          title="This queue isn't live yet"
          body="It ships with migration 20261023143240 and reaches the database when db-deploy runs on merge. Until then this screen can't read it — it is not saying the queue is empty."
          action={<Button size="sm" onClick={() => refetch()}>Check again</Button>}
        />
      ) : open.length === 0 ? (
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={CheckCircle2}
          title="No jobs are waiting on an approval"
          body="Every job past its approval window has been handled."
        />
      ) : (
        <div className="space-y-3">
          {open.map((row) => {
            const poster = row.customer_id ? data.names[row.customer_id] ?? "Unknown" : ADMIN_DELETED_ACCOUNT_LABEL;
            const helper = row.helper_id ? data.names[row.helper_id] ?? "Unknown" : "No Helpr on record";
            const busy = busyId === row.job_id;
            return (
              <div key={row.job_id} className="rounded-ds-md border p-4 space-y-3 border-destructive/30 bg-destructive/5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-foreground text-ds-13 min-w-0">{row.title ?? "Untitled job"}</h3>
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-ds-10 font-semibold uppercase tracking-wide", toneBadgeClasses.danger)}>
                        <Hourglass className="w-3 h-3" /> {row.still_waiting ? "Awaiting a human" : "Settled since"}
                      </span>
                    </div>
                    <p className="text-ds-11 text-muted-foreground tabular-nums">
                      ${formatPriceExact(Number(row.budget ?? 0))} held · payment {row.payment_status ?? "unknown"} · job {row.status ?? "unknown"}
                    </p>
                    <p className="text-ds-11 font-semibold text-destructive-ink">{escalationWhy(row)}</p>
                    {row.escalated_at && <p className="text-ds-11 text-muted-foreground">Escalated {formatTimestamp(row.escalated_at)}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {row.still_waiting && (
                      <Button size="sm" disabled={busy} onClick={() => setConfirming(row)}>
                        Approve for the poster
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(row, "review")}>
                      {busy ? "Recording…" : "Mark reviewed"}
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ds-11">
                  <span className="text-muted-foreground">
                    Posted by{" "}
                    {row.customer_id ? (
                      <Link to={`/user/${row.customer_id}`} className="font-semibold text-foreground underline underline-offset-2">{poster}</Link>
                    ) : (
                      <span className="font-semibold text-foreground">{poster}</span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    Helpr{" "}
                    {row.helper_id ? (
                      <Link to={`/user/${row.helper_id}`} className="font-semibold text-foreground underline underline-offset-2">{helper}</Link>
                    ) : (
                      <span className="font-semibold text-foreground">{helper}</span>
                    )}
                  </span>
                  <Link to={`/jobs/${row.job_id}`} className="inline-flex items-center gap-1 font-semibold text-foreground underline underline-offset-2">
                    Open the job <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </Link>
                  <Link to={`/admin?view=jobs&job=${row.job_id}`} className="inline-flex items-center gap-1 font-semibold text-foreground underline underline-offset-2">
                    Refund in Jobs
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {confirming && (
        <BrandConfirmDialog
          open={!!confirming}
          onOpenChange={(o) => { if (!o) setConfirming(null); }}
          title="Approve for the poster?"
          description={
            <>
              This approves "{confirming.title ?? "this job"}" as if the poster had: the ${formatPriceExact(Number(confirming.budget ?? 0))} held is scheduled to the Helpr and sent {STANDARD_PAYOUT_PHRASE}. Both sides are told the date. This can't be undone from here.
            </>
          }
          primaryLabel="Approve and pay"
          onPrimary={() => { const row = confirming; setConfirming(null); void run(row, "approve"); }}
          secondaryLabel="Cancel"
        />
      )}
    </AdminCard>
  );
}
