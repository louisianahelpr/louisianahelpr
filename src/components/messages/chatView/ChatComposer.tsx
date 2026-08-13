import type { Dispatch, SetStateAction } from "react";
import { Lock, X } from "lucide-react";
import { QuickReplies } from "@/components/QuickReplies";
import { RichMessageInput } from "@/components/RichMessageInput";
import { FirstMessageChips } from "../FirstMessageChips";
import type { Conversation, Message } from "../types";

/**
 * The composer dock — the poster-first lock card, the empty-thread
 * ice-breaker chips, the status-aware quick replies, and the rich
 * message input. Extracted verbatim from ChatView — markup unchanged.
 */
export function ChatComposer({
  composerLocked,
  chatLoadError,
  keyboardInset,
  activeConvo,
  messages,
  userId,
  draft,
  setDraft,
  chipsDismissed,
  setChipsDismissed,
  sendMessage,
  broadcastTyping,
  replyTo,
  onCancelReply,
}: {
  composerLocked: boolean;
  chatLoadError: boolean;
  keyboardInset: number;
  activeConvo: Conversation;
  messages: Message[];
  userId: string | null;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  chipsDismissed: boolean;
  setChipsDismissed: Dispatch<SetStateAction<boolean>>;
  sendMessage: (
    content: string,
    attachment?: { path: string; mime: string; size: number; duration?: number },
    replyToId?: string | null,
  ) => Promise<boolean>;
  broadcastTyping: () => void;
  /** Message being replied to, or null. Owned by ChatView. */
  replyTo?: Message | null;
  onCancelReply?: () => void;
}) {
  if (composerLocked) {
    /* Poster-first lock — the applicant waits for the poster to
       open the conversation. Replaces chips + quick replies +
       composer so there's no disabled control to fight with. The
       backend RLS policy enforces the same rule server-side. */
    return (
      <div
        className="pt-2 pb-3 glass-dock sticky bottom-0"
        style={{ paddingBottom: keyboardInset > 0 ? "8px" : "env(safe-area-inset-bottom, 12px)" }}
      >
        <div
          className="flex items-start gap-2.5 rounded-ds-md px-3.5 py-3"
          style={{
            background: "hsl(var(--amber-tint) / 0.10)",
            border: "0.5px solid hsl(var(--amber-tint) / 0.30)",
          }}
        >
          <Lock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2} aria-hidden="true" />
          <p className="font-serif italic text-ds-13 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            Your application's in. The poster will reach out here if they're interested — you'll be able to reply as soon as they do.
          </p>
        </div>
      </div>
    );
  }
  if (chatLoadError) {
    /* Thread failed to load — suppress the whole composer dock
       (quick replies + rich input + voice recorder). Sending into a
       conversation that never loaded would post into an unknown
       state; the error card above is the only action: Retry. */
    return null;
  }
  /* Composer dock — quick-reply chips and the input share ONE
     frosted glass panel so they read as a single sticky unit.
     The chips used to sit in a transparent wrapper above the
     dock, leaving a seam where scrolling message bubbles bled
     up behind them; folding them inside the glass closes that
     gap and keeps the backdrop consistent. */
  return (
    <div
      className="pt-2 pb-3 glass-dock sticky bottom-0"
      style={{ paddingBottom: keyboardInset > 0 ? "8px" : "env(safe-area-inset-bottom, 12px)" }}
    >
      {/* First-message chips — three ice-breaker suggestions shown
          ONLY when the thread is brand-new (zero messages) and the
          user hasn't already picked one this session. Dismissed
          after one tap so a fresh thread doesn't keep nudging the
          user once they've started typing. */}
      {!chatLoadError && messages.length === 0 && !chipsDismissed && (
        <FirstMessageChips
          viewerRole={activeConvo.viewerIsPoster ? "customer" : "helper"}
          onPick={(text) => {
            setDraft(text);
            setChipsDismissed(true);
          }}
          className="pt-0 pb-2"
        />
      )}

      {/* Reply strip — the quoted message sits directly above the input, so
          what you are answering is visible while you type it. Dismissible,
          because deciding mid-sentence not to make it a reply is common. */}
      {replyTo && (
        <div
          className="flex items-start gap-2 mb-1.5 px-3 py-2 rounded-ds-md"
          style={{ background: "hsl(var(--olivewood) / 0.07)", borderLeft: "2.5px solid hsl(var(--bark))" }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-ds-10 font-sans font-semibold" style={{ color: "hsl(var(--bark))" }}>
              Replying to {replyTo.sender_id === userId ? "yourself" : (activeConvo?.otherUserName ?? "them")}
            </p>
            <p className="text-ds-11 truncate font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              {replyTo.content?.trim() || "Attachment"}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="shrink-0 h-8 w-8 -mr-1 -mt-1 inline-flex items-center justify-center rounded-full"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      )}

      <RichMessageInput
        // Quick replies live in the "+" sheet now, not in their own strip
        // above the input — the third chip was permanently clipped mid-word by
        // the scroll fade, and iPhone keeps this class of shortcut one tap
        // deeper. Same gating as before: suppressed on an empty thread
        // (FirstMessageChips owns that moment), when the user typed the last
        // real message, or while they are mid-draft.
        quickReplies={(() => {
          const realMessages = messages.filter((m) => !m.is_system);
          if (realMessages.length === 0) return null;
          const lastReal = realMessages[realMessages.length - 1];
          if (draft.trim() || lastReal?.sender_id === userId) return null;
          return (
            <QuickReplies
              onSelect={(msg) => setDraft(msg)}
              onSend={(msg) => { void sendMessage(msg); }}
              audience={activeConvo?.viewerIsPoster ? "poster" : "helper"}
              jobStatus={activeConvo.jobStatus}
              wrap
            />
          );
        })()}
        value={draft}
        onChange={setDraft}
        onSend={async (content, attachment) => {
          // RichMessageInput clears its (controlled) text right
          // after onSend returns. If the content scan in the page
          // blocks the message (`sendMessage` resolves `false`),
          // restore the typed text so a blocked message isn't
          // silently lost — the user keeps what they wrote and a
          // toast explains why it didn't send.
          const accepted = await sendMessage(content, attachment, replyTo?.id ?? null);
          // Only clear the reply once the message was actually accepted. If the
          // content scan blocked it, the user keeps both their text AND the
          // message they were replying to, so retrying is one tap.
          if (accepted) onCancelReply?.();
          if (!accepted && content.trim()) setDraft(content);
        }}
        onTyping={broadcastTyping}
        jobId={activeConvo.jobId}
        senderId={userId || undefined}
      />
    </div>
  );
}
