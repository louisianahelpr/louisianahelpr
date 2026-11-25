/**
 * Owner picks 11-08 (design audit B, Declutter redesign): the shared pieces and the Browse card rules that have no
 * older guard.
 *
 * - Browse card: "Trades OK" is a photo tag in the ONE PhotoTag style (the same as "Porch pickup"), only when the
 *   item takes trades.
 * - Category chips: no icons on the row (M4, 11-16: no "Free" chip; the Free tab is the way in).
 * - StickyActionBar: the buttons render ONCE (inline on a wide screen), never a second copy.
 *
 * @mutate src/components/declutter/DeclutterItemCard.tsx | {photoTag === "trades" && <PhotoTag data-card-trades="">{t("decl.card.trades")}</PhotoTag>} | {null}
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ItemCard } from "@/components/declutter/DeclutterItemCard";
import { StickyActionBar } from "@/components/ui/StickyActionBar";

const item = (extra: Record<string, unknown> = {}) => ({
  id: "i1", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
  delivery_size: "small", price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15,
  porch_ok: true, ...extra,
}) as never;

describe("owner picks 11-08: Declutter redesign", () => {
  it("a card that takes trades wears a 'Trades OK' photo tag; one that doesn't, none", () => {
    // Owner 11-20 (site polish A2): porch pickup is the default way and wears no tag, so a porch card that takes
    // trades still shows "Trades OK", and a plain porch card shows nothing over its photo.
    const on = render(<MemoryRouter><ItemCard item={item({ accepts_trades: true })} miles={2} approximate={false} /></MemoryRouter>);
    const trades = on.container.querySelector("[data-photo-tags] [data-card-trades]")!;
    const porchCard = render(<MemoryRouter><ItemCard item={item()} miles={2} approximate={false} /></MemoryRouter>);
    expect(porchCard.container.querySelector("[data-photo-tags]")).toBeNull();
    expect(trades.textContent).toBe("Trades OK");
    on.unmount();
    porchCard.unmount();
    const off = render(<MemoryRouter><ItemCard item={item()} miles={2} approximate={false} /></MemoryRouter>);
    expect(off.container.querySelector("[data-card-trades]")).toBeNull();
    off.unmount();
  });

  // M4's chip-row checks retired with the row (owner 11-25: the categories are in Filters).
  it("the sticky action bar renders its buttons once", () => {
    const r = render(<StickyActionBar label="Buy or make an offer"><button type="button">Make offer</button><button type="button">Buy now</button></StickyActionBar>);
    expect(screen.getAllByRole("button", { name: "Buy now" })).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Buy or make an offer" })).toBeInTheDocument();
    r.unmount();
  });
});
