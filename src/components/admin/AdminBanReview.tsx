import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Ban, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
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
import SectionBoundary from "@/components/SectionBoundary";
import { toneBadgeClasses, toneTextClasses } from "@/components/admin/tones";
import { cn } from "@/lib/utils";
import { report } from "@/lib/errorLogger";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";

/**
 * Ban Review — the human half of the message-scanner ladder.
 *
 * The scanner's third strike used to permanently ban the account from the
 * OFFENDER'S OWN CLIENT, with nobody ever looking at it. It now records the
 * case as `user_violations.action_taken = 'pending_ban_review'` and applies a
 * REVERSIBLE 7-day restriction (see apply_message_violation_consequence,
 * 20260825183000). This view is where a person reads the actual blocked
 * messages and decides: confirm the permanent ban, or dismiss it and lift the
 * restriction. Both decisions go through the admin-user-actions edge function,
 * which re-checks the caller is an admin server-side and writes an
 * admin_audit_log row — a client write would put us back where we started.
 */

interface ViolationRow {
  id: string;
  user_id: string;
  description: string | null;
  action_taken: string;
  created_at: string;
}

interface ReviewCase {
  /** The pending_ban_review row that opened the case. */
  id: string;
  user_id: string;
  created_at: string;
  full_name: string | null;
  email: string | null;
  /** Every off-platform violation on file for this user, newest first. */
  history: ViolationRow[];
}

