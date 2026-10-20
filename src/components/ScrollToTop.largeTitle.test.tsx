/**
 * Cowork design audit 2026-10-20, D4 (reproduced on prod, poster-e2e, 375:
 * ~/.lh-shots/audit-musts-1020/before-d4-item-375-light.png): scroll Declutter
 * Browse past 56px, tap an item, and the item page opened under Browse's
 * "Declutter" compact title bar, which covered its back, share and heart
 * buttons. Every scroller on the new page was at 0 (measured), but the large-
 * title state (installLargeTitles: html.page-scrolled and the fixed
 * .compact-title-bar.on) only changes on a scroll event, and the new page's
 * scroller never fires one.
 *
 * The class: whatever page you arrive on by a new navigation starts with its
 * title large and every page scroller (AppShell's and AppPage/SectionScreen's
 * own column) at the top.
 *
 * @mutate src/components/ScrollToTop.tsx |     if (!samePathname) resetLargeTitles(); |     if (!samePathname) void 0;
 * @mutate src/components/ScrollToTop.tsx |     document.querySelectorAll<HTMLElement>(".app-shell-scroll, [data-app-page-scroll]").forEach((el) => { |     document.querySelectorAll<HTMLElement>(".app-shell-scroll").forEach((el) => {
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, Outlet } from "react-router-dom";

vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));

import ScrollToTop from "./ScrollToTop";
import { installLargeTitles } from "@/lib/largeTitles";

function Layout() {
  return (
    <>
      <ScrollToTop />
      <Outlet />
    </>
  );
}

/** A page with AppPage's scroll column, like Browse and the item page. */
function Page({ title }: { title: string }) {
  return (
    <div data-app-page-scroll="" data-testid={`scroll-${title}`}>
      <h1 className="text-page-title">{title}</h1>
    </div>
  );
}

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
});

describe("D4: a new page opens at the top with its title large", () => {
  it("Browse scrolled past the large-title threshold, then an item: no stale compact bar, page-scrolled off, the item's own column at 0", async () => {
    uninstall = installLargeTitles(document);
    const router = createMemoryRouter(
      [{ path: "/", element: <Layout />, children: [
        { path: "declutter", element: <Page title="Declutter" /> },
        { path: "declutter/item/:id", element: <Page title="Oak chair" /> },
      ] }],
      { initialEntries: ["/declutter"] },
    );
    const { getByTestId } = render(<RouterProvider router={router} />);
    const browse = getByTestId("scroll-Declutter");
    // jsdom has no layout: give the column a scroll range, scroll it, fire the event.
    Object.defineProperty(browse, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(browse, "clientHeight", { configurable: true, value: 700 });
    browse.scrollTop = 618; // measured on prod before tapping an item
    browse.dispatchEvent(new Event("scroll"));
    const bar = document.querySelector(".compact-title-bar");
    expect(bar?.classList.contains("on")).toBe(true);
    expect(bar?.textContent).toBe("Declutter");
    expect(document.documentElement.classList.contains("page-scrolled")).toBe(true);

    await act(async () => {
      await router.navigate("/declutter/item/1");
    });
    const item = getByTestId("scroll-Oak chair");
    expect(item.scrollTop).toBe(0);
    expect(document.querySelector(".compact-title-bar")?.classList.contains("on")).toBe(false);
    expect(document.documentElement.classList.contains("page-scrolled")).toBe(false);
  });

  it("a page column that is mounted and scrolled is put back at the top on a new navigation", async () => {
    const router = createMemoryRouter(
      [{ path: "/", element: <><Layout /><div data-app-page-scroll="" data-testid="persistent" /></>, children: [
        { path: "a", element: <p>a</p> },
        { path: "b", element: <p>b</p> },
      ] }],
      { initialEntries: ["/a"] },
    );
    const { getByTestId } = render(<RouterProvider router={router} />);
    const col = getByTestId("persistent");
    col.scrollTop = 400;
    await act(async () => {
      await router.navigate("/b");
    });
    expect(col.scrollTop).toBe(0);
  });
});
