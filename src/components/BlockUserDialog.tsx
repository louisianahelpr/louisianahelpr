import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
}

export function BlockUserDialog({
  open,
  onClose,
  blockedUserId,
  blockedUserName,
  onBlocked,
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
      const { data } = await supabase
        .from("jobs")
        .select("id")
        .or(
          `and(customer_id.eq.${user.id},helper_id.eq.${blockedUserId}),and(customer_id.eq.${blockedUserId},helper_id.eq.${user.id})`,
        )
        .in("status", ["accepted", "in_progress", "revision_requested"]);
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
        toast.error(result.error || "Failed to block user");
        return;
      }

      // Notify the blocked user about any cancelled jobs (no notification about the block itself)
      for (const jobId of result.cancelledJobIds) {
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
          ? `${blockedUserName} blocked. ${result.cancelledJobIds.length} active job${result.cancelledJobIds.length === 1 ? "" : "s"} cancelled.`
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
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-destructive" />
            Block {blockedUserName}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>Once blocked:</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>You won&apos;t see their messages, applications, or profile.</li>
                <li>They won&apos;t be able to apply to your jobs or message you.</li>
                <li>They won&apos;t be notified that you blocked them.</li>
                {activeJobCount !== null && activeJobCount > 0 && (
                  <li className="text-destructive font-medium">
                    {activeJobCount} active job{activeJobCount === 1 ? "" : "s"} between you will be cancelled and refunded.
                  </li>
                )}
              </ul>
              <Textarea
                placeholder="Reason (optional, only visible to admins)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleBlock();
            }}
            disabled={submitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Blocking…
              </>
            ) : (
              "Block user"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
