/**
 * Every Browse list ends on the same friendly card (owner, 2026-10-19), short
 * lists included, and it never promises what we don't do (lead, 2026-10-19):
 * "Widen distance" only where a distance filter exists and is not already at
 * "Any distance"; "Turn on alerts" only in Jobs (the only real alert).
 *
 * @mutate src/components/sections/BrowseEndCard.tsx |         title={onWiden ? "That's everything nearby." : "That's everything for now."} |         title="That's everything nearby."
 * @mutate src/components/shops/ShopsHomeView.tsx | && <BrowseEndCard />} | && null}
 * @mutate src/components/declutter/DeclutterHomeView.tsx |           onWiden={from && maxMiles !== null ? | onWiden={from ?
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BrowseEndCard } from "@/components/sections/BrowseEndCard";
import { blankComments } from "./helpers/blankNonCode";

afterEach(cleanup);
const src = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

describe("BrowseEndCard", () => {
  it("with both actions: nearby copy, Widen + Turn on alerts", () => {
    render(<BrowseEndCard onWiden={() => {}} widenLabel="Widen to 25 mi" onAlerts={() => {}} />);
    expect(screen.getByText("That's everything nearby.")).toBeTruthy();
    expect(screen.getByText("Widen your distance or turn on alerts.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Widen to 25 mi" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Turn on alerts/ })).toBeTruthy();
  });
  it("with no widen (any distance / no distance filter): check back soon, no widen button", () => {
    render(<BrowseEndCard />);
    expect(screen.getByText("That's everything for now.")).toBeTruthy();
    expect(screen.getByText("Check back soon.")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(document.body.textContent).not.toMatch(/soon\b.*alerts|coming soon/i);
  });
});

describe("each Browse list renders it", () => {
  const FILES: [string, RegExp][] = [
    ["src/components/dashboard/BrowseTasksFeed.tsx", /<BrowseEndCard[\s\S]*?onAlerts=/],
    ["src/components/declutter/DeclutterHomeView.tsx", /<BrowseEndCard[\s\S]*?onWiden=\{from && maxMiles !== null \?/],
    ["src/components/shops/ShopsHomeView.tsx", /<BrowseEndCard \/>/],
    ["src/components/rentals/listings/RentBrowse.tsx", /<BrowseEndCard \/>/],
  ];
  // Vacuity floor (#2894): the four Browse lists (Jobs, Declutter, Shops, Homes), never an empty list.
  it("checks all four Browse lists", () => expect(FILES.length).toBe(4));
  for (const [f, re] of FILES) it(f, () => expect(src(f)).toMatch(re));
  it("only Jobs offers alerts", () => {
    for (const [f] of FILES.slice(1)) expect(src(f)).not.toMatch(/<BrowseEndCard[^>]*onAlerts/);
  });
});
