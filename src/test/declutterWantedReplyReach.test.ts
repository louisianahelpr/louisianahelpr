/**
 * Declutter audit W6 + W7 (2026-10-30), on the EFFECTIVE definition of declutter_wanted_reply (effectiveDefs replays
 * every migration, so a later restatement that drops a rule turns this red):
 *   W6: the listing must be inside the post's distance, measured listing to post with declutter_miles (the match
 *       alerts' measure), and only AFTER the one-answer wanted_not_found gate (no oracle for private/blocked posts).
 *       A NULL distance refuses (IS NOT TRUE), never skips the RAISE.
 *   W7: any listing for sale now can answer: no sale_mode refusal in the server, no sale_mode filter in the client.
 * Behaviour is proven in src/test/pglite/declutterWantedPhotosReplies.pglite.mjs (farListingRefused,
 * auctionListingAnswers, privatePostStillOneAnswer).
 *
 * @mutate supabase/migrations/20261030064727_declutter_wanted_photos_and_replies.sql |   IF (public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles) IS NOT TRUE THEN | IF false THEN
 * @mutate supabase/migrations/20261030064727_declutter_wanted_photos_and_replies.sql |   IF (public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles) IS NOT TRUE THEN |   IF NOT (public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles) THEN
 * @mutate supabase/migrations/20261030064727_declutter_wanted_photos_and_replies.sql |   IF i.status <> 'live' THEN\n    RAISE EXCEPTION 'item_not_available' | IF i.sale_mode <> 'offers' THEN RAISE EXCEPTION 'sale_mode_unavailable'; END IF;\n  IF i.status <> 'live' THEN\n    RAISE EXCEPTION 'item_not_available'
 * @mutate src/lib/declutter/wanted.ts |       .eq("status", "live")\n | .eq("status", "live").eq("sale_mode", "offers")\n
 * @mutate src/components/declutter/useSellFlowState.ts |   const answer = urlItemId ? null : readWantedAnswer(params); |   const answer = readWantedAnswer(params);
 * @mutate src/components/declutter/useSellFlowState.ts |           const out = await answerAfterListing(answer, id, status, form.free ? null : dollarsToCents(form.price)); |           const out = await answerAfterListing(answer, id, "live", form.free ? null : dollarsToCents(form.price));
 *
 * Quick-list (owner 2026-10-30): the shared sell flow answers the post only for a NEW listing made from it, after
 * publishItem, with the status publishItem returned (a listing in review never sends: answerAfterListing).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "../..");
const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
const reply = defs.get("declutter_wanted_reply");
const body = blankSqlComments(reply?.stmt ?? "");

describe("declutter_wanted_reply: the listing is near the post, and any live listing answers (audit W6, W7)", () => {
  it("reads a real, current definition", () => {
    expect(reply?.file ?? "").toMatch(/^\d{14}_.+\.sql$/);
    expect(reply!.file >= "20261030064727").toBe(true);
    expect(body.length).toBeGreaterThan(2000);
  });

  it("W6: refuses a listing outside the post's distance, NULL-safe, after the one-answer gate", () => {
    const radius = body.search(/IF\s*\(\s*public\.declutter_miles\(\s*w\.area_lat,\s*w\.area_lng,\s*i\.area_lat,\s*i\.area_lng\s*\)\s*<=\s*w\.radius_miles\s*\)\s*IS NOT TRUE THEN\s*RAISE EXCEPTION 'listing_too_far'/);
    expect(radius).toBeGreaterThan(0);
    const gate = body.indexOf("RAISE EXCEPTION 'wanted_not_found'");
    expect(gate).toBeGreaterThan(0);
    expect(radius).toBeGreaterThan(gate);
    // The listing's own area is read (not the seller's browse point).
    expect(body).toMatch(/SELECT[^;]*\bit\.area_lat,\s*it\.area_lng\b[^;]*INTO i\b/);
  });

  it("W7: no sale_mode refusal in the server", () => {
    expect(body).not.toMatch(/sale_mode\s*<>/);
    expect(body).not.toContain("sale_mode_unavailable");
  });

  it("W7: the client lists every live listing of yours, not only one sale mode", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/lib/declutter/wanted.ts"), "utf8"));
    const fn = src.slice(src.indexOf("export async function fetchMyReplyListings"), src.indexOf("export async function replyToWanted"));
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).toContain('.eq("status", "live")');
    expect(fn).not.toContain("sale_mode");
  });

  it("quick-list: only a NEW listing answers, after publishItem, with the status it returned", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/components/declutter/useSellFlowState.ts"), "utf8"));
    expect(src).toContain("const answer = urlItemId ? null : readWantedAnswer(params);");
    const publish = src.indexOf("const status = await publishItem(id);");
    const send = src.indexOf("await answerAfterListing(answer, id, status,");
    expect(publish).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(publish);
  });
});
