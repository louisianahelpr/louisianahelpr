/**
 * The owner's UI audit of the landing (2026-11-09, ~/.lh-shots/ui-audit-1109), one block per finding.
 *
 * F003: the Declutter card said "Offers and checkout happen in the app.", which reads wrong on the website, where a
 * visitor can browse and buy. It now says they are built in.
 * @mutate src/components/landing/SectionsShowcase.tsx | Offers and checkout are built in. | Offers and checkout happen in the app.
 *
 * F004: the four section cards were grey-beige fills (var(--lp-ground)) beside the white How a job works cards. They
 * wear the same white landing card with its soft shadow (.landing-card: var(--lp-surface) + var(--lp-shadow)).
 * @mutate src/components/landing/SectionsShowcase.tsx | className="landing-card relative p-6 | className="relative rounded-[20px] p-6
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  it("F004: every section card is the white landing card (the How a job works surface), never the ground fill", () => {
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    const rule = css.match(/\n\.landing-card \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/background:\s*var\(--lp-surface\)/);
    expect(rule).toMatch(/box-shadow:\s*var\(--lp-shadow\)/);
    const { container, unmount } = renderSections(null);
    const cards = [...container.querySelectorAll<HTMLElement>("[data-section]")];
    expect(cards.length).toBeGreaterThan(3);
    for (const c of cards) {
      expect(c.classList.contains("landing-card"), c.dataset.section).toBe(true);
      expect(c.style.background, c.dataset.section).toBe("");
    }
    unmount();
  });
});
