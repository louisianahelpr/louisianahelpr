/**
 * F421 / F437 / F439 (whole-app audit 2026-11-10; owner pop-up 11-11 morning): Messages rows are TITLE FIRST.
 *
 * Seen on prod: 14 rows all read "E2E P." with the same avatar and "Active today", and the job ("which of these is my
 * Pressure wash?") sat in a small grey caption. Owner 11-11: the job title is the headline, with the job's photo; the
 * other person's name goes on line 2; "Active today" is dropped. The pin chip and the unread state stay.
 * (Supersedes the 2026-10-19 name-first row layout.)
 *
 * Every row a job thread can paint is rendered here (each status the row knows, read from its own `allowed`
 * list, with and without a photo, read and unread):
 *   1. line 1's headline is the job title, and it carries the unread weight;
 *   2. the person's name is on line 2 (the caption), after the headline;
 *   3. a job with a photo leads with that photo; one without keeps the person's avatar;
 *   4. no row says "Active today", even when the person was active today;
 *   5. the Pinned chip and the unread count still paint.
 * And the loader asks the jobs read for `photos` and maps the first one onto the row.
 *
 * @mutate src/components/messages/ConversationRow.tsx |   const headline = c.teamThread ? c.otherUserName : c.jobTitle; |   const headline = c.otherUserName;
 * @mutate src/components/messages/ConversationRow.tsx |         {c.jobPhotoUrl && !c.teamThread ? ( |         {false ? (
 * @mutate src/pages/messages/messagesData/loadConversations.ts |     jobPhotoUrl: jobMap.get(v.jobId)?.photo ?? null, |     jobPhotoUrl: null,
 * @mutate src/pages/messages/messagesData/loadConversations.ts | cancelled_by, cancellation_reason, photos").in("id", jobIds), | cancelled_by, cancellation_reason").in("id", jobIds),
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { ConversationRow } from "@/components/messages/ConversationRow";
import type { Conversation } from "@/components/messages/types";
import { blankComments } from "@/test/helpers/blankNonCode";

afterEach(cleanup);

const ROW_SRC = blankComments(readFileSync("src/components/messages/ConversationRow.tsx", "utf8"));
const LOADER_SRC = blankComments(readFileSync("src/pages/messages/messagesData/loadConversations.ts", "utf8"));

/** The statuses the row paints a chip for, from its own `allowed` map (the inventory). */
const STATUSES = (() => {
  const block = /const allowed: Record<string, true> = \{([\s\S]*?)\};/.exec(ROW_SRC)?.[1] ?? "";
  return [...block.matchAll(/(\w+): true/g)].map((m) => m[1]);
})();

const convo = (over: Partial<Conversation>): Conversation =>
  ({
    otherUserId: "u-1",
    otherUserName: "Hallie Hebert",
    jobId: "job-1",
    jobTitle: "Pressure wash the driveway",
    lastMessage: "See you Tuesday",
    lastAt: new Date().toISOString(),
    unread: 0,
    otherUserActiveBand: "today",
    viewerIsPoster: true,
    ...over,
  }) as Conversation;

describe("Messages rows are title first (owner 11-11: F421, F437, F439)", () => {
  it("the inventory of row states is real", () => {
    expect(STATUSES.length).toBeGreaterThan(7);
  });

  it("every job row: the title is the headline, the name is line 2, the photo leads, no Active today", () => {
    let rendered = 0;
    for (const jobStatus of STATUSES) {
      for (const jobPhotoUrl of ["https://example.test/driveway.jpg", null]) {
        for (const unread of [0, 2]) {
          const { container } = render(
            <ConversationRow convo={convo({ jobStatus, jobPhotoUrl, unread })} currentUserId="me" openConvo={() => {}} pinned />,
          );
          const label = `${jobStatus} photo=${!!jobPhotoUrl} unread=${unread}`;
          const title = screen.getByTestId("row-title");
          const name = screen.getByTestId("row-name");
          expect(title.textContent, label).toBe("Pressure wash the driveway");
          expect(screen.getByTestId("row-line-1").contains(title), label).toBe(true);
          expect(container.querySelector("[data-thread-caption]")?.contains(name), `${label}: name on line 2`).toBe(true);
          expect(name.textContent, label).toBe("Hallie Hebert");
          expect(title.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING, label).toBeTruthy();
          expect(title.style.fontWeight, `${label}: unread weight on the headline`).toBe(unread ? "700" : "600");
          const photo = screen.queryByTestId("row-job-photo");
          expect(!!photo, `${label}: the job photo leads exactly when the job has one`).toBe(!!jobPhotoUrl);
          expect(container.textContent, `${label}: no Active today`).not.toContain("Active today");
          expect(screen.getByLabelText("Pinned"), label).toBeTruthy();
          expect(!!screen.queryByTestId("row-unread-count"), label).toBe(unread > 0);
          cleanup();
          rendered++;
        }
      }
    }
    expect(rendered).toBeGreaterThan(30);
  });

  it("the loader reads each job's photos and hands the first to the row", () => {
    const jobsSelect = /from\("jobs"\)\.select\("([^"]*)"\)\.in\("id", jobIds\)/.exec(LOADER_SRC)?.[1] ?? "";
    expect(jobsSelect.split(",").map((c) => c.trim())).toContain("photos");
    expect(LOADER_SRC).toMatch(/photo: j\.photos\?\.\[0\] \?\? null/);
    expect(LOADER_SRC).toMatch(/jobPhotoUrl: jobMap\.get\(v\.jobId\)\?\.photo \?\? null/);
  });
});
