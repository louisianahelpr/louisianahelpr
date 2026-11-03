// The card-matching skeletons back high-traffic loading states (Dashboard /
// Activity / Messages).
//
// This used to be three "does it mount" smoke tests, and that is not what
// these components are for. Owner, 2026-09-19: loading states "jump and are
// not consistent with their info". The fix was that each skeleton IMPORTS the
// real card's geometry instead of re-drawing it, so the reserved space is the
// real space by construction. A mount check cannot see that: replace
// `className={JOB_CARD_FRAME}` with a hand-written approximation and the row
// pitch diverges from the card's again while all three tests stay green —
// which is exactly the regression that shipped.
//
// So each skeleton is asserted to wear the SAME frame string the real card
// wears, compared against the exported constant rather than a literal copy of
// it (a literal here would be a second hand-written description of the card,
// i.e. the defect in test form). jsdom resolves no Tailwind and computes no
// layout, so what is proven is the shared SOURCE of the geometry, not a
// measured pitch; the measured pitch is checked at 375 on the built app.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { JobCardSkeleton, RecommendedJobCardSkeleton } from "./JobCardSkeleton";
import { ApplicationCardSkeleton, PostedListBones, WorkingListBones } from "./ApplicationCardSkeleton";
import { MessageThreadSkeleton } from "./MessageThreadSkeleton";
import { JOB_CARD_FRAME } from "@/components/job/cardGeometry";
import { JOB_CARD_SHELL_FRAME } from "@/components/job-card/JobCardShell";
import { CONVERSATION_ROW_FRAME } from "@/components/messages/ConversationRow";

const cases = [
  {
    name: "JobCardSkeleton",
    el: <JobCardSkeleton />,
    frame: JOB_CARD_FRAME,
    source: "JobCard (cardGeometry)",
    minBones: 5,
  },
  {
    name: "ApplicationCardSkeleton",
    el: <ApplicationCardSkeleton />,
    frame: JOB_CARD_SHELL_FRAME,
    source: "AppliedJobCard (JobCardShell)",
    minBones: 8,
  },
  {
    /*
     * THE POSTED TAB'S PLACEHOLDER (/posts). It was ActivityCardSkeleton, the old collapsed card, until Q833
     * (2026-11-03): PostedJobCard is MineJobFace now, so PostedListBones draws ApplicationCardSkeleton in the
     * posted shape (the bar, never the street address), and ActivityCardSkeleton, drawn by no list, was removed.
     * Same frame constant as the applied card above: one card, one drawing.
     */
    name: "ApplicationCardSkeleton, posted shape",
    el: <ApplicationCardSkeleton tracker address={false} />,
    frame: JOB_CARD_SHELL_FRAME,
    source: "PostedJobCard (JobCardShell)",
    minBones: 8,
  },
  {
    name: "MessageThreadSkeleton",
    el: <MessageThreadSkeleton />,
    frame: CONVERSATION_ROW_FRAME,
    source: "ConversationRow",
    minBones: 5,
  },
] as const;

