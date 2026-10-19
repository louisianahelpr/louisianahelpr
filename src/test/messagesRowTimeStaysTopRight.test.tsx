/**
 * A Messages row keeps its time (and pin) on LINE 1, top right, even when the
 * row carries a status chip (owner, 2026-10-19: "when a row has a status badge
 * (IN PROGRESS), the pin and time wrap to a second line. Keep the time on line
 * 1 top right like the other rows").
 *
 * The shape that broke: name, chip and time cluster were siblings in ONE
 * `flex-wrap` line, so when name + chip + time did not fit, the chip AND the
 * time dropped together. Now line 1 never wraps; only its left group (name +
 * chip) does, and the time cluster is line 1's own last child. jsdom has no
 * layout, so this pins the STRUCTURE that makes the wrap impossible, on the
 * rendered row, for every status the row chips.
 *
 * @mutate src/components/messages/ConversationRow.tsx | <div className="flex items-start gap-x-1.5" data-testid="row-line-1"> | <div className="flex flex-wrap items-start gap-x-1.5" data-testid="row-line-1">
 * @mutate src/components/messages/ConversationRow.tsx |             </div>\n              {/* Right cluster: | \n              {/* Right cluster:
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { ConversationRow } from "@/components/messages/ConversationRow";
import type { Conversation } from "@/components/messages/types";

afterEach(cleanup);

const STATUSES = ["in_progress", "accepted", "completed", "disputed", "revision_requested"];

describe("Messages row: the time stays on line 1, top right", () => {
  for (const status of STATUSES) {
    it(`with a ${status} chip and a pin`, () => {
      render(
        <ConversationRow
          convo={{
            otherUserId: "u-1",
            otherUserName: "Hallie Hebert-Thibodeaux",
            jobId: "j-1",
            jobTitle: "Trim crepe myrtles and haul the limbs",
            jobStatus: status,
            lastMessage: "Can you come Tuesday?",
            lastAt: new Date().toISOString(),
            unread: 0,
          } as unknown as Conversation}
          currentUserId="me"
          openConvo={() => {}}
          pinned
        />,
      );
      const line = screen.getByTestId("row-line-1");
      const time = screen.getByTestId("row-time-cluster");
      const chip = screen.queryByTestId("row-status-chip");
      expect(chip, `${status}: the row chips this status (else this case checks nothing)`).not.toBeNull();
      expect(line.className.split(/\s+/), "line 1 never wraps").not.toContain("flex-wrap");
      expect(time.parentElement, "the time cluster is line 1's own child").toBe(line);
      expect(line.lastElementChild, "…and its LAST child: the top-right corner").toBe(time);
      expect(chip!.parentElement, "the chip wraps inside the left group, not line 1").not.toBe(line);
      expect(line.contains(chip!)).toBe(true);
      expect(time.querySelector("[data-testid=\"pinned-chip\"]"), "the pin sits beside the time").not.toBeNull();
    });
  }
});
