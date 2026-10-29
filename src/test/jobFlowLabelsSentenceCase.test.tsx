/**
 * F35 (app audit 2026-10-28, part 4 half 2 final leg): Title Case left in the job's last steps. The Helpr's done
 * confirm said "Mark Complete" while the card's button says "Mark job complete"; the tip prompt's buttons said
 * "No Thanks" / "Send a Tip"; the proof panel was titled "Photo Proof". Sentence case everywhere (design spec v2 §2,
 * owner 2026-10-20).
 *
 * Red first (2026-10-28) against origin/main 6b3206e2bd: all four old labels present.
 *
 * @mutate src/components/JobTracking.tsx | primaryLabel="Mark job complete" | primaryLabel="Mark Complete"
 * @mutate src/components/reviewPanel/ReviewForm.tsx |               No thanks |               No Thanks
 * @mutate src/components/reviewPanel/ReviewForm.tsx |               Send a tip |               Send a Tip
 * @mutate src/components/PhotoProof.tsx |       title="Photo proof"\n      action={ |       title="Photo Proof"\n      action={
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
  it("the Helpr's done confirm matches the card: Mark job complete", () => {
    const src = code("components/JobTracking.tsx");
    expect(src).toContain('primaryLabel="Mark job complete"');
    expect(src).not.toContain('"Mark Complete"');
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
