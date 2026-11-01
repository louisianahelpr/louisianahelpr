/**
 * Owner 11-01 (B107, /messages at ~1900px): the thread sat in a narrow centred column with small text. On a computer
 * (lg) a bubble may take up to 65% of the pane, theirs on the left and mine on the right, and the text is body size
 * (15px); a phone keeps 75% and 13px. Measured in the 1440/1920 shots (~/.lh-shots/b107/msgs-*): jsdom has no layout,
 * so this file pins the classes and the row's side.
 *
 * @mutate src/components/messages/MessageBubble.tsx | max-w-[75%] lg:max-w-[65%] flex | max-w-[75%] flex
 * @mutate src/components/messages/MessageBubble.tsx | text-ds-13 lg:text-ds-15 group | text-ds-13 group
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MessageBubble } from "./MessageBubble";
import type { Conversation, Message } from "./types";

const msg = (id: string) => ({
  id, job_id: "j1", sender_id: "x", receiver_id: "y", read: true, created_at: "2026-10-31T12:00:00Z", content: "All done, photos are on the job.",
  attachment_url: null, attachment_mime: null, attachment_size: null, attachment_duration: null, reply_to_id: null,
}) as unknown as Message;

const show = (mine: boolean) => render(
  <MemoryRouter>
    <MessageBubble m={msg(mine ? "mine" : "theirs")} mine={mine} showReadReceipt={false} activeConvo={{} as Conversation} retryMessage={vi.fn()}
      setLightboxPhoto={vi.fn()} onDelete={vi.fn()} onLongPress={vi.fn()} />
  </MemoryRouter>,
).container;

describe("chat bubbles on a computer", () => {
  it.each([[true, "items-end"], [false, "items-start"]])("mine=%s: up to 65% of the pane from lg (75% on a phone), anchored %s, 15px text from lg", (mine, side) => {
    const c = show(mine);
    const col = c.querySelector("[data-bubble-col]")!;
    const cls = col.className.split(/\s+/);
    expect(cls).toContain("max-w-[75%]");
    expect(cls).toContain("lg:max-w-[65%]");
    expect(cls).toContain(side);
    const bubble = c.querySelector("[data-bubble]")!.className.split(/\s+/);
    expect(bubble).toContain("text-ds-13");
    expect(bubble).toContain("lg:text-ds-15");
  });
});
