/**
 * F35 (app audit 2026-10-28, part 4 half 2 final leg): Title Case left in the job's last steps. The Helpr's done
 * confirm said "Mark Complete" while the card's button says "Mark it done"; the tip prompt's buttons said
 * "No Thanks" / "Send a Tip"; the proof panel was titled "Photo Proof". Sentence case everywhere (design spec v2 §2,
 * owner 2026-10-20).
 *
 * Red first (2026-10-28) against origin/main 6b3206e2bd: all four old labels present.
 *
 * @mutate src/components/JobTracking.tsx | primaryLabel="Mark it done" | primaryLabel="Mark Complete"
 * @mutate src/components/reviewPanel/ReviewForm.tsx |               No thanks |               No Thanks
 * @mutate src/components/reviewPanel/ReviewForm.tsx |               Send a tip |               Send a Tip
 * @mutate src/components/PhotoProof.tsx |       title="Photo proof"\n      action={ |       title="Photo Proof"\n      action={
 *
 * JA-56 (Jobs audit 11-01): the tracker line said "Mark it done when you finish", the button "Mark job complete", and
 * the poster read "Yusef marked it done": three phrasings of one step. One label everywhere: "Mark it done" (12
 * characters, so it fits a side-by-side pair as it is; the pair's "Complete job" short form is gone).
 * @mutate src/pages/jobs/appliedJobCard/steps/PayoutPrimary.tsx | : "Mark it done"} | : "Mark job complete"}
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts | key: "done", label: "Mark it done" | key: "done", label: "Mark job complete"
 * @mutate src/components/JobTracking.tsx | action: "Mark it done", icon: PartyPopper | action: "Mark job complete", icon: PartyPopper
 * @mutate supabase/functions/_shared/stalledCompletion.ts | ask your Helpr to tap Mark it done. | ask your Helpr to tap Mark job complete.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: (v: string[]) => v.map(() => null), PENDING_PHOTO_SRC: "data:," }));

import { PhotoProofGroup } from "@/components/PhotoProof";

const code = (f: string) => blankComments(readFileSync(resolve(__dirname, "..", f), "utf8"));

describe("F35: the job's last steps are sentence case", () => {
  it("the Helpr's done confirm matches the card: Mark it done", () => {
    const src = code("components/JobTracking.tsx");
    expect(src).toContain('primaryLabel="Mark it done"');
    expect(src).not.toContain('"Mark Complete"');
  });

  it("JA-56: the Helpr's done step has one label, Mark it done, on every surface that names it", () => {
    const files = [
      "components/JobTracking.tsx",
      "pages/jobs/appliedJobCard/steps/PayoutPrimary.tsx",
      "pages/jobs/appliedJobCard/helperFaceAction.ts",
      "components/ui/pairLabel.ts",
      "../supabase/functions/_shared/stalledCompletion.ts",
    ];
    let named = 0;
    for (const f of files) {
      const src = code(f);
      expect(src, f).not.toMatch(/Mark job complete|Complete job/i);
      named += src.split("Mark it done").length - 1;
    }
    // Inventory floor: the tracker step, its confirm, the card's button, the face step and both reminder lines.
    expect(named).toBeGreaterThan(4);
  });

  it("the tip prompt's buttons: No thanks / Send a tip", () => {
    const src = code("components/reviewPanel/ReviewForm.tsx");
    // The static text right before each footer action's closing tag.
    const labels = [...src.matchAll(/>\s*([A-Z][^<>{}\n]*?)\s*<\/Dialog(?:Secondary|Primary)Action>/g)].map((m) => m[1]);
    // Inventory floor: the review dialog's own pair plus the tip prompt's pair.
    expect(labels.length).toBeGreaterThan(2);
    expect(labels).toContain("No thanks");
    expect(labels).toContain("Send a tip");
    expect(labels.filter((l) => /\b(Thanks|Tip)\b/.test(l)), "a Title Case tip button is back").toEqual([]);
  });

  it("the proof panel's title is Photo proof", () => {
    render(<PhotoProofGroup jobId="j1" beforeUrls={["a.jpg"]} afterUrls={[]} canUpload={false} />);
    expect(screen.getByText("Photo proof")).toBeTruthy();
    expect(screen.queryByText("Photo Proof")).toBeNull();
  });
});
