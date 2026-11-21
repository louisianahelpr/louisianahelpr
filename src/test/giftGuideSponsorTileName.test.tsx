/**
 * A sponsor tile's accessible name holds its visible text (a11y sweep 11-20: the gift guide landing failed axe's
 * label-content-name-mismatch on a sponsor with no logo, whose aria-label left the tile's visible text out). An outside
 * link has no aria-label: its name is the sponsor's name from the content plus a screen-reader "opens in a new tab".
 *
 * @mutate src/pages/info/giftGuides/GiftGuideSponsorRow.tsx | className="gg-spons-a">{body}{" "}<span className="sr-only">({G.newTab})</span></a> | className="gg-spons-a" aria-label={G.newTab}>{body}</a>
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SponsorTile } from "@/pages/info/giftGuides/GiftGuideSponsorRow";
import { giftGuides as G } from "@/content/giftGuides";

const tile = (s: Parameters<typeof SponsorTile>[0]["s"]) => render(<MemoryRouter><ul><SponsorTile s={s} /></ul></MemoryRouter>);

describe("gift guide sponsor tile name", () => {
  it("names an outside sponsor link from its visible name, with no aria-label", () => {
    tile({ name: "Active Beauty", slug: "active-beauty", href: "https://www.facebook.com/RealActiveBeauty/", external: true } as never);
    const link = screen.getByRole("link", { name: `Active Beauty (${G.newTab})` });
    expect(link.getAttribute("aria-label")).toBeNull();
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.querySelector(".gg-spons-name")?.textContent).toBe("Active Beauty");
  });

  it("names an in-app sponsor link by the sponsor alone", () => {
    tile({ name: "Oil Center", slug: "oil-center", href: "/sponsors/oil-center" } as never);
    expect(screen.getByRole("link", { name: "Oil Center" }).getAttribute("aria-label")).toBeNull();
  });
});
