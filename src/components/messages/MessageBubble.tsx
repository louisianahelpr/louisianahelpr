import { Flag, Trash2, Loader2, RotateCw, MapPin } from "lucide-react";
import { MessageAttachment } from "@/components/MessageAttachment";
import { ReadReceipt } from "@/components/ChatPresence";
import { useLongPress } from "@/hooks/useLongPress";
import { hapticMedium } from "@/lib/haptics";
import type { Conversation, Message } from "./types";
import { REVEAL_WIDTH } from "./chatView/useTimestampReveal";

/**
 * Message `content` is attacker-controlled free text, and both the photo and
 * location branches inject a URL from it straight into an `href`/`src`. React
 * does NOT strip `javascript:`/`data:` from runtime-computed URL props, so an
 * unvalidated href is a stored-XSS vector (tap "View location on map" runs the
 * sender's script in the recipient's authed session). Only render as an active
 * link/image when the URL is a real `https:` URL; legit senders always are
 * (location → `https://maps.google.com/…`, photos → Supabase storage https).
 */
const isSafeHttpsUrl = (raw: string): boolean => {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
};

export const renderMessageContent = (
  content: string,
  onImageClick: (url: string) => void,
) => {
  // Photo message
  if (content.startsWith("📷 ")) {
    const parts = content.slice(2).trim().split("\n");
    const url = parts[0].trim();
    const caption = parts.slice(1).join("\n").trim();
    // Untrusted scheme → never emit an <img src>; fall back to inert text.
    if (!isSafeHttpsUrl(url)) return <p>{content}</p>;
    return (
      <div className="space-y-1">
        <img
          loading="lazy"
          decoding="async"
          src={url}
          alt="Shared photo"
          className="max-w-full max-h-64 object-contain rounded-ds-sm cursor-pointer hover:opacity-90 transition-opacity"
          onClick={() => onImageClick(url)}
        />
        {caption && <p>{caption}</p>}
      </div>
    );
  }
  // Location message
  if (content.startsWith("📍 Location:")) {
    const url = content.replace("📍 Location: ", "").trim();
    // Untrusted scheme → never emit an <a href>; fall back to inert text.
    if (!isSafeHttpsUrl(url)) return <p>{content}</p>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 underline hover:no-underline"
      >
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        View location on map
      </a>
    );
  }
  return <p>{content}</p>;
};

/**
 * A single chat message row: the styled bubble (with attachment / photo /
 * location rendering) plus the meta row (timestamp, read receipt, and the
 * inline report/delete affordance). Extracted from the thread map so each
 * row can own a `useLongPress` (hooks can't run inside a map) — a long
 * press opens the shared MessageActionSheet via `onLongPress`.
 */
