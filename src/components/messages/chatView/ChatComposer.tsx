import type { Dispatch, SetStateAction } from "react";
import { Lock } from "lucide-react";
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
  ) => Promise<boolean>;
  broadcastTyping: () => void;
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
            background: "hsl(var(--gold-warm) / 0.10)",
            border: "0.5px solid hsl(var(--gold-warm) / 0.30)",
          }}
        >
          <Lock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna) / 0.8)" }} strokeWidth={2} aria-hidden="true" />
          <p className="font-serif italic text-[0.84rem] leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
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

      {/* Quick replies — the single quick-reply system for a thread
          that already has messages. `FirstMessageChips` (above) owns
          the empty-thread starter prompts; once there's a real
          message, `QuickReplies` takes over. Most chips populate the
          composer; the status-aware smart-reply chips ("On my way",
          "Running 5 min late", "Done", from #15) fire on tap so an
          active-job logistics update is one tap, not three.
          `jobStatus` drives which smart-reply set (if any) is
          prepended.

          Suppressed when the user typed the last real message (they
          already spoke) or is currently composing (draft has content)
          — no reply nudge is needed in those moments. */}
      {(() => {
        const realMessages = messages.filter((m) => !m.is_system);
        // Empty thread → FirstMessageChips handles it; don't stack
        // QuickReplies on top of the starter prompts.
        if (realMessages.length === 0) return null;
        const lastReal = realMessages[realMessages.length - 1];
        const userSentLast = lastReal?.sender_id === userId;
        if (draft.trim() || userSentLast) return null;

        return (
          <div className="pb-1">
            <QuickReplies
              onSelect={(msg) => setDraft(msg)}
              onSend={(msg) => { void sendMessage(msg); }}
              audience={activeConvo?.viewerIsPoster ? "poster" : "helper"}
              jobStatus={activeConvo.jobStatus}
            />
          </div>
        );
      })()}

      <RichMessageInput
        value={draft}
        onChange={setDraft}
        onSend={async (content, attachment) => {
          // RichMessageInput clears its (controlled) text right
          // after onSend returns. If the content scan in the page
          // blocks the message (`sendMessage` resolves `false`),
          // restore the typed text so a blocked message isn't
          // silently lost — the user keeps what they wrote and a
          // toast explains why it didn't send.
          const accepted = await sendMessage(content, attachment);
          if (!accepted && content.trim()) setDraft(content);
        }}
        onTyping={broadcastTyping}
        jobId={activeConvo.jobId}
        senderId={userId || undefined}
      />
    </div>
  );
}