const BanReviewInner = () => {
  const qc = useQueryClient();
  const queryKey = ["admin-ban-review"];
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ReviewCase | null>(null);
  const [dismissTarget, setDismissTarget] = useState<ReviewCase | null>(null);
  const [note, setNote] = useState("");

  const { data: cases, isInitialLoading } = useInstantQuery<ReviewCase[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => {
      const { data, error } = await supabase
        .from("user_violations")
        .select("id, user_id, description, action_taken, created_at")
        .eq("action_taken", "pending_ban_review")
        .order("created_at", { ascending: true });

      if (error) {
        // PGRST202 / missing column — the migration hasn't deployed yet. An
        // empty queue is the honest answer, not an error banner.
        if ((error as { code?: string }).code === "PGRST202" || error.message?.includes("does not exist")) {
          return [];
        }
        toast.error(error.message);
        return [];
      }

      const pending = (data ?? []) as ViolationRow[];
      if (pending.length === 0) return [];

      // One open case per user — a user with two flagged rows is still one
      // decision, so collapse to the oldest and show the rest as history.
      const userIds = [...new Set(pending.map((r) => r.user_id))];

      // user_violations.user_id has no FK to profiles, so the name has to be a
      // second read (same shape as AdminExceptionQueue). Don't drop the error:
      // silently rendering "Unnamed user" on every row of a BAN queue looks
      // like data rather than a failed lookup.
      const nameById = new Map<string, { full_name: string | null; email: string | null }>();
      const { data: profs, error: profsError } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);
      if (profsError) report(profsError, { severity: "warning", tags: { source: "AdminBanReview.hydrateNames" } });
      (profs ?? []).forEach((p) =>
        nameById.set(p.user_id, { full_name: p.full_name ?? null, email: p.email ?? null }),
      );

      // The evidence: every off-platform violation these users have on file.
      const { data: hist, error: histError } = await supabase
        .from("user_violations")
        .select("id, user_id, description, action_taken, created_at")
        .in("user_id", userIds)
        .eq("violation_type", "off_platform")
        .order("created_at", { ascending: false });
      if (histError) report(histError, { severity: "warning", tags: { source: "AdminBanReview.history" } });
      const historyByUser = new Map<string, ViolationRow[]>();
      ((hist ?? []) as ViolationRow[]).forEach((h) => {
        const list = historyByUser.get(h.user_id) ?? [];
        list.push(h);
        historyByUser.set(h.user_id, list);
      });

      const seen = new Set<string>();
      const collapsed: ReviewCase[] = [];
      for (const r of pending) {
        if (seen.has(r.user_id)) continue;
        seen.add(r.user_id);
        collapsed.push({
          id: r.id,
          user_id: r.user_id,
          created_at: r.created_at,
          full_name: nameById.get(r.user_id)?.full_name ?? null,
          email: nameById.get(r.user_id)?.email ?? null,
          history: historyByUser.get(r.user_id) ?? [],
        });
      }
      return collapsed;
    },
  });

  const decide = async (row: ReviewCase, confirming: boolean) => {
    setBusy(row.id);
    try {
      const { error } = await supabase.functions.invoke("admin-user-actions", {
        body: {
          action: confirming ? "confirm_message_ban" : "dismiss_message_ban_review",
          userId: row.user_id,
          violationId: row.id,
          note: note.trim(),
        },
      });
      if (error) throw error;
      toast.success(confirming ? "Account permanently banned." : "Restriction lifted.");
      qc.invalidateQueries({ queryKey });
      setConfirmTarget(null);
      setDismissTarget(null);
      setNote("");
    } catch (err) {
      toast.error((err as Error).message || "Action failed");
    } finally {
      setBusy(null);
    }
  };

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <HelprSpinner size={24} />
      </div>
    );
  }

  return (
    <AdminViewShell>
      <AdminCard
        title="Pending Ban Reviews"
        subtitle="Accounts the message scanner stopped after a third blocked message. Each is restricted for 7 days — nothing is permanent until you say so."
        action={
          cases.length > 0 ? (
            <span className={cn("inline-flex items-center justify-center rounded-full text-ds-11 font-bold px-2.5 py-1 min-w-[1.75rem]", toneBadgeClasses.warning)}>
              {cases.length}
            </span>
          ) : undefined
        }
      >
        {cases.length === 0 ? (
          <EmptyState
            surfaceStyle={NESTED_EMPTY_SURFACE}
            variant="inline"
            icon={ShieldCheck}
            title="No accounts awaiting review"
            body="Nothing is waiting on a ban decision right now."
          />
        ) : (
          <div className="space-y-3">
            {cases.map((c) => (
              <div key={c.id} className="rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className={cn("w-10 h-10 shrink-0 rounded-full bg-warning/10 flex items-center justify-center", toneTextClasses.warning)}>
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-ds-13 text-foreground truncate">
                        {c.full_name || "Unnamed user"}
                      </p>
                      <span className={cn("inline-flex items-center rounded-full text-ds-10 font-semibold px-2 py-0.5", toneBadgeClasses.warning)}>
                        {c.history.length} blocked {c.history.length === 1 ? "message" : "messages"}
                      </span>
                    </div>
                    <p className="text-ds-11 text-muted-foreground truncate">{c.email}</p>
                  </div>
                  <p className="text-ds-11 text-muted-foreground shrink-0">
                    {formatShortDate(c.created_at)}
                  </p>
                </div>

                {/* The evidence — what they actually tried to send. */}
                <ul className="space-y-1.5">
                  {c.history.slice(0, 5).map((h) => (
                    <li key={h.id} className="rounded-ds-sm border border-border/40 bg-card/60 px-3 py-2">
                      <p className="text-ds-11 text-foreground break-words">{h.description || "No detail recorded"}</p>
                      <p className="text-ds-10 text-muted-foreground mt-0.5">{formatShortDate(h.created_at)}</p>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === c.id}
                    onClick={() => {
                      setDismissTarget(c);
                      setNote("");
                    }}
                  >
                    {busy === c.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
                    Dismiss &amp; Lift
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy === c.id}
                    onClick={() => {
                      setConfirmTarget(c);
                      setNote("");
                    }}
                  >
                    <Ban className="w-4 h-4 mr-1" />
                    Confirm Permanent Ban
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      <AlertDialog open={!!confirmTarget} onOpenChange={(o) => !o && setConfirmTarget(null)}>
        <AlertDialogContent>
          {/* AlertDialogHero renders its title ONLY (the 2026-07-25 "one main
              title" decision), so the consequence sentence is its own line. */}
          <AlertDialogHero title="Confirm Permanent Ban" />
          <p className="text-ds-13 text-muted-foreground">
            {confirmTarget?.full_name || "This user"} will be permanently banned and lose access to Helpr.
          </p>
          <Textarea
            aria-label="Ban reason"
            placeholder="e.g. Three separate attempts to move a job to Cash App — reviewed the messages, clear intent"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmTarget) decide(confirmTarget, true);
              }}
            >
              Ban Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!dismissTarget} onOpenChange={(o) => !o && setDismissTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHero title="Dismiss Review" />
          <p className="text-ds-13 text-muted-foreground">
            {dismissTarget?.full_name || "This user"}&rsquo;s 7-day restriction will be lifted and the case closed. Their violation history stays on file.
          </p>
          <Textarea
            aria-label="Dismissal note"
            placeholder="e.g. Scanner caught a street address, not contact info — false positive"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (dismissTarget) decide(dismissTarget, false);
              }}
            >
              Dismiss &amp; Lift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminViewShell>
  );
};

const AdminBanReview = () => (
  <SectionBoundary label="ban review">
    <BanReviewInner />
  </SectionBoundary>
);

export default AdminBanReview;
