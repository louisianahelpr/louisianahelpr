import { useState } from "react";
import { toast } from "sonner";
import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enMessages";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { hapticError, hapticHeavy, hapticSuccess } from "@/lib/haptics";
import { deleteConversationForMe } from "@/lib/archivedConversations";
import type { Conversation } from "@/components/messages/types";

/**
 * "Delete for me" on the Messages page (owner-approved polish 2026-11-20): the
 * thread staged for its confirm, the confirm itself, and the write. Off THIS
 * member's list for good (see deleteConversationForMe): nothing is deleted on
 * the server, the other person keeps the whole thread, and a new message brings
 * it back with only what came after. Not restorable from Archived. Out of
 * Messages.tsx so that file stays under the component-size ratchet.
 */
export function useDeleteForMe({
  userId,
  activeConvo,
  closeThread,
}: {
  userId: string | null;
  activeConvo: Conversation | null;
  closeThread: () => void;
}) {
  const [target, setTarget] = useState<Conversation | null>(null);

  const confirm = async (convo: Conversation) => {
    setTarget(null);
    if (!userId) return;
    hapticHeavy();
    // The open thread is the one going away: leave it first (the same single exit as the back button).
    if (activeConvo && activeConvo.jobId === convo.jobId && activeConvo.otherUserId === convo.otherUserId) closeThread();
    const ok = await deleteConversationForMe(userId, convo.jobId, convo.otherUserId);
    if (ok) {
      hapticSuccess();
      toast(t("msg.deletedForMe"));
    } else {
      hapticError();
      toast.error(t("msg.deleteForMeFailed"));
    }
  };

  const dialog = (
    <BrandConfirmDialog
      open={!!target}
      onOpenChange={(o) => { if (!o) setTarget(null); }}
      title={t("msg.deleteForMeTitle")}
      description={
        // Q335: a deleted account can never send again, so there is no "comes back" to promise.
        target?.otherUserId === null
          ? t("msg.deleteForMeDeletedBody")
          : t("msg.deleteForMeBody", { name: target?.otherUserName ?? t("msg.thisPerson") })
      }
      primaryLabel={t("msg.deleteForMe")}
      primaryTone="sienna"
      primaryHaptic="warning"
      onPrimary={() => { if (target) void confirm(target); }}
      secondaryLabel={t("msg.cancel")}
    />
  );

  return { requestDeleteForMe: setTarget, deleteForMeDialog: dialog };
}