describe("card-matching skeletons", () => {
  it.each(cases)("$name mounts and wears $source's own frame", ({ el, frame, minBones }) => {
    const { container } = render(el);
    const root = container.firstElementChild as HTMLElement | null;
    expect(root, "skeleton rendered nothing — a blank loading state").not.toBeNull();

    // The frame string must come from the card's exported constant, not from
    // a copy that can drift away from it.
    expect(root!.className.trim()).toBe(frame.trim());

    // A frame with nothing inside it reserves the box but shows no content
    // arriving — the bones are the other half of the promise.
    const bones = root!.querySelectorAll("[class*='rounded'], [class*='h-']");
    expect(bones.length, "skeleton drew no bones").toBeGreaterThanOrEqual(minBones);

    // Placeholders are decorative: a screen reader must not read the bones
    // out as content.
    expect(root!.getAttribute("aria-hidden")).not.toBeNull();
  });

  it("RecommendedJobCardSkeleton is the SAME skeleton plus the chip it adds", () => {
    // Not a second hand-drawn card: it composes JobCardSkeleton, so the two
    // cannot disagree about the box the way the old pair did.
    const { container } = render(<RecommendedJobCardSkeleton />);
    const inner = container.querySelector(`[class="${JOB_CARD_FRAME.trim()}"]`);
    expect(inner, "recommended skeleton must reuse JobCardSkeleton's frame").not.toBeNull();
  });

  /*
   * Q700 (owner, 2026-09-27): "the /jobs collapsed-card skeleton reserves the
   * one-line shape (~131px), /posts keeps two lines." A collapsed card is 131px
   * with a city (one meta line) or 151px with a street address (two); the two
   * tabs' lists are mostly one shape each, so each placeholder reserves its
   * tab's shape. jsdom computes no layout, so the LINE COUNT and the lines'
   * declared heights are what is held here; the pixel row is measured at 375
   * by e2e/prod-audit/activity-loading-reserve.spec.ts.
   */
  /* Q833 (2026-11-03): the /jobs Working cards are MineJobFace now, so ApplicationCardSkeleton draws the face
     (src/test/mineFaceSkeletonMatchesFace.test.tsx holds its height) and no old-card meta line at all. */
  /* Later on 11-03: PostedJobCard is MineJobFace too, so /posts draws the same face (PostedListBones). The old
     collapsed card placeholder (ActivityCardSkeleton) was then drawn by no list, and was removed. */
  it("the /jobs and /posts placeholders are the MineJobFace drawing, each in its list's shape (Q700, Q833)", () => {
    const lines = (el: ReactElement) =>
      [...render(el).container.querySelectorAll<HTMLElement>("[data-skeleton-meta-line]")].map((l) => l.style.height);
    const faces = (el: ReactElement) =>
      [...render(el).container.querySelectorAll("[data-mine-face-skeleton]")].map((e) => e.getAttribute("data-mine-face-skeleton"));
    expect(lines(<ApplicationCardSkeleton />)).toEqual([]);
    expect(render(<ApplicationCardSkeleton />).container.querySelector("[data-mine-face-skeleton]")).not.toBeNull();
    // Working "All" opens on Needs You / Scheduled: hired or offered cards, the street address on the face and the bar.
    expect(faces(<WorkingListBones filter={null} />)).toEqual(Array(4).fill("bar address"));
    expect(faces(<WorkingListBones filter="waiting" />)).toEqual(Array(4).fill("no-bar"));
    expect(faces(<WorkingListBones filter="done" />)).toEqual(Array(4).fill("bar"));
    // Posted cards never carry the address on the face; the bar is there until a job is cancelled.
    expect(faces(<PostedListBones filter={null} />)).toEqual(Array(4).fill("bar"));
    expect(faces(<PostedListBones filter="cancelled" />)).toEqual(Array(4).fill("no-bar"));
    expect(lines(<PostedListBones filter={null} />)).toEqual([]);
  });

  it("every frame constant is a real class string, so the checks above can bite", () => {
    // Guard on the guard: if a constant were renamed to an empty export, the
    // equality above would compare "" to "" and pass for every skeleton.
    for (const frame of [JOB_CARD_FRAME, JOB_CARD_SHELL_FRAME, CONVERSATION_ROW_FRAME]) {
      expect(frame.trim().length).toBeGreaterThan(10);
    }
  });
});

// The whole thesis of these components: the skeleton IMPORTS the card's frame
// instead of re-drawing it. A hand-written approximation is the owner's
// "loading states jump" defect, and it used to be invisible here.
// @mutate src/components/ui/skeletons/JobCardSkeleton.tsx | <div className={JOB_CARD_FRAME} aria-hidden> | <div className="relative rounded-2xl overflow-hidden" aria-hidden>
// Same contract on the inbox row, whose bones were once a raised glass CARD
// at a 76px pitch standing in for a flat 64px strip.
// @mutate src/components/ui/skeletons/MessageThreadSkeleton.tsx | <div className={CONVERSATION_ROW_FRAME} aria-hidden> | <div className="p-3 rounded-ds-md liquid-glass" aria-hidden>
// Q700/Q833: /jobs and /posts draw the face, each in its list's shape. Each mutation moves one list off its shape.
// @mutate src/components/ui/skeletons/ApplicationCardSkeleton.tsx | return <MineFaceSkeleton tracker={tracker} address={address} />; | return <div className={JOB_CARD_SHELL_FRAME} aria-hidden />;
// @mutate src/components/ui/skeletons/ApplicationCardSkeleton.tsx | return <FaceListBones side="posted" filter={filter} />; | return <FaceListBones side="applied" filter={filter} />;
// @mutate src/components/ui/skeletons/ApplicationCardSkeleton.tsx | const address = side === "applied" && | const address = false &&
