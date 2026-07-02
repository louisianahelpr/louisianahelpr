export type SendAttachment = {
  path: string;
  mime: string;
  size: number;
  /** Duration in seconds — only set for voice notes. */
  duration?: number;
};

export interface RichMessageInputProps {
  onSend: (content: string, attachment?: SendAttachment) => void;
  onTyping?: () => void;
  disabled?: boolean;
  /** Optional controlled value — when provided, parent owns the text state. */
  value?: string;
  onChange?: (value: string) => void;
  /** Job ID for the active conversation — required for attachment uploads. */
  jobId?: string;
  /** Sender ID (current user) — required for attachment uploads (path scoping). */
  senderId?: string;
}
