/**
 * Q1465: in Recently Deleted at 375 the "Restore" chip covered the end of a
 * long job line ("SEED Mow and edge a corner lot": "lot" sat behind it),
 * because the chip was absolutely positioned over the row. It is now the
 * row's `trailing` slot: a flex sibling of the text column, so the column
 * shrinks (and its job line truncates) before the chip instead of under it.
 *
 * Asserts the layout CONTRACT that makes overlap impossible, read from the
 * rendered DOM: the trailing control is a direct flex child of the row frame,
 * after the open-thread button, with no absolutely positioned ancestor below
 * the frame; and the list's Restore has no `absolute` class of its own.
 *
 * @mutate src/components/messages/ConversationRow.tsx |       {trailing && <div data-row-trailing className="shrink-0 self-center">{trailing}</div>} |       {trailing && <div data-row-trailing className="absolute right-2 top-1/2 shrink-0 self-center">{trailing}</div>}
 * @mutate src/components/messages/ConversationRow.tsx |       {trailing && <div data-row-trailing className="shrink-0 self-center">{trailing}</div>} |       {null}
 * @mutate src/components/messages/ConversationList.tsx |                           trailing={restore} |                           trailing={undefined}
 * @mutate src/components/messages/RestoreConversationButton.tsx |       className="inline-flex items-center gap-1 | className="absolute right-2 inline-flex items-center gap-1
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { ConversationRow, CONVERSATION_ROW_FRAME } from "@/components/messages/ConversationRow";
import type { Conversation } from "@/components/messages/types";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const convo = {
  jobId: "job-1",
  otherUserId: "u-1",
  otherUserName: "Hallie Hebert",
  jobTitle: "SEED Mow and edge a corner lot",
  lastMessage: "Can you come Tuesday?",
  lastAt: new Date().toISOString(),
  unread: 0,
} as Conversation;

afterEach(cleanup);

describe("Q1465: Recently Deleted's Restore sits in the row's flow, never over the job line", () => {
  it("the trailing control is a flex child of the row frame, after the open-thread button", () => {
    render(
      <ConversationRow convo={convo} currentUserId="me" openConvo={() => {}} trailing={<button type="button">Restore</button>} />,
    );
    const restore = screen.getByRole("button", { name: "Restore" });
    const slot = restore.closest("[data-row-trailing]") as HTMLElement;
    expect(slot).not.toBeNull();
    const frame = slot.parentElement as HTMLElement;
    for (const c of CONVERSATION_ROW_FRAME.split(" ").filter((x) => /flex|items-center/.test(x))) expect(frame.className).toContain(c);
    expect(slot.className).toContain("shrink-0");
    expect(slot.className).not.toMatch(/\babsolute\b/);
    const open = screen.getByText(convo.jobTitle).closest("button") as HTMLElement;
    expect(open.parentElement).toBe(frame);
    expect(open.className).toMatch(/\bmin-w-0\b/);
    expect(open.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (let n: HTMLElement | null = restore; n && n !== frame; n = n.parentElement) {
      expect(n.className ?? "", "nothing between the chip and the frame is absolutely positioned").not.toMatch(/\babsolute\b/);
    }
  });

  it("no trailing control: no empty slot", () => {
    const { container } = render(<ConversationRow convo={convo} currentUserId="me" openConvo={() => {}} />);
    expect(container.querySelector("[data-row-trailing]")).toBeNull();
  });

  it("the list hands Restore to the row's trailing slot, and Restore is not absolutely positioned", () => {
    const list = blankComments(fs.readFileSync(path.join(ROOT, "src/components/messages/ConversationList.tsx"), "utf8"));
    expect(list).toMatch(/const restore = isRecentlyDeletedView && userId \? <RestoreConversationButton /);
    expect(list).toMatch(/trailing=\{restore\}/);
    const button = blankComments(fs.readFileSync(path.join(ROOT, "src/components/messages/RestoreConversationButton.tsx"), "utf8"));
    expect(button).toMatch(/Restore conversation with/);
    expect(button).not.toMatch(/\babsolute\b/);
  });
});
