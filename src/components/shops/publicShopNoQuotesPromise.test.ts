/**
 * S030 follow-up (Shops audit 11-12): the signed-out shared shop page (PublicShopView) still said "This shop gives
 * quotes. Asking for one here opens soon." / "Sign in to ask for one when quotes open here." — the same dead-end
 * promise S030 removed for members. The page can't read custom_orders, so the Quotes card is dropped.
 *
 * @mutate src/components/shops/PublicShopView.tsx |       <ShopHoursCard hours={shop.hours} /> |       {shop.offers_quotes && <ShopCard id="shop-quotes" title="Quotes"><p>Asking for one here opens soon.</p></ShopCard>}<ShopHoursCard hours={shop.hours} />
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const src = blankComments(readFileSync(join(__dirname, "PublicShopView.tsx"), "utf8"));

describe("S030 follow-up: the public shop page makes no 'opens soon' quotes promise", () => {
  it("has no quotes-opening promise and no Quotes card", () => {
    expect(src).not.toMatch(/quotes open here|Asking for one here opens soon/i);
    expect(src).not.toMatch(/id="shop-quotes"/);
  });
});
