/**
 * Presence dot. Online is the assumed default, so we render nothing when the
 * other user is online — a dot only appears (muted) when they're offline.
 */
export const OnlineIndicator = ({ isOnline }: { isOnline: boolean }) => {
  if (isOnline) return null;
  return (
    <span
      className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30"
      title="Offline"
    />
  );
};

export const TypingIndicator = () => (
  <div className="flex items-center gap-1 text-ds-11 text-muted-foreground px-4 py-1">
    <span className="flex gap-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 motion-safe:animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 motion-safe:animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 motion-safe:animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
    typing…
  </div>
);

/**
 * Read receipt — Slack-style. Unread shows a single bark checkmark
 * ("delivered"). Read shows the recipient's avatar (or initials) so the
 * "seen" moment carries a face, not just a check. Only renders on the
 * sender's side.
 */
export const ReadReceipt = ({
  read,
  sentByMe,
  recipientName,
  recipientAvatarUrl,
}: {
  read: boolean;
  sentByMe: boolean;
  /** Required for the read-state initials fallback. */
  recipientName?: string | null;
  /** Recipient profile photo — preferred. */
  recipientAvatarUrl?: string | null;
}) => {
  if (!sentByMe) return null;
  if (!read) {
    return (
      // role="img": ARIA prohibits aria-label on a roleless element, so the
      // label was being DISCARDED and the receipt announced only its bare "✓"
      // glyph. Same fix the codebase already uses on ProfileHeaderCard's star
      // row (and the rule IdentityHeader.tsx documents in a comment).
      <span
        role="img"
        className="text-ds-10 font-sans font-semibold ml-1"
        style={{ color: "hsl(var(--bark) / 0.55)" }}
        aria-label="Delivered"
        title="Delivered"
      >
        ✓
      </span>
    );
  }
  const initials = (recipientName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
  return (
    <span
      role="img"
      className="inline-flex items-center justify-center w-4 h-4 rounded-full ml-1 overflow-hidden"
      style={{
        background: "hsl(var(--bark) / 0.18)",
        border: "0.5px solid hsl(var(--bark) / 0.32)",
      }}
      // Without role="img" this label was discarded, so the read receipt
      // announced either nothing (avatar with alt="") or a bare initials
      // fragment like "JD" — never that the message had been read.
      aria-label={recipientName ? `Read by ${recipientName}` : "Read"}
      title="Read"
    >
      {recipientAvatarUrl ? (
        <img
          loading="lazy"
          decoding="async"
          src={recipientAvatarUrl}
          alt=""
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="text-ds-9 font-sans font-bold" style={{ color: "hsl(var(--bark))" }}>
          {initials}
        </span>
      )}
    </span>
  );
};
