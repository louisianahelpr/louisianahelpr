import type { ReactNode } from "react";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { SectionBoundary } from "@/components/SectionBoundary";
import { MESSAGES_LIST_PANE_CLASS } from "./useTwoPane";
import { EmptyState } from "@/components/ui/EmptyState";
import { MessagesSquare } from "lucide-react";
import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enMessages";

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
 *
 * Owner 2026-11-17 (signed-in tweaks, item 6): with no conversations at all (`empty`: loaded, none, not a filter's
 * zero) the right pane was a huge blank. The inbox pane then spans the full width (its content kept to a readable
 * column) and there is no chat pane; the moment a conversation exists, the two panes return.
 */
export function MessagesTwoPane({ list, chat, hasConversations, empty = false }: { list: ReactNode; chat: ReactNode; hasConversations: boolean; empty?: boolean }) {
  const spanAll = empty && !chat;
  return (
    // flushRight: the thread's composer reaches the window's right edge (owner 11-01, B107).
    <PageScaffold flushRight>
      <div data-testid="messages-two-pane" className="flex-1 min-h-0 flex">
        <div
          data-testid="messages-list-pane"
          data-span-all={spanAll ? "" : undefined}
          className={`min-h-0 flex flex-col ${spanAll ? "flex-1 min-w-0" : `shrink-0 border-r border-border ${MESSAGES_LIST_PANE_CLASS}`}`}
        >
          <div className={`flex-1 min-h-0 flex flex-col px-4 pt-2${spanAll ? " mx-auto w-full max-w-2xl" : ""}`}>
            <SectionBoundary label="conversations">{list}</SectionBoundary>
          </div>
        </div>
        {!spanAll && <div data-testid="messages-chat-pane" className="flex-1 min-w-0 min-h-0 flex flex-col">
          {chat ? (
            <SectionBoundary label="chat">{chat}</SectionBoundary>
          ) : hasConversations ? (
            // The shared empty state (owner-approved polish 2026-11-20), not a hand-made one: a friendly resting pane.
            <div data-testid="messages-chat-resting" className="flex-1 flex flex-col items-center justify-center px-8">
              <EmptyState variant="bare" icon={MessagesSquare} title={t("msg.pickTitle")} body={t("msg.pickBody")} />
            </div>
          ) : null}
        </div>}
      </div>
    </PageScaffold>
  );
}
