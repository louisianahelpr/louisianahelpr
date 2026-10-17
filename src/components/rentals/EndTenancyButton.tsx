import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { endTenancy } from "@/lib/rentals/api";
import { rentalsErrorMessage } from "@/lib/rentals/copy";

/**
 * Rentals: end a tenancy (rentals_end_tenancy; either side, active -> ended,
 * invited -> revoked). Three uses, one control: a tenant leaves a home, a
 * landlord cuts off a former tenant (who could otherwise keep filing
 * requests), and a landlord cancels an unused invite link. One-way, so it
 * asks first. Past requests stay readable on both sides (they are snapshots).
 */
type Kind = "leave" | "end" | "cancel-invite";
const WORDS: Record<Kind, { button: string; title: string; description: string; confirm: string; done: string }> = {
  leave: {
    button: "Leave this home",
    title: "Leave This Home?",
    description: "You won't be able to send repair requests for it. Your past requests stay here. To connect again, your landlord sends a new invite.",
    confirm: "Leave home",
    done: "You've left this home.",
  },
  end: {
    button: "End tenancy",
    title: "End This Tenancy?",
    description: "Your tenant won't be able to send repair requests for this unit. Past requests stay here. To connect again, send a new invite.",
    confirm: "End tenancy",
    done: "Tenancy ended.",
  },
  "cancel-invite": {
    button: "Cancel invite",
    title: "Cancel This Invite?",
    description: "The link stops working. Nobody has used it yet.",
    confirm: "Cancel invite",
    done: "Invite cancelled.",
  },
};

export function EndTenancyButton({ tenancyId, kind, onDone }: { tenancyId: string; kind: Kind; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const w = WORDS[kind];
  const m = useMutation({
    mutationFn: () => endTenancy(tenancyId),
    onSuccess: () => {
      setOpen(false);
      toast.success(w.done);
      onDone();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  // One call per control: a second tap landing as the first succeeds would be
  // refused (tenancy_not_found) and toast an error after "ended" (lh-money-escrow review of 801589ae1 #6).
  const done = m.isPending || m.isSuccess;
  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={done} onClick={() => setOpen(true)}>
        {w.button}
      </Button>
      <BrandConfirmDialog
        open={open}
        onOpenChange={(next) => { if (!m.isPending) setOpen(next); }}
        title={w.title}
        description={w.description}
        primaryLabel={m.isPending ? "Working…" : w.confirm}
        primaryTone="sienna"
        primaryDisabled={done}
        primaryHaptic="warning"
        onPrimary={(e) => {
          e.preventDefault();
          if (!done) m.mutate();
        }}
        secondaryLabel="Keep it"
      />
    </>
  );
}
