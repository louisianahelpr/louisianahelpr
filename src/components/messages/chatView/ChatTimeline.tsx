import type { Dispatch, Ref, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, MessageSquare, Loader2, RotateCw } from "lucide-react";
import { TypingIndicator } from "@/components/ChatPresence";
import { MessageBubble } from "../MessageBubble";
import type { Conversation, Message } from "../types";
import type { TimelineItem } from "./types";
import {
  SystemEventRow,
  iconForEventKind,
  normalizeStoredSystemMessage,
} from "./SystemEventRow";

/**
 * Shape-matched placeholder bubbles shown while a newly-opened
 * conversation's messages are still in flight — fills the same blank
 * window the empty-thread / error states cover, so opening a thread
 * never paints nothing. Mirrors `MessageThreadSkeleton`'s pattern
 * (same `Skeleton` primitive, alternating widths) but shaped like chat
 * bubbles instead of an inbox row.
 */
function ChatBubbleSkeleton() {
  const rows: Array<{ mine: boolean; width: string }> = [
    { mine: false, width: "58%" },
    { mine: true, width: "38%" },
    { mine: false, width: "70%" },
    { mine: false, width: "44%" },
  ];
  return (
    <div aria-hidden className="space-y-3 py-2">
      {rows.map((row, i) => (
        <div key={i} className={`flex ${row.mine ? "justify-end" : "justify-start"}`}>
          <Skeleton
            className="h-9 rounded-ds-md"
            style={{
              width: row.width,
              maxWidth: "80%",
              background: "hsl(var(--olivewood) / 0.12)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The scrolling message thread body: the "load earlier" control, the
 * recoverable load-error state, the empty "Say hello." state, the merged
 * timeline (date dividers, system pills, DB system rows, chat bubbles),
 * the typing indicator, and the bottom sentinel. Extracted verbatim from
 * ChatView — markup unchanged.
 */
export function ChatTimeline({
  timeline,
  userId,
  activeConvo,
  composerLocked = false,
  lastOwnMessageId,
  hasMoreMessages,
  loadingMore,
  loadOlderMessages,
  chatLoadError,
  chatLoading,
  onRetryLoad,
  isOtherTyping,
  bottomRef,
  retryMessage,
  setLightboxPhoto,
  setDeleteMessageConfirm,
  setActionMessage,
  reactions,
  onReact,
  reveal = 0,
}: {
  timeline: TimelineItem[];
  userId: string | null;
  /** messageId → grouped tapbacks. Empty map before the first load. */
  reactions?: Map<string, { counts: { emoji: string; count: number }[]; mine: string | null }>;
  onReact?: (messageId: string, emoji: string) => void;
  /** px the timeline is dragged left, from useTimestampReveal. */
  reveal?: number;
  activeConvo: Conversation;
  /** True while ChatView's poster-first lock is in effect for THIS viewer
      (a genuinely pending applicant, not yet offered or assigned). When
      true, the empty state below must not tell the viewer to "Say hello" —
      they cannot: the composer dock renders the lock card instead of an
      input. Defaults to false so every other ChatTimeline caller/test is
      unaffected. F-4, 2026-08-27. */
  composerLocked?: boolean;
  lastOwnMessageId: string | null;
  hasMoreMessages: boolean;
  loadingMore: boolean;
  loadOlderMessages: () => void;
  chatLoadError: boolean;
  /** True while a newly-opened conversation's messages are still being
   *  fetched — renders `ChatBubbleSkeleton` instead of the blank window
   *  or the misleading "Say hello." empty state. */
  chatLoading: boolean;
  onRetryLoad: () => void;
  isOtherTyping: boolean;
  bottomRef: Ref<HTMLDivElement>;
  retryMessage: (clientId: string) => void;
  setLightboxPhoto: Dispatch<SetStateAction<string | null>>;
  setDeleteMessageConfirm: Dispatch<SetStateAction<string | null>>;
  setActionMessage: Dispatch<SetStateAction<Message | null>>;
}) {
  return (
    <div aria-live="polite" aria-relevant="additions" className="space-y-3">
      {hasMoreMessages && (
        <div className="text-center py-2">
          <button
            onClick={loadOlderMessages}
            disabled={loadingMore}
            className="btn-press inline-flex items-center gap-1.5 mx-auto rounded-ds-md px-4 py-1.5 text-ds-11 font-medium transition-colors disabled:opacity-50"
            style={{
              background: "hsl(var(--parchment) / 0.8)",
              color: "hsl(var(--bark))",
              border: "1px solid hsl(var(--bark) / 0.22)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255,255,255,0.55), " +
                "0 1px 2px hsl(var(--bark) / 0.10)",
            }}
          >
            {loadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
            {loadingMore ? "Loading…" : "Load Earlier Messages"}
          </button>
        </div>
      )}
      {/* Fetching a newly-opened conversation's messages — shape-matched
          skeleton bubbles instead of a blank window. Takes precedence
          over the error/empty states below (chatLoading and
          chatLoadError are never true at the same time — see
          useMessagesData.openConvo). */}
      {chatLoading && !chatLoadError && <ChatBubbleSkeleton />}
      {/* Failed thread fetch — recoverable error state. Shown
          instead of the "Say hello." empty state so a network
          failure never masquerades as an empty conversation. */}
      {!chatLoading && chatLoadError && (
        <div className="flex flex-col items-center text-center py-14 gap-3">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: "hsl(var(--destructive) / 0.1)",
              border: "1px solid hsl(var(--destructive) / 0.2)",
            }}
          >
            <AlertTriangle className="w-6 h-6" style={{ color: "hsl(var(--destructive))" }} strokeWidth={1.75} />
          </div>
          <div className="space-y-1">
            <p
              className="font-display italic font-bold text-ds-17"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Couldn't load this conversation.
            </p>
            <p
              className="font-serif italic text-ds-13 max-w-[260px]"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Tap Retry. If it sticks, our end is having a hiccup —
              not yours.
            </p>
          </div>
          <Button variant="outline" size="sm" className="rounded-ds-md" onClick={onRetryLoad}>
            <RotateCw className="w-3.5 h-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
      )}
      {!chatLoading && !chatLoadError && timeline.length === 0 && (
        <div className="flex flex-col items-center text-center py-14 gap-3">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: "hsl(var(--ivory-sand) / 0.55)",
              border: "1px solid hsl(var(--olivewood) / 0.10)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
            }}
          >
            <MessageSquare className="w-6 h-6" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
          </div>
          <div className="space-y-1">
            <p
              className="font-display italic font-bold text-ds-17"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              {composerLocked ? "No messages yet." : "Say hello."}
            </p>
            <p
              className="font-serif italic text-ds-13 max-w-[260px]"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              {composerLocked
                ? "The poster will reach out here once they're ready."
                : "Send the first message to get the job moving."}
            </p>
          </div>
        </div>
      )}
      {!chatLoading && !chatLoadError && timeline.map((item, i) => {
        if (item.type === "date") {
          // Section divider — quietly anchors the thread to the
          // calendar so scrolling back through long history reads
          // as a dated transcript, not an undifferentiated wall of
          // bubbles. Hairline rules on either side, italic serif
          // label centered between them.
          return (
            <div
              key={item.key}
              role="separator"
              aria-label={`Date: ${item.label}`}
              className="flex items-center gap-3 px-2 pt-3 pb-1"
            >
              <span
                aria-hidden="true"
                className="flex-1 h-px"
                style={{ background: "hsl(var(--olivewood) / 0.15)" }}
              />
              <span
                className="font-serif italic uppercase tracking-wider whitespace-nowrap text-ds-10"
                style={{
                  letterSpacing: "0.16em",
                  color: "hsl(var(--olivewood) / 0.8)",
                }}
              >
                {item.label}
              </span>
              <span
                aria-hidden="true"
                className="flex-1 h-px"
                style={{ background: "hsl(var(--olivewood) / 0.15)" }}
              />
            </div>
          );
        }
        if (item.type === "system") {
          // Derived job-transition row — styled centered <div>, NOT a real
          // message row. Reads as "the app speaking" rather than either
          // participant. Same component as the stored `is_system` rows
          // below, so one thread never shows two idioms for one kind of
          // fact — see SystemEventRow.
          const ev = item.event;
          return (
            <SystemEventRow
              key={item.key}
              icon={iconForEventKind(ev.kind)}
              label={ev.label}
              at={ev.at}
            />
          );
        }
        const m = item.message;
        // Stored system rows — `messages` rows flagged `is_system`, written
        // by the job-status trigger. These used to render as bare centred
        // text carrying the DB content's literal `✓` / `▶` glyph, so an
        // identical kind of announcement looked like a different kind of
        // thing depending on which mechanism produced it. Now the exact same
        // pill as the derived rows, with the glyph mapped to a Lucide icon.
        if (m.is_system) {
          const stored = normalizeStoredSystemMessage(m.content);
          return (
            <SystemEventRow
              key={item.key}
              icon={stored.icon}
              label={stored.label}
            />
          );
        }
        // Grouped when the previous timeline row is a non-system message
        // from the same sender — tightens the inter-bubble gap (iOS run).
        const prev = timeline[i - 1];
        const grouped =
          !!prev &&
          prev.type === "message" &&
          !prev.message.is_system &&
          prev.message.sender_id === m.sender_id;
        return (
          <MessageBubble
            key={item.key}
            m={m}
            mine={m.sender_id === userId}
            showReadReceipt={m.id === lastOwnMessageId}
            reactions={reactions?.get(m.id)}
            onReact={onReact}
            reveal={reveal}
            replyParent={(() => {
              // Resolved here rather than in the bubble so the lookup happens
              // once per render pass with the full list in hand. A parent that
              // is missing (deleted, or simply outside the loaded window)
              // yields null and the reply renders as a normal message.
              if (!m.reply_to_id) return null;
              const parent = timeline.find(
                (t): t is Extract<TimelineItem, { message: Message }> =>
                  "message" in t && t.message?.id === m.reply_to_id,
              )?.message;
              if (!parent) return null;
              return { content: parent.content, mine: parent.sender_id === userId };
            })()}
            grouped={grouped}
            activeConvo={activeConvo}
            retryMessage={retryMessage}
            setLightboxPhoto={setLightboxPhoto}
            onDelete={setDeleteMessageConfirm}
            onLongPress={setActionMessage}
          />
        );
      })}
      {isOtherTyping && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
