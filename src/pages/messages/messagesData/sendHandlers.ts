import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { supabase } from "@/integrations/supabase/client";
import { hapticError } from "@/lib/haptics";
import { toast } from "sonner";
import { scanMessage } from "@/lib/messageScanner";
import { requireOnline } from "@/lib/requireOnline";
import type { Conversation, Message } from "@/components/messages/types";
import { logViolation } from "../logViolation";

/**
 * The outbound-send slice of the Messages data layer, extracted verbatim from
 * `useMessagesData`. Owns the optimistic-send bubble lifecycle
 * (`dispatchMessage`), the content-scan + violation gate (`sendMessage`), the
 * failed-send retry (`retryMessage`), and the single-row inbox patch for an
 * inbound/outbound message (`patchConversationForMessage`). Every Supabase
 * insert, its error handling, the clientId dedupe reconciliation, the unread-
 * count math, and every "why" comment are preserved unchanged.
 *
 * The hook injects the state it owns (setters, `activeConvo`/`userId`, the
 * `messages` snapshot `retryMessage` reads, the `warningShown` guard,
 * `scrollToBottom`, `activeConvoRef`, and the shared `loadConversations`) so
 * the returned handlers keep the exact signatures the page calls.
 */
export function createSendHandlers({
  userId,
  cachedUser,
  activeConvo,
  messages,
  warningShown,
  setWarningShown,
  setMessages,
  setConversations,
  scrollToBottom,
  activeConvoRef,
  loadConversations,
}: {
  userId: string | null;
  cachedUser: { user_metadata?: { full_name?: string } } | null | undefined;
  activeConvo: Conversation | null;
  messages: Message[];
  warningShown: boolean;
  setWarningShown: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  activeConvoRef: MutableRefObject<Conversation | null>;
  loadConversations: (uid: string) => Promise<void>;
}) {
  // Patch a single conversation in local state for one inbound/outbound
  // message — instead of re-running the whole 200-row + RPC
  // `loadConversations`. Updates the affected thread's last-message,
  // unread count, and timestamp, then re-sorts. If the message belongs
  // to a thread not yet in the list (rare — a brand-new conversation),
  // fall back to a full refetch so the new row's profile/job metadata
  // gets resolved.
  const patchConversationForMessage = (msg: Message) => {
    if (!userId) return;
    // System messages have no human sender — they're status notifications
    // that don't update the inbox preview or unread count.
    if (msg.is_system) return;
    const other = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
    let matched = false;
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.jobId !== msg.job_id || c.otherUserId !== other) return c;
        matched = true;
        // An inbound message to a thread that is NOT currently open
        // increments the unread badge; outbound messages and messages
        // in the open thread do not.
        const active = activeConvoRef.current;
        const isInboundUnseen =
          msg.receiver_id === userId &&
          !(active &&
            active.jobId === msg.job_id &&
            active.otherUserId === other);
        return {
          ...c,
          lastMessage: msg.content,
          lastAt: msg.created_at,
          unread: isInboundUnseen ? c.unread + 1 : c.unread,
          // Keep the rich-preview metadata in lockstep with the latest
          // message so "You: " prefix and image-thumb previews update
          // live on realtime inserts (and on the sender's own echo).
          lastMessageSenderId: msg.sender_id,
          lastMessageAttachmentPath: msg.attachment_url,
          lastMessageAttachmentMime: msg.attachment_mime,
        };
      });
      if (!matched) return prev;
      // Re-sort so the freshly-touched thread floats to the top.
      next.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
      return next;
    });
    // New conversation we've never seen — only then pay for a full
    // refetch (needs profile + job RPCs to render the row).
    if (!matched) loadConversations(userId);
  };

  // Performs the actual insert for one optimistic message and reconciles
  // its bubble with the server row (or marks it failed). Shared by the
  // first-attempt send path and the retry path so both stay in sync.
  const dispatchMessage = async (optimistic: Message) => {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        job_id: optimistic.job_id,
        sender_id: optimistic.sender_id,
        receiver_id: optimistic.receiver_id,
        content: optimistic.content,
        attachment_url: optimistic.attachment_url,
        attachment_mime: optimistic.attachment_mime,
        attachment_size: optimistic.attachment_size,
        // attachment_duration may be null pre-migration — Supabase ignores unknown
        // columns gracefully until the migration is pushed; if the column exists
        // it is stored, if not the row still inserts (no column → ignored by Postgres).
        ...(optimistic.attachment_duration != null
          ? { attachment_duration: optimistic.attachment_duration }
          : {}),
      })
      .select("*")
      .single();

    if (error || !data) {
      // Keep the text on screen and let the user retry it.
      hapticError();
      toast.error("Message didn't go through — tap it to try again.");
      setMessages((prev) =>
        prev.map((m) =>
          m.clientId === optimistic.clientId ? { ...m, sendStatus: "failed" } : m,
        ),
      );
      return;
    }

    // Reconcile: swap the optimistic bubble for the confirmed server row.
    // If the realtime echo raced ahead and already appended the real row,
    // drop the optimistic placeholder instead of leaving a duplicate.
    setMessages((prev) => {
      const realAlreadyPresent = prev.some(
        (m) => m.id === data.id && m.clientId === undefined,
      );
      if (realAlreadyPresent) {
        return prev.filter((m) => m.clientId !== optimistic.clientId);
      }
      return prev.map((m) =>
        m.clientId === optimistic.clientId ? { ...data, clientId: optimistic.clientId } : m,
      );
    });
    // Refresh the conversation list so the sender's own thread re-sorts.
    loadConversations(userId!);
  };

  // Returns `true` when the message was accepted for delivery, `false`
  // when it was blocked by the content scan (or there was nothing to
  // send). The caller (ChatView) keys off this to decide whether to
  // clear the composer — a blocked message keeps the user's typed text
  // so they don't silently lose what they wrote.
  const sendMessage = async (
    content: string,
    attachment?: { path: string; mime: string; size: number; duration?: number },
  ): Promise<boolean> => {
    if (!requireOnline()) return false;
    if (!activeConvo || !userId) return false;
    if (!content.trim() && !attachment) return false;

    // Skip scanning for system-generated messages (location shares, attachments)
    const isSystemMessage = content.startsWith("📍 Location:") || !!attachment;

    if (!isSystemMessage) {
      const violations = scanMessage(content);
      if (violations.length > 0) {
        const violationDesc = violations.map((v) => v.label).join(", ");
        if (!warningShown) {
          setWarningShown(true);
          toast.error(
            "⚠️ Warning: Sharing contact info or taking business off-platform is not allowed. This is your first warning — a second offense will result in a permanent ban.",
            { duration: 8000 }
          );
        }
        await logViolation(userId, cachedUser, violationDesc, content);
        // Blocked — report back so the composer keeps the typed text
        // rather than silently discarding it.
        return false;
      }
    }

    // Render the bubble instantly in a "sending" state. The clientId is a
    // stable nonce: it survives reconciliation and lets the realtime echo
    // of our own INSERT be matched back to this bubble (dedupe), while the
    // temporary `id` keeps React keys unique until the server row arrives.
    const clientId = crypto.randomUUID();
    const optimistic: Message = {
      id: `optimistic-${clientId}`,
      job_id: activeConvo.jobId,
      sender_id: userId,
      receiver_id: activeConvo.otherUserId,
      content: content.trim(),
      read: false,
      created_at: new Date().toISOString(),
      attachment_url: attachment?.path ?? null,
      attachment_mime: attachment?.mime ?? null,
      attachment_size: attachment?.size ?? null,
      attachment_duration: attachment?.duration ?? null,
      clientId,
      sendStatus: "sending",
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom();

    await dispatchMessage(optimistic);
    return true;
  };

  // Retry a previously failed send: flip the bubble back to "sending" and
  // re-dispatch the same content rather than dropping the user's text.
  const retryMessage = async (clientId: string) => {
    const failed = messages.find((m) => m.clientId === clientId && m.sendStatus === "failed");
    if (!failed) return;
    setMessages((prev) =>
      prev.map((m) => (m.clientId === clientId ? { ...m, sendStatus: "sending" } : m)),
    );
    await dispatchMessage({ ...failed, sendStatus: "sending" });
  };

  return {
    patchConversationForMessage,
    dispatchMessage,
    sendMessage,
    retryMessage,
  };
}
