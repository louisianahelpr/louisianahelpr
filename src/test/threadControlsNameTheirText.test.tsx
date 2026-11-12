/**
 * Q1816 (messages-thread thread-dock-messages-axe, iphone-webkit, red at baseline 2026-11-06): axe 4.14's
 * label-content-name-mismatch (WCAG 2.5.3, "Label in Name") on an open thread. Two thread controls drew text their
 * aria-label did not hold:
 *   - the jump chip drew "Jump to latest" and was named "Jump to newest message" (it shows whenever the thread is not
 *     at the bottom, which is how the webkit run saw it);
 *   - a reaction chip used by two people drew its count ("2") and was named "React with <emoji>" without it.
 * Both proven against axe-core 4.14 itself in a lab page (old markup: 1 violation each; new: clean).
 * This renders the real components and holds each control's accessible name to its visible text.
 *
 * @mutate src/lib/i18n/enMessages.ts |   "msg.jumpLatestAria": "Jump to latest message", |   "msg.jumpLatestAria": "Jump to newest message",
 * @mutate src/components/messages/MessageBubble.tsx | ${count > 1 ? t("msg.nReactions", { n: count }) : ""} |
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { JumpToBottomButton } from "@/components/messages/chatView/JumpToBottomButton";
import { MessageBubble } from "@/components/messages/MessageBubble";
import type { Conversation, Message } from "@/components/messages/types";

/** axe's comparison, near enough: lower case, letters and digits only, the visible text inside the name. */
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const holdsText = (el: HTMLElement) => {
  const name = el.getAttribute("aria-label") ?? "";
  const text = words(el.textContent ?? "");
  return { name, text, ok: text === "" || words(name).includes(text) };
};

describe("thread controls name the text they draw (WCAG 2.5.3)", () => {
  const ref = <T,>(v: T) => ({ current: v });

  it("the jump chip, both ways", () => {
    for (const firstUnreadOffscreen of [false, true]) {
      const { unmount } = render(
        <JumpToBottomButton firstUnreadOffscreen={firstUnreadOffscreen} showJumpToBottom hasMessages
          scrollContainerRef={ref(null)} initialFirstUnreadIdRef={ref(null)} initialUnreadCountRef={ref(3)} />,
      );
      const r = holdsText(screen.getByRole("button"));
      expect(r.text, "inventory: the chip draws text").not.toBe("");
      expect(r.ok, `"${r.text}" is not in "${r.name}"`).toBe(true);
      unmount();
    }
  });

  it("reaction chips, with and without a count, mine or not", () => {
    const m = {
      id: "m1", job_id: "j1", sender_id: "them", receiver_id: "me", read: true, created_at: "2026-10-31T12:00:00Z",
      content: "Thanks", attachment_url: null, attachment_mime: null, attachment_size: null, attachment_duration: null, reply_to_id: null,
    } as unknown as Message;
    render(
      <MemoryRouter>
        <MessageBubble m={m} mine={false} showReadReceipt={false} activeConvo={{} as Conversation} retryMessage={vi.fn()}
          setLightboxPhoto={vi.fn()} onDelete={vi.fn()} onLongPress={vi.fn()} onReact={vi.fn()}
          reactions={{ counts: [{ emoji: "❤️", count: 2 }, { emoji: "👍", count: 1 }, { emoji: "😂", count: 2 }], mine: "😂" }} />
      </MemoryRouter>,
    );
    const chips = screen.getAllByRole("button", { name: /^(React with|Remove your)/ });
    // Inventory floor: the three chips rendered above.
    expect(chips.length).toBeGreaterThan(2);
    for (const c of chips) {
      const r = holdsText(c);
      expect(r.ok, `"${r.text}" is not in "${r.name}"`).toBe(true);
    }
    expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual(["React with ❤️, 2 reactions", "React with 👍", "Remove your 😂 reaction, 2 reactions"]);
  });
});
