/**
 * Owner, 2026-10-12: "yes show the full question at the top of the chat".
 * The Applicants card clamps an applicant's note to two lines ("Do I need to
 * bring my own…"), and the chat the poster opens from Message showed none of
 * it, so the poster could not read the question while answering it.
 *
 * CLASS: in a job thread, the POSTER sees the other person's application note
 * on that job, in full, at the top of the thread; nobody else sees it, and a
 * thread with no note has no card.
 *
 *  (a) RENDER (the card as a user sees it; its read is injected, never a
 *      mocked Supabase): poster + note -> the whole note, unclamped, with the
 *      applied date; the applicant themself -> nothing, and no read at all;
 *      poster + no application / blank note -> nothing.
 *  (b) SOURCE: ChatView renders <ApplicationNoteCard> inside the thread
 *      scroller, ahead of the timeline (so it scrolls with the thread and never
 *      covers the composer), with the real read (no fetchNote override).
 *  (c) The read selects only client-readable applications columns (a withheld
 *      column turns the whole read into 42501) and goes through unwrap().
 *
 * Shown red on the old code (no card) and on each planted hole:
 * @mutate src/components/messages/ChatView.tsx | <ApplicationNoteCard activeConvo={activeConvo} /> | {null}
 * @mutate src/components/messages/chatView/ApplicationNoteCard.tsx | return convo.viewerIsPoster === true && !!convo.otherUserId; | return !!convo.otherUserId;
 * @mutate src/components/messages/chatView/ApplicationNoteCard.tsx | whitespace-pre-wrap break-words | line-clamp-2
 * @mutate src/components/messages/chatView/ApplicationNoteCard.tsx | if (!row \|\| !message) return null; | if (!row) return null;
 * @mutate src/components/messages/chatView/ApplicationNoteCard.tsx | "message, created_at" as const | "message, created_at, flag_reason" as const
 * @mutate src/components/messages/chatView/ApplicationNoteCard.tsx |   const row = unwrap(\n    await supabase | const row = (\n    await supabase
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { APPLICATION_READABLE_COLUMN_LIST } from "@/lib/applicationColumns";
import type { Conversation } from "@/components/messages/types";

// The card module imports the client for its real read. This spec never lets
// it run: every case injects its read, and a call reaching here fails loudly.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      throw new Error("chatShowsApplicationNote: the card must not read Supabase in this spec");
    },
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import {
  ApplicationNoteCard,
  APPLICATION_NOTE_COLUMNS,
  noteFromRow,
} from "@/components/messages/chatView/ApplicationNoteCard";

const LONG_QUESTION =
  "Do I need to bring my own mower and trimmer, or will there be equipment on site? " +
  "Also, is the back gate usually locked — should I text you when I arrive?\n" +
  "Thanks, I can start at 8.";

function convo(over: Partial<Conversation>): Conversation {
  return {
    otherUserId: "helper-1",
    otherUserName: "Eli",
    jobTitle: "Mow the lawn",
    jobId: "job-1",
    lastMessage: "",
    lastAt: "2026-10-11T12:00:00Z",
    unread: 0,
    ...over,
  };
}

const read = (s: string) => readFileSync(resolve(__dirname, "..", s), "utf8");

describe("(a) the poster sees the applicant's full note; nobody else does", () => {
  it("poster + note: the whole note, unclamped, with the applied date", async () => {
    const fetchNote = vi.fn().mockResolvedValue({ message: LONG_QUESTION, createdAt: "2026-10-11T15:00:00Z" });
    render(<ApplicationNoteCard activeConvo={convo({ viewerIsPoster: true })} fetchNote={fetchNote} />);
    const card = await screen.findByTestId("chat-application-note");
    expect(fetchNote).toHaveBeenCalledWith("job-1", "helper-1");
    expect(card.textContent).toContain("Their application");
    // The full text, not a truncation of it: every line of the question.
    const body = card.querySelector("p");
    expect(body?.textContent).toBe(LONG_QUESTION);
    expect(body?.className).toContain("whitespace-pre-wrap");
    expect(body?.className ?? "").not.toMatch(/line-clamp|truncate/);
    expect(card.textContent).toMatch(/Applied Oct 11/);
  });

  it("the applicant themself: no card, and no read", async () => {
    const fetchNote = vi.fn().mockResolvedValue({ message: LONG_QUESTION, createdAt: "2026-10-11T15:00:00Z" });
    const { container } = render(
      <ApplicationNoteCard activeConvo={convo({ viewerIsPoster: false, otherUserId: "poster-1" })} fetchNote={fetchNote} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchNote).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("viewerIsPoster absent (an older conversation shape) counts as not the poster", async () => {
    const fetchNote = vi.fn().mockResolvedValue({ message: LONG_QUESTION, createdAt: "2026-10-11T15:00:00Z" });
    const { container } = render(<ApplicationNoteCard activeConvo={convo({})} fetchNote={fetchNote} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchNote).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("poster + no application, or a blank note: no card", async () => {
    expect(noteFromRow(null)).toBeNull();
    expect(noteFromRow({ message: null, created_at: "2026-10-11T15:00:00Z" })).toBeNull();
    expect(noteFromRow({ message: "   \n ", created_at: "2026-10-11T15:00:00Z" })).toBeNull();
    expect(noteFromRow({ message: " Hi? ", created_at: "2026-10-11T15:00:00Z" })).toEqual({
      message: "Hi?",
      createdAt: "2026-10-11T15:00:00Z",
    });
    const fetchNote = vi.fn().mockResolvedValue(null);
    const { container } = render(<ApplicationNoteCard activeConvo={convo({ viewerIsPoster: true })} fetchNote={fetchNote} />);
    await waitFor(() => expect(fetchNote).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
  });

  it("a deleted counterparty (otherUserId null): no card, no read", async () => {
    const fetchNote = vi.fn().mockResolvedValue({ message: LONG_QUESTION, createdAt: "2026-10-11T15:00:00Z" });
    const { container } = render(
      <ApplicationNoteCard activeConvo={convo({ viewerIsPoster: true, otherUserId: null })} fetchNote={fetchNote} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchNote).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });
});

describe("(b) the chat keeps the card, in the thread scroller, ahead of the timeline", () => {
  const src = blankComments(read("components/messages/ChatView.tsx"));
  it("ChatView renders <ApplicationNoteCard> with the real read", () => {
    const uses = src.match(/<ApplicationNoteCard\b[^>]*\/>/g) ?? [];
    expect(uses).toEqual(["<ApplicationNoteCard activeConvo={activeConvo} />"]);
  });
  it("inside PullToRefreshWrapper, before <ChatTimeline, and not in the composer", () => {
    const card = src.indexOf("<ApplicationNoteCard");
    const scrollerOpen = src.indexOf("<PullToRefreshWrapper");
    const scrollerClose = src.indexOf("</PullToRefreshWrapper>");
    const timeline = src.indexOf("<ChatTimeline");
    const composer = src.indexOf("<ChatComposer");
    expect(card).toBeGreaterThan(scrollerOpen);
    expect(scrollerOpen).toBeGreaterThan(-1);
    expect(card).toBeLessThan(timeline);
    expect(timeline).toBeLessThan(scrollerClose);
    expect(card).toBeLessThan(composer);
  });
});

describe("(c) the read is one the poster's client may make", () => {
  it("selects only client-readable applications columns", () => {
    const cols = APPLICATION_NOTE_COLUMNS.split(",").map((c) => c.trim());
    expect(cols.length).toBeGreaterThan(1);
    for (const c of cols) expect(APPLICATION_READABLE_COLUMN_LIST as readonly string[]).toContain(c);
  });
  it("reads applications through unwrap()", () => {
    const card = blankComments(read("components/messages/chatView/ApplicationNoteCard.tsx"));
    expect(card).toMatch(/unwrap\(\s*await supabase\s*\.from\("applications"\)/);
  });
});
