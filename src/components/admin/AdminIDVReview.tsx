// AdminIDVReview — the human half of the identity gate.
//
// This is NOT a revival of the old AdminIDVQueue (retired ab5817de). That
// queue listed everyone who had uploaded an ID and offered a manual approve
// on the strength of a review nobody performed — a human stamp on a badge
// strangers trusted, with no human behind it.
//
// This surface exists because 2f650f35 created a state that REQUIRES a human:
// a Helpr gets exactly one Stripe Identity attempt (claim_idv_attempt caps at
// 1). When Stripe bills that attempt and returns a failure, the webhook now
// routes them to `manual_review` instead of the terminal `failed`, so a real
// person who was charged and rejected is not permanently barred from the
// marketplace. Without a screen to work that state they simply wait forever,
// which is worse than the old dishonesty.
//
// Scope is deliberately narrow, and that narrowness is the whole design:
//   * It lists ONLY `manual_review` and `failed`. It cannot see, touch, or
//     second-guess anyone Stripe passed. Identity is still Stripe's answer.
//   * `failed` is listed alongside so any user stranded there — by the old
//     webhook, or by a rejection an admin later regrets — is rescuable.
//   * Approving stamps `legacy_manual_review`, and the badge that flag drives
//     now reads "Admin Verified", not "Stripe Verified" (adminUserHelpers).
//     The provenance of a manual pass stays visible.
//
// Three decisions, all reversible by another admin, none of them silent:
//   Approve       -> manual_verify      (verified + approved + audit-logged)
//   Another try   -> request_id_reupload(not_started + a fresh attempt)
//   Reject        -> idv_reject         (failed + a stored reason; still listed here)

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Camera,
} from "lucide-react";
import { formatShortDate } from "@/lib/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";

interface ReviewRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  idv_status: string | null;
  idv_session_id: string | null;
  idv_attempt_count: number | null;
  idv_attempted_at: string | null;
  idv_failure_reason: string | null;
  created_at: string | null;
}

/**
 * Deep link into the Stripe dashboard for one verification session.
 *
 * Stripe serves live and test data from different paths, and a link that
 * lands on "no such session" is worse than no link — an admin deciding
 * someone's access needs to actually see what Stripe saw. Test session ids
 * carry the `_test_` infix, so route on that rather than guessing.
 */
const stripeSessionUrl = (sessionId: string) =>
  sessionId.includes("_test_")
    ? `https://dashboard.stripe.com/test/identity/verification-sessions/${sessionId}`
    : `https://dashboard.stripe.com/identity/verification-sessions/${sessionId}`;

type Decision = "manual_verify" | "request_id_reupload" | "idv_reject";

