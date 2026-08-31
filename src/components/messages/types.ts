/**
 * Shared types for the Messages page and its extracted sub-components.
 * Lives in a leaf module so both the page and the component depend on it
 * (rather than a component reaching back into the page).
 */

export type Message = {
  id: string;
  job_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  /** When `read` was set. Absent on older rows written before this column
   *  existed and on unread messages — see
   *  supabase/migrations/20260830233932_add_messages_read_at.sql. */
  read_at?: string | null;
  created_at: string;
  /** Set by a server-side trigger the first time the sender edits `content`.
   *  Null on never-edited messages. See
   *  supabase/migrations/20260831003117_add_message_editing.sql. */
  edited_at?: string | null;
  attachment_url: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  /** Duration in seconds — only set for audio/voice-note messages. */
  attachment_duration: number | null;
  /** Message this one replies to, or null. FK is ON DELETE SET NULL, so a
   *  reply survives its parent being deleted — it just stops quoting. */
  reply_to_id?: string | null;
  /**
   * Optimistic-send bookkeeping. Absent on rows loaded from the DB or
   * received over realtime — present only on bubbles the local user has
   * just sent and that have not yet been confirmed by the server.
   *
   * - `clientId`: a client-generated nonce that survives reconciliation.
   *   It lets the realtime INSERT echo of our own message be matched back
   *   to the optimistic bubble so we don't render a duplicate.
   * - `sendStatus`: `"sending"` while the insert is in flight, `"failed"`
   *   if it errored (the bubble offers a retry). Confirmed messages leave
   *   this `undefined`.
   */
  clientId?: string;
  sendStatus?: "sending" | "failed";
  /**
   * True for DB-generated status-change notifications (sender_id is NULL).
   * These render as centered italic pills in the thread instead of chat
   * bubbles. Never set on messages created by a human sender.
   */
  is_system?: boolean;
};

export type Conversation = {
  otherUserId: string;
  otherUserName: string;
  otherUserAvatarUrl?: string | null;
  jobTitle: string;
  jobId: string;
  /** Job status — surfaced as a chip in the chat header so participants
      see at a glance whether they're discussing an open posting, an
      awarded job, or a completed one. */
  jobStatus?: string | null;
  /** True when the current user posted the job — drives poster-specific
      quick reply set in the chat composer. */
  viewerIsPoster?: boolean;
  /** True when the current user is the job's assigned (`helper_id`) or
      offered (`offered_to_helper_id`) helper. Mirrors case 2 of the
      `can_message_in_job` RLS check, so the client's poster-first lock
      cannot be stricter than the server's own rule. */
  viewerIsAssignedHelper?: boolean;
  lastMessage: string;
  lastAt: string;
  unread: number;
  /** Sender of the last message — drives the iMessage-style "You: " prefix
      on the preview row when the current user sent it. */
  lastMessageSenderId?: string | null;
  /** Storage path of the last-message attachment (NOT a URL — resolved via
      `getMessageAttachmentSignedUrl` at render time). Only set when the
      last message carried an attachment. */
  lastMessageAttachmentPath?: string | null;
  /** MIME of the last-message attachment. Used with `isImageMime` to
      decide whether to render a thumbnail preview vs treat as a file. */
  lastMessageAttachmentMime?: string | null;
  /** Pre-resolved signed URL for the last-message image thumbnail, when
      `lastMessageAttachmentPath` points at an image attachment. Batched
      with `createSignedUrls` in `loadConversations` so the inbox doesn't
      fire one round-trip per row (N+1 across image-last-message threads).
      Stays absent for text-only or non-image attachments. */
  lastMessageAttachmentSignedUrl?: string | null;
  /** True when the current user has muted this thread — drives a
      bell-slash icon on the row and a "Muted" pill in the chat header.
      Resolved in batch from `get_muted_threads` per `loadConversations`. */
  isMuted?: boolean;
  /** When the mute ends. `null` (with `isMuted = true`) means muted
      forever; a future ISO timestamp means muted until that moment
      ("snoozed"). Used to render "Muted for 8h" copy and to flip
      `isMuted` back to false once the snooze expires locally. */
  muteUntil?: string | null;
  /** ISO timestamp of the other user's most recent login (from the
      `get_user_last_active` RPC). Drives a quiet "Active now" / "Active
      2h ago" inline label on the conversation row so a poster can
      gauge how likely a helpr is to reply soon. Absent when the RPC is
      undeployed (PGRST202) or older than the 7-day staleness cutoff. */
  otherUserLastActiveAt?: string | null;
};
