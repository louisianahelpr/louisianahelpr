/**
 * Owner 2026-10-28: "claude did not help with the listing so idk how to get it
 * to do the listing for me". A NEW listing has no draft before step 4, so
 * declutter-ai-draft drafts it from photos sent in the body (photosDraft).
 * This pins the gates that path must keep, read from the edge function's
 * code (comments blanked) and the newest migration definition:
 *   - the 'declutter' switch for the verified caller (requireFeature, shared
 *     with every mode, before any mode branches);
 *   - the selling gates as the CALLER (declutter_assert_can_draft_from_photos
 *     through the caller-token client), before the hourly cap, the photo
 *     check and the model call;
 *   - the per-minute limit (shared) and its own hourly cap;
 *   - the photos only reach the model: no storage call and no write RPC.
 * The gate's behaviour per account (switch off, banned, strikes, under 18,
 * anon) is src/test/pglite/declutterAiDraftFromPhotos.pglite.mjs.
 *
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   const { error: gateErr } = await anon.rpc("declutter_assert_can_draft_from_photos");\n  if (gateErr) {\n    // Includes the gate not deployed yet |   const gateErr = null as { message?: string } \| null;\n  if (gateErr) {\n    // Includes the gate not deployed yet
 * @mutate supabase/functions/declutter-ai-draft/index.ts | windowMs: 3_600_000, maxRequests: 30, keyPrefix: "declutter-ai-photos" | windowMs: 3_600_000, maxRequests: 3000, keyPrefix: "declutter-ai-photos"
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   if (!photos) return json({ error: "item_photos_invalid" }, 400); |   if (!photos) return json({ error: "item_photos_invalid" }, 200);
 * @mutate supabase/migrations/20261028155329_declutter_ai_draft_from_photos.sql |   PERFORM public.declutter_assert_member(true);\nEND; |   NULL;\nEND;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const EDGE = blankComments(readFileSync(join(process.cwd(), "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));
const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const gateBody = blankSqlComments(DEFS.get("declutter_assert_can_draft_from_photos")?.stmt ?? "");
const fnStart = EDGE.indexOf("async function photosDraft(");
const PHOTOS = fnStart >= 0 ? EDGE.slice(fnStart) : "";
const at = (s: string) => PHOTOS.indexOf(s);

describe("Claude drafts a NEW listing from photos in the body", () => {
  it("reads a real inventory (floors)", () => {
    expect(EDGE.length).toBeGreaterThan(5_000);
    expect(PHOTOS.length).toBeGreaterThan(800);
    expect(gateBody.length).toBeGreaterThan(150);
  });

  it("is reached only after the shared gates: signed in, confirmed email, the 'declutter' switch, the per-minute limit", () => {
    const route = EDGE.indexOf("return await photosDraft(req, anon, body)");
    expect(route).toBeGreaterThan(0);
    for (const gate of ["checkRateLimit(req, {", "anon.auth.getUser()", "refuseUnconfirmedEmail(", 'requireFeature(admin, shopItem ? "shops" : "declutter"']) {
      const i = EDGE.indexOf(gate);
      expect(i, gate).toBeGreaterThan(0);
      expect(i, gate).toBeLessThan(route);
    }
    // Never for a shop item, and never when the request names a draft (that path keeps its owner check).
    expect(EDGE).toMatch(/if \(!shopItem && \(body\?\.mode \?\? "draft"\) === "draft" && body\?\.itemId === undefined && body\?\.photos !== undefined\)/);
  });

  it("runs the selling gates AS THE CALLER before it spends anything", () => {
    const gate = at('anon.rpc("declutter_assert_can_draft_from_photos")');
    expect(gate).toBeGreaterThan(0);
    expect(PHOTOS).toMatch(/if \(gateErr\) \{[\s\S]*?return json\(\{ error: code \?\? "ai_unavailable" \}, code \? 403 : 500\);/);
    const hourly = at('keyPrefix: "declutter-ai-photos"');
    const photos = at("roomPhotosFromBody(body.photos)");
    const model = at("askModel(");
    expect(gate).toBeLessThan(hourly);
    expect(hourly).toBeLessThan(photos);
    expect(photos).toBeLessThan(model);
    expect(PHOTOS).toContain('windowMs: 3_600_000, maxRequests: 30, keyPrefix: "declutter-ai-photos"');
    expect(PHOTOS).toContain('if (!photos) return json({ error: "item_photos_invalid" }, 400);');
  });

  it("stores nothing: no storage call and no RPC but the gate", () => {
    const own = PHOTOS.slice(0, PHOTOS.indexOf("\n}\n") + 2);
    expect(own).not.toMatch(/\.storage\b|\.from\(|\.upload\(|\.insert\(|\.update\(/);
    expect([...own.matchAll(/\.rpc\(/g)]).toHaveLength(1);
    // The answer goes through the same sanitizer (fail-closed banned flag) as a saved draft's.
    expect(own).toContain("sanitizeDraft(answer.parsed, photos.length)");
  });

  it("the gate is the 'declutter' switch, the ban check and the selling member gates; anon cannot run it", () => {
    const b = gateBody.replace(/\s+/g, " ");
    expect(b).toMatch(/BEGIN PERFORM public\.require_feature\('declutter'\); IF public\.is_caller_banned\(\) THEN/);
    expect(b).toContain("PERFORM public.declutter_assert_member(true);");
    const mig = blankSqlComments(readFileSync(join(process.cwd(), "supabase/migrations/20261028155329_declutter_ai_draft_from_photos.sql"), "utf8"));
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_assert_can_draft_from_photos() FROM PUBLIC, anon;");
  });
});
