/**
 * Q1465: in Recently Deleted the Restore chip is laid over the row's right
 * edge, and at 375 the job line ran underneath it ("…corner lot" under
 * "Restore"; at 1440 the OPEN chip and the time did). The row now reserves
 * the chip's width: ConversationList passes reserveTrailingControl in that
 * view, and ConversationRow's text column then stops 5.5rem (88px) short.
 *
 * Measured on screen (Playwright, prod data, poster-e2e, 2026-10-07): text runs
 * painted under the chip, before -> after: 375: 4 -> 0; 1440: 2 -> 0
 * (~/.lh-shots/lane-low/shots, reviews recorded). The chip itself is
 * px-2.5 + a 12px icon + "Restore" at ds-11 + right-2: about 79px + 8px.
 *
 * @mutate src/components/messages/ConversationList.tsx |                             reserveTrailingControl={isRecentlyDeletedView} |
 * @mutate src/components/messages/ConversationRow.tsx | ${reserveTrailingControl ? " pr-[5.5rem]" : ""} | ${""}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../../..");
const list = blankComments(readFileSync(resolve(ROOT, "src/components/messages/ConversationList.tsx"), "utf8"));
const row = blankComments(readFileSync(resolve(ROOT, "src/components/messages/ConversationRow.tsx"), "utf8"));

describe("Q1465: a Recently Deleted row's text stops before the Restore chip", () => {
  it("the list renders the Restore chip only in Recently Deleted, and tells that row to reserve its width", () => {
    expect(list).toMatch(/isRecentlyDeletedView && \(\s*<button[\s\S]*?aria-label=\{`Restore conversation/);
    expect(list).toMatch(/<ConversationRow[\s\S]*?reserveTrailingControl=\{isRecentlyDeletedView\}[\s\S]*?\/>/);
  });

  it("the row's text column stops 5.5rem (88px) short when asked, enough for the ~87px chip", () => {
    expect(row).toMatch(/reserveTrailingControl \? " pr-\[5\.5rem\]" : ""/);
    expect(list).toMatch(/className="absolute top-1\/2 -translate-y-1\/2 right-2 z-10 inline-flex items-center gap-1 px-2\.5/);
  });
});
