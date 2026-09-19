import type { Dispatch, SetStateAction } from "react";
import { Lock, X } from "lucide-react";
import { QuickReplies } from "@/components/QuickReplies";
import { RichMessageInput } from "@/components/RichMessageInput";
import { assertWritable } from "@/hooks/useImpersonation";
import { threadClosedCopy } from "@/lib/messagingLockout";
import { RECIPIENT_RESTRICTED_NOTICE } from "@/lib/recipientGate";
import type { Conversation, Message } from "../types";

/**
 * Bottom inset for the composer dock — the ONE place the chat screen accounts
 * for the home indicator, applied to the dock itself because AppShell is
 * mounted `scrollable={false}` here and so reserves nothing.
 *
 * Two things were wrong with the `env(safe-area-inset-bottom, 12px)` this
 * replaces, and both produced the same symptom on device: the input row sat
 * flush on the bottom edge with the dock's white material running underneath
 * it, clipped by the screen ("the bottom doesn't fit the screen", owner).
 *
 *  1. An env() FALLBACK is only used when env() is unsupported — not when the
 *     inset is zero. So every device without a home indicator (and every
 *     browser) got `0px`, never the intended 12px of breathing room.
 *  2. WebKit reports 0 for env(safe-area-inset-*) inside a `position: fixed`
 *     descendant of a transformed ancestor, which is what this dock is. The
 *     project already hit this at the top of the screen and solved it by
 *     resolving the inset at `:root` and reading it back through a var —
 *     `--safe-area-bottom` is the bottom half of that pair (see index.css).
 *
 * `max(...)` rather than `calc(... + 12px)` deliberately: a home-indicator
 * phone keeps exactly its 34px inset (unchanged from what shipped, no fatter
 * white band), while everything else gets a 12px floor instead of nothing.
 *
 * With the keyboard up, the home indicator is covered by the keyboard and the
 * wrapper in ChatView has already lifted the dock by `keyboardInset`, so the
 * inset must NOT be added again — a flat 8px gap is all that's wanted.
 */
function dockPaddingBottom(keyboardInset: number): string {
  return keyboardInset > 0 ? "8px" : "max(var(--safe-area-bottom, 0px), 12px)";
}

/**
 * Edge-to-edge bleed for the dock.
 *
 * The dock is a child of the chat column, which sits inside the shell's
 * horizontal gutter (`px-5 / lg:px-6 / xl:px-6` standalone, `px-4` embedded —
 * see ChatPaneShell). Inheriting that gutter left the frosted panel and its top
 * hairline stopping 20px short of each screen edge, so the composer read as a
 * floating card that had missed its margins rather than a bar attached to the
 * bottom of the thread — AND, because the dock had no padding of its own, the
 * "+" and Send buttons sat flush against that panel's own edges, which is what
 * "the send button is cut off" actually was (measured: at 375 the dock spanned
 * x=20→355 and Send's right edge was 355.0 — exactly the panel edge, 20px of
 * screen still to its right).
 *
 * So: cancel the inherited gutter with a negative inline margin, then re-apply
 * the SAME value as the dock's own padding. Net effect — the material runs
 * screen edge to screen edge, while every control keeps the gutter it had and
 * stays aligned with the message bubbles above it.
 *
 * `--chat-gutter` is declared on the same element that owns the `px-*`, so the
 * two can never drift; the `0px` fallback makes this a no-op for any future
 * host that doesn't set it.
 */
const CHAT_GUTTER_BLEED = {
  marginInline: "calc(var(--chat-gutter, 0px) * -1)",
  paddingInline: "var(--chat-gutter, 0px)",
} as const;

/**
 * The composer dock — the poster-first lock card, the status-aware quick
 * replies, and the rich message input.
 */
