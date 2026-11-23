// @mutate src/content/sponsorPage.ts |         day: 25,\n        partners: [ |         day: 25,\n        partners: [\n          { brand: "Louisiana Helpr", prize: "$100 Louisiana Helpr gift card" },
// @mutate src/content/sponsorPage.ts |           { brand: "Boston Mints", prize: "3 Boston Mints lip glosses" }, |           { brand: "Boston Mints", prize: "One lip gloss each day" },
// @mutate src/content/sponsorPage.ts |         day: 21,\n        partners: [ |         day: 21,\n        partners: [\n          { brand: "Boston Mints", prize: "One lip gloss each day" },
/**
 * Owner pop-up 2026-11-22 10:02 PM: take the $100 Louisiana Helpr gift card off the 25 Days giveaway. It sat on Dec 25
 * of the public lineup (/25days and /sponsor), so the lineup carries sponsors' prizes only: no partner is Louisiana
 * Helpr and no prize is a Louisiana Helpr gift card, in the data or in the rendered A-Z list.
 * Same evening (lead, 2026-11-22): the owner combined Boston Mints' 3 lip glosses into one prize on Dec 18 (their Dec 11
 * and Dec 21 entries removed), so the public lineup counts 163 giveaways.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { sponsorPage } from "@/content/sponsorPage";
import { Lineup } from "@/components/sponsor/Sections";

const OURS = /louisiana\s*helpr/i;

describe("our own gift card is off the 25 Days giveaway (owner 2026-11-22)", () => {
  it("no lineup partner or prize is ours (inventory floor: every day is listed)", () => {
    const partners = sponsorPage.lineup.days.flatMap((d) => d.partners.map((p) => ({ day: d.day, ...p })));
    expect(sponsorPage.lineup.days.length).toBeGreaterThan(24);
    expect(partners.length).toBeGreaterThan(100);
    expect(partners.filter((p) => OURS.test(p.brand) || OURS.test(p.prize)).map((p) => `Dec ${p.day} ${p.brand}`)).toEqual([]);
  });

  it("Boston Mints' 3 lip glosses are one prize on Dec 18 (owner 2026-11-22), not one a day on Dec 11, 18 and 21", () => {
    const days = sponsorPage.lineup.days.filter((d) => d.partners.some((p) => p.brand === "Boston Mints"));
    expect(days.map((d) => d.day)).toEqual([18]);
    expect(days[0]?.partners.find((p) => p.brand === "Boston Mints")?.prize).toBe("3 Boston Mints lip glosses");
  });

  it("the rendered lineup shows no Louisiana Helpr card", () => {
    render(<MemoryRouter><Lineup /></MemoryRouter>);
    const cards = screen.getAllByTestId("lineup-partner").map((c) => c.textContent ?? "");
    expect(cards.length).toBeGreaterThan(50);
    expect(cards.filter((t) => OURS.test(t))).toEqual([]);
  });
});
