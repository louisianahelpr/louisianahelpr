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
    render(
      <MemoryRouter>
        <PageTitleBar title="Jobs" phone={<span />} />
        <div data-testid="overlay">
          <PageTitleBar title="Applicants" back={{ onBack: () => {} }} phone={<span />} />
        </div>
      </MemoryRouter>,
    );
    const titles = Array.from(bar.querySelectorAll("h1")).map((h) => h.textContent);
    expect(titles).toEqual(["Jobs"]);
    const overlay = screen.getByTestId("overlay");
    expect(overlay.querySelector("h1")?.textContent).toBe("Applicants");
    expect(overlay.querySelector("[data-page-title-nested]")).not.toBeNull();
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
