/**
 * "Sell it for me" words and links (src/lib/declutter/sellForMe.ts): the Post a
 * Job path, the Declutter Help prefill, and the Shops category both options
 * name. The title must fit public.jobs' 32-character cap (Q782) and the
 * description must carry the no-account-access promise.
 *
 * @mutate src/lib/declutter/sellForMe.ts | const SELL_FOR_ME_TITLE = "Help me list my things to sell"; | const SELL_FOR_ME_TITLE = "Help me list all of my things to sell";
 */
import { describe, expect, it } from "vitest";
import { detailsBlocker } from "@/pages/post-job/detailsBlocker";
import {
  SELL_FOR_ME_NO_ACCOUNT_LINE,
  SELL_FOR_ME_PARAM,
  SELL_FOR_ME_SHOP_CATEGORY,
  buildSellForMePrefill,
  sellForMePostJobPath,
} from "./sellForMe";

describe("sell it for me", () => {
  it("links to Post a job with the sellForMe flag", () => {
    expect(SELL_FOR_ME_PARAM).toBe("sellForMe");
    expect(sellForMePostJobPath()).toBe("/post-job?sellForMe=1");
    expect(new URL(sellForMePostJobPath(), "https://x.test").searchParams.get(SELL_FOR_ME_PARAM)).toBe("1");
  });

  it("prefills a Declutter Help job whose title fits the jobs cap and whose description promises no account access", () => {
    const p = buildSellForMePrefill();
    expect(p.category).toBe("declutter_help");
    expect(p.title).toBe("Help me list my things to sell");
    expect(p.title.length).toBeLessThanOrEqual(32);
    expect(p.description.length).toBeLessThan(1000);
    expect(p.description.endsWith(SELL_FOR_ME_NO_ACCOUNT_LINE)).toBe(true);
    expect(p.description).toContain("How many items");
  });

  // POST-H15 (posting audit 10-30 #15): Continue went on with the template's three blanks empty.
  // @mutate src/lib/declutter/sellForMe.ts | label: "How many items", placeholder: "[about how many]" }, | label: "How many items", placeholder: "about " },
  // @mutate src/lib/declutter/sellForMe.ts | placeholder: "[yes or no]", choices | placeholder: "", choices
  it("every blank in the template is a placeholder, so Details refuses it until each is filled", () => {
    const p = buildSellForMePrefill();
    const asks = p.description.split("\n").filter((l) => /^(How many items|Rough size|Also handle pickups)/.test(l));
    expect(asks).toHaveLength(3);
    for (const ask of asks) expect(ask).toMatch(/: \[[^\]]+\]$/);
    expect(detailsBlocker({ title: p.title, description: p.description, category: p.category })).toBe("Replace the [placeholders] to continue");
    const filled = p.description
      .replace("[about how many]", "about 20").replace("[small things, furniture or a mix]", "a mix").replace("[yes or no]", "yes");
    expect(detailsBlocker({ title: p.title, description: filled, category: p.category })).toBeNull();
  });

  it("names the Shops category the migration adds", () => {
    expect(SELL_FOR_ME_SHOP_CATEGORY).toBe("declutter_estate_sales");
  });
});
