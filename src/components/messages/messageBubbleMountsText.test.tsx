/**
 * Mount wiring (vacuity scan, B45 10-31): MessageText was tested only on its own, so a chat bubble that stopped
 * mounting it (wrong prop, plain <p> again) stayed green. This renders the REAL MessageBubble with a plain text
 * message and finds MessageText's own output in it: the wrapping paragraph and our own link, tappable in the app.
 *
 * @mutate src/components/messages/MessageBubble.tsx |   return <MessageText text={content} />; |   return <p>{content}</p>;
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MessageBubble } from "./MessageBubble";
import type { Conversation, Message } from "./types";

const m = {
  id: "m1", job_id: "j1", sender_id: "them", receiver_id: "me", read: true, created_at: "2026-10-31T12:00:00Z",
  content: "See https://www.louisianahelpr.com/jobs?job=abc. Thanks",
  attachment_url: null, attachment_mime: null, attachment_size: null, attachment_duration: null, reply_to_id: null,
} as unknown as Message;

describe("a chat bubble mounts MessageText", () => {
  it("our own link in a message is a tappable in-app link, inside the wrapping paragraph", () => {
    const { container } = render(
      <MemoryRouter>
        <MessageBubble m={m} mine={false} showReadReceipt={false} activeConvo={{} as Conversation} retryMessage={vi.fn()}
          setLightboxPhoto={vi.fn()} onDelete={vi.fn()} onLongPress={vi.fn()} />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    expect(links.find((a) => a.getAttribute("href") === "/jobs?job=abc")).toBeTruthy();
    expect(container.querySelector("p.\\[overflow-wrap\\:anywhere\\]")?.textContent).toBe(m.content);
  });
});
