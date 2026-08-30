import { useState } from "react";

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
 *
 * The state label ("Delivered"/"Read") is available on hover (native
 * `title`) and on tap (the indicator is a real `<button>` that toggles an
 * inline text label — `title` never fires on touch, so hover-only would
 * leave phone/native users with no way to see it).
 *
 * NOTE — no per-message read TIMESTAMP is shown. `public.messages` only
 * has a boolean `read` column (see src/integrations/supabase/types.ts and
 * every `.update({ read: true })` call site — grepped, no `read_at` exists
 * anywhere in the schema). Rendering a real "Read 2:14 PM" needs a
 * migration adding `read_at timestamptz` plus wiring it through the
 * mark-read paths in src/pages/messages/useMessagesData.ts and
 * useMessagesRealtime.ts — both outside this session's scope (owned by a
 * parallel session on the Messages list). Stubbed to the boolean state's
 * label until that lands.
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
  const [revealed, setRevealed] = useState(false);
  if (!sentByMe) return null;
  if (!read) {
    return (
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        // role="img" was here to keep aria-label from being discarded on a
        // roleless <span>; a real <button> carries its own accessible name
        // natively, so that workaround is gone along with the span.
        //
        // Inline `minHeight/minWidth: 0` overrides the global touch-target
        // rule (index.css `button { min-height/min-width: 44px }`, higher
        // specificity than any Tailwind class) which would otherwise inflate
        // this into a 44px box inside the compact meta row — the same
        // overflow pattern fixed on the banner dismiss button. The `::before`
        // restores a real 44px hit target without the box itself growing.
        style={{ minHeight: 0, minWidth: 0 }}
        className="relative inline-flex items-center gap-1 ml-1 before:absolute before:-inset-2.5 before:content-['']"
        aria-label="Delivered"
        aria-pressed={revealed}
        title="Delivered"
      >
        <span className="text-ds-10 font-sans font-semibold" style={{ color: "hsl(var(--bark) / 0.55)" }}>
          ✓
        </span>
        {revealed && (
          <span className="text-ds-9 font-sans" style={{ color: "hsl(var(--bark) / 0.55)" }}>
            Delivered
          </span>
        )}
      </button>
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
    <button
      type="button"
      onClick={() => setRevealed((v) => !v)}
      // See the unread branch above for why this needs an inline
      // min-height/min-width override plus a `::before` hit target.
      style={{ minHeight: 0, minWidth: 0 }}
      className="relative inline-flex items-center gap-1 ml-1 before:absolute before:-inset-2.5 before:content-['']"
      aria-label={recipientName ? `Read by ${recipientName}` : "Read"}
      aria-pressed={revealed}
      title="Read"
    >
      <span
        className="inline-flex items-center justify-center w-4 h-4 rounded-full overflow-hidden shrink-0"
        style={{
          background: "hsl(var(--bark) / 0.18)",
          border: "0.5px solid hsl(var(--bark) / 0.32)",
        }}
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
      {revealed && (
        <span className="text-ds-9 font-sans" style={{ color: "hsl(var(--bark) / 0.7)" }}>
          Read
        </span>
      )}
    </button>
  );
};
