// Reassign-on-removal dialog.
//
// When the owner removes a teammate, this dialog asks which active
// member should inherit the leaver's open / pending posts before the
// row is deleted. The reassignment runs against the
// `reassign_business_jobs` RPC (migration 20260609170000) and only
// touches jobs whose status is one of open / accepted / in_progress /
// pending_approval — completed/cancelled rows stay attributed to the
// original poster for accounting.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";

export interface ReassignTarget {
  member_id: string;
  user_id: string;
  display: string;
}

interface ReassignMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId: string;
  fromUserId: string | null;
  fromDisplay: string;
  candidates: ReassignTarget[];
  /** Run AFTER the reassign completes (or is skipped). */
  onConfirm: () => Promise<void> | void;
}

export function ReassignMemberDialog({
  open,
  onOpenChange,
  businessId,
  fromUserId,
  fromDisplay,
  candidates,
  onConfirm,
}: ReassignMemberDialogProps) {
  const [inflightCount, setInflightCount] = useState<number | null>(null);
  const [pickedUserId, setPickedUserId] = useState<string>("");
  const [working, setWorking] = useState(false);

  // Count the leaver's in-flight posts so the owner knows the stakes.
  useEffect(() => {
    if (!open || !fromUserId) {
      setInflightCount(null);
      setPickedUserId("");
      return;
    }
    (async () => {
      const { count } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("customer_id", fromUserId)
        .in("status", ["open", "accepted", "in_progress", "pending_approval"] as any);
      setInflightCount(count ?? 0);
    })();
  }, [open, fromUserId, businessId]);

  const handleConfirm = async () => {
    setWorking(true);
    if (fromUserId && pickedUserId && (inflightCount ?? 0) > 0) {
      const { error } = await supabase.rpc("reassign_business_jobs" as any, {
        p_business_id: businessId,
        p_from_user_id: fromUserId,
        p_to_user_id: pickedUserId,
      } as any);
      if (error) {
        const code = (error as { code?: string }).code;
        if (code !== "PGRST202") {
          hapticError();
          toast.error(error.message || "Couldn't reassign posts.");
          setWorking(false);
          return;
        }
        // RPC missing — fall through to removal but warn loudly.
        toast.warning("Reassignment isn't live yet; posts will stay attributed.");
      } else {
        hapticSuccess();
      }
    }
    await onConfirm();
    setWorking(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero
          eyebrow="Remove teammate"
          title={`Remove ${fromDisplay}?`}
        />

        {inflightCount !== null && inflightCount > 0 && (
          <div className="space-y-2">
            <label className="text-ds-11 font-medium text-muted-foreground" htmlFor="reassign-select">
              Reassign posts to
            </label>
            <select
              id="reassign-select"
              value={pickedUserId}
              onChange={(e) => setPickedUserId(e.target.value)}
              className="w-full rounded-ds-sm border border-input bg-background px-3 py-2 text-ds-13"
            >
              <option value="">Pick a teammate…</option>
              {candidates.map((c) => (
                <option key={c.user_id} value={c.user_id}>
                  {c.display}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={working}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              working ||
              inflightCount === null ||
              ((inflightCount ?? 0) > 0 && !pickedUserId)
            }
          >
            {working ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remove"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ReassignMemberDialog;
