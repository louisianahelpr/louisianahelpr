export type SendAttachment = {
  path: string;
  mime: string;
  size: number;
  /** Duration in seconds — only set for voice notes. */
  duration?: number;
};

export interface RichMessageInputProps {
  /**
   * Job quick-replies, rendered inside the "+" sheet rather than as their own
   * row above the composer.
   *
   * They used to sit in a horizontally-scrolling strip between the thread and
   * the input, where the third chip was always clipped mid-word by the fade
   * mask. iPhone keeps this class of shortcut one tap deeper, behind the "+",
   * and the owner picked that arrangement. Passed as a node because the chips
   * need the thread's send handler, which lives up in ChatComposer.
   */
  quickReplies?: React.ReactNode;
  onSend: (
    content: string,
    attachment?: SendAttachment,
    /** Set by the share-location path so the app-generated share (and only
     *  it) can skip the content scan — user-typed "📍" prefixes don't. */
    opts?: { isLocationShare?: boolean },
  ) => void;
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
