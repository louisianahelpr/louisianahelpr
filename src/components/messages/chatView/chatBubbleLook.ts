import type { CSSProperties } from "react";

/**
 * The chat bubble's look, shared by every chat in the app (audit 1122 #137: the Declutter order chat drew grey "You"
 * bubbles with the sender's label inside, a different design from the job chat in the same inbox). MessageBubble (job
 * chats) and DeclutterOrderTalk both draw their bubbles from here, so the two can never drift apart again.
 */
export function chatBubbleShape(mine: boolean): string {
  return `rounded-2xl px-4 py-2.5 text-ds-13 lg:text-ds-15 ${mine ? "rounded-br-md" : "rounded-bl-md"}`;
}

/** "Mine": bark with a subtle inner highlight and a soft shadow, for a tactile, brand-aligned feel. */
export const CHAT_BUBBLE_MINE_STYLE: CSSProperties = {
  background: "linear-gradient(180deg, hsl(var(--bark)) 0%, hsl(var(--bark) / 0.92) 100%)",
  color: "hsl(var(--parchment))",
  boxShadow:
    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.15), " +
    "0 1px 2px hsl(var(--bark) / 0.18), " +
    "0 6px 14px -6px hsl(var(--bark) / 0.32)",
};

/** "Theirs": translucent parchment with a hairline border, so it reads as an inbound card, never grey on grey. */
export const CHAT_BUBBLE_THEIRS_STYLE: CSSProperties = {
  backgroundColor: "hsl(var(--ivory-sand) / 0.78)",
  color: "hsl(var(--ink-deep))",
  border: "0.5px solid hsl(var(--olivewood) / 0.14)",
  boxShadow:
    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6), " +
    "0 1px 2px hsl(var(--olivewood) / 0.06), " +
    "0 4px 10px -4px hsl(var(--olivewood) / 0.10)",
};

export const chatBubbleStyle = (mine: boolean): CSSProperties => (mine ? CHAT_BUBBLE_MINE_STYLE : CHAT_BUBBLE_THEIRS_STYLE);
