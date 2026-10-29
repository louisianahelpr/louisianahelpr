/**
 * Photo coach (owner 2026-10-29: "ai should always be doing most of the work for declutter listing").
 * declutter-ai-draft's one-item draft also returns what the labels say (brand / model / size /
 * measurements, added to the details as one line, never when the description already says it), the
 * best cover photo (an index into the photos it was SENT; none without that count), and at most one
 * "one more photo would help" tip. Model output is untrusted: bounded and typed here.
 *
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |   const coverPhoto = photoCount !== undefined && Number.isInteger(cover) && cover >= 0 && cover < photoCount ? cover : null; |   const coverPhoto = Number.isInteger(cover) ? cover : null;
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts | details.length >= 3 && !baseDescription.toLowerCase().includes(details.toLowerCase()) | details.length >= 3
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |   const tipRaw = typeof r.photo_tip === "string" ? oneLine(r.photo_tip).slice(0, 120) : ""; |   const tipRaw = typeof r.photo_tip === "string" ? r.photo_tip : "";
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     const draft = answer.parsed ? sanitizeDraft(answer.parsed, images.length) : null; |     const draft = answer.parsed ? sanitizeDraft(answer.parsed) : null;
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     photoTip: draft.photoTip, |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { sanitizeDraft } from "../../supabase/functions/declutter-ai-draft/sanitize";

const base = { title: "Stand mixer", description: "Red stand mixer with bowl.", category: "kitchen", delivery_size: "small", condition_stars: 4, possibly_banned: false };
const answer = (extra: Record<string, unknown>, n?: number) => sanitizeDraft(JSON.parse(JSON.stringify({ ...base, ...extra })), n)!;
const EDGE = blankComments(readFileSync(join(process.cwd(), "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));

describe("photo coach", () => {
  it("adds what the labels say to the details as one line, unless already there", () => {
    expect(answer({ details: "Brand: KitchenAid.\nModel: KSM150." }).description).toBe("Red stand mixer with bowl.\nBrand: KitchenAid. Model: KSM150.");
    expect(answer({ description: "A KitchenAid mixer. Brand: KitchenAid.", details: "brand: kitchenaid." }).description).toBe("A KitchenAid mixer. Brand: KitchenAid.");
    expect(answer({ details: "" }).description).toBe(base.description);
    expect(answer({ details: "x".repeat(900) }).description.length).toBe(base.description.length + 1 + 300);
  });

  it("the cover is an index into the photos sent, else none", () => {
    expect(answer({ cover_photo: 2 }, 3).coverPhoto).toBe(2);
    expect(answer({ cover_photo: 3 }, 3).coverPhoto).toBeNull();
    expect(answer({ cover_photo: -1 }, 3).coverPhoto).toBeNull();
    expect(answer({ cover_photo: 1.5 }, 3).coverPhoto).toBeNull();
    // Room / group modes do not say how many photos: no cover pick.
    expect(answer({ cover_photo: 0 }).coverPhoto).toBeNull();
  });

  it("at most one short tip, one line", () => {
    expect(answer({ photo_tip: "A photo of\nthe label" }).photoTip).toBe("A photo of the label");
    expect(answer({ photo_tip: "" }).photoTip).toBeNull();
    expect(answer({ photo_tip: "y".repeat(400) }).photoTip!.length).toBe(120);
  });

  it("the edge function asks for them in one-item drafts only and returns them", () => {
    expect(EDGE).toMatch(/required: \[\.\.\.ITEM_SCHEMA\.required, "details", "cover_photo", "photo_tip"\]/);
    expect(EDGE).toContain('const ITEM_TOOL = { name: "draft_listing", description: "A draft listing for one used household item", parameters: DRAFT_SCHEMA };');
    // The room scan keeps the plain item schema (no cover pick across a room's items).
    expect(EDGE).toMatch(/items: \{ type: "array", maxItems: ROOM_MAX_ITEMS, items: ITEM_SCHEMA \}/);
    expect(EDGE).toContain("sanitizeDraft(answer.parsed, images.length)");
    expect(EDGE).toContain("sanitizeDraft(answer.parsed, photos.length)");
    expect(EDGE).toContain("coverPhoto: draft.coverPhoto,");
    expect(EDGE).toContain("photoTip: draft.photoTip,");
  });
});
