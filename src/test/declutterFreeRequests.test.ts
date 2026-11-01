/**
 * The Free change (owner 2026-10-29; lead-approved design, Builder 85): a free item is ASKED for, stays up, and the
 * giver picks who gets it. The newest definitions keep that shape; the behaviour runs in
 * src/test/pglite/declutterFreeRequests.pglite.mjs (migration applied 3x; red with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261030064021_declutter_free_requests.sql |   RETURN public.declutter_request_free(p_item_id); |   RETURN public.declutter_take_item(p_item_id, auth.uid(), 0, 'buy', NULL);
 * @mutate supabase/migrations/20261101040158_profile_lookups_by_user_id.sql |   SELECT (SELECT count(*) FROM public.declutter_free_requests r WHERE r.requester_id = v_uid AND r.status = 'open')\n       + (SELECT | SELECT (SELECT 0)\n       + (SELECT
 * @mutate supabase/migrations/20261101040158_profile_lookups_by_user_id.sql |  WHERE p.user_id = v_uid AND p.free_blocked_until > now(); |  WHERE false;
 * @mutate supabase/migrations/20261030064021_declutter_free_requests.sql |   IF NEW.status <> 'live' OR NEW.current_price_cents <> 0 THEN |   IF NEW.status <> 'live' THEN
 * @mutate src/components/declutter/DeclutterHomeView.tsx | data-free-request-count="">Requests ({freeAsks.data.get(item.id) ?? 0}) | data-free-request-count="">View
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       <MyFreeAsks />\n | \n
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       <FreePauseLine />\n | \n
 * @mutate src/pages/info/legal/TermsSection.tsx | if you don&apos;t choose in time, the item goes back up and you get no strike. | the usual strike rules apply if you don&apos;t confirm.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const body = (fn: string) => blankSqlComments(newestFunction(fn).body);

describe("free items are asked for, not grabbed", () => {
  it("the old claim (installed builds) asks, and never reserves the item itself", () => {
    const b = body("declutter_claim_free");
    expect(b).toContain("public.declutter_request_free(p_item_id)");
    expect(b).not.toContain("declutter_take_item");
  });

  it("an ask records a request and leaves the item up; only a pick reserves it", () => {
    const ask = body("declutter_request_free");
    expect(ask).toContain("INSERT INTO public.declutter_free_requests");
    expect(ask).not.toContain("declutter_take_item");
    const pick = body("declutter_pick_free_request");
    expect(pick).toContain("public.declutter_take_item(v_item.id, v_req.requester_id, 0, 'buy', NULL)");
    expect(pick.indexOf("status = 'not_picked'")).toBeLessThan(pick.indexOf("declutter_take_item"));
  });

  it("the 3-at-a-time cap counts asks too, and the 30-day pause refuses with a date", () => {
    const ask = body("declutter_request_free");
    const rules = ["(SELECT count(*) FROM public.declutter_free_requests r WHERE r.requester_id = v_uid AND r.status = 'open')", "c.price_cents = 0 AND c.status = 'in_cart'", "o.paid_with = 'free'"];
    expect(rules.length).toBeGreaterThan(2);
    for (const r of rules) expect(ask).toContain(r);
    expect(ask).toContain("p.user_id = v_uid AND p.free_blocked_until > now()");
    expect(ask).toContain("You can ask for free items again on %s.");
  });

  it("open asks close when the item stops being live or free", () => {
    expect(body("declutter_free_requests_close_on_item_change")).toContain("IF NEW.status <> 'live' OR NEW.current_price_cents <> 0 THEN");
    expect(body("declutter_free_pause_on_no_show")).toContain("NEW.close_reason = 'buyer_no_show' AND NEW.paid_with = 'free'");
  });

  it("the screens: Requests (n) on a free Selling row, the member's asks and pause in Buying, and the Terms say how it works", () => {
    const src = (f: string) => blankComments(readFileSync(f, "utf8"));
    const selling = src("src/components/declutter/DeclutterHomeView.tsx");
    expect(selling).toContain('item.status === "live" && item.current_price_cents === 0 && freeAsks.data ?');
    expect(selling).toContain("Requests ({freeAsks.data.get(item.id) ?? 0})");
    const buying = src("src/components/declutter/DeclutterMineViews.tsx");
    const dash = buying.slice(buying.indexOf("export function BuyingDash"), buying.indexOf("export function SellingDash"));
    expect(dash.length).toBeGreaterThan(200);
    for (const tag of ["<FreePauseLine />", "<MyFreeAsks />"]) expect(dash).toContain(tag);
    const terms = readFileSync("src/pages/info/legal/TermsSection.tsx", "utf8");
    const free = terms.slice(terms.indexOf("Free items.</strong>"), terms.indexOf("</p>", terms.indexOf("Free items.</strong>")));
    expect(free.length).toBeGreaterThan(300);
    for (const words of ["&ldquo;Ask for it&rdquo;", "The seller picks who gets it", "you have 48 hours",
      "the item goes back up and you get no strike", "pauses asking for free items for 30 days"]) expect(free).toContain(words);
    expect(free).not.toContain("Get it free");
  });
});
