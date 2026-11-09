/**
 * The owner's UI audit of the landing (2026-11-09, ~/.lh-shots/ui-audit-1109), one block per finding.
 *
 * F003: the Declutter card said "Offers and checkout happen in the app.", which reads wrong on the website, where a
 * visitor can browse and buy. It now says they are built in.
 * @mutate src/components/landing/SectionsShowcase.tsx | Offers and checkout are built in. | Offers and checkout happen in the app.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ open: null as ReadonlySet<string> | null }));
vi.mock("@/components/landing/useSectionsOpen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/useSectionsOpen")>();
  return { ...real, useSectionsOpen: () => ({ open: state.open }) };
});

import { SectionsShowcase } from "@/components/landing/SectionsShowcase";
import { SECTIONS } from "@/components/sections/sectionsConfig";

function renderSections(open: ReadonlySet<string> | null) {
  state.open = open;
  return render(<MemoryRouter><SectionsShowcase /></MemoryRouter>);
}

describe("landing UI audit 2026-11-09", () => {
  it("F003: the Declutter card says offers and checkout are built in", () => {
    const { container, unmount } = renderSections(new Set(["declutter"]));
    expect(container.querySelectorAll("[data-section]").length).toBe(SECTIONS.length);
    const card = container.querySelector('[data-section="declutter"]') as HTMLElement;
    expect(card.textContent).toContain("Sell to neighbors or find a deal. Offers and checkout are built in.");
    expect(container.textContent).not.toMatch(/happen in the app/);
    unmount();
  });
});
