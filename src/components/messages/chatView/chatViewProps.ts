/** Props of ChatView (src/components/messages/ChatView.tsx); moved out whole so the component file stays under the size ratchet. */
import type { Dispatch, Ref, SetStateAction } from "react";
import type { BlockTarget } from "@/components/BlockUserDialog";
import type { Conversation, Message } from "../types";
import type { JobSystemEvent } from "@/lib/jobSystemEvents";

export interface ChatViewProps {
  /** The open conversation — this component only renders inside the
   *  activeConvo branch, so it is always non-null. */
  activeConvo: Conversation;
  /** Leave the thread and return to the inbox. Owned by the Messages page,
   *  because closing has to clear the `?chat=1` flag from the URL as well as
   *  the state — MobileNav hides the whole bottom dock while that flag is
   *  set, so a close that only nulls the state strands the user on a list
   *  with no navigation. See the contract on chatOpenPath. */
  onCloseThread: () => void;
  /** Soft-keyboard inset (px) so the composer clears the keyboard. */
  keyboardInset: number;
  /** Presence — from the page's useChatPresence hook. */
  isOtherOnline: boolean;
  isOtherTyping: boolean;
  broadcastTyping: () => void;
  messages: Message[];
  userId: string | null;
  /** True when the thread fetch failed — shows a recoverable error
   *  state instead of the misleading "Say hello." empty state. */
  chatLoadError: boolean;
  /** True while a newly-opened conversation's messages are still being
   *  fetched — shows a skeleton instead of a blank window or the
   *  misleading "Say hello." empty state. */
  chatLoading: boolean;
  /** Re-runs the thread fetch for the open conversation. */
  onRetryLoad: () => void;
  hasMoreMessages: boolean;
  loadingMore: boolean;
  loadOlderMessages: () => void;
  /** Pull-to-refresh handler — re-fetches the latest page of the open
   *  thread. Resolves once the refetch completes. */
  onRefreshThread: () => Promise<void>;
  /** Sends a message. Resolves `true` when accepted for delivery,
   *  `false` when blocked by the content scan — the composer keeps the
   *  typed text on `false` so a blocked message isn't silently lost. */
  sendMessage: (
    content: string,
    attachment?: { path: string; mime: string; size: number; duration?: number },
    replyToId?: string | null,
    opts?: { isLocationShare?: boolean },
  ) => Promise<boolean>;
  /** Re-dispatch a previously failed optimistic message by its clientId. */
  retryMessage: (clientId: string) => void;
  /** Scroll container + bottom sentinel — created by the page so its
   *  realtime/scroll handlers can read them; attached to nodes here. */
  chatContainerRef: Ref<HTMLDivElement>;
  bottomRef: Ref<HTMLDivElement>;
  setReportTarget: Dispatch<SetStateAction<{ type: "message" | "user"; id: string } | null>>;
  setBlockTarget: Dispatch<SetStateAction<BlockTarget | null>>;
  setDeleteMessageConfirm: Dispatch<SetStateAction<string | null>>;
  /** Persist an edit to a sent message's content. Mirrors the sender-only,
   *  15-minute-window RLS policy — see
   *  supabase/migrations/20260831003117_add_message_editing.sql. */
  onEditMessage: (messageId: string, newContent: string) => Promise<void>;
  /** Toggle the muted state of the open thread. Mute is per-user and
   *  silences push only — the conversation stays visible and the unread
   *  badge still increments (matches iMessage's "Hide Alerts"). */
  onToggleMute: (convo: Conversation) => void;
  /** Set a snooze for the open thread until a caller-supplied future
   *  time. `null` mutes forever. Used by the MuteSheet picker. */
  onSnoozeMute: (convo: Conversation, until: Date | null) => void;
  /** Explicit unmute — clears any forever or snoozed mute. */
  onUnmute: (convo: Conversation) => void;
  /** System-event entries derived from the active job's transition
   *  timestamps — rendered as styled centered <div>s interleaved with
   *  the messages so both participants see status changes in the same
   *  scroll. NOT real message rows. */
  jobSystemEvents: JobSystemEvent[];
  /** When true, render only the chat body (no AppShell / fixed-viewport
   *  lock, no centered max-width column) so the desktop Messages page can
   *  host it as the right pane of a list+thread split. Defaults to false —
   *  mobile/native render the full standalone shell exactly as before. */
  embedded?: boolean;
}
