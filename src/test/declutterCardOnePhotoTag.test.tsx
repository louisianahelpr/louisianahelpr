/**
 * Post-merge check 11-20 #11 (~/.lh-shots/declutter-top5-1120/mock-browse-390-top.png): a Browse card stacked "Yours",
 * "Porch pickup", "Trades OK" and "In demand" over its photo next to the heart, covering the item. The photo now wears
 * ONE tag, in photoTagOf's order: your own listing, the card's rule tag (new, may drop tonight, in demand, Helpr
 * delivery), porch pickup, trades.
 *
 * @mutate src/components/declutter/DeclutterItemCard.tsx |   if (mine) return "mine"; |   if (false) return "mine";
 * @mutate src/components/declutter/DeclutterItemCard.tsx |   if (tag) return "rule"; |   if (false) return "rule";
 * Owner 11-20 (site polish A2): porch pickup is the default way, so it wears no tag at all; the order is Yours, the
 * rule tag, trades.
 * @mutate src/components/declutter/DeclutterItemCard.tsx |   return item.accepts_trades === true ? "trades" : null; |   return item.accepts_trades === true ? "trades" : (item as { porch_ok?: boolean }).porch_ok ? "trades" : null;
 * @mutate src/components/declutter/DeclutterItemCard.tsx |             {photoTag === "trades" && <PhotoTag data-card-trades=""> |             {item.accepts_trades === true && <PhotoTag data-card-trades="">
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ItemCard, photoTagOf, type CardTag } from "@/components/declutter/DeclutterItemCard";

const item = (extra: Record<string, unknown> = {}) => ({
  id: "i1", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
  delivery_size: "small", price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15,
  porch_ok: true, accepts_trades: true, ...extra,
}) as never;

const tagsOn = (extra: Record<string, unknown>, tag: CardTag | null, mine = false) => {
  const r = render(<MemoryRouter><ItemCard item={item(extra)} tag={tag} mine={mine} miles={2} approximate={false} /></MemoryRouter>);
  const stack = r.container.querySelector("[data-photo-tags]");
  const out = stack ? [...stack.children].map((c) => c.textContent) : [];
  r.unmount();
  return out;
};

describe("11-20 #11: a card's photo wears one tag", () => {
  it("never more than one tag over the photo, whatever the listing has", () => {
    const cases: [Record<string, unknown>, CardTag | null, boolean][] = [];
    for (const porch_ok of [true, false]) for (const accepts_trades of [true, false]) for (const tag of [null, "new", "drop", "demand", "delivery"] as const) for (const mine of [true, false]) {
      cases.push([{ porch_ok, accepts_trades }, tag, mine]);
    }
    expect(cases.length).toBeGreaterThan(30);
    for (const [extra, tag, mine] of cases) expect(tagsOn(extra, tag, mine).length, JSON.stringify([extra, tag, mine])).toBeLessThanOrEqual(1);
  });

  it("the order: Yours, then the rule tag, then trades; porch pickup (the default) never wears one", () => {
    expect(tagsOn({}, "demand", true)).toEqual(["Yours"]);
    expect(tagsOn({}, "demand")).toEqual(["In demand"]);
    expect(tagsOn({}, "delivery")).toEqual(["Helpr delivery"]);
    expect(tagsOn({}, null)).toEqual(["Trades OK"]);
    expect(tagsOn({ porch_ok: false }, null)).toEqual(["Trades OK"]);
    expect(tagsOn({ accepts_trades: false }, null)).toEqual([]);
    expect(tagsOn({ porch_ok: false, accepts_trades: false }, null)).toEqual([]);
    expect(photoTagOf({ accepts_trades: false }, null, false)).toBeNull();
  });
});
