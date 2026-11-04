import { logAdminAction } from "@/lib/adminAudit";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { createNotification } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogDestructiveAction,
  DialogFooter,
  DialogHero,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from "@/components/ui/dialog";
import { formatShortDate } from "@/lib/format";
import { AlertTriangle, CheckCircle2, User, Send, Search } from "lucide-react";
import { toast } from "sonner";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { toneBadgeClasses, type Tone } from "@/components/admin/tones";
import { AdminViewShell, AdminFilterStrip } from "@/components/admin/AdminViewShell";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { userFacingError } from "@/lib/userFacingError";
import { useFilterCounts, pillLabel } from "@/components/admin/useFilterCounts";
import { reportsQueueKey, type ReportQueueFilter } from "@/components/admin/adminQueueKeys";
import { REPORT_FILTERS } from "@/components/admin/adminReports/reportFilters";
import { WANTED_REPORT } from "@/components/admin/adminReports/reportedWanted";
import { fetchReports } from "@/components/admin/adminReports/fetchReports";
import { DeclutterTakeDown } from "@/components/admin/adminReports/DeclutterTakeDown";
import { WantedReportPanel } from "@/components/admin/adminReports/WantedReportPanel";
import { ReportedCopy } from "@/components/admin/adminReports/ReportedCopy";
import { ReportSubjectButton } from "@/components/admin/adminReports/ReportSubjectButton";
import { SLA_BREACH_HOURS, slaInfo, typeIcon } from "@/components/admin/adminReports/reportRowBits";

import type { Report } from "@/components/admin/adminReports/reportType";

// Triage states. The DB CHECK (added in migration 20260609160000) allows
// new/investigating/resolved/dismissed alongside the legacy
// pending/reviewed values. We surface 'new' as the default replacement
// for 'pending' but tolerate both so the queue keeps working between
// merge and the manual `supabase db push`.

type ReportFilter = ReportQueueFilter;
const REPORT_FILTER_VALUES = REPORT_FILTERS.map((f) => f.value);

