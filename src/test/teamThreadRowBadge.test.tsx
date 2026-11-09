/**
 * F131 (owner UI audit 11-09): on the staff side every support row's second line said the same "Louisiana Helpr Team
 * conversation", taking the room a real context would use. A support thread now wears a small team badge in that
 * line ("Louisiana Helpr team": the site name stays whole, siteNameInTeamSignoffs) and never the repeated words; a
 * job thread keeps its caption (side · job title).
 *
 * @mutate src/components/messages/ConversationRow.tsx |               {c.teamThread ? ( |               {false ? (
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { ConversationRow } from "@/components/messages/ConversationRow";
import type { Conversation } from "@/components/messages/types";

afterEach(cleanup);

const base = {
  otherUserId: "u2",
  lastMessage: "hi",
  lastAt: "2026-11-09T12:00:00Z",
  unread: 0,
  isMuted: false,
  muteUntil: null,
  otherUserActiveBand: null,
} as const;

const team = (viewerIsStaff: boolean) =>
  ({
    ...base,
    otherUserName: viewerIsStaff ? "Mindy Braquet" : "Louisiana Helpr Team",
    jobTitle: viewerIsStaff ? "Louisiana Helpr Team conversation" : "Direct message",
    jobId: "team:u2",
    jobStatus: null,
    teamThread: { userId: "u2", viewerIsStaff },
  }) as unknown as Conversation;

describe("a support thread's row (F131)", () => {
  it.each([true, false])("staff side %s: a team badge, never the repeated caption", (staff) => {
    const { container } = render(<ConversationRow convo={team(staff)} currentUserId="me" openConvo={() => {}} />);
    const caption = container.querySelector("[data-thread-caption]");
    expect(caption, "the caption line").not.toBeNull();
    expect(caption!.querySelector("[data-team-badge]")?.textContent?.trim()).toBe("Louisiana Helpr team");
    expect(container.textContent).not.toContain("Louisiana Helpr Team conversation");
    expect(container.textContent).not.toContain("Direct message");
  });

  it("a job thread keeps its caption: the job's title", () => {
    const job = { ...base, otherUserName: "Pat", jobTitle: "Mow the lawn", jobId: "job-1", jobStatus: "accepted" } as unknown as Conversation;
    const { container } = render(<ConversationRow convo={job} currentUserId="me" openConvo={() => {}} />);
    expect(container.querySelector("[data-thread-caption]")?.textContent).toContain("Mow the lawn");
    expect(screen.queryByText("Louisiana Helpr team")).toBeNull();
  });
});
