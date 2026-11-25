/**
 * M13 (iOS design audit 11-16): a guest's cold launch landed on a jobs list with no visible label and no way to
 * Declutter, though Declutter is open to everyone. Both guest screens now draw the same labelled "Jobs | Declutter"
 * switch (GuestSectionSwitch: the shared FilterChips), the current one pressed; Declutter only while it is open.
 *
 * @mutate src/pages/home/DashboardGuest.tsx |     <GuestSectionSwitch at="jobs" className="mb-2" />\n |
 * @mutate src/components/declutter/DeclutterGuestHome.tsx | <div className="flex items-center justify-between gap-2 pb-2"><GuestSectionSwitch at="declutter" className="min-w-0" /> | <div className="flex items-center justify-between gap-2 pb-2">
 * @mutate src/components/sections/GuestSectionSwitch.tsx |   if (at !== "declutter" && !open?.has("declutter")) return null; |   if (open) return null;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

const state = vi.hoisted(() => ({ open: new Set<string>(["declutter"]) as Set<string> | null }));
vi.mock("@/components/landing/useSectionsOpen", () => ({ useSectionsOpen: () => ({ open: state.open, settled: true, failed: false }) }));

import { GuestSectionSwitch } from "@/components/sections/GuestSectionSwitch";

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}
function show(at: "jobs" | "declutter") {
  render(
    <MemoryRouter initialEntries={[at === "jobs" ? "/browse" : "/declutter"]}>
      <GuestSectionSwitch at={at} />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}
const chips = () => [...document.querySelectorAll<HTMLButtonElement>("[data-guest-section]")];
afterEach(() => { cleanup(); state.open = new Set(["declutter"]); });

describe("a guest's first screen is labelled and reaches Declutter (M13)", () => {
  it("Jobs | Declutter, the current section pressed; a tap opens the other", () => {
    show("jobs");
    expect(chips().map((c) => c.textContent)).toEqual(["Jobs", "Declutter"]);
    expect(chips()[0].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Declutter" }));
    expect(screen.getByTestId("where").textContent).toBe("/declutter");
    cleanup();
    show("declutter");
    expect(chips()[1].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Jobs" }));
    expect(screen.getByTestId("where").textContent).toBe("/browse");
  });

  it("no switch while Declutter is not open to everyone (or the answer is still out)", () => {
    state.open = new Set();
    show("jobs");
    expect(chips()).toHaveLength(0);
    cleanup();
    state.open = null;
    show("jobs");
    expect(chips()).toHaveLength(0);
  });

  it("both guest screens draw it", () => {
    expect(blankComments(readFileSync("src/pages/home/DashboardGuest.tsx", "utf8"))).toContain('<GuestSectionSwitch at="jobs"');
    expect(blankComments(readFileSync("src/components/declutter/DeclutterGuestHome.tsx", "utf8"))).toMatch(/<GuestSectionSwitch at="declutter"[^>]*\/>\{guestSell\(true\)\}<\/div>,/);
  });
});
