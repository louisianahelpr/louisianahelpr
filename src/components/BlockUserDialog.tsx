import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { blockUser } from "@/lib/userBlocks";
import { createNotification } from "@/lib/notifications";

interface BlockUserDialogProps {
  open: boolean;
  onClose: () => void;
  blockedUserId: string;
  blockedUserName: string;
  /** Called after a successful block so the parent can navigate / refresh. */
  onBlocked?: (cancelledJobIds: string[]) => void;
  /** Optional — surfaces the "Report and block" combo button so the
   *  user can flag the account for the trust team in the same gesture
   *  that protects them from it. Receives no args; the parent owns the
   *  Report dialog open state and routes it through this hook. */
  onReportAndBlock?: () => void;
}

export function BlockUserDialog({
  open,
  onClose,
  blockedUserId,
  blockedUserName,
  onBlocked,
  onReportAndBlock,
}: BlockUserDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState<number | null>(null);

  // Look up active jobs between the two users so we can warn the user
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("jobs")
        .select("id")
        .or(
          `and(customer_id.eq.${user.id},helper_id.eq.${blockedUserId}),and(customer_id.eq.${blockedUserId},helper_id.eq.${user.id})`,
        )
        .in("status", ["accepted", "in_progress", "revision_requested"]);
      if (error) {
        // A swallowed error here would set the count to 0 and hide the
        // "active jobs will be cancelled" warning — leave it unknown
        // (null) instead of implying it's safe to block.
        console.error("[BlockUserDialog] active-job lookup failed:", error);
        return;
      }
      if (!cancelled) setActiveJobCount(data?.length ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, blockedUserId]);

  const handleBlock = async () => {
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in");
        return;
      }
      const result = await blockUser(user.id, blockedUserId, reason.trim() || undefined);
      if (!result.ok) {
        toast.error(result.error || "Couldn't block this person — try again?");
        return;
      }

      // Notify the blocked user about any cancelled jobs (no notification about the block itself)
      for (const _jobId of result.cancelledJobIds) {
        void _jobId;
        await createNotification({
          user_id: blockedUserId,
          title: "Job cancelled",
          message: "A job between you and another user has been cancelled.",
          type: "warning",
          link: "/my-jobs",
        });
      }

      toast.success(
        result.cancelledJobIds.length > 0
          ? `${blockedUserName} blocked. ${result.cancelledJobIds.length} active job${result.cancelledJobIds.length === 1 ? "" : "s"} cancelled — any refund processes within the hour.`
          : `${blockedUserName} blocked.`,
      );
      onBlocked?.(result.cancelledJobIds);
      onClose();
      setReason("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <AlertDialogContent>
        <AlertDialogHero
          eyebrow={<><ShieldAlert className="w-3 h-3" /> Safety</>}
          eyebrowClassName="inline-flex items-center gap-1.5"
          title={<>Block {blockedUserName}?</>}
        />
        <div className="space-y-3 mt-2">
              <ul
                className="font-serif italic space-y-1 list-disc pl-5 leading-relaxed text-ds-13"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                <li>You won&apos;t see their messages, applications, or profile.</li>
                <li>They won&apos;t be able to apply to your jobs or message you.</li>
                <li>They won&apos;t be notified that you blocked them.</li>
                {activeJobCount !== null && activeJobCount > 0 && (
                  <li className="not-italic font-sans font-medium" style={{ color: "hsl(var(--burnt-sienna))" }}>
                    {activeJobCount} active job{activeJobCount === 1 ? "" : "s"} between you will be cancelled and refunded.
                  </li>
                )}
              </ul>
              <div className="space-y-1.5">
                <label
                  className="font-serif italic uppercase block text-ds-10"
                  style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
                >
                  Reason — optional, admin-only
                </label>
                <Textarea
                  aria-label="Block reason (optional, admin-only)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-ds-14"
                />
              </div>
            </div>
        {/* Force normal (top-down) column order — shadcn's footer defaults to
            flex-col-reverse on mobile, which would float Cancel to the top.
            We want the action stack to read Just block → Block and report →
            Cancel, with Cancel anchored at the bottom. */}
        <AlertDialogFooter className="!flex-col sm:!items-stretch sm:!space-x-0">
          {/* Order: Just block → Block and report → Cancel. When the parent
              opts into report-and-block, "Block and report" is the primary
              filled CTA and sits closest to the thumb (just above Cancel);
              "Just block" reads as a solid-tinted secondary above it. When
              there's no report path, "Just block" is the lone primary. */}
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleBlock();
            }}
            disabled={submitting}
            className="rounded-ds-md"
            style={
              onReportAndBlock
                ? {
                    // Secondary — but clearly ENABLED, not greyed. "Block and
                    // report" stays the primary filled CTA; this reads as a
                    // solid-tinted secondary (a real choice, since the reason
                    // is optional), not a disabled control.
                    background: "hsl(var(--burnt-sienna) / 0.16)",
                    backgroundImage: "none",
                    border: "1px solid hsl(var(--burnt-sienna) / 0.65)",
                    color: "hsl(var(--burnt-sienna))",
                    boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.4), 0 1px 2px hsl(var(--burnt-sienna) / 0.12)",
                    fontFamily: "Montserrat, system-ui, sans-serif",
                    fontWeight: 600,
                    letterSpacing: "0.01em",
                  }
                : {
                    background: "hsl(var(--burnt-sienna))",
                    backgroundImage: "none",
                    border: "1px solid hsl(var(--burnt-sienna))",
                    color: "hsl(var(--parchment))",
                    fontFamily: "Montserrat, system-ui, sans-serif",
                    fontWeight: 600,
                    letterSpacing: "0.01em",
                    boxShadow: "var(--elev-sienna-raised)",
                  }
            }
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Blocking…
              </>
            ) : (
              "Just Block"
            )}
          </AlertDialogAction>
          {onReportAndBlock && (
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                await handleBlock();
                onReportAndBlock();
              }}
              disabled={submitting}
              className="rounded-ds-md"
              style={{
                background: "hsl(var(--burnt-sienna))",
                backgroundImage: "none",
                border: "1px solid hsl(var(--burnt-sienna))",
                color: "hsl(var(--parchment))",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
                letterSpacing: "0.01em",
                boxShadow: "var(--elev-sienna-raised)",
              }}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Working…
                </>
              ) : (
                "Block and Report"
              )}
            </AlertDialogAction>
          )}
          <AlertDialogCancel disabled={submitting} className="rounded-ds-md">Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
