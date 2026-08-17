import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { report } from "@/lib/errorLogger";
import { hapticHeavy, hapticSuccess, hapticError } from "@/lib/haptics";
import { toast } from "sonner";
import { snoozeThread, toggleThreadMute, unmuteThread } from "@/lib/threadMutes";
import type { Conversation } from "@/components/messages/types";

/**
 * Mute-state actions for the Messages page — the binary toggle, the
 * picker-driven snooze, and the explicit unmute. All three are optimistic
 * with rollback and keep the conversation list and the active-thread mirror
 * coherent via `patchMuteState`. Extracted verbatim from Messages.tsx.
 */
export function useThreadMuteActions({
  userId,
  activeConvoRef,
  setConversations,
  setActiveConvo,
}: {
  userId: string | null;
  activeConvoRef: MutableRefObject<Conversation | null>;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setActiveConvo: Dispatch<SetStateAction<Conversation | null>>;
}) {
  // Patch a conversation's mute state across both the list and the
  // active-thread mirror in one go. Used by every code path that flips
  // the mute (toggle, snooze, unmute) so they all stay coherent.
  const patchMuteState = useCallback(
    (jobId: string, otherUserId: string, muted: boolean, muteUntil: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.jobId === jobId && c.otherUserId === otherUserId
            ? { ...c, isMuted: muted, muteUntil }
            : c,
        ),
      );
      if (
        activeConvoRef.current &&
        activeConvoRef.current.jobId === jobId &&
        activeConvoRef.current.otherUserId === otherUserId
      ) {
        setActiveConvo((cur) =>
          cur ? { ...cur, isMuted: muted, muteUntil } : cur,
        );
      }
    },
    [activeConvoRef, setConversations, setActiveConvo],
  );

  // Toggle the muted state of the active thread (or any conversation by
  // jobId+otherUserId). Optimistic: flip the local flag immediately and
  // reconcile against the RPC's authoritative return value. On error,
  // revert and surface a toast so the bell-slash never silently lies.
  //
  // This is the "binary" toggle — for the picker-driven snooze flow,
  // callers use `handleSnoozeMute` below.
  const handleToggleMute = useCallback(
    async (convo: Conversation) => {
      if (!userId) return;
      const prevMuted = !!convo.isMuted;
      const prevUntil = convo.muteUntil ?? null;
      hapticHeavy();
      patchMuteState(convo.jobId, convo.otherUserId, !prevMuted, null);
      try {
        const newMuted = await toggleThreadMute(
          userId,
          convo.jobId,
          convo.otherUserId,
        );
        patchMuteState(convo.jobId, convo.otherUserId, newMuted, null);
        hapticSuccess();
        toast.success(newMuted ? "Notifications muted" : "Notifications on");
      } catch (err) {
        report(err, {
          severity: "warning",
          tags: { source: "Messages.handleToggleMute" },
        });
        patchMuteState(convo.jobId, convo.otherUserId, prevMuted, prevUntil);
        hapticError();
        toast.error("Couldn't update mute — try again?");
      }
    },
    [userId, patchMuteState],
  );

  // Snooze a thread until a caller-supplied moment. `null` mutes forever
  // (same end-state as `handleToggleMute` when going off→on); a past
  // timestamp explicitly clears the mute. Optimistic with rollback,
  // mirrors `handleToggleMute`'s recovery model.
  const handleSnoozeMute = useCallback(
    async (convo: Conversation, until: Date | null) => {
      if (!userId) return;
      const prevMuted = !!convo.isMuted;
      const prevUntil = convo.muteUntil ?? null;
      const targetIso = until ? until.toISOString() : null;
      const targetMuted = until ? until.getTime() > Date.now() : true;
      hapticHeavy();
      patchMuteState(
        convo.jobId,
        convo.otherUserId,
        targetMuted,
        targetMuted ? targetIso : null,
      );
      try {
        const serverUntil = await snoozeThread(
          userId,
          convo.jobId,
          convo.otherUserId,
          until,
        );
        const finalMuted = serverUntil
          ? Date.parse(serverUntil) > Date.now()
          : until === null;
        patchMuteState(
          convo.jobId,
          convo.otherUserId,
          finalMuted,
          finalMuted ? serverUntil : null,
        );
        hapticSuccess();
        if (until === null) toast.success("Notifications muted");
        else if (until.getTime() <= Date.now()) toast.success("Notifications on");
        else toast.success(`Muted until ${until.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`);
      } catch (err) {
        report(err, {
          severity: "warning",
          tags: { source: "Messages.handleSnoozeMute" },
        });
        patchMuteState(convo.jobId, convo.otherUserId, prevMuted, prevUntil);
        hapticError();
        toast.error("Couldn't update mute — try again?");
      }
    },
    [userId, patchMuteState],
  );

  // Explicit unmute (clears any forever or snoozed mute). Used by the
  // mute picker's "Turn notifications back on" action.
  const handleUnmute = useCallback(
    async (convo: Conversation) => {
      if (!userId) return;
      const prevMuted = !!convo.isMuted;
      const prevUntil = convo.muteUntil ?? null;
      hapticHeavy();
      patchMuteState(convo.jobId, convo.otherUserId, false, null);
      try {
        await unmuteThread(userId, convo.jobId, convo.otherUserId);
        hapticSuccess();
        toast.success("Notifications on");
      } catch (err) {
        report(err, {
          severity: "warning",
          tags: { source: "Messages.handleUnmute" },
        });
        patchMuteState(convo.jobId, convo.otherUserId, prevMuted, prevUntil);
        hapticError();
        toast.error("Couldn't update mute — try again?");
      }
    },
    [userId, patchMuteState],
  );

  return { patchMuteState, handleToggleMute, handleSnoozeMute, handleUnmute };
}
