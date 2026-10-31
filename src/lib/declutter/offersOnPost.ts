/**
 * LEAD-OFFERS-CHOICE part (2) (owner, 2026-10-31): a NEW listing's "Accept offers", on the one-item form and per item
 * in Sell a bunch. Both start from the seller's saved default (declutter_seller_defaults.accepts_offers, Settings >
 * Listing defaults) and the choice is saved with the item when it posts.
 *
 * A new item takes offers unless told otherwise (declutter_items.accepts_offers DEFAULT true), so only OFF is sent:
 *   - on the draft, before it goes up (declutter_set_offer_rules takes a draft from 20261031201036 on), so it never
 *     goes live taking offers;
 *   - until that migration is live the server answers item_not_editable for a draft, so it is sent again once the
 *     item is live. An item held for a check (pending_review) can't be changed then: that is said, with where to do it.
 * Guard: src/test/declutterOffersOnPost.test.ts.
 */
import { setOfferRules } from "@/lib/declutter/api";

export const OFFERS_TITLE = "Accept offers";

/** What "Accept offers" means, on or off (Settings, the one-item form and Sell a bunch say it the same way). */
export const offersSettingLine = (on: boolean) =>
  on ? "Buyers can offer a lower price, and you say yes or no." : "Off. Buyers pay your price with Buy now; no offers.";

type SetRules = (id: string, accepts: boolean, auto: boolean) => Promise<void>;

/**
 * Before publish. "done": the draft takes no offers. "after": this server can't change a draft yet, so send it again
 * with offersOffAfterPublish once the item is up. Any other refusal is thrown (the caller says it, never blocks Post).
 */
export async function offersOffOnDraft(id: string, set: SetRules = setOfferRules): Promise<"done" | "after"> {
  try {
    await set(id, false, false);
    return "done";
  } catch (err) {
    if (String((err as Error)?.message ?? "").includes("item_not_editable")) return "after";
    throw err;
  }
}

/** After publish, for an item offersOffOnDraft answered "after". Throws when it could not be turned off. */
export async function offersOffAfterPublish(id: string, status: string, set: SetRules = setOfferRules): Promise<void> {
  // Held for a check, it is not live or paused, so the server would refuse: said instead of tried.
  if (status !== "live") throw Object.assign(new Error("item_not_editable"), { userMessage: "Offers are still on for this listing." });
  await set(id, false, false);
}
