/**
 * Coordinator 11-15 (~/.lh-shots/newmember-1115/home-390.png, 390 x 844): on a new member's Home the floating "+ Create"
 * pill sat on the second "Jobs near you" row's price at rest. The welcome card at the top of that Home IS the create
 * ("Post a job", "Sell something"), so the pill steps aside while the card is on screen, the owner's 11-08 rule for an
 * empty state's own create (createFabHidden, createFabStepsAside.test.tsx). Every other Home keeps the pill.
 *
 * @mutate src/pages/home/homeDashboard/WelcomeCard.tsx |       <HideSectionCreateFab />\n |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: () => {}, hapticLight: () => {} }));

import { SectionCreateFab } from "@/components/sections/SectionCreateFab";
import { WelcomeCard } from "@/pages/home/homeDashboard/WelcomeCard";

afterEach(cleanup);

describe("a new member's Home: the Create pill never sits on the jobs near them", () => {
  it.each([true, false])("the pill is gone while the welcome card (its own create) is on screen (sell=%s)", (sell) => {
    render(<MemoryRouter><SectionCreateFab /><WelcomeCard sell={sell} /></MemoryRouter>);
    // The card's own create actions are there (inventory floor: the check rendered the real card).
    expect(document.querySelectorAll("[data-welcome-tile]").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Post a job").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("section-create-fab")).toBeNull();
  });

  it("any other Home keeps the pill", () => {
    render(<MemoryRouter><SectionCreateFab /></MemoryRouter>);
    expect(screen.getByTestId("section-create-fab")).toBeInTheDocument();
  });
});
