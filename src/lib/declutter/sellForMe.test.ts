/**
 * "Sell it for me" words and links (src/lib/declutter/sellForMe.ts): the Post a
 * Job path, the Declutter Help prefill, and the Shops category both options
 * name. The title must fit public.jobs' 32-character cap (Q782) and the
 * description must carry the no-account-access promise.
 */
import { describe, expect, it } from "vitest";
import {
  SELL_FOR_ME_NO_ACCOUNT_LINE,
  SELL_FOR_ME_PARAM,
  SELL_FOR_ME_SHOP_CATEGORY,
  buildSellForMePrefill,
  sellForMePostJobPath,
} from "./sellForMe";

describe("sell it for me", () => {
  it("links to Post a Job with the sellForMe flag", () => {
    expect(SELL_FOR_ME_PARAM).toBe("sellForMe");
    expect(sellForMePostJobPath()).toBe("/post-job?sellForMe=1");
    expect(new URL(sellForMePostJobPath(), "https://x.test").searchParams.get(SELL_FOR_ME_PARAM)).toBe("1");
  });

  it("prefills a Declutter Help job whose title fits the jobs cap and whose description promises no account access", () => {
    const p = buildSellForMePrefill();
    expect(p.category).toBe("declutter_help");
    expect(p.title).toBe("Photograph and list my items");
    expect(p.title.length).toBeLessThanOrEqual(32);
    expect(p.description.length).toBeLessThan(1000);
    expect(p.description.endsWith(SELL_FOR_ME_NO_ACCOUNT_LINE)).toBe(true);
    expect(p.description).toContain("How many items");
  });

  it("names the Shops category the migration adds", () => {
    expect(SELL_FOR_ME_SHOP_CATEGORY).toBe("declutter_estate_sales");
  });
});
