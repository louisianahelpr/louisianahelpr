/**
 * F36 (app audit 2026-10-28, part 4 half 2 final leg): the approve sheet's before/after photo links
 * (CompletionChoiceSheet -> PhotoProofGroup) were named by their raw signed storage URL. Each link now carries its
 * own name, "Before photo" / "After photo" (numbered when there are several), and the image inside is decorative.
 *
 * Owner 11-13: the thumbnails are buttons that open the in-app photo viewer now (never a link to the signed URL),
 * with the same names.
 *
 * Red first (2026-10-28) against origin/main 6b3206e2bd: the links carried no name of their own ("Before 1", from
 * the image's alt, in jsdom; the audit heard the URL).
 *
 * @mutate src/components/PhotoProof.tsx | onClick={() => openPhoto(i)} aria-label={proofPhotoLinkName("before", i, beforeUrls.length)}> | onClick={() => openPhoto(i)}>
 * @mutate src/components/PhotoProof.tsx | onClick={() => openPhoto(beforeSrcs.length + i)} aria-label={proofPhotoLinkName("after", i, afterUrls.length)}> | onClick={() => openPhoto(beforeSrcs.length + i)}>
 * @mutate src/components/proofPhotoLinkName.ts |   return count > 1 ? `${base} ${index + 1}` : base; |   return base;
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const SIGNED = (p: string) => `https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/job-photos/${p}?token=abc`;
vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: (v: string[]) => v.map(SIGNED), PENDING_PHOTO_SRC: "data:," }));

import { PhotoProofGroup } from "@/components/PhotoProof";

describe("F36: proof photo links say which photo they are", () => {
  it("one before, one after: 'Before photo' and 'After photo', never a URL", () => {
    render(<PhotoProofGroup jobId="j1" beforeUrls={["b.jpg"]} afterUrls={["a.jpg"]} canUpload={false} />);
    const links = Array.from(document.querySelectorAll("[data-proof-photo-open]"));
    // Inventory floor: both thumbnails rendered as controls.
    expect(links.length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Before photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "After photo" })).toBeTruthy();
    expect(screen.queryAllByRole("link").filter((a) => /storage|supabase/.test(a.getAttribute("href") ?? "")), "no link to the signed URL").toEqual([]);
    for (const l of links) expect(l.getAttribute("aria-label") ?? "", "a control is named by its URL").not.toMatch(/https?:|storage/);
    void SIGNED;
    cleanup();
  });

  it("several photos are numbered", () => {
    render(<PhotoProofGroup jobId="j1" beforeUrls={["b1.jpg", "b2.jpg"]} afterUrls={[]} canUpload={false} />);
    expect(screen.getByRole("button", { name: "Before photo 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Before photo 2" })).toBeTruthy();
    cleanup();
  });
});
