/**
 * OWNER, 2026-09-19 (desktop screenshot of /messages?chat=1): "messages need
 * to fill the screen."
 *
 * THE MECHANISM. The chat column is a flex column inside a 100dvh AppShell;
 * the message scroller is its `flex-1` child, so on a pane taller than the
 * conversation the scroller is taller than its content. The timeline is
 * bottom-anchored inside it (`mt-auto`, VN-25 — top-anchoring left a ~400px
 * void between the last bubble and the composer, which made the composer read
 * as a bar floating in dead space). An auto margin collapses ALL of that slack
 * into ONE contiguous band, and the band opens immediately above whatever the
 * anchored block starts with.
 *
 * THE DEFECT that produced was placement, not sizing: the safety banner was a
 * SIBLING of the scroller, pinned to the top of the column, so the band opened
 * BETWEEN two pieces of content — banner alone at the top, ~280px of nothing,
 * then the first date divider (owner's 1640x900 pane: banner bottom y≈247,
 * first divider y≈524). Slack between two things reads as a hole; the same
 * slack above everything, with only the chat header over it, reads as air.
 *
 * THE RULE, which is what this guards: every piece of chat content that is not
 * the composer must sit INSIDE the bottom-anchored block. Nothing may be
 * pinned above the scroller, because anything pinned there gets the whole
 * band under it. Stated structurally so it survives restyling, and stated as
 * a CLASS — it is not "the banner is in the right div", it is "no chat content
 * is stranded above the auto margin".
 *
 * Deliberately NOT asserted: the 780px reading measure. "Fill the screen"
 * means no dead band, not edge-to-edge text — a 1640px-wide bubble is a worse
 * read, not a better one. The measure is VN-25's business and is guarded by
 * ChatView.layout.test.tsx.
 *
 * @mutate src/components/messages/ChatView.tsx | overflow-x-clip ${timeline.length === 0 ? "my-auto" : "mt-auto"} | overflow-x-clip
 * @mutate src/components/messages/ChatView.tsx |           >\n          {/* THE SAFETY BANNER |           />\n          <div>\n          {/* THE SAFETY BANNER
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

vi.mock("./../components/messages/chatView/ChatPaneShell", () => ({
  ChatPaneShell: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <div data-testid="pane">
      {header}
      {children}
    </div>
  ),
}));
vi.mock("./../components/messages/ChatHeader", () => ({ ChatHeader: () => <div data-testid="chat-header" /> }));
vi.mock("./../components/messages/chatView/ChatTimeline", () => ({
  ChatTimeline: () => <div data-testid="chat-timeline" />,
}));
vi.mock("./../components/messages/chatView/ChatComposer", () => ({
  ChatComposer: () => <div data-testid="chat-composer" />,
}));
vi.mock("./../components/messages/chatView/JumpToBottomButton", () => ({ JumpToBottomButton: () => null }));
vi.mock("./../components/messages/MuteSheet", () => ({ MuteSheet: () => null }));
vi.mock("./../components/messages/MessageActionSheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/dashboard/PhotoLightbox", () => ({ PhotoLightbox: () => null }));
vi.mock("@/components/ui/BrandConfirmDialog", () => ({ BrandConfirmDialog: () => null }));
vi.mock("./../components/messages/useMessageReactions", () => ({
  useMessageReactions: () => ({ reactions: new Map(), react: vi.fn() }),
}));
vi.mock("./../components/messages/chatView/useTimestampReveal", () => ({
  useTimestampReveal: () => ({ reveal: 0, handlers: {} }),
}));
vi.mock("./../components/messages/chatView/useChatScroll", () => ({
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

import { ChatView } from "@/components/messages/ChatView";

function renderChat() {
  const noop = () => {};
  return render(
    <MemoryRouter>
      <ChatView
        embedded={false}
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

/**
 * The element that collapses the scroller's spare height into one band.
 * Found by the auto margin itself, not by a testid, because the auto margin
 * IS the thing under test.
 */
function bottomAnchor(container: HTMLElement) {
  return container.querySelector<HTMLElement>(".mt-auto, .my-auto");
}

afterEach(cleanup);

describe("chat thread — the bottom-anchor band never opens between two pieces of content", () => {
  it("the thread is bottom-anchored at all (the band exists to be placed)", () => {
    const { container } = renderChat();
    expect(
      bottomAnchor(container),
      "nothing carries mt-auto/my-auto: the thread is top-anchored again and the " +
        "void is back under the last bubble (VN-25).",
    ).not.toBeNull();
  });

  it("the safety banner rides INSIDE the anchored block, not pinned above the scroller", () => {
    const { container } = renderChat();
    const anchor = bottomAnchor(container)!;
    const banner = screen.getByText(/Keep chats & payments on Helpr/);
    expect(
      anchor.contains(banner),
      "the safety banner is outside the bottom-anchored block, so all of the " +
        "scroller's spare height opens as one band between it and the first message.",
    ).toBe(true);
  });

  it("the banner and the timeline share the anchored block, in that order", () => {
    const { container } = renderChat();
    const anchor = bottomAnchor(container)!;
    const timeline = screen.getByTestId("chat-timeline");
    const banner = screen.getByText(/Keep chats & payments on Helpr/);

    expect(anchor.contains(timeline)).toBe(true);
    // DOCUMENT_POSITION_FOLLOWING === 4: the timeline comes after the banner.
    expect(banner.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("nothing else is stranded above the scroller: only the sr-only h1 sits there", () => {
    // THE CLASS. Whatever the column's children are, every visible one that
    // is not the composer or the jump-to-bottom affordance must be inside the
    // anchored block — otherwise it inherits the whole band underneath it,
    // which is the defect this file exists for.
    const { container } = renderChat();
    const anchor = bottomAnchor(container)!;
    // The scroller is the anchored block's parent (PullToRefreshWrapper).
    const scroller = anchor.parentElement!;
    const column = scroller.parentElement!;

    const stranded = Array.from(column.children).filter((child) => {
      if (child === scroller) return false;
      if (child.contains(screen.getByTestId("chat-composer"))) return false;
      // sr-only content takes no layout space, so it cannot open a band.
      return !child.className.toString().includes("sr-only");
    });

    expect(
      stranded.map((el) => el.className.toString().slice(0, 70)),
      "these render ABOVE the message scroller, so the scroller's entire spare " +
        "height opens as one dead band between them and the conversation. Move " +
        "them inside the bottom-anchored block.",
    ).toEqual([]);
  });
});
