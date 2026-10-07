/**
 * THE PINNED CHIP NEVER COVERS THE UNREAD MARK (Q1090, owner 2026-10-07).
 *
 * Seen on prod at 375 (2026-10-07, poster-e2e's pinned + unread thread): the
 * list painted the 16px Pinned chip as an absolute overlay at the row's
 * `top-2 left-2` with z-10, the same top-left avatar corner the 10px unread
 * mark moved to on 2026-09-19, so a pinned thread's unread mark showed as a
 * blue sliver under the chip. Owner: the unread mark keeps its spot; the
 * Pinned chip moves beside the timestamp.
 *
 * So, for every pinned x unread combination the row is rendered and:
 *   1. the chip exists exactly when the thread is pinned (and not selecting);
 *   2. it sits in the timestamp's cluster, in flow (no absolute/fixed
 *      positioning on it or on any wrapper up to the row), and AFTER the name
 *      in document order, so it cannot share the avatar's corner;
 *   3. the unread mark is still inside the avatar box, unmoved;
 *   4. ConversationList no longer paints a Pinned overlay of its own (the
 *      second half of the old defect), read from source with comments blanked.
 *
 * @mutate src/components/messages/ConversationRow.tsx |                 {pinned && !selectMode && <PinnedChip />} |                 {false && pinned && !selectMode && <PinnedChip />}
 * @mutate src/components/messages/PinnedChip.tsx |       className="inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0" |       className="absolute top-2 left-2 z-10 inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0"
 * @mutate src/components/messages/ConversationList.tsx |                             pinned={pinned} |                             pinned={false}
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { ConversationRow } from "@/components/messages/ConversationRow";
import type { Conversation } from "@/components/messages/types";

const ROOT = path.resolve(__dirname, "../..");
const LIST_SRC = blankComments(fs.readFileSync(path.join(ROOT, "src/components/messages/ConversationList.tsx"), "utf8"));

const convo = (unread: number): Conversation =>
  ({
    jobId: "job-1",
    otherUserId: "u-1",
    otherUserName: "Hallie Hebert",
    jobTitle: "Trim crepe myrtles and haul the limbs",
    lastMessage: "Can you come Tuesday?",
    lastAt: new Date().toISOString(),
    unread,
  }) as Conversation;

const CASES = [
  { pinned: true, unread: 1 },
  { pinned: true, unread: 0 },
  { pinned: false, unread: 1 },
  { pinned: false, unread: 0 },
];

afterEach(cleanup);

function positionedAncestor(el: Element, stop: Element): Element | null {
  for (let n: Element | null = el; n && n !== stop; n = n.parentElement) {
    const cls = n.getAttribute("class") ?? "";
    const style = n.getAttribute("style") ?? "";
    if (/(^|\s)(absolute|fixed)(\s|$)/.test(cls) || /position:\s*(absolute|fixed)/.test(style)) return n;
  }
  return null;
}

describe("the Pinned chip sits beside the timestamp, never over the unread mark (Q1090)", () => {
  it("covers every pinned x unread combination (inventory floor)", () => {
    expect(CASES.length).toBeGreaterThan(3);
    expect(CASES.some((c) => c.pinned && c.unread > 0)).toBe(true);
  });

  it.each(CASES)("pinned=$pinned unread=$unread", ({ pinned, unread }) => {
    const { container } = render(
      <ConversationRow convo={convo(unread)} currentUserId="me" openConvo={() => {}} pinned={pinned} />,
    );
    const chip = container.querySelector('[data-testid="pinned-chip"]');
    const mark = container.querySelector('[data-testid="unread-mark"]');
    expect(!!chip, "Pinned chip present exactly when pinned").toBe(pinned);
    expect(!!mark, "unread mark present exactly when unread").toBe(unread > 0);
    if (mark) {
      // The unread mark keeps its spot: inside the avatar box, leading corner.
      expect(mark.getAttribute("class")).toMatch(/-left-0\.5/);
    }
    if (chip) {
      expect(chip.getAttribute("aria-label")).toBe("Pinned");
      expect(positionedAncestor(chip, container), "the chip is laid out in flow, not overlaid").toBeNull();
      const name = Array.from(container.querySelectorAll("*")).find((e) => e.children.length === 0 && e.textContent === "Hallie Hebert");
      expect(name, "name rendered").toBeTruthy();
       
      expect(name!.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING, "chip comes after the name, in the timestamp cluster").toBeTruthy();
      const when = chip.parentElement?.textContent ?? "";
      expect(when, "chip shares the timestamp's cluster").toMatch(/now|\dm/);
    }
  });

  it("is hidden while selecting", () => {
    const { container } = render(
      <ConversationRow convo={convo(1)} currentUserId="me" openConvo={() => {}} pinned selectMode />,
    );
    expect(container.querySelector('[data-testid="pinned-chip"]')).toBeNull();
  });

  it("the list hands pinned to the row and paints no Pinned overlay of its own", () => {
    expect(LIST_SRC).toMatch(/<ConversationRow[\s\S]{0,400}pinned=\{pinned\}/);
    expect(LIST_SRC).not.toMatch(/aria-label="Pinned"/);
  });
});