export function MessageBubble({
  m,
  mine,
  showReadReceipt,
  reactions,
  onReact,
  replyParent,
  reveal = 0,
  grouped = false,
  activeConvo,
  retryMessage,
  setLightboxPhoto,
  onReport,
  onDelete,
  onLongPress,
}: {
  m: Message;
  mine: boolean;
  /** True only for the current user's most recent settled outbound
   *  message — gates the "Read"/"Delivered" indicator so it appears once
   *  at the bottom (iMessage-style) rather than on every bubble. */
  showReadReceipt: boolean;
  /** Grouped tapbacks for this message, or undefined when it has none. */
  reactions?: { counts: { emoji: string; count: number }[]; mine: string | null };
  /** The message this one replies to, already resolved by the timeline.
   *  Undefined when this isn't a reply, or when the parent was deleted —
   *  the FK is ON DELETE SET NULL, so a reply outlives its parent. */
  replyParent?: { content: string; mine: boolean } | null;
  /** px the timeline is dragged left; >0 reveals the absolute time column. */
  reveal?: number;
  /** Toggle the viewer's tapback — used by the chips as a one-tap undo. */
  onReact?: (messageId: string, emoji: string) => void;
  /** True when the previous timeline row is a message from the same
   *  sender — tightens the gap above so a run of consecutive bubbles
   *  reads as one group (iOS convention), with a larger gap on sender
   *  change. */
  grouped?: boolean;
  activeConvo: Conversation;
  retryMessage: (clientId: string) => void;
  setLightboxPhoto: (url: string | null) => void;
  onReport: (id: string) => void;
  onDelete: (id: string) => void;
  onLongPress: (m: Message) => void;
}) {
  const isSending = m.sendStatus === "sending";
  const isFailed = m.sendStatus === "failed";
  // Only settled messages get a long-press menu — there's nothing to
  // copy/report/delete on an in-flight or failed row.
  const actionable = !isSending && !isFailed;
  const longPress = useLongPress({
    onLongPress: () => {
      if (!actionable) return;
      void hapticMedium();
      onLongPress(m);
    },
  });
  const pressHandlers = actionable ? longPress : {};

  return (
    <div
      data-msg-id={m.id}
      className={`relative flex flex-col ${mine ? "items-end" : "items-start"}`}
      // Inline margin so it wins over the timeline's `space-y-3`: a run of
      // consecutive same-sender bubbles tightens to a hairline gap; a
      // sender change keeps the full spacing.
      //
      // `relative` anchors the revealed time column, and the row shifts left
      // by the drag distance. No transition while dragging — the transform
      // must track the finger 1:1 — but one on release so it springs back.
      style={{
        marginTop: grouped ? "0.125rem" : undefined,
        transform: reveal > 0 ? `translateX(-${reveal}px)` : undefined,
        transition: reveal > 0 ? "none" : "transform 180ms ease-out",
      }}
    >
      <div
        {...pressHandlers}
        className={`max-w-[75%] rounded-[18px] px-4 py-2.5 text-ds-13 group relative space-y-2 transition-opacity ${
          mine ? "rounded-br-md" : "rounded-bl-md"
        } ${isSending ? "opacity-60" : ""}`}
        style={mine ? {
          // "Mine" bubble — bark with subtle inner highlight + soft shadow
          // for a tactile, brand-aligned feel (vs. flat primary fill).
          background: "linear-gradient(180deg, hsl(var(--bark)) 0%, hsl(var(--bark) / 0.92) 100%)",
          color: "hsl(var(--parchment))",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.15), " +
            "0 1px 2px hsl(var(--bark) / 0.18), " +
            "0 6px 14px -6px hsl(var(--bark) / 0.32)",
        } : {
          // "Theirs" bubble — translucent parchment with a hairline border
          // so it reads as an inbound card without looking gray-on-gray.
          backgroundColor: "hsl(var(--ivory-sand) / 0.78)",
          color: "hsl(var(--ink-deep))",
          border: "0.5px solid hsl(var(--olivewood) / 0.14)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6), " +
            "0 1px 2px hsl(var(--olivewood) / 0.06), " +
            "0 4px 10px -4px hsl(var(--olivewood) / 0.10)",
        }}
      >
        {/* Tapbacks — overlapping the bubble's top corner, on the side away
            from the speaker: top-right for an inbound bubble, top-left for
            your own. That is where iMessage puts them, and it is why they
            read as attached TO the message.

            They previously sat in the column below the bubble, which left a
            large chip floating in the gap between the message and its
            timestamp — visually closer to the next message than to the one it
            belonged to. Absolute here, so they add no height and cannot push
            the meta row around.

            The ring is the page background rather than a border colour, so the
            chip punches a clean hole in the bubble edge instead of looking
            like a sticker laid on top. */}
        {reactions && reactions.counts.length > 0 && (
          <div
            className={`absolute -top-3 z-10 flex items-center gap-0.5 ${mine ? "-left-1.5" : "-right-1.5"}`}
          >
            {reactions.counts.map(({ emoji, count }) => {
              const isMine = reactions.mine === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact?.(m.id, emoji)}
                  disabled={!onReact}
                  aria-label={isMine ? `Remove your ${emoji} reaction` : `React with ${emoji}`}
                  aria-pressed={isMine}
                  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-[3px] text-ds-11 leading-none transition-transform active:scale-90 disabled:active:scale-100"
                  style={{
                    background: isMine ? "hsl(var(--bark) / 0.16)" : "hsl(var(--ivory-sand))",
                    boxShadow: `0 0 0 2px hsl(var(--premium-page, var(--parchment))), 0 1px 3px hsl(var(--olivewood) / 0.20)`,
                  }}
                >
                  <span>{emoji}</span>
                  {/* Only show a number once more than one person has used it —
                      a lone "1" next to every chip is noise. */}
                  {count > 1 && (
                    <span className="tabular-nums font-sans font-semibold text-ds-10" style={{ color: "hsl(var(--olivewood))" }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {m.attachment_url && m.attachment_mime && (
          <MessageAttachment
            path={m.attachment_url}
            mime={m.attachment_mime}
            size={m.attachment_size}
            duration={m.attachment_duration}
            mine={mine}
          />
        )}
        {/* Quoted parent — inside the bubble and above the content, so the
            reply reads as one unit rather than two stacked messages. Clamped
            to two lines: it is a pointer back, not a re-read. */}
        {replyParent && (
          <div
            className="mb-1.5 pl-2 py-0.5"
            style={{ borderLeft: `2px solid ${mine ? "hsl(var(--parchment) / 0.55)" : "hsl(var(--bark) / 0.45)"}` }}
          >
            <p
              className="text-ds-10 font-sans font-semibold leading-none mb-0.5"
              style={{ color: mine ? "hsl(var(--parchment) / 0.85)" : "hsl(var(--bark))" }}
            >
              {replyParent.mine ? "You" : "Them"}
            </p>
            <p
              className="text-ds-11 font-serif italic leading-snug line-clamp-2"
              style={{ color: mine ? "hsl(var(--parchment) / 0.80)" : "hsl(var(--olivewood) / 0.85)" }}
            >
              {replyParent.content?.trim() || "Attachment"}
            </p>
          </div>
        )}
        {m.content && renderMessageContent(m.content, setLightboxPhoto)}
      </div>
      {/* Revealed time column — absolutely positioned OUTSIDE the row's right
          edge, so it costs no layout width and slides into the gap the drag
          opens. aria-hidden: the accessible name already carries the time via
          the meta row, and a screen reader user has no drag gesture to make
          this appear. */}
      {reveal > 0 && (
        <span
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 text-ds-10 tabular-nums whitespace-nowrap"
          style={{
            right: -REVEAL_WIDTH + 6,
            width: REVEAL_WIDTH - 10,
            opacity: reveal / REVEAL_WIDTH,
            color: "hsl(var(--olivewood) / 0.75)",
          }}
        >
          {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
        </span>
      )}
      {/* Meta row — timestamp / read-receipt plus the report (inbound) or
          delete (own) affordance. Kept BELOW the bubble, never overlaid on
          the copy, so the icon can't sit on top of the message text. Faded
          on touch (no hover) so it stays discoverable without dominating
          every row. */}
      <div className={`flex items-center gap-1 mt-1 px-1 text-ds-10 text-muted-foreground ${mine ? "flex-row-reverse" : ""}`}>
        {isSending ? (
          <span className="flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            Sending…
          </span>
        ) : isFailed ? (
          <button
            type="button"
            onClick={() => m.clientId && retryMessage(m.clientId)}
            className="flex items-center gap-1 text-destructive font-medium hover:underline"
            title="Retry sending"
          >
            <RotateCw className="w-2.5 h-2.5" />
            Not sent — tap to retry
          </button>
        ) : (
          <>
            {/* The inline time is hidden on a GROUPED message — one that
                directly follows another from the same sender. A run of five
                replies used to stamp five timestamps a few seconds apart,
                which is noise; the run now reads as one block and the last
                message carries the time. Every hidden time is still one
                left-drag away (see useTimestampReveal), which is exactly the
                trade iMessage makes. */}
            {!grouped && (
              <span>
                {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
              </span>
            )}
            {showReadReceipt && (
              <ReadReceipt
                read={m.read}
                sentByMe={mine}
                recipientName={activeConvo?.otherUserName}
                recipientAvatarUrl={activeConvo?.otherUserAvatarUrl}
              />
            )}
            {!mine && (
              <button
                onClick={() => onReport(m.id)}
                className="ml-0.5 opacity-50 hover:opacity-100 hover:text-destructive transition-opacity flex items-center justify-center w-5 h-5 rounded-full"
                title="Report"
                aria-label="Report message"
              >
                <Flag className="w-2.5 h-2.5" />
              </button>
            )}
            {mine && (
              <button
                onClick={() => onDelete(m.id)}
                className="ml-0.5 opacity-50 hover:opacity-100 hover:text-destructive transition-opacity flex items-center justify-center w-5 h-5 rounded-full"
                title="Delete"
                aria-label="Delete message"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
