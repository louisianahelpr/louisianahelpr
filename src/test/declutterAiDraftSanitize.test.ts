/**
 * declutter-ai-draft treats the model's answer as untrusted (the
 * ai-job-builder A-002 rule) and FAILS CLOSED on the banned-item verdict
 * (row 34): anything but an explicit `false` is a flag, so a malformed answer
 * sends the listing to an admin.
 *
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |   const flagged = r.possibly_banned !== false; |   const flagged = r.possibly_banned === true;
 */
import { describe, expect, it } from "vitest";
import { sanitizeDraft } from "../../supabase/functions/declutter-ai-draft/sanitize";

describe("declutter-ai-draft output", () => {
  it("keeps a good answer, bounded", () => {
    const d = sanitizeDraft({ title: "Oak rocking chair\n", description: "x".repeat(3000), category: "furniture", delivery_size: "large", condition_stars: 4, possibly_banned: false });
    expect(d).toMatchObject({ title: "Oak rocking chair", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, flagReason: null });
    expect(d!.description.length).toBe(2000);
  });

  it("coerces unknown values to safe defaults", () => {
    // Parsed from text, as the model's answer arrives (and not a fixture row).
    const d = sanitizeDraft(JSON.parse('{"title":"Lamp","category":"weapons","delivery_size":"huge","condition_stars":9,"possibly_banned":false}'));
    expect(d).toMatchObject({ category: "other", deliverySize: "large", conditionStars: 5 });
  });

  it("fails closed: a missing or malformed verdict is a flag", () => {
    expect(sanitizeDraft({ title: "Lamp" })!.flagged).toBe(true);
    expect(sanitizeDraft({ title: "Lamp", possibly_banned: "no" })!.flagged).toBe(true);
    expect(sanitizeDraft({ title: "Car seat", possibly_banned: true, banned_reason: "used car seat" })!.flagReason).toBe("used car seat");
  });

  it("refuses an answer with no usable title", () => {
    expect(sanitizeDraft({ title: "x" })).toBeNull();
    expect(sanitizeDraft(null)).toBeNull();
  });
});
