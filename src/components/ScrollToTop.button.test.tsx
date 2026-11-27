/**
 * Q1356: the scroll-to-top button lost framer-motion's AnimatePresence. It must
 * still leave the page once hidden: an always-mounted hidden button (scale 0.8,
 * 35px) failed messages-thread.spec.ts's 44px tap-target scan on PR #2841.
 *
 * @mutate src/components/ScrollToTop.tsx | if (!rendered) return null; | if (false) return null;
 * @mutate src/components/ScrollToTop.tsx | setVisible(pos > revealAfter(viewport) && !footerInView() && !onLanding(pathname) && !onHeartList(pathname)); | setVisible(pos > revealAfter(viewport) && !onLanding(pathname) && !onHeartList(pathname));
 * Polish audit 11-27 #6: only after two screens (jsdom's window is 768px tall, so 1536px), and no shadow.
 * @mutate src/components/ScrollToTop.tsx |   return Math.max(REVEAL_AFTER_PX, REVEAL_AFTER_SCREENS * viewport); |   return REVEAL_AFTER_PX;
 * @mutate src/components/ScrollToTop.tsx |         boxShadow: "none", |         boxShadow: "0 8px 18px -6px hsl(var(--olivewood) / 0.16)",
 * @mutate src/components/ScrollToTop.tsx |   return pathname === "/"; |   return false;
 * @mutate src/components/ScrollToTop.tsx |   return pathname === "/gift-guides" \|\| pathname.startsWith("/gift-guides/"); |   return false;
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

import ScrollToTop from "./ScrollToTop";

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

describe("ScrollToTop's button is in the page only while wanted (Q1356)", () => {
  afterEach(() => {
    vi.useRealTimers();
    scrollTo(0);
  });

  it("no button at the top or one screen down, a button past two screens, none again after the fade-out", () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={["/messages"]}>
        <ScrollToTop />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText("Scroll to top")).toBeNull();

    expect(window.innerHeight).toBe(768);
    scrollTo(1500); // past the old 1200px, under two screens: still none
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByLabelText("Scroll to top")).toBeNull();

    scrollTo(1600);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const btn = screen.getByLabelText("Scroll to top");
    expect(btn.getAttribute("aria-hidden")).toBeNull();
    expect(btn.style.boxShadow).toBe("none");

    scrollTo(100);
    expect(screen.getByLabelText("Scroll to top").getAttribute("aria-hidden")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByLabelText("Scroll to top")).toBeNull();
  });

  it("hides while the site footer is on screen, so it never covers the footer's Follow links (owner, 2026-10-20)", () => {
    vi.useFakeTimers();
    const footer = document.createElement("footer");
    document.body.appendChild(footer);
    const top = { value: 2000 };
    footer.getBoundingClientRect = () => ({ top: top.value }) as DOMRect;
    render(
      // Any public page with the footer (the landing itself never shows the button, D019).
      <MemoryRouter initialEntries={["/help"]}>
        <ScrollToTop />
      </MemoryRouter>,
    );
    scrollTo(1600);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByLabelText("Scroll to top").getAttribute("aria-hidden")).toBeNull();

    top.value = 400; // footer scrolled into a 768px-tall window
    scrollTo(2600);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByLabelText("Scroll to top")).toBeNull();
    footer.remove();
  });

  // Owner's UI audit 11-09, F014: on a phone the landing's full-width blocks always sat under the button. D019 (landing
  // design audit 11-10): at 1440 it floated over the money band and the join block, so it is off the landing at every width.
  describe("never on the landing, at any width (F014, D019)", () => {
    const realMatchMedia = window.matchMedia;
    const phone = (isPhone: boolean) => {
      window.matchMedia = ((q: string) => ({
        matches: q === "(max-width: 639px)" ? isPhone : false,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    };
    afterEach(() => {
      window.matchMedia = realMatchMedia;
    });

    it.each([
      ["/", true, false],
      ["/", false, false],
      ["/messages", true, true],
      // Holiday audit 1121 #40 / #78: every gift guides row ends in a heart at the right edge, where the button sat.
      ["/gift-guides/her", true, false],
      ["/gift-guides", false, false],
    ])("%s, phone=%s: button shown = %s", (path, isPhone, shown) => {
      vi.useFakeTimers();
      phone(isPhone);
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <ScrollToTop />
        </MemoryRouter>,
      );
      scrollTo(1600);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(!!screen.queryByLabelText("Scroll to top")).toBe(shown);
      unmount();
    });
  });
});
