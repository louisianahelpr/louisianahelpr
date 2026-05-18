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
  created_at: string;
  attachment_url: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
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
  lastMessage: string;
  lastAt: string;
  unread: number;
};
