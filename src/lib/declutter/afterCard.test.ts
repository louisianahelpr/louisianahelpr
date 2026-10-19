/**
 * "Add a card, then carry on" (src/lib/declutter/afterCard.ts): what is
 * remembered across the trip to Stripe's card page, and what is refused.
 *
 * @mutate src/lib/declutter/afterCard.ts |     if (typeof v.at !== "number" \|\| now - v.at > AFTER_CARD_TTL_MS \|\| now < v.at) return null; |     void 0;
 * @mutate src/lib/declutter/afterCard.ts |     sessionStorage.removeItem(KEY); |     void KEY;
 * @mutate src/lib/declutter/afterCard.ts | !UUID.test(v.itemId) | false
 * @mutate src/lib/declutter/afterCard.ts |   return isAfterCardAction(a) ? a : null;\n} |   return a as AfterCardAction;\n}
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_CARD_TTL_MS, afterCardFromState, afterCardPath, isAfterCardAction, rememberAfterCard, takeAfterCard } from "./afterCard";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

beforeEach(() => sessionStorage.clear());

describe("afterCard", () => {
  it("remembers the item and the action once, and builds the way back", () => {
    rememberAfterCard(ID, "offer", 1_000);
    expect(takeAfterCard(2_000)).toEqual({ itemId: ID, action: "offer" });
    // Taken: a second return finds nothing.
    expect(takeAfterCard(2_000)).toBeNull();
    // The action rides in router state, never the address (a shared link cannot start a buy).
    expect(afterCardPath(ID)).toBe(`/declutter/item/${ID}`);
  });

  it("drops a stale, future-dated or malformed intent", () => {
    rememberAfterCard(ID, "buy", 1_000);
    expect(takeAfterCard(1_000 + AFTER_CARD_TTL_MS + 1)).toBeNull();
    rememberAfterCard(ID, "buy", 5_000);
    expect(takeAfterCard(1_000)).toBeNull();
    rememberAfterCard("../../admin", "buy", 1_000);
    expect(takeAfterCard(1_000)).toBeNull();
    sessionStorage.setItem("declutter.afterCard", JSON.stringify({ itemId: ID, action: "pay", at: 1_000 }));
    expect(takeAfterCard(1_000)).toBeNull();
    sessionStorage.setItem("declutter.afterCard", "{not json");
    expect(takeAfterCard(1_000)).toBeNull();
  });

  it("knows the two actions only", () => {
    expect(isAfterCardAction("buy")).toBe(true);
    expect(isAfterCardAction("offer")).toBe(true);
    expect(isAfterCardAction("pay")).toBe(false);
    expect(isAfterCardAction(null)).toBe(false);
  });

  it("reads the action back from router state only when it is one of the two", () => {
    expect(afterCardFromState({ afterCard: "offer" })).toBe("offer");
    expect(afterCardFromState({ afterCard: "pay" })).toBeNull();
    expect(afterCardFromState(null)).toBeNull();
    expect(afterCardFromState("buy")).toBeNull();
  });
});
