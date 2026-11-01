/**
 * Desktop Messages = TWO PANES (board 38, owner 2026-10-20), overriding the
 * 2026-09-11 "selected thread = full page" rule, under the owner's one condition:
 * the chat is NEVER cut off. So:
 *   - on a wide desktop, the inbox list (360px) and the open chat sit side by side
 *     in one PageScaffold, both `embedded`, with a resting state in the chat pane;
 *   - the split starts only where the chat keeps >= 480px (measured: 1140 -> 482px);
 *   - below that, desktop and phone keep the list -> full chat swap;
 *   - the list pane wears the phone's header (title, search pill, chips).
 *
 * @mutate src/pages/messages/Messages.tsx |       embedded={twoPane}\n      activeKey={ |       embedded={false}\n      activeKey={
 * @mutate src/pages/messages/Messages.tsx |       {twoPane ? ( |       {false ? (
 * @mutate src/pages/messages/MessagesTwoPane.tsx |           style={{ width: MESSAGES_LIST_PANE_PX }} |           style={{ width: 340 }}
 * @mutate src/pages/messages/MessagesTwoPane.tsx |           ) : null} |           ) : <p>When you message someone, the conversation opens here.</p>}
 * @mutate src/pages/messages/useTwoPane.ts | export const TWO_PANE_MIN_WIDTH = 1140; | export const TWO_PANE_MIN_WIDTH = 900;
 * @mutate src/pages/messages/useTwoPane.ts |   return isWebDesktop && isWide; |   return isWide;
 * @mutate src/components/messages/ConversationList.tsx |   const phoneTopBar = embedded \|\| !isWebDesktop; |   const phoneTopBar = !isWebDesktop && !embedded;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  TWO_PANE_MIN_WIDTH,
  TWO_PANE_CHROME_PX,
  CHAT_PANE_FLOOR_PX,
  MESSAGES_LIST_PANE_PX,
} from "@/pages/messages/useTwoPane";

const read = (rel: string) => blankComments(readFileSync(resolve(__dirname, "..", rel), "utf8"));
const page = read("pages/messages/Messages.tsx");
const hook = read("pages/messages/useTwoPane.ts");
const panes = read("pages/messages/MessagesTwoPane.tsx");
const list = read("components/messages/ConversationList.tsx");

describe("Messages matches board 38 without ever cutting the chat off", () => {
  it("is not vacuous", () => {
    expect(page.length).toBeGreaterThan(5000);
    expect(list.length).toBeGreaterThan(20000);
  });

  it("a wide desktop shows the list and the open chat side by side, both embedded", () => {
    expect(page).toMatch(/const twoPane = useMessagesTwoPane\(\);/);
    expect(page).toMatch(/embedded=\{twoPane\}\s*activeKey=\{/);
    expect(page).toMatch(/jobSystemEvents=\{jobSystemEvents\}\s*embedded=\{twoPane\}/);
    expect(page).toMatch(/\{twoPane \? \(\s*<MessagesTwoPane list=\{listEl\} chat=\{chatEl\} hasConversations=\{conversations\.length > 0\} \/>/);
    expect(panes.length).toBeGreaterThan(800);
    expect(panes).toContain("<PageScaffold flushRight>"); // B107 (11-01): the open chat runs to the window edge on desktop
    expect(panes).toMatch(/data-testid="messages-list-pane"[\s\S]*style=\{\{ width: MESSAGES_LIST_PANE_PX \}\}/);
    expect(panes).toMatch(/data-testid="messages-chat-pane" className="flex-1 min-w-0/);
    // A resting state when no thread is open; with no conversations the pane
    // stays empty, the inbox pane's empty state is the only one (A3-C19).
    expect(panes).toMatch(/\) : hasConversations \? \(\s*<div data-testid="messages-chat-resting"[\s\S]*Pick a conversation[\s\S]*\) : null\}/);
    expect(panes).not.toMatch(/No conversations yet|When you message someone/);
    // Narrower: the one-at-a-time swap is still there.
    expect(page).toMatch(/\) : !activeConvo \? \(\s*<SectionBoundary label="conversations">\{listEl\}<\/SectionBoundary>\s*\) : \(\s*<SectionBoundary label="chat">\{chatEl\}<\/SectionBoundary>/);
  });

  it("the split starts only where the chat keeps its 480px floor, and only on the desktop website", () => {
    expect(MESSAGES_LIST_PANE_PX).toBe(360);
    expect(CHAT_PANE_FLOOR_PX).toBeGreaterThanOrEqual(480);
    expect(TWO_PANE_CHROME_PX).toBeGreaterThanOrEqual(248);
    expect(TWO_PANE_MIN_WIDTH).toBeGreaterThanOrEqual(TWO_PANE_CHROME_PX + MESSAGES_LIST_PANE_PX + CHAT_PANE_FLOOR_PX);
    expect(hook).toMatch(/return isWebDesktop && isWide;/);
  });

  it("the list pane wears the phone header (title, search pill, chips)", () => {
    expect(list).toMatch(/const phoneTopBar = embedded \|\| !isWebDesktop;/);
  });
});
