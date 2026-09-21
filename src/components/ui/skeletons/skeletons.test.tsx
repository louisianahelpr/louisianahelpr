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

import { JobCardSkeleton, RecommendedJobCardSkeleton } from "./JobCardSkeleton";
import { ApplicationCardSkeleton } from "./ApplicationCardSkeleton";
import { MessageThreadSkeleton } from "./MessageThreadSkeleton";
import { JOB_CARD_FRAME } from "@/components/job/cardGeometry";
import { JOB_CARD_SHELL_FRAME } from "@/components/activity/JobCardShell";
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
