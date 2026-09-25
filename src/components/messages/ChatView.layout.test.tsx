/**
 * VN-25 (owner, 2026-09-14): "the bottom message part needs to fill the bottom
 * area". Only the composer was named. The first fix removed the 780px reading
 * cap from the WHOLE chat column, so the safety banner and every message bubble
 * spread across a ~1570px desktop pane too. This pins the split: the composer
 * dock sits in an uncapped column, and the banner and the message scroller each
 * keep the centred 780px column.
 *
 * The children that own data, realtime and scrolling are stubbed — this test is
 * about which element carries the cap, not about what renders inside them.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

vi.mock("./chatView/ChatPaneShell", () => ({
  ChatPaneShell: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <div data-testid="pane">
      {header}
      {children}
    </div>
  ),
}));
vi.mock("./ChatHeader", () => ({ ChatHeader: () => <div data-testid="chat-header" /> }));
vi.mock("./chatView/ChatTimeline", () => ({ ChatTimeline: () => <div data-testid="chat-timeline" /> }));
vi.mock("./chatView/ChatComposer", () => ({ ChatComposer: () => <div data-testid="chat-composer" /> }));
vi.mock("./chatView/JumpToBottomButton", () => ({ JumpToBottomButton: () => null }));
vi.mock("./MuteSheet", () => ({ MuteSheet: () => null }));
vi.mock("./MessageActionSheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/dashboard/PhotoLightbox", () => ({ PhotoLightbox: () => null }));
vi.mock("@/components/ui/BrandConfirmDialog", () => ({ BrandConfirmDialog: () => null }));
// The off-the-job read is a server RPC; a layout test has no thread state.
vi.mock("@/lib/offJobGate", () => ({ useOffJobState: () => null }));
vi.mock("./useMessageReactions", () => ({
  useMessageReactions: () => ({ reactions: new Map(), react: vi.fn() }),
}));
vi.mock("./chatView/useTimestampReveal", () => ({
  useTimestampReveal: () => ({ reveal: 0, handlers: {} }),
}));
vi.mock("./chatView/useChatScroll", () => ({
  useChatScroll: () => ({
    scrollContainerRef: { current: null },
    initialFirstUnreadIdRef: { current: null },
    initialUnreadCountRef: { current: 0 },
    showJumpToBottom: false,
    firstUnreadOffscreen: false,
    setThreadRef: () => {},
    pullDistance: 0,
    refreshing: false,
    isPulling: false,
    canTrigger: false,
  }),
}));

import { ChatView } from "./ChatView";

const CAP = "max-w-[780px]";

function renderChat(embedded: boolean) {
  const noop = () => {};
  return render(
    <MemoryRouter>
      <ChatView
        embedded={embedded}
        activeConvo={{
          otherUserId: "u2",
          otherUserName: "Perry P.",
          jobTitle: "Fix a leaking kitchen faucet",
          jobId: "job-1",
          viewerIsPoster: true,
          lastMessage: "",
          lastAt: new Date().toISOString(),
          unread: 0,
        }}
        onCloseThread={noop}
        keyboardInset={0}
        isOtherOnline={false}
        isOtherTyping={false}
        broadcastTyping={noop}
        messages={[]}
        userId="u1"
        chatLoadError={false}
        chatLoading={false}
        onRetryLoad={noop}
        hasMoreMessages={false}
        loadingMore={false}
        loadOlderMessages={noop}
        onRefreshThread={async () => {}}
        sendMessage={async () => true}
        retryMessage={noop}
        chatContainerRef={{ current: null }}
        bottomRef={{ current: null }}
        setReportTarget={noop}
        setBlockTarget={noop}
        setDeleteMessageConfirm={noop}
        onEditMessage={async () => {}}
        onToggleMute={noop}
        onSnoozeMute={noop}
        onUnmute={noop}
        jobSystemEvents={[]}
      />
    </MemoryRouter>,
  );
}

/** Every element from `el` up to (not including) the pane, innermost first. */
function ancestorsWithinPane(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node: HTMLElement | null = el;
  while (node && node.dataset.testid !== "pane") {
    out.push(node);
    node = node.parentElement;
  }
  return out;
}

const capped = (el: HTMLElement) => el.className.includes(CAP) && el.className.includes("mx-auto");

describe.each([
  ["embedded desktop pane", true],
  ["standalone", false],
])("ChatView reading column (VN-25) — %s", (_label, embedded) => {
  it("the composer dock spans the pane: nothing between it and the pane is capped", () => {
    renderChat(embedded);
    const chain = ancestorsWithinPane(screen.getByTestId("chat-composer"));
    expect(chain.length).toBeGreaterThan(1);
    expect(chain.filter(capped)).toEqual([]);
  });

  it("the message timeline keeps the centred 780px column", () => {
    renderChat(embedded);
    const chain = ancestorsWithinPane(screen.getByTestId("chat-timeline"));
    expect(chain.some(capped)).toBe(true);
  });

  it("the safety banner keeps the centred 780px column", () => {
    renderChat(embedded);
    const text = screen.getByText(/Keep chats & payments on Helpr/);
    expect(ancestorsWithinPane(text).some(capped)).toBe(true);
  });
});

/* BLIND SPOTS, stated rather than implied. jsdom computes NO style, so every
 * assertion here is a CLASS-NAME proxy: it proves which element carries
 * `max-w-[780px] mx-auto`, never that the composer is actually wider than the
 * bubbles on a 1570px pane. Tailwind could stop emitting the arbitrary value,
 * a parent could set its own width, or `--chat-gutter` could change, and this
 * file would not notice. The measured version of this claim is a rendered
 * screenshot at 1440 and 375 (VN-25); this file's job is to stop the cap being
 * moved back onto the composer's ancestors by a later edit. */

// THE SPLIT ITSELF: the cap lives on the scroller, not the column.
// @mutate src/components/messages/ChatView.tsx | const CHAT_READING_COLUMN = "w-full max-w-[780px] mx-auto"; | const CHAT_READING_COLUMN = "w-full";
// …and the other direction — re-capping the column the composer dock sits in,
// which is the regression the owner reported.
// @mutate src/components/messages/ChatView.tsx | className="flex flex-col flex-1 min-h-0 w-full transition-[padding] duration-150" | className="flex flex-col flex-1 min-h-0 w-full max-w-[780px] mx-auto transition-[padding] duration-150"
