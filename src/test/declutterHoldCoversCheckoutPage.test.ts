/**
 * BUY-1 (lead 10-31, the payment race): starting checkout stretches the hold to the Stripe page's end, so the
 * stretch in declutter_attach_checkout_session must be at least the page's lifetime in declutter-checkout
 * (PAGE_LIFETIME_S, both Stripe pages that open a sale). If the page outlives the stretch, a 30-minute Buy now hold
 * goes back on sale while its page can still be paid. Reads the NEWEST definition (comments blanked).
 *
 * @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |            LEAST(now() + interval '31 minutes', |            LEAST(now() + interval '25 minutes',
 * @mutate supabase/functions/declutter-checkout/index.ts | const PAGE_LIFETIME_S = 31 * 60; | const PAGE_LIFETIME_S = 45 * 60;
 * @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |                  c.created_at + public.declutter_hold_length(c.price_cents, c.source) + interval '31 minutes')) |                  c.created_at + public.declutter_hold_length(c.price_cents, c.source) + interval '20 minutes'))
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";

const edge = blankComments(readFileSync(join(process.cwd(), "supabase/functions/declutter-checkout/index.ts"), "utf8"));

describe("the hold covers the checkout page (BUY-1 race)", () => {
  it("the newest attach stretches every in-cart line by at least the page's lifetime", () => {
    const def = latestFunctionDefs(join(process.cwd(), "supabase/migrations")).get("declutter_attach_checkout_session");
    expect(def?.file ?? "").toContain("20261101030040_declutter_buy_now_30_minutes.sql");
    const body = (def?.body ?? "").replace(/\s+/g, " ");
    const page = /const PAGE_LIFETIME_S = (\d+) \* 60;/.exec(edge);
    expect(page, "PAGE_LIFETIME_S in declutter-checkout").not.toBeNull();
    const pageMin = Number(page?.[1]);
    expect(pageMin).toBeGreaterThanOrEqual(30); // Stripe's minimum
    const stretch = [...body.matchAll(/interval '(\d+) minutes'/g)].map((m) => Number(m[1]));
    expect(stretch.length).toBe(2); // now() + page, and the cap: the line's own hold + one page
    for (const m of stretch) expect(m, "each stretch covers one whole page").toBeGreaterThanOrEqual(pageMin);
    expect(body).toContain("SET checkout_by = GREATEST(c.checkout_by,");
    expect(body).toContain("WHERE c.order_id = p_order_id AND c.status = 'in_cart';");
  });
});
