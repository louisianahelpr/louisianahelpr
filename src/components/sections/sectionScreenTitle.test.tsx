/**
 * Cowork design audit 2026-10-20, D12. Measured on prod (poster-e2e, 375): the
 * browser tab read "Helpr — Louisiana's Local Job Partner | Hire or Find Work"
 * on /home, /declutter (every tab), a Declutter item, /declutter/sell, /shops
 * and /rentals; only Jobs, Messages and Profile named themselves.
 *
 * The class: the two screen frames every in-app page is built on name the tab
 * themselves (SectionScreen: the section, or Home; AppPage: the page's title),
 * and a page's own, more specific title still wins.
 *
 * @mutate src/components/sections/SectionScreen.tsx |   usePageTitle(`${title ?? "Home"} — Helpr`); |   void title;
 * @mutate src/components/AppPage.tsx |   usePageTitle(`${title} — Helpr`); |   void title;
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("./AppTopBar", () => ({ AppTopBar: ({ title }: { title?: string }) => <h1>{title}</h1> }));
vi.mock("@/components/AppShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/profile/ProfileTabHeader", () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));

import { SectionScreen } from "./SectionScreen";
import AppPage from "@/components/AppPage";
import { usePageTitle } from "@/hooks/usePageTitle";

function OwnTitle() {
  usePageTitle("Oak rocking chair — Helpr");
  return (
    <AppPage title="Item">
      <p>item</p>
    </AppPage>
  );
}

describe("D12: every in-app screen names the browser tab", () => {
  it.each([["Declutter"], ["Shops"], ["Homes"]])("%s", (t) => {
    render(<MemoryRouter><SectionScreen title={t}><p>x</p></SectionScreen></MemoryRouter>);
    expect(document.title).toBe(`${t} — Helpr`);
  });

  it("Home (no title on screen: the logo shows)", () => {
    render(<MemoryRouter><SectionScreen><p>x</p></SectionScreen></MemoryRouter>);
    expect(document.title).toBe("Home — Helpr");
  });

  it("an AppPage screen: its own title", () => {
    render(<MemoryRouter><AppPage title="Sell an item"><p>x</p></AppPage></MemoryRouter>);
    expect(document.title).toBe("Sell an item — Helpr");
  });

  it("a page's own, more specific title wins over the frame's", () => {
    render(<MemoryRouter><OwnTitle /></MemoryRouter>);
    expect(document.title).toBe("Oak rocking chair — Helpr");
  });
});