const AdminIDVReview = () => {
  const qc = useQueryClient();
  const queryKey = ["admin-idv-review"];
  const [busy, setBusy] = useState<string | null>(null);
  // Reject and "another try" both carry a note the Helpr reads, so both go
  // through the same confirm sheet rather than firing on a single click.
  const [confirming, setConfirming] = useState<{ row: ReviewRow; decision: Decision } | null>(null);
  const [note, setNote] = useState("");

  // unwrap() throws into React Query so a failed read flips isError on rather
  // than degrading silently to "nobody is waiting" — the one wrong answer this
  // screen must never give. See CLAUDE.md "Never drop the Supabase `error`".
  const { data: rows, isInitialLoading, isError, refetch } = useInstantQuery<ReviewRow[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () =>
      (unwrap(
        await supabase
          .from("profiles")
          .select(
            "user_id, full_name, email, idv_status, idv_session_id, idv_attempt_count, idv_attempted_at, idv_failure_reason, created_at",
          )
          // manual_review first: those people are actively waiting on a human.
          // `failed` is the rescue list, not the shift.
          .in("idv_status", ["manual_review", "failed"])
          .order("idv_status", { ascending: true })
          .order("idv_attempted_at", { ascending: true, nullsFirst: false })
          .limit(200),
      ) ?? []) as ReviewRow[],
  });

  const run = async (row: ReviewRow, decision: Decision, reason: string) => {
    setBusy(row.user_id);
    try {
      const { error } = await supabase.functions.invoke("admin-user-actions", {
        body: {
          action: decision,
          userId: row.user_id,
          note: reason,
          reasonCategory: "",
          bypassStrike: false,
        },
      });
      if (error) throw error;
      toast.success(
        decision === "manual_verify"
          ? "Approved — they can post and accept jobs now."
          : decision === "request_id_reupload"
            ? "Sent. They have a fresh verification attempt."
            : "Rejected. They stay listed here so this can be undone.",
      );
      qc.invalidateQueries({ queryKey });
    } catch (err) {
      report(err, { tags: { source: "AdminIDVReview.run", decision } });
      toast.error((err as Error).message || "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const waiting = rows.filter((r) => r.idv_status === "manual_review").length;

  return (
    <AdminViewShell>
      <AdminCard
        title="Identity Review"
        subtitle="Helprs Stripe billed and could not verify. Approving grants access as an Admin Verified account — it does not claim Stripe passed them."
        action={
          waiting > 0 ? (
            <Badge className="bg-accent/20 text-accent border-accent/30 text-ds-11">
              {waiting} waiting
            </Badge>
          ) : undefined
        }
      >
        {isInitialLoading ? (
          <div className="space-y-3" aria-hidden="true">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
                <Skeleton className="h-16 w-full rounded-ds-md" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            surfaceStyle={NESTED_EMPTY_SURFACE}
            variant="inline"
            title="We couldn't load the identity review queue."
            body="Tap Try again. Nobody's decision is lost — this list is read straight from their profiles."
            onRetry={() => refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            surfaceStyle={NESTED_EMPTY_SURFACE}
            variant="inline"
            icon={ShieldCheck}
            title="Nobody is waiting on a human"
            body="Helprs land here only when Stripe charged them for an attempt and could not verify it."
          />
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const isFailed = r.idv_status === "failed";
              return (
                <div
                  key={r.user_id}
                  className="rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent/20 text-accent flex items-center justify-center text-ds-13 font-bold shrink-0">
                      {(r.full_name || r.email || "?").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ds-13 text-foreground truncate">
                        {r.full_name || "Unnamed"}
                      </p>
                      <p className="text-ds-11 text-muted-foreground truncate">{r.email || "No email on file"}</p>
                    </div>
                    <Badge
                      className={
                        isFailed
                          ? "bg-destructive/10 text-destructive border-destructive/20 text-ds-10 gap-0.5 shrink-0"
                          : "bg-accent/20 text-accent border-accent/30 text-ds-10 gap-0.5 shrink-0"
                      }
                    >
                      <ShieldAlert className="w-2.5 h-2.5" />
                      {isFailed ? "Rejected" : "Awaiting review"}
                    </Badge>
                  </div>

                  <div className="rounded-ds-md border border-border bg-secondary/40 p-3 space-y-1.5">
                    <p className="text-ds-11 text-muted-foreground">
                      <span className="font-semibold text-foreground">Attempts used:</span>{" "}
                      {r.idv_attempt_count ?? 0} of 1
                      {r.idv_attempted_at ? ` · last ${formatShortDate(r.idv_attempted_at)}` : ""}
                      {r.created_at ? ` · joined ${formatShortDate(r.created_at)}` : ""}
                    </p>
                    {/* Stripe's own words, verbatim. The admin deciding this
                        needs the reason Stripe gave, not a paraphrase. */}
                    {r.idv_failure_reason && (
                      <p className="text-ds-11 text-muted-foreground">
                        <span className="font-semibold text-foreground">Reason on file:</span>{" "}
                        {r.idv_failure_reason}
                      </p>
                    )}
                    {r.idv_session_id ? (
                      <a
                        href={stripeSessionUrl(r.idv_session_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-ds-11 font-semibold text-primary hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open the Stripe session
                        <span className="text-muted-foreground font-normal">({r.idv_session_id})</span>
                      </a>
                    ) : (
                      // Say so rather than showing a dead link. No session id
                      // means there is nothing at Stripe to look at, and the
                      // admin should decide on other evidence or ask for a
                      // fresh attempt.
                      <p className="text-ds-11 text-muted-foreground">
                        No Stripe session on file — there is nothing to review at Stripe.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="flex-1 min-w-[8rem]"
                      disabled={busy === r.user_id}
                      onClick={() => {
                        setConfirming({ row: r, decision: "manual_verify" });
                        setNote("");
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 min-w-[8rem]"
                      disabled={busy === r.user_id}
                      onClick={() => {
                        setConfirming({ row: r, decision: "request_id_reupload" });
                        setNote("");
                      }}
                    >
                      <Camera className="w-4 h-4 mr-1" /> Give another try
                    </Button>
                    {!isFailed && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 min-w-[8rem] border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={busy === r.user_id}
                        onClick={() => {
                          setConfirming({ row: r, decision: "idv_reject" });
                          setNote("");
                        }}
                      >
                        <XCircle className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AdminCard>

      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHero
            title={
              confirming?.decision === "manual_verify"
                ? `Approve ${confirming.row.full_name || confirming.row.email || "this Helpr"}?`
                : confirming?.decision === "request_id_reupload"
                  ? "Give them another attempt?"
                  : "Reject this verification?"
            }
            subtitle={
              confirming?.decision === "manual_verify"
                ? "They get full access and an Admin Verified badge. Approve only if you have seen evidence of who they are — this is your judgement on the record, not Stripe's."
                : confirming?.decision === "request_id_reupload"
                  ? "Resets them to not started and hands back a verification attempt. They get an email and a notification asking for a clearer ID."
                  : "Marks the verification failed with your reason. They stay on this screen, so you or another admin can approve or re-open it later."
            }
          />
          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">
              {confirming?.decision === "manual_verify" ? "Note (optional)" : "Reason (shown to them)"}
            </p>
            <Textarea
              aria-label="Note or reason"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                confirming?.decision === "idv_reject"
                  ? "e.g. The document Stripe captured belongs to someone else."
                  : "e.g. Photo was too blurry — please retake in good lighting."
              }
              rows={3}
            />
            <p className="text-ds-11 text-muted-foreground">This decision is written to the admin audit log.</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirming) return;
                const { row, decision } = confirming;
                const reason = note.trim();
                setConfirming(null);
                void run(row, decision, reason);
              }}
            >
              {confirming?.decision === "manual_verify"
                ? "Approve"
                : confirming?.decision === "request_id_reupload"
                  ? "Send request"
                  : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminViewShell>
  );
};

export default AdminIDVReview;