const AdminReports = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Triage filter — `pending` is the legacy default and we treat it as
  // "new + investigating" so the queue keeps showing everything an
  // admin would expect under the old default.
  const [filter, setFilter] = useState<ReportFilter>("pending");
  const [updating, setUpdating] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<{ userId: string; name: string } | null>(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [deleteReviewTarget, setDeleteReviewTarget] = useState<Report | null>(null);
  const [deletingReview, setDeletingReview] = useState(false);

  const queryKey = reportsQueueKey(filter);
  // Owner 2026-10-27: each pill carries the number of reports it lists.
  const counts = useFilterCounts(REPORT_FILTER_VALUES, reportsQueueKey, fetchReports, (rows) => rows.length);
  // isError/refetch, not a swallowed toast. This caught the error, told the
  // user once, and returned [] — so a failed read rendered "No pending
  // reports", which is the same screen as a genuinely empty queue. An admin
  // looking at an outage saw an all-clear and moved on. AdminIDVReview.tsx
  // already ships the right shape; this matches it.
  const { data: reports, isInitialLoading, isError, refetch } = useInstantQuery<Report[]>({
    key: queryKey,
    fallback: [],
    fetcher: () => fetchReports(filter),
  });

  // Every status tab: a status change moves a report between tabs, and each pill counts its own (useFilterCounts).
  const loadReports = () => qc.invalidateQueries({ queryKey: ["admin-reports"] });

  const assignToSelf = async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUpdating(id);
    // assigned_to lives in a recent migration (now in the generated types);
    // the 42703 fallback below still covers a database that lacks the column.
    // .select("id") on both paths: a zero-row update returns error === null, and
    // the queue would log an audit entry claiming this admin took the report.
    const { data: rows, error } = await supabase.from("reports")
      .update({ assigned_to: user.id, status: "investigating" })
      .eq("id", id)
      .select("id");
    if (error) {
      // 42703 = undefined column → migration hasn't been applied yet.
      // Fall back to status-only so the queue keeps working.
      if (error.code === "42703") {
        try {
          unwrapMutation(
            await supabase.from("reports")
              .update({ status: "investigating" })
              .eq("id", id)
              .select("id"),
            {
              action: "assign this report to yourself",
              rejectedMessage: "This report wasn't assigned — someone else may have taken it. Refresh the queue.",
              context: { reportId: id },
            },
          );
        } catch (fallbackErr) {
          toast.error(mutationErrorMessage(fallbackErr, "Couldn't assign that report — try again."));
        }
      } else {
        toast.error(userFacingError(error, "Couldn't update that report — try again."));
      }
    } else if (!rows || rows.length === 0) {
      // Zero rows on the primary path — same treatment as the fallback: report
      // it and say so, rather than logging an audit entry for a no-op.
      try {
        unwrapMutation(
          { data: [], error: null },
          {
            action: "assign this report to yourself",
            rejectedMessage: "This report wasn't assigned — someone else may have taken it. Refresh the queue.",
            context: { reportId: id },
          },
        );
      } catch (err) {
        toast.error(mutationErrorMessage(err, "Couldn't assign that report — try again."));
        setUpdating(null);
        return;
      }
    }
    // `void supabase.from(...).insert(...)` never sent this: PostgrestBuilder
    // issues its fetch inside then(), so `void` evaluates the builder and
    // discards it without ever calling then(). Trust & Safety had no audit
    // trail at all. logAdminAction awaits and reports failures.
    await logAdminAction("report_assigned_self", "report", id);
    loadReports();
    setUpdating(null);
  };

  const deleteReportedReview = async () => {
    if (!deleteReviewTarget) return;
    setDeletingReview(true);
    const { error } = await supabase.rpc("admin_delete_review", {
      _review_id: deleteReviewTarget.reported_id,
      _reason: `Removed via report ${deleteReviewTarget.id}: ${deleteReviewTarget.reason}`,
    });
    setDeletingReview(false);
    if (error) {
      toast.error(userFacingError(error, "Couldn't remove that review — try again."));
      return;
    }
    toast.success("Review removed.");
    await updateStatus(deleteReviewTarget.id, "resolved");
    setDeleteReviewTarget(null);
  };

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    const { data: { user } } = await supabase.auth.getUser();
    // .select("id"): resolving a report that matches zero rows returns
    // error === null — the queue used to log an audit entry and re-render as
    // resolved over a report that never changed.
    try {
      unwrapMutation(
        await supabase.from("reports").update({ status }).eq("id", id).select("id"),
        {
          action: "update this report",
          rejectedMessage: "This report wasn't updated — someone else may have handled it. Refresh the queue.",
          context: { reportId: id, status },
        },
      );
    } catch (err) {
      toast.error(mutationErrorMessage(err, "Couldn't update that report — try again."));
      setUpdating(null);
      return;
    }
    // Audit trail for the status change. Best-effort — don't fail the
    // resolution if the audit insert errors (admin already saw success).
    if (user) {
      const report = reports?.find(r => r.id === id);
      const ageHours = report ? Math.round((Date.now() - new Date(report.created_at).getTime()) / 3600_000) : null;
      // Same dead-`void` bug as the assign path above.
      await logAdminAction(
        status === "resolved" ? "report_resolved" : "report_dismissed",
        "report",
        id,
        {
          report_id: id,
          new_status: status,
          age_hours_at_resolution: ageHours,
          sla_breached: ageHours !== null && ageHours > SLA_BREACH_HOURS,
        },
      );
    }
    loadReports();
    setUpdating(null);
  };

  const handleSendMessage = async () => {
    if (!messageTarget || !messageText.trim()) return;
    setSendingMessage(true);
    try {
      await createNotification({
        user_id: messageTarget.userId,
        title: "📩 Message from Admin",
        message: messageText.trim(),
        type: "info",
        link: "/profile",
      });
      setMessageTarget(null);
      setMessageText("");
    } catch {
      toast.error("Couldn't send that message — try again.");
    }
    setSendingMessage(false);
  };

  // "New" is the label for the `pending` status because that is what the
  // report badge says; keeping the two in one table stops them drifting.

  return (
    <AdminViewShell>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => navigate("/admin/preview/messages")}>Preview the Messages page</Button>
        {/* Q2664 (b): the sign-up screens after step 2 no test account can reach. */}
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => navigate("/admin/preview/onboarding")}>Preview sign-up</Button>
      </div>
      {/* Five chips wrapped to two ragged rows at 375. One scrollable strip with the shared edge fade instead — a
          cut-off chip then reads as "there is more this way" rather than as a broken layout. */}
      {/* Real Title Case text, not CSS `capitalize` over a lowercase status
          key. Two reasons it matters here: the platform writes controls in
          Title Case, and `capitalize` only paints — the ACCESSIBLE NAME stays
          the raw "investigating", which is the lowercase twin of the
          per-report ACTION button labelled "Investigating" further down the
          same screen. A screen-reader user got two differently-cased buttons
          with the same name, one of which changes a report's status. */}
      <AdminFilterStrip label="Filter reports by status">
        {REPORT_FILTERS.map(({ value, label, icon: Icon, dim }) => (
          <Button
            key={value}
            variant={filter === value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className="shrink-0"
          >
            {Icon && <Icon className={cn("w-3.5 h-3.5 mr-1", dim && "opacity-60")} />}
            {pillLabel(label, counts.get(value))}
          </Button>
        ))}
      </AdminFilterStrip>

      {isInitialLoading ? (
        <p className="text-muted-foreground text-ds-11 py-8 text-center">Loading reports…</p>
      ) : isError ? (
        <ErrorState
          variant="inline"
          title="We couldn't load the reports queue."
          body="Tap Try again. Nothing has been dismissed — this list is read straight from the reports table."
          onRetry={() => refetch()}
        />
      ) : reports.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={AlertTriangle}
          title={filter !== "all" ? `No ${filter} reports` : "No reports"}
          body={
            filter !== "all"
              ? "Nothing matches this filter — try All."
              : "Nobody has reported anything. That is the good outcome."
          }
        />
      ) : (
        <div className="space-y-3">
          {reports.map(report => (
            <div key={report.id} className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {typeIcon(report.reported_type)}
                  <div>
                    <p className="text-ds-13 font-semibold text-foreground">
                      <button
                        disabled={report.reported_type === WANTED_REPORT && !report.subject_user_id}
                        onClick={() => navigate(`/user/${report.subject_user_id ?? report.reported_id}`)}
                        className="hover:text-primary underline-offset-2 hover:underline transition-colors"
                      >
                        {report.reported_name}
                      </button>
                      <span className="text-muted-foreground font-normal"> — {report.reason}</span>
                      
                    </p>
                    <p className="text-ds-11 text-muted-foreground">
                      Reported by{" "}
                      {/* `reporter_id` is nullable: purge_user_data() nulls it
                          when the reporter deletes their account, keeping the
                          report itself because it protects the person named in
                          `reported_id`. Without this branch the link built a
                          `/user/null` href that renders a not-found profile.
                          `reporter_name` already resolves to ADMIN_DELETED_ACCOUNT_LABEL via
                          nameFor(), so the label needs no special case. */}
                      {report.reporter_id ? (
                        <button
                          onClick={() => navigate(`/user/${report.reporter_id}`)}
                          className="hover:text-primary underline-offset-2 hover:underline transition-colors"
                        >
                          {report.reporter_name}
                        </button>
                      ) : (
                        <span>{report.reporter_name}</span>
                      )}
                      {" · "}<span className="whitespace-nowrap">{formatShortDate(report.created_at)}</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {/* Calm "sienna" accent badge, not destructive: a new/pending
                      report isn't a danger/delete action — the mauve destructive
                      color is reserved for genuinely destructive controls. */}
                  <Badge variant="sienna">
                    {report.status === "pending" ? "new" : report.status}
                  </Badge>
                  {report.assigned_to_name && (
                    <Badge variant="outline" className="text-ds-10 gap-0.5">
                      <User className="w-2.5 h-2.5" /> {report.assigned_to_name.split(" ")[0]}
                    </Badge>
                  )}
                  {(report.status === "pending" || report.status === "new" || report.status === "investigating") && (() => {
                    const sla = slaInfo(report.created_at);
                    const slaTone: Tone =
                      sla.tone === "red" ? "danger" :
                      sla.tone === "yellow" ? "notice" :
                      "success";
                    return (
                      <span className={cn("text-ds-10 font-medium px-2 py-0.5 rounded-full", toneBadgeClasses[slaTone])}>
                        {sla.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {report.description && (
                <p className="text-ds-11 text-muted-foreground bg-muted/50 rounded-ds-sm p-3">{report.description}</p>
              )}
              {/* The reported message or Declutter question as it read when it was reported (kept even if later deleted). */}
              <ReportedCopy report={report} onDone={loadReports} gone={report.reported_question_gone} />

              {report.reported_wanted && <WantedReportPanel post={report.reported_wanted} reportId={report.id} open={report.status !== "resolved" && report.status !== "dismissed"} onDone={loadReports} />}

              {/* AUD31-44 (audit 10-31): the seven actions WRAP. One scrolling row under a fade hid "Dismiss" at 1440 and
                  everything after "Assign to Me" at 375, so Resolve and Dismiss were never seen without a sideways scroll. */}
              <div data-report-actions className="flex flex-wrap gap-2 pt-1 [&>button]:shrink-0">
                <ReportSubjectButton report={report} />
                {(report.status === "pending" || report.status === "new" || report.status === "investigating") && (
                  <>
                    {!report.assigned_to && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => assignToSelf(report.id)}
                        disabled={updating === report.id}
                      >
                        <User className="w-3.5 h-3.5 mr-1" /> Assign to Me
                      </Button>
                    )}
                    {report.status !== "investigating" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus(report.id, "investigating")}
                        disabled={updating === report.id}
                      >
                        <Search className="w-3.5 h-3.5 mr-1" /> Investigating
                      </Button>
                    )}
                    {/* Disabled for a deleted actor: createNotification would
                        write a row against a user_id with nothing behind it,
                        so the admin would get a success toast for a message
                        nobody can ever receive. */}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={report.reported_exists === false}
                      title={report.reported_exists === false ? "This account no longer exists" : undefined}
                      onClick={() => { setMessageTarget({ userId: report.subject_user_id ?? report.reported_id, name: report.reported_name || "User" }); setMessageText(""); }}
                    >
                      <Send className="w-3.5 h-3.5 mr-1" /> Message {report.reported_exists === false ? "Reported" : (report.reported_name?.split(" ")[0] || "Reported")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!report.reporter_id || report.reporter_exists === false}
                      title={
                        !report.reporter_id || report.reporter_exists === false
                          ? "This account no longer exists"
                          : undefined
                      }
                      onClick={() => {
                        // Narrowed rather than asserted: `reporter_id` is null
                        // once the reporter deletes their account, and there is
                        // nobody to message. The `disabled` above already
                        // covers it — this keeps the two in step instead of
                        // leaning on that to hold forever.
                        if (!report.reporter_id) return;
                        setMessageTarget({ userId: report.reporter_id, name: report.reporter_name || "User" });
                        setMessageText("");
                      }}
                    >
                      <Send className="w-3.5 h-3.5 mr-1" /> Message {report.reporter_exists === false ? "Reporter" : (report.reporter_name?.split(" ")[0] || "Reporter")}
                    </Button>
                    {report.reported_type === "review" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive-ink hover:text-destructive-ink"
                        onClick={() => setDeleteReviewTarget(report)}
                        disabled={updating === report.id}
                      >
                        Remove Review
                      </Button>
                    )}
                    {report.reported_listing_down_ok && (
                      <DeclutterTakeDown itemId={report.reported_id} reportId={report.id} title={report.reported_name ?? "This listing"} onDone={loadReports} />
                    )}
                    <Button
                      size="sm"
                      onClick={() => updateStatus(report.id, "resolved")}
                      disabled={updating === report.id}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateStatus(report.id, "dismissed")}
                      disabled={updating === report.id}
                    >
                      Dismiss
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Message Dialog */}
      <Dialog open={!!messageTarget} onOpenChange={(open) => { if (!open) setMessageTarget(null); }}>
        <DialogContent role="alertdialog">
          <DialogHero
            title={`Message ${messageTarget?.name}`}
          />
          <div className="space-y-3">
            <DialogBody>
              <p>This will send an in-app notification to {messageTarget?.name}.</p>
            </DialogBody>
            <Textarea
              aria-label="Message to user"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <DialogSecondaryAction onClick={() => setMessageTarget(null)}>Cancel</DialogSecondaryAction>
            <DialogPrimaryAction onClick={handleSendMessage} disabled={sendingMessage || !messageText.trim()}>
              {sendingMessage ? "Sending…" : "Send Message"}
            </DialogPrimaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteReviewTarget} onOpenChange={(open) => { if (!open) setDeleteReviewTarget(null); }}>
        <DialogContent role="alertdialog">
          <DialogHero
            title="Remove this review?"
          />
          {/* WAS A `subtitle` PROP ON THE HERO — IT NEVER RENDERED.
              DialogHero has shown the title alone since the 2026-07-25 "one main
              title" decision, but it went on ACCEPTING `eyebrow`/`subtitle` and
              discarding them, so this sentence has been dead in the shipped bundle
              with no error, no warning and no type failure. Deleting the props from
              the type surfaced six of these in one compile. The copy is not
              decoration — it is the line that tells the reader what the button below
              is about to do — so it moves into the body, which is where the same
              decision already sent TipDialog's, ReviewForm's, InstantPayoutDialog's
              and W9CollectionDialog's. */}
          <DialogDescription>
            This permanently deletes the review. The reviewee's star rating recalculates immediately — this can't be undone.
          </DialogDescription>
          <DialogFooter>
            <DialogSecondaryAction disabled={deletingReview}>Cancel</DialogSecondaryAction>
            <DialogDestructiveAction onClick={deleteReportedReview} disabled={deletingReview}>
              {deletingReview ? "Removing…" : "Remove Review"}
            </DialogDestructiveAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminViewShell>
  );
};

export default AdminReports;
