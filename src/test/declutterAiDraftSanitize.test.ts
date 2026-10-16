/**
 * declutter-ai-draft treats the model's answer as untrusted (the
 * ai-job-builder A-002 rule) and FAILS CLOSED on the banned-item verdict
 * (row 34): anything but an explicit `false` is a flag, so a malformed answer
 * sends the listing to an admin.
 *
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |   const flagged = r.possibly_banned !== false; |   const flagged = r.possibly_banned === true;
 *
 * Moving-out mode's room answer (docs/specs/declutter-moving-out.md): every
 * item goes through the same sanitizer (so each fails closed), at most 15;
 * the room photos must be 1-4 real JPEGs under the size cap.
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |     if (out.length >= ROOM_MAX_ITEMS) break; |     if (out.length >= 99) break;
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |     if (bytes < 100 \|\| bytes > ROOM_MAX_PHOTO_BYTES) return null; |     if (bytes < 100) return null;
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |     if (!p.startsWith("/9j/")) return null; |     if (false) return null;
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |   if (!Array.isArray(raw) \|\| raw.length < 1 \|\| raw.length > ROOM_MAX_PHOTOS) return null; |   if (!Array.isArray(raw)) return null;
 */
import { describe, expect, it } from "vitest";
import { ROOM_MAX_PHOTO_BYTES, roomPhotosFromBody, sanitizeDraft, sanitizeRoom } from "../../supabase/functions/declutter-ai-draft/sanitize";

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

  it("room mode: each listed item through the same sanitizer, unusable ones dropped, at most 15", () => {
    const raw = JSON.parse(JSON.stringify({
      items: [
        { title: "Oak dresser", category: "furniture", delivery_size: "large", condition_stars: 4, possibly_banned: false },
        { title: "x" },
        { title: "Old crib", category: "baby_kids", possibly_banned: "maybe" },
        ...Array.from({ length: 20 }, (_, i) => ({ title: `Box ${i}`, possibly_banned: false })),
      ],
    }));
    const items = sanitizeRoom(raw);
    expect(items).toHaveLength(15);
    expect(items[0]).toMatchObject({ title: "Oak dresser", flagged: false });
    // The crib's malformed verdict fails closed, as for one item.
    expect(items[1]).toMatchObject({ title: "Old crib", flagged: true });
    expect(sanitizeRoom(null)).toEqual([]);
    expect(sanitizeRoom({ items: "a dresser" })).toEqual([]);
  });

  it("room photos: 1 to 4 JPEGs, each under the cap, or nothing", () => {
    const jpeg = "/9j/" + "A".repeat(400);
    expect(roomPhotosFromBody([jpeg, jpeg])).toHaveLength(2);
    expect(roomPhotosFromBody([])).toBeNull();
    expect(roomPhotosFromBody([jpeg, jpeg, jpeg, jpeg, jpeg])).toBeNull();
    expect(roomPhotosFromBody("not a list")).toBeNull();
    expect(roomPhotosFromBody(["iVBORw0KGgo" + "A".repeat(400)])).toBeNull(); // a PNG
    expect(roomPhotosFromBody(["/9j/<script>"])).toBeNull();
    expect(roomPhotosFromBody(["/9j/AAAA"])).toBeNull(); // too small to be a photo
    const big = "/9j/" + "A".repeat(Math.ceil((ROOM_MAX_PHOTO_BYTES + 10) * 4 / 3));
    expect(roomPhotosFromBody([big])).toBeNull();
  });
});
