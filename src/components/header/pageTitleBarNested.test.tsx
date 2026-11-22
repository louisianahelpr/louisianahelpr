/**
 * Owner 2026-10-28 (screenshots of Applicants over Jobs): a screen opened on top
 * of a page draws its back + title row UNDER the desktop bar, never beside the
 * page's own title (which squeezed the "+" and gear into the middle, and the
 * overlay covered that back arrow so it could not be clicked). Only the first
 * mounted title bar goes up into the bar.
 *
 * @mutate src/components/header/PageTitleBar.tsx |   if (isWebDesktop && target && !first) { |   if (false) {
 * @mutate src/components/header/PageTitleBar.tsx | text-foreground${titleHidden ? " sr-only" : ""}` | text-foreground`
 * @mutate src/components/PageHeader.tsx |       titleHidden={hidesTitle}\n |
 * @mutate src/components/header/PageTitleBar.tsx | titleTag={covered ? "p" : titleTag} />, target)} | titleTag={titleTag} />, target)}
 *
 * Jobs audit 11-21 (L24): the page under the screen kept its bar title as an h1, so Applicants over Jobs read two h1s.
 * The page's title keeps its place and look in the bar as a plain line while the screen is open; the screen holds the
 * one h1, and the page's h1 comes back when the screen closes.
 *
 * B106 (Declutter item page at 1440, 11-01): the title showed twice, in the bar and in the item column. A page that
 * paints its own title (PageHeader `hidesTitle`) keeps the bar's h1 for screen readers only.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PageTitleBar, registerDesktopTitleSlot } from "./PageTitleBar";
import PageHeader from "@/components/PageHeader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));

describe("a screen on top of a page keeps its title under the bar", () => {
  it("the page's title goes in the bar; the overlay's own row renders inside the overlay", () => {
    const bar = document.createElement("div");
    document.body.appendChild(bar);
    registerDesktopTitleSlot(bar);
    const page = (open: boolean) => (
      <MemoryRouter>
        <PageTitleBar title="Jobs" phone={<span />} />
        {open && (
          <div data-testid="overlay">
            <PageTitleBar title="Applicants" back={{ onBack: () => {} }} phone={<span />} />
          </div>
        )}
      </MemoryRouter>
    );
    const { rerender } = render(page(true));
    // The page's title stays in the bar, the same words in the same place (owner 10-28), as a plain line (L24).
    expect(bar.querySelector("[data-page-title-row]")?.textContent).toBe("Jobs");
    expect(bar.querySelectorAll("h1")).toHaveLength(0);
    const overlay = screen.getByTestId("overlay");
    expect(overlay.querySelector("h1")?.textContent).toBe("Applicants");
    expect(overlay.querySelector("[data-page-title-nested]")).not.toBeNull();
    // ONE h1 on the screen while the overlay is open.
    expect(Array.from(document.querySelectorAll("h1")).map((h) => h.textContent)).toEqual(["Applicants"]);
    rerender(page(false));
    expect(Array.from(bar.querySelectorAll("h1")).map((h) => h.textContent)).toEqual(["Jobs"]);
    registerDesktopTitleSlot(null);
  });
});

describe("a page that paints its own title keeps the bar's h1 for screen readers only", () => {
  it("PageHeader hidesTitle -> the desktop bar's h1 is sr-only; back stays", () => {
    const bar = document.createElement("div");
    document.body.appendChild(bar);
    registerDesktopTitleSlot(bar);
    const qc = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PageHeader title="Casper pillow" backTo="/declutter" hidesTitle />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const h1 = bar.querySelector("h1");
    expect(h1?.textContent).toBe("Casper pillow");
    expect(h1?.className).toMatch(/\bsr-only\b/);
    expect(bar.querySelector("[data-page-title-row] button, [data-page-title-row] a")).not.toBeNull();
    unmount();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PageHeader title="Jobs" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(bar.querySelector("h1")?.className).not.toMatch(/\bsr-only\b/);
    registerDesktopTitleSlot(null);
  });
});
