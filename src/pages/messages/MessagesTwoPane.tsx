import type { ReactNode } from "react";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { SectionBoundary } from "@/components/SectionBoundary";
import { MESSAGES_LIST_PANE_PX } from "./useTwoPane";

/**
 * Board 38 (owner, 2026-10-20): desktop Messages as two panes in one PageScaffold.
 * The inbox list is 360px; the open deal room takes the rest (useTwoPane only
 * turns this on where that rest is >= 480px, so the chat is never cut off).
 * With no thread open, the chat pane rests with "Pick a conversation". With
 * no conversations at all it stays EMPTY: the inbox pane's own empty state
 * already says how chats start (A3-C19, app audit 2026-10-29). It used to add
 * a second "No conversations yet" here, promising "When you message someone,
 * the conversation opens here." when no screen lets a member start a chat:
 * two near-identical empty states side by side at 1440, one of them untrue.
 */
export function MessagesTwoPane({ list, chat, hasConversations }: { list: ReactNode; chat: ReactNode; hasConversations: boolean }) {
  return (
    // flushRight: the thread's composer reaches the window's right edge (owner 11-01, B107).
    <PageScaffold flushRight>
      <div data-testid="messages-two-pane" className="flex-1 min-h-0 flex">
        <div
          data-testid="messages-list-pane"
          className="shrink-0 min-h-0 flex flex-col border-r border-border"
          style={{ width: MESSAGES_LIST_PANE_PX }}
        >
          <div className="flex-1 min-h-0 flex flex-col px-4 pt-2">
            <SectionBoundary label="conversations">{list}</SectionBoundary>
          </div>
        </div>
        <div data-testid="messages-chat-pane" className="flex-1 min-w-0 min-h-0 flex flex-col">
          {chat ? (
            <SectionBoundary label="chat">{chat}</SectionBoundary>
          ) : hasConversations ? (
            <div data-testid="messages-chat-resting" className="flex-1 flex flex-col items-center justify-center gap-1.5 px-8 text-center">
              <p className="font-display font-moment text-ds-22 text-foreground">Pick a conversation</p>
              <p className="text-ds-14 text-muted-foreground max-w-sm">It opens here, next to your inbox.</p>
            </div>
          ) : null}
        </div>
      </div>
    </PageScaffold>
  );
}
