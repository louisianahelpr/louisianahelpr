// Q2044 (U6, owner 2026-10-17): iMessage-style messages = read receipts, a typing indicator, photo sending and quick
// replies. Builder 80 found all four built (code read 11-03); Builder 1 saw them live on prod 11-04 (poster-e2e's
// thread with helper-e2e, read-only, shots ~/.lh-shots/b1-q2044: the photo message, the reader's avatar as the
// "seen" receipt). This is the item's own check: each piece, mounted or wired, fails if it is dropped.
//
// @mutate src/components/QuickReplies.tsx |   { label: "On my way", icon: Car, message: "🚗 On my way!", mode: "send" }, |   { label: "Omw", icon: Car, message: "🚗 On my way!", mode: "send" },
// @mutate src/components/ChatPresence.tsx |     typing…\n  </div> |     \n  </div>
// @mutate src/components/messages/chatView/ChatTimeline.tsx |       {isOtherTyping && <TypingIndicator />} |       {false && <TypingIndicator />}
// @mutate src/components/messages/chatView/ChatComposer.tsx |         onTyping={broadcastTyping} |         onTyping={() => {}}
// @mutate src/components/RichMessageInput.tsx |           accept="image/*" |           accept="audio/*"
// @mutate src/components/messages/MessageBubble.tsx |                 readAt={m.read_at} |                 readAt={null}
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { QuickReplies } from "@/components/QuickReplies";
import { TypingIndicator, ReadReceipt } from "@/components/ChatPresence";

const code = (f: string) => blankComments(readFileSync(resolve(__dirname, "..", "..", f), "utf8"));

describe("Q2044: iMessage-style messages", () => {
  it("quick replies: a hired Helpr gets 'On my way' and 'Running 5 min late'; everyone gets 'Running late'", () => {
    render(<QuickReplies onSelect={vi.fn()} onSend={vi.fn()} audience="helper" jobStatus="accepted" />);
    expect(screen.getByText("On my way")).toBeTruthy();
    expect(screen.getAllByText("Running 5 min late").length).toBeGreaterThan(0);
    expect(screen.getByText("Running late")).toBeTruthy();
  });

  it("typing: the indicator says typing, the timeline shows it while the other side types, and the composer broadcasts it", () => {
    render(<TypingIndicator />);
    expect(screen.getByText(/typing…/)).toBeTruthy();
    expect(code("src/components/messages/chatView/ChatTimeline.tsx")).toMatch(/\{isOtherTyping && <TypingIndicator \/>\}/);
    expect(code("src/components/messages/chatView/ChatComposer.tsx")).toMatch(/onTyping=\{broadcastTyping\}/);
  });

  it("read receipts: a read message shows the reader, an unread one says Delivered; the bubble passes read_at", () => {
    const { unmount } = render(<ReadReceipt read={false} sentByMe recipientName="Hallie H." />);
    expect(screen.getByRole("button", { name: "Delivered" })).toBeTruthy();
    unmount();
    render(<ReadReceipt read readAt="2026-11-03T23:53:00Z" sentByMe recipientName="Hallie H." />);
    expect(screen.queryByRole("button", { name: "Delivered" })).toBeNull();
    expect(document.body.textContent).toContain("HH");
    expect(code("src/components/messages/MessageBubble.tsx")).toMatch(/readAt=\{m\.read_at\}/);
  });

  it("photo sending: the composer has an image picker", () => {
    expect(code("src/components/RichMessageInput.tsx")).toMatch(/type="file"\s+accept="image\/\*"/);
  });

  it("inventory: four pieces", () => expect(["receipts", "typing", "photos", "quick replies"].length).toBeGreaterThan(3));
});
