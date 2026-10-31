/**
 * "Sell a bunch" (owner 2026-10-29: "upload all pictures for everything they
 * want to sell, ai does the forms and they review all at once before
 * submission"). declutter-ai-draft's mode 'group' sorts up to 8 photos of
 * several items into items and drafts each. This pins:
 *   - the model's grouping is untrusted: each item through sanitizeDraft (the
 *     banned flag fails closed), photo numbers only in range and used once,
 *     and every photo it did not place comes back as leftover (none lost);
 *   - the photos sent are bounded (count, each photo, the total);
 *   - the gates, read from the edge function's code (comments blanked): the
 *     shared ones (signed in, confirmed email, the 'declutter' switch, the
 *     per-minute limit) before the mode branches, then the selling gates AS
 *     THE CALLER, then its own hourly cap, then the photo check, then the
 *     model; and it stores nothing.
 *
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |       if (typeof n !== "number" \|\| !Number.isInteger(n) \|\| n < 0 \|\| n >= photoCount \|\| used.has(n)) continue; |       if (typeof n !== "number") continue;
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |   for (let i = 0; i < photoCount; i++) if (!used.has(i)) leftover.push(i); |   for (let i = 0; i < 0; i++) if (!used.has(i)) leftover.push(i);
 * @mutate supabase/functions/declutter-ai-draft/sanitize.ts |     if (total > GROUP_MAX_TOTAL_BYTES) return null; |     if (false) return null;
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   const { error: gateErr } = await anon.rpc("declutter_assert_can_draft_from_photos");\n  if (gateErr) {\n    const code = MEMBER_GATE_CODES.find((c) => gateErr.message?.includes(c));\n    if (!code) console.error("[declutter-ai-draft] group gate failed:", gateErr.message); |   const gateErr = null as { message?: string } \| null;\n  if (gateErr) {\n    const code = MEMBER_GATE_CODES.find((c) => gateErr.message?.includes(c));\n    if (!code) console.error("[declutter-ai-draft] group gate failed:", gateErr.message);
 * @mutate supabase/functions/declutter-ai-draft/index.ts | windowMs: 3_600_000, maxRequests: 20, keyPrefix: "declutter-ai-group" | windowMs: 3_600_000, maxRequests: 2000, keyPrefix: "declutter-ai-group"
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     const { flagReason: _reason, ...d } = await groundWithOurSales(anon, await priceDraftFromLookup(ANTHROPIC_API_KEY, draft), body); |     const { flagReason: _reason, ...d } = await priceDraftFromLookup(ANTHROPIC_API_KEY, draft);
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { GROUP_MAX_PHOTOS, groupPhotosFromBody, sanitizeGroups } from "../../supabase/functions/declutter-ai-draft/sanitize";

const item = (photos: unknown, extra: Record<string, unknown> = {}) => ({
  photos, title: "Oak rocking chair", description: "Solid oak.", category: "furniture", delivery_size: "large", condition_stars: 4, possibly_banned: false, ...extra,
});
// A JPEG's base64 starts "/9j/"; long enough to pass the 100-byte floor.
const jpeg = (bytes: number) => "/9j/" + "A".repeat(Math.ceil((bytes * 4) / 3) - 4);

describe("sanitizeGroups: the model's grouping is untrusted", () => {
  it("keeps good items with their photos", () => {
    // Parsed from text, as the model's answer arrives.
    const out = sanitizeGroups(JSON.parse(JSON.stringify({ items: [item([0, 2]), item([1], { title: "Floor lamp" })] })), 3);
    expect(out.items.map((i) => i.photos)).toEqual([[0, 2], [1]]);
    expect(out.items[1]).toMatchObject({ title: "Floor lamp", flagged: false });
    expect(out.leftover).toEqual([]);
  });

  it("drops photo numbers out of range, not whole, or already used; an item left with none is dropped", () => {
    const out = sanitizeGroups({ items: [item([0, 0, 7, -1, 1.5, "2"]), item([0])] }, 3);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].photos).toEqual([0]);
    // Nothing is lost: what no item kept comes back.
    expect(out.leftover).toEqual([1, 2]);
  });

  it("fails closed on the banned check for each item", () => {
    const out = sanitizeGroups({ items: [item([0], { possibly_banned: undefined }), item([1], { possibly_banned: "no" })] }, 2);
    expect(out.items.map((i) => i.flagged)).toEqual([true, true]);
  });

  it("an unusable answer places nothing and loses nothing", () => {
    expect(sanitizeGroups(null, 3)).toEqual({ items: [], leftover: [0, 1, 2] });
    expect(sanitizeGroups({ items: [item([0], { title: "" })] }, 2)).toEqual({ items: [], leftover: [0, 1] });
  });
});

describe("groupPhotosFromBody: what the app may send", () => {
  it("takes 1 to 8 real JPEGs under the caps", () => {
    expect(GROUP_MAX_PHOTOS).toBe(8);
    expect(groupPhotosFromBody(Array.from({ length: 8 }, () => jpeg(200_000)))).toHaveLength(8);
    expect(groupPhotosFromBody(Array.from({ length: 9 }, () => jpeg(200_000)))).toBeNull();
    expect(groupPhotosFromBody([])).toBeNull();
    expect(groupPhotosFromBody(["iVBORw0KGgo" + "A".repeat(400)])).toBeNull();
    // Each under the room cap, but together over the total.
    expect(groupPhotosFromBody(Array.from({ length: 5 }, () => jpeg(1_400_000)))).toBeNull();
  });
});

const EDGE = blankComments(readFileSync(join(process.cwd(), "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));
const start = EDGE.indexOf("async function groupScan(");
const GROUP = start >= 0 ? EDGE.slice(start, EDGE.indexOf("\n}\n", start) + 2) : "";
const at = (s: string) => GROUP.indexOf(s);

describe("mode 'group' suggested prices (audit finding 4)", () => {
  it("each item's price is held to our sold prices near the point sent, as one item's draft is", () => {
    expect(GROUP).toContain("await groundWithOurSales(anon, await priceDraftFromLookup(ANTHROPIC_API_KEY, draft), body)");
    expect(GROUP).toContain("flagReason: _reason");
    expect(GROUP).toContain("return json({ items: grounded, leftover });");
  });
});

describe("mode 'group' gates", () => {
  it("reads a real inventory (floors)", () => {
    expect(EDGE.length).toBeGreaterThan(5_000);
    expect(GROUP.length).toBeGreaterThan(1_000);
  });

  it("is reached only after the shared gates, and never for a shop item", () => {
    const route = EDGE.indexOf('if (!shopItem && body?.mode === "group") return await groupScan(req, anon, body);');
    expect(route).toBeGreaterThan(0);
    for (const gate of ["checkRateLimit(req, {", "anon.auth.getUser()", "refuseUnconfirmedEmail(", 'requireFeature(admin, shopItem ? "shops" : "declutter"']) {
      const i = EDGE.indexOf(gate);
      expect(i, gate).toBeGreaterThan(0);
      expect(i, gate).toBeLessThan(route);
    }
  });

  it("runs the selling gates as the caller, then its hourly cap, then the photo check, then the model", () => {
    const gate = at('anon.rpc("declutter_assert_can_draft_from_photos")');
    expect(gate).toBeGreaterThan(0);
    expect(GROUP).toMatch(/if \(gateErr\) \{[\s\S]*?return json\(\{ error: code \?\? "ai_unavailable" \}, code \? 403 : 500\);/);
    const hourly = at('windowMs: 3_600_000, maxRequests: 20, keyPrefix: "declutter-ai-group"');
    const photos = at("groupPhotosFromBody(body.photos)");
    const model = at("askModel(");
    expect(gate).toBeLessThan(hourly);
    expect(hourly).toBeGreaterThan(0);
    expect(hourly).toBeLessThan(photos);
    expect(photos).toBeLessThan(model);
    expect(GROUP).toContain('if (!photos) return json({ error: "group_photos_invalid" }, 400);');
  });

  it("stores nothing, and every item goes through the sanitizer", () => {
    expect(GROUP).not.toMatch(/\.storage\b|\.from\(|\.upload\(|\.insert\(|\.update\(/);
    expect([...GROUP.matchAll(/\.rpc\(/g)]).toHaveLength(1);
    expect(GROUP).toContain("sanitizeGroups(answer.parsed, photos.length)");
  });
});
