/**
 * Chat text wraps and our own links can be tapped (list #23, Messages audit L1, L2).
 *
 * @mutate src/components/messages/MessageText.tsx | <p className="[overflow-wrap:anywhere]">{parts}</p> | <p>{parts}</p>
 * @mutate src/components/messages/MessageText.tsx |     if (url.hostname !== "louisianahelpr.com" && url.hostname !== "www.louisianahelpr.com") return null; |
 * @mutate src/components/messages/MessageBubble.tsx |   return <MessageText text={content} />; |   return <p>{content}</p>;
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MessageText, ownLinkPath } from "./MessageText";
import { blankComments } from "@/test/helpers/blankNonCode";

const show = (text: string) => render(<MemoryRouter><MessageText text={text} /></MemoryRouter>);

describe("MessageText", () => {
  it("a long unbroken word wraps inside the bubble", () => {
    const { container } = show("x".repeat(300));
    expect(container.querySelector("p")?.className).toContain("[overflow-wrap:anywhere]");
  });

  it("our own link is tappable and stays in the app, without the sentence's full stop", () => {
    show("See https://www.louisianahelpr.com/jobs?job=abc. Thanks");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/jobs?job=abc");
    expect(link.textContent).toBe("https://www.louisianahelpr.com/jobs?job=abc");
    expect(screen.getByText(/Thanks/).textContent).toBe("See https://www.louisianahelpr.com/jobs?job=abc. Thanks");
  });

  it("a bare address of ours works too", () => {
    show("louisianahelpr.com/help");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/help");
  });

  it("other sites stay plain text, including ones dressed up as ours", () => {
    show("Go to https://evil.example/x or https://louisianahelpr.com.evil.example/x or http://notlouisianahelpr.com/x or https://evil.example/louisianahelpr.com or me@louisianahelpr.com");
    // Floor: the message rendered (an empty render has no links either).
    expect(String(screen.getByText(/^Go to /).textContent).length).toBeGreaterThan(100);
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(ownLinkPath("https://louisianahelpr.com.evil.example/x")).toBeNull();
    expect(ownLinkPath("https://evil.example/louisianahelpr.com")).toBeNull();
  });

  it("the bubble's plain text goes through it", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "MessageBubble.tsx"), "utf8"));
    expect(src).toContain("return <MessageText text={content} />;");
  });
});
