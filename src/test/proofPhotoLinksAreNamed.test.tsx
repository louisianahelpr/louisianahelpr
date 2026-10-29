/**
 * F36 (app audit 2026-10-28, part 4 half 2 final leg): the approve sheet's before/after photo links
 * (CompletionChoiceSheet -> PhotoProofGroup) were named by their raw signed storage URL. Each link now carries its
 * own name, "Before photo" / "After photo" (numbered when there are several), and the image inside is decorative.
 *
 * Red first (2026-10-28) against origin/main 6b3206e2bd: the links carried no name of their own ("Before 1", from
 * the image's alt, in jsdom; the audit heard the URL).
 *
 * @mutate src/components/PhotoProof.tsx | rel="noopener noreferrer" aria-label={proofPhotoLinkName("before", i, beforeUrls.length)}> | rel="noopener noreferrer">
 * @mutate src/components/PhotoProof.tsx | rel="noopener noreferrer" aria-label={proofPhotoLinkName("after", i, afterUrls.length)}> | rel="noopener noreferrer">
 * @mutate src/components/PhotoProof.tsx |   return count > 1 ? `${base} ${index + 1}` : base; |   return base;
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const SIGNED = (p: string) => `https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/job-photos/${p}?token=abc`;
vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: (v: string[]) => v.map(SIGNED), PENDING_PHOTO_SRC: "data:," }));

import { PhotoProofGroup } from "@/components/PhotoProof";

describe("F36: proof photo links say which photo they are", () => {
  it("one before, one after: 'Before photo' and 'After photo', never a URL", () => {
    render(<PhotoProofGroup jobId="j1" beforeUrls={["b.jpg"]} afterUrls={["a.jpg"]} canUpload={false} />);
    const links = screen.getAllByRole("link");
    // Inventory floor: both thumbnails rendered as links.
    expect(links.length).toBeGreaterThan(1);
    expect(screen.getByRole("link", { name: "Before photo" }).getAttribute("href")).toBe(SIGNED("b.jpg"));
    expect(screen.getByRole("link", { name: "After photo" }).getAttribute("href")).toBe(SIGNED("a.jpg"));
    for (const l of links) expect(l.getAttribute("aria-label") ?? "", "a link is named by its URL").not.toMatch(/https?:|storage/);
    cleanup();
  });

  it("several photos are numbered", () => {
    render(<PhotoProofGroup jobId="j1" beforeUrls={["b1.jpg", "b2.jpg"]} afterUrls={[]} canUpload={false} />);
    expect(screen.getByRole("link", { name: "Before photo 1" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Before photo 2" })).toBeTruthy();
    cleanup();
  });
});
