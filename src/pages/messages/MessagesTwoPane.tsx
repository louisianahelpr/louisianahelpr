import type { ReactNode } from "react";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { SectionBoundary } from "@/components/SectionBoundary";
import { MESSAGES_LIST_PANE_PX } from "./useTwoPane";

/**
 * Board 38 (owner, 2026-10-20): desktop Messages as two panes in one PageScaffold.
 * The inbox list is 360px; the open deal room takes the rest (useTwoPane only
 * turns this on where that rest is >= 480px, so the chat is never cut off).
 * With no thread open, the chat pane rests with an honest line.
 */
export function MessagesTwoPane({ list, chat, hasConversations }: { list: ReactNode; chat: ReactNode; hasConversations: boolean }) {
  return (
    <PageScaffold>
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
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-1.5 px-8 text-center">
              <p className="font-display font-moment text-ds-22 text-foreground">
                {hasConversations ? "Pick a conversation" : "No conversations yet"}
              </p>
              <p className="text-ds-14 text-muted-foreground max-w-sm">
                {hasConversations ? "It opens here, next to your inbox." : "When you message someone, the conversation opens here."}
              </p>
            </div>
          )}
        </div>
      </div>
    </PageScaffold>
  );
}
