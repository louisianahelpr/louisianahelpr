/**
 * Owner 2026-11-17 (signed-in tweaks, item 6): desktop Inbox with no conversations showed the empty state in the
 * 360px left column beside a huge blank right pane. With none at all (loaded, not a filter's zero) the inbox pane
 * spans the full width and there is no chat pane; with conversations and none open, the right pane still rests on
 * "Pick a conversation"; an open chat keeps the two panes.
 *
 * @mutate src/pages/messages/MessagesTwoPane.tsx |   const spanAll = empty && !chat; |   const spanAll = false;
 * @mutate src/pages/messages/Messages.tsx | empty={!loading && !loadError && allConversations?.length === 0} | empty={false}
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MessagesTwoPane } from "@/pages/messages/MessagesTwoPane";
import { blankComments } from "./helpers/blankNonCode";

afterEach(cleanup);
const draw = (props: { chat?: boolean; hasConversations: boolean; empty?: boolean }) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <MessagesTwoPane list={<div data-testid="list" />} chat={props.chat ? <div data-testid="chat" /> : null} hasConversations={props.hasConversations} empty={props.empty} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("desktop Inbox with no conversations (owner 11-17)", () => {
  it("no conversations: the inbox pane spans the width, no blank chat pane", () => {
    draw({ hasConversations: false, empty: true });
    const list = screen.getByTestId("messages-list-pane");
    expect(list.hasAttribute("data-span-all")).toBe(true);
    expect(list.className.split(/\s+/)).toContain("flex-1");
    expect(list.style.width).toBe("");
    expect(screen.queryByTestId("messages-chat-pane")).toBeNull();
  });

  it("conversations, none open: two panes, the right one resting on 'Pick a conversation'", () => {
    draw({ hasConversations: true, empty: false });
    expect(screen.getByTestId("messages-list-pane").className.split(/\s+/)).toContain("w-[360px]");
    expect(screen.getByTestId("messages-chat-resting").textContent).toContain("Pick a conversation");
  });

  it("an open chat keeps two panes even if the list read says empty", () => {
    draw({ chat: true, hasConversations: false, empty: true });
    expect(screen.getByTestId("messages-chat-pane")).toBeTruthy();
    expect(screen.getByTestId("messages-list-pane").hasAttribute("data-span-all")).toBe(false);
  });

  // Not yet read (allConversations undefined) is not empty: `?.length === 0` is false until the inbox query answers.
  it("Messages passes 'empty' only once the inbox has loaded with none (a filter's zero is not empty)", () => {
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/messages/Messages.tsx"), "utf8"));
    expect(page.length).toBeGreaterThan(5000);
    expect(page).toContain("empty={!loading && !loadError && allConversations?.length === 0}");
  });
});
