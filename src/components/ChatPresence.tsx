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
 * The state label ("Delivered"/"Read [time]") is available on hover (native
 * `title`) and on tap (the indicator is a real `<button>` that toggles an
 * inline text label — `title` never fires on touch, so hover-only would
 * leave phone/native users with no way to see it). The dotted underline is
 * the tap affordance — nothing else about a bare checkmark/avatar hints
 * it's interactive, and native has no hover to discover it by accident.
 *
 * `readAt` is `public.messages.read_at` (added by
 * supabase/migrations/20260830233932_add_messages_read_at.sql) — absent on
 * rows written before that column existed, so the reveal falls back to the
 * bare "Read" label with no time in that case.
 */
export const ReadReceipt = ({
  read,
  readAt,
  sentByMe,
  recipientName,
  recipientAvatarUrl,
}: {
  read: boolean;
  /** ISO timestamp `read` flipped true, when known. */
  readAt?: string | null;
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
        // Negative vertical margins absorb the 44px HIG minimum imposed by the
        // global `button { min-height: 44px }` rule (index.css) so the compact
        // message-meta row stays visually tight while the element's own bounding
        // box meets the tap-target floor. -my-[14px]: 44 − 28 = 16px contribution
        // to the line height, matching the unresized visual content.
        className="relative inline-flex items-center gap-1 ml-1 -my-[14px]"
        aria-label="Delivered"
        aria-pressed={revealed}
        title="Delivered"
      >
        {/* FULL BARK on both, no alpha. At 0.55 the tick and its label measured
            2.26:1 against a 4.5:1 AA floor — the worst text contrast in the
            chat. Bark cannot clear AA below 0.95 (ladder on parchment: 0.55 →
            2.26, 0.7 → 2.96, 0.85 → 3.97, 0.9 → 4.40, 0.95 → 4.89, 1.0 →
            5.44), so rather than invent an 0.95 the receipt takes the same bare
            `hsl(var(--bark))` as the avatar initials below in this file. 5.44:1
            light / 5.82:1 dark. These stay the quietest thing on a message row
            by SIZE (ds-10 / ds-9 against ds-13 bubble copy), which is where the
            hierarchy was actually coming from — the tint was only making them
            hard to read, not making them secondary. */}
        <span
          className="text-ds-10 font-sans font-semibold underline decoration-dotted underline-offset-2"
          style={{ color: "hsl(var(--bark))" }}
        >
          ✓
        </span>
        {revealed && (
          <span className="text-ds-9 font-sans" style={{ color: "hsl(var(--bark))" }}>
            Delivered
          </span>
        )}
      </button>
    );
  }
  const readAtLabel = readAt
    ? new Date(readAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
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
      // See the unread branch above for the -my-[14px] approach.
      className="relative inline-flex items-center gap-1 ml-1 -my-[14px]"
      aria-label={
        recipientName
          ? `Read by ${recipientName}${readAtLabel ? ` at ${readAtLabel}` : ""}`
          : `Read${readAtLabel ? ` at ${readAtLabel}` : ""}`
      }
      aria-pressed={revealed}
      title={readAtLabel ? `Read ${readAtLabel}` : "Read"}
    >
      <span
        className="inline-flex items-center justify-center w-4 h-4 rounded-full overflow-hidden shrink-0 outline outline-1 outline-dotted outline-offset-1"
        style={{
          background: "hsl(var(--bark) / 0.18)",
          border: "0.5px solid hsl(var(--bark) / 0.32)",
          outlineColor: "hsl(var(--bark) / 0.4)",
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
      {/* Same change as the Delivered receipt above, same reason: 0.7 was
          2.96:1, and bark clears AA only at ~0.95. Bare `hsl(var(--bark))`
          matches the initials rendered two lines up. 5.44:1 / 5.82:1. */}
      {revealed && (
        <span className="text-ds-9 font-sans" style={{ color: "hsl(var(--bark))" }}>
          {readAtLabel ? `Read ${readAtLabel}` : "Read"}
        </span>
      )}
    </button>
  );
};
