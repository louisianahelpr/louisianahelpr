import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { supabase } from "@/integrations/supabase/client";
import { hapticError } from "@/lib/haptics";
import { track } from "@/lib/analytics";
import { toast } from "sonner";
import { scanMessage } from "@/lib/messageScanner";
import { requireOnline } from "@/lib/requireOnline";
import type { Conversation, Message } from "@/components/messages/types";
import { logViolation } from "../logViolation";
import {
  threadClosedCopy,
  fetchMessagingClosesAt,
  isLockoutRefusal,
} from "@/lib/messagingLockout";
import { RECIPIENT_RESTRICTED_TOAST, fetchRecipientRestricted } from "@/lib/recipientGate";
import { OFF_JOB_TOAST, fetchOffJobState } from "@/lib/offJobGate";
import { DELETED_ACCOUNT_NOTICE } from "@/lib/deletedCounterparty";

// Module-level so it survives the per-render re-creation of the handlers:
// a blocked send logs at most ONE violation per unique (user, message) —
// retrying the identical text re-blocks but must not re-log, since two
// logged violations reach the permanent-ban branch.
let lastLoggedViolationKey: string | null = null;

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
  setActiveConvo,
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
  /** Lets a lockout refusal flip the open thread to its read-only notice. */
  setActiveConvo?: Dispatch<SetStateAction<Conversation | null>>;
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
    // Q262: a thread whose other party deleted their account has no receiver
    // (messages.receiver_id ON DELETE SET NULL). There is nobody to deliver to,
    // so refuse locally instead of sending a row the INSERT policy rejects.
    const receiverId = optimistic.receiver_id;
    if (receiverId === null) {
      setMessages((prev) =>
        prev.map((m) =>
          m.clientId === optimistic.clientId ? { ...m, sendStatus: "refused" } : m,
        ),
      );
      hapticError();
      toast.error(DELETED_ACCOUNT_NOTICE);
      return;
    }
    const insertRow = (withClientId: boolean) => supabase
      .from("messages")
      .insert({
        // Q268 idempotency key. The bubble's clientId is minted once in
        // sendMessage and reused by retryMessage, so "Tap to Retry" on a send
        // whose RESPONSE was lost resends the SAME key and the server's
        // UNIQUE (sender_id, client_id) refuses the second row (23505),
        // handled below as "it already landed".
        ...(withClientId && optimistic.clientId ? { client_id: optimistic.clientId } : {}),
        job_id: optimistic.job_id,
        sender_id: optimistic.sender_id,
        receiver_id: receiverId,
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
        // Same defensive spread as attachment_duration: omitted entirely when
        // absent so the insert still succeeds against a database that predates
        // the reply_to_id column.
        ...(optimistic.reply_to_id ? { reply_to_id: optimistic.reply_to_id } : {}),
      })
      .select("*")
      .single();

    let { data, error } = await insertRow(true);
    // A retry whose first INSERT already landed was counted then (Q283).
    let alreadyLanded = false;
    // Deploy lag: a database that predates messages.client_id answers PGRST204
    // for the unknown column. Send without the key rather than fail the send.
    if (error && (error as { code?: string }).code === "PGRST204" && /client_id/.test(error.message ?? "")) {
      ({ data, error } = await insertRow(false));
    }
    // The retry of a send that already landed: the first INSERT reached the
    // server and only its response was lost. That row IS this message, so read
    // it back and reconcile the bubble with it instead of calling it failed.
    if (error && (error as { code?: string }).code === "23505" && optimistic.clientId) {
      const existing = await supabase
        .from("messages")
        .select("*")
        .eq("sender_id", optimistic.sender_id)
        .eq("client_id", optimistic.clientId)
        .maybeSingle();
      if (!existing.error && existing.data) {
        data = existing.data;
        error = null;
        alreadyLanded = true;
      }
    }

    if (error || !data) {
      // Keep the text on screen and let the user retry it.
      hapticError();
      // Thread closed — 24h after completion, or immediately on cancellation
      // (20260919220233). RLS refuses with 42501 and no reason, so
      // ask the server when this thread closes (the local value can be stale:
      // loaded before the job completed, or a device clock behind the
      // server's). If that explains the refusal, say so and flip the thread
      // to its read-only notice instead of inviting a retry that cannot work.
      if ((error as { code?: string } | null)?.code === "42501") {
        const closesAt =
          (await fetchMessagingClosesAt([optimistic.job_id])).get(optimistic.job_id) ?? null;
        if (isLockoutRefusal(error, closesAt)) {
          /* RE-READ THE STATUS, do not trust the one in hand.
             Both ways a thread closes need DIFFERENT copy (the completed
             wording names a 24-hour rule that is false of a cancellation),
             and the locally-held `jobStatus` is exactly the field that is
             stale here: the common case is the OTHER party cancelling while
             this one was typing, so `activeConvo.jobStatus` still says
             `in_progress` and the copy would confidently report a completion
             that never happened.
             One extra read, on an error path that has already made one, in
             exchange for never telling somebody their cancelled job was
             completed. Errors are ignored deliberately — the fallback is the
             status already in hand, and a failed status read must not turn a
             handled refusal into an unhandled one. `.select("status")` with
             `maybeSingle()` returns null rather than throwing when RLS hides
             the row. */
          const { data: jobRow } = await supabase
            .from("jobs")
            .select("status")
            .eq("id", optimistic.job_id)
            .maybeSingle();
          const closedStatus = jobRow?.status ?? activeConvo?.jobStatus ?? null;
          toast.error(threadClosedCopy(closedStatus).toast);
          const patch = (c: Conversation) =>
            c.jobId === optimistic.job_id
              ? { ...c, messagingClosesAt: closesAt, jobStatus: closedStatus }
              : c;
          setConversations((prev) => prev.map(patch));
          setActiveConvo?.((prev) => (prev ? patch(prev) : prev));
          // `refused`, not `failed`: the bubble keeps the text but offers no
          // tap-to-retry, because a retry into a closed thread cannot work.
          setMessages((prev) =>
            prev.map((m) =>
              m.clientId === optimistic.clientId ? { ...m, sendStatus: "refused" } : m,
            ),
          );
          return;
        }
        const rlsRefusal = /row-level security/i.test(
          (error as { message?: string } | null)?.message ?? "",
        );
        // Off the job (owner, 2026-09-25): once either person in the thread is
        // no longer on the job, the INSERT gate refuses both directions. Ask
        // the server's own read; if that is the reason, the thread becomes
        // read-only and the bubble is non-retryable (a retry cannot work),
        // instead of the retryable "didn't go through" below. Only for the RLS
        // policy's refusal, like the receiver gate after it.
        if (rlsRefusal) {
          const offJob = await fetchOffJobState(optimistic.job_id, receiverId);
          if (offJob) {
            toast.error(OFF_JOB_TOAST);
            // Only the OPEN thread is flipped; reopening it asks the server again.
            setActiveConvo?.((prev) =>
              prev && prev.jobId === optimistic.job_id && prev.otherUserId === receiverId
                ? { ...prev, offJobState: offJob }
                : prev,
            );
            setMessages((prev) =>
              prev.map((m) =>
                m.clientId === optimistic.clientId ? { ...m, sendStatus: "refused" } : m,
              ),
            );
            return;
          }
        }
        // Receiver gate: only the poster may message applicants and an offered
        // Helpr (can_send_message_to_in_job). Ask that same server function
        // whether it is the reason; if so the thread becomes read-only for this
        // viewer and the bubble is non-retryable, like the lockout above.
        // Only for the RLS policy's refusal: the ban and block triggers also
        // raise 42501, with their own messages, and the gate answers false for
        // those too.
        // fetchRecipientRestricted also returns false for the poster itself and
        // for any caller who cannot reach the poster either (banned, replaced,
        // rate-capped), so those keep the ordinary retry below.
        const posterId =
          activeConvo?.jobId === optimistic.job_id ? (activeConvo.posterId ?? null) : null;
        if (
          rlsRefusal &&
          (await fetchRecipientRestricted(
            optimistic.job_id,
            receiverId,
            optimistic.sender_id,
            posterId,
          ))
        ) {
          toast.error(RECIPIENT_RESTRICTED_TOAST);
          // Only the OPEN thread is flipped: reopening it from the inbox asks
          // the server again, so the notice cannot outlive the rule (an offer
          // accepted later makes the thread sendable again).
          setActiveConvo?.((prev) =>
            prev && prev.jobId === optimistic.job_id && prev.otherUserId === receiverId
              ? { ...prev, recipientRestricted: true }
              : prev,
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.clientId === optimistic.clientId ? { ...m, sendStatus: "refused" } : m,
            ),
          );
          return;
        }
      }
      toast.error("Message didn't go through — tap it to try again.");
      setMessages((prev) =>
        prev.map((m) =>
          m.clientId === optimistic.clientId ? { ...m, sendStatus: "failed" } : m,
        ),
      );
      return;
    }

    // Key product event (Q283): once per stored message, never for a retry
    // that only recovered a row an earlier attempt already wrote.
    if (!alreadyLanded) track("message_sent", { job_id: optimistic.job_id });

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
    replyToId?: string | null,
    opts?: { isLocationShare?: boolean },
  ): Promise<boolean> => {
    if (!requireOnline()) return false;
    if (!activeConvo || !userId) return false;
    // Q262: the other party deleted their account; the composer is replaced by
    // a read-only notice, and this refuses a send that reaches here anyway.
    if (activeConvo.otherUserId === null) return false;
    if (!content.trim() && !attachment) return false;

    // Scan every piece of user-entered text — including captions on
    // attachment messages. Only the app-generated location share skips the
    // scan, identified by the explicit flag threaded from the share-location
    // path (a user-typed "📍" prefix must not exempt a message).
    const skipScan = opts?.isLocationShare === true;

    if (!skipScan && content.trim()) {
      const violations = scanMessage(content);
      if (violations.length > 0) {
        const violationDesc = violations.map((v) => v.label).join(", ");
        if (!warningShown) {
          setWarningShown(true);
          // Neutral by design (docs/OPEN.md queue #1 residual, 2026-09-15):
          // the CLIENT scanner is advisory only and flags a few phrases
          // ("my number", "my email", F-TRUST-01) the SERVER's
          // contact_leak_reason deliberately does not act on. Claiming a
          // strike here — before logViolation's RPC below has even asked the
          // server whether this text is a real violation — told the truth
          // only when the two rules agreed. Strike/warning wording now comes
          // from that RPC's own verdict (logViolation.ts), never from the
          // client's guess.
          toast.error(
            "Remove contact details (phone number, email, payment app, etc.) to send this message.",
            { duration: 6000 }
          );
        }
        // Log once per unique blocked message — a retry of the identical
        // text is still blocked but doesn't accrue another violation.
        const violationKey = `${userId}|${content}`;
        if (lastLoggedViolationKey !== violationKey) {
          lastLoggedViolationKey = violationKey;
          await logViolation(userId, cachedUser, violationDesc, content);
        }
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
      reply_to_id: replyToId ?? null,
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