export function ChatComposer({
  composerLocked,
  threadClosed = false,
  recipientRestricted = false,
  chatLoadError,
  keyboardInset,
  activeConvo,
  messages,
  userId,
  draft,
  setDraft,
  sendMessage,
  broadcastTyping,
  replyTo,
  onCancelReply,
}: {
  composerLocked: boolean;
  /** True once this thread has passed its closing instant — 24h after the
      job completed, or IMMEDIATELY on cancellation (migration
      20260919220233). Replaces the composer with a read-only notice, whose
      wording follows which of the two it was. See lib/messagingLockout.ts. */
  threadClosed?: boolean;
  /** True when the server's receiver gate refuses this recipient for this
      viewer (src/lib/recipientGate.ts). Replaces the composer with a notice. */
  recipientRestricted?: boolean;
  chatLoadError: boolean;
  keyboardInset: number;
  activeConvo: Conversation;
  messages: Message[];
  userId: string | null;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  sendMessage: (
    content: string,
    attachment?: { path: string; mime: string; size: number; duration?: number },
    replyToId?: string | null,
    opts?: { isLocationShare?: boolean },
  ) => Promise<boolean>;
  broadcastTyping: () => void;
  /** Message being replied to, or null. Owned by ChatView. */
  replyTo?: Message | null;
  onCancelReply?: () => void;
}) {
  if (threadClosed) {
    /* Thread closed — applies to everyone on the job. TWO ways in:
         - completed, 24h after completion (can_message_in_job, 20260914201350);
         - cancelled, IMMEDIATELY (20260919220233; before that migration a
           cancelled job's thread stayed open forever).
       The server refuses new messages from the same instant either way, so
       this replaces the whole composer with a read-only notice rather than
       offering a send that would bounce — the fail-on-tap pattern this
       codebase rejects. Checked before the poster-first lock: once the thread
       is closed, who may open it is moot.

       The WORDING is chosen from the job's status, because the completed copy
       names a rule ("messaging ends 24 hours after a job is completed") that
       is simply untrue of a cancellation. */
    return (
      <div
        className="pt-2 pb-3 glass-dock sticky bottom-0"
        style={{ ...CHAT_GUTTER_BLEED, paddingBottom: dockPaddingBottom(keyboardInset) }}
        data-testid="thread-closed-notice"
      >
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-ds-md px-3.5 py-3"
          style={{
            background: "hsl(var(--olivewood) / 0.06)",
            border: "0.5px solid hsl(var(--olivewood) / 0.18)",
          }}
        >
          <Lock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }} strokeWidth={2} aria-hidden="true" />
          <p className="font-sans text-ds-13 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            {threadClosedCopy(activeConvo.jobStatus).notice}
          </p>
        </div>
        {/* ── THE DRAFT THAT WAS MID-SENTENCE ──────────────────────────────
            Cancelling is something a HUMAN does in the moment, and the other
            party may be typing when it happens — the thread can close under
            an open keyboard. Before this, the composer simply vanished and
            took the text with it: `draft` lives in ChatView's `useState`,
            which is still mounted, so the string was not lost, merely
            unreachable, which is worse than losing it.

            So the unsent text is rendered, selectable, beside the notice. No
            Send (there is nothing to send it to) and no promise to keep it —
            it is exactly as durable as it was a second ago, which is "until
            you leave this screen". It is here so the reader can copy it,
            re-read it, or paste it somewhere that is still open.

            Only when there IS one: an empty draft gets no empty box. */}
        {draft.trim().length > 0 && (
          <div
            className="mt-2 rounded-ds-md px-3.5 py-2.5"
            style={{
              background: "hsl(var(--olivewood) / 0.04)",
              border: "0.5px dashed hsl(var(--olivewood) / 0.22)",
            }}
            data-testid="thread-closed-unsent-draft"
          >
            <p
              className="font-sans text-ds-11 uppercase tracking-wide mb-1"
              style={{ color: "hsl(var(--olivewood) / 0.6)" }}
            >
              Not sent
            </p>
            <p
              className="font-sans text-ds-13 leading-relaxed whitespace-pre-wrap break-words select-text"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              {draft}
            </p>
          </div>
        )}
      </div>
    );
  }
  if (composerLocked) {
    /* Poster-first lock — the applicant waits for the poster to
       open the conversation. Replaces chips + quick replies +
       composer so there's no disabled control to fight with. The
       backend RLS policy enforces the same rule server-side. */
    return (
      <div
        className="pt-2 pb-3 glass-dock sticky bottom-0"
        style={{ ...CHAT_GUTTER_BLEED, paddingBottom: dockPaddingBottom(keyboardInset) }}
      >
        <div
          className="flex items-start gap-2.5 rounded-ds-md px-3.5 py-3"
          style={{
            background: "hsl(var(--amber-tint) / 0.10)",
            border: "0.5px solid hsl(var(--amber-tint) / 0.30)",
          }}
        >
          <Lock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2} aria-hidden="true" />
          <p className="font-sans text-ds-13 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            Your application's in. The person who posted it will reach out here if they're interested — you'll be able to reply as soon as they do.
          </p>
        </div>
      </div>
    );
  }
  if (recipientRestricted) {
    /* Receiver gate — only the poster may message applicants and an offered
       Helpr (can_send_message_to_in_job, 20260914210443 + 20260914215014).
       Server-derived, same read-only notice as the lockout, so an existing
       thread never offers a send RLS will refuse. */
    return (
      <div
        className="pt-2 pb-3 glass-dock sticky bottom-0"
        style={{ ...CHAT_GUTTER_BLEED, paddingBottom: dockPaddingBottom(keyboardInset) }}
        data-testid="thread-recipient-restricted-notice"
      >
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-ds-md px-3.5 py-3"
          style={{
            background: "hsl(var(--olivewood) / 0.06)",
            border: "0.5px solid hsl(var(--olivewood) / 0.18)",
          }}
        >
          <Lock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }} strokeWidth={2} aria-hidden="true" />
          <p className="font-sans text-ds-13 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            {RECIPIENT_RESTRICTED_NOTICE}
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
      style={{ ...CHAT_GUTTER_BLEED, paddingBottom: dockPaddingBottom(keyboardInset) }}
    >
      {/* The empty-thread ice-breaker chips ("When can you start?", "Do you
          have your own tools?", …) were removed at the owner's request: a
          canned opener is not what the sender actually wants to say, and a row
          of pre-written questions above the input makes a real conversation
          between two neighbours read like a support ticket form. The blank
          composer is the better prompt. `FirstMessageChips` had no other
          call site and was deleted with them. */}

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
            <p className="text-ds-11 truncate font-sans" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              {replyTo.content?.trim() || "Attachment"}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="shrink-0 min-h-[44px] min-w-[44px] -mr-1 -mt-1 inline-flex items-center justify-center rounded-full"
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
        // deeper. Gating is unchanged: suppressed on an empty thread — a
        // thread with nothing in it has no context to reply TO, so a canned
        // reply there is a guess — when the user typed the last real message,
        // or while they are mid-draft.
        quickReplies={(() => {
          const realMessages = messages.filter((m) => !m.is_system);
          if (realMessages.length === 0) return null;
          const lastReal = realMessages[realMessages.length - 1];
          if (draft.trim() || lastReal?.sender_id === userId) return null;
          return (
            <QuickReplies
              onSelect={(msg) => setDraft(msg)}
              // Same read-only-impersonation guard the typed-send path runs.
              onSend={(msg) => { if (!assertWritable()) return; void sendMessage(msg); }}
              audience={activeConvo?.viewerIsPoster ? "poster" : "helper"}
              jobStatus={activeConvo.jobStatus}
              // NOT `wrap`: the attach ("+") sheet these render in is a fixed
              // `w-[300px]` popover (AttachSourceSheet), not a roomy surface —
              // `wrap` there was overflowing into 3+ rows of chips. The
              // horizontally-scrolling default (fade-masked) fits the narrow
              // sheet as a single row.
            />
          );
        })()}
        value={draft}
        onChange={setDraft}
        onSend={async (content, attachment, opts) => {
          // RichMessageInput clears its (controlled) text right
          // after onSend returns. If the content scan in the page
          // blocks the message (`sendMessage` resolves `false`),
          // restore the typed text so a blocked message isn't
          // silently lost — the user keeps what they wrote and a
          // toast explains why it didn't send.
          const accepted = await sendMessage(content, attachment, replyTo?.id ?? null, opts);
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
