/**
 * Deep audit 11-22 #13 (Medium): toasts squeezed into a thin column or sat on the main button.
 *
 *  1. On a phone a toast with an action ("Describe it" error with Retry) drew its words in an ~80px column, 10 lines
 *     tall, beside a 32px button. The ONE toaster (ui/sonner.tsx) now wraps under 768px: words + X on the first line,
 *     the action on its own full-width, 44px row.
 *  2. A signed-out visitor has no dock (--bottom-nav-h is 0), so "Link copied" sat on the item page's sticky Make offer
 *     / Buy now bar. Every phone StickyActionBar publishes its height (--sticky-action-h) and every toast offset clears
 *     whichever is taller, the dock or the bar.
 *
 * CLASS: the toaster is the one toast surface (toastCopy / sonner alias), and StickyActionBar is the one sticky bottom
 * bar primitive, so pinning both covers every toast and every sticky action bar.
 *
 * @mutate src/components/ui/sonner.tsx |             "max-md:!flex-wrap group toast !rounded-2xl | "group toast !rounded-2xl
 * @mutate src/components/ui/sonner.tsx | max-md:!basis-full max-md:!w-full | max-md:!w-auto
 * @mutate src/components/ui/sonner.tsx | max-md:!h-11 max-md:!min-h-[44px] | max-md:!h-8
 * @mutate src/components/ui/sonner.tsx | 0px) + var(--bottom-nav-h, 96px), var(${STICKY_ACTION_H_VAR}, 0px)) + 12px)`; | 0px) + var(--bottom-nav-h, 96px), 0px) + 12px)`;
 * @mutate src/components/ui/StickyActionBar.tsx |           ref={setFixedBar}\n |
 * @mutate src/components/ui/stickyActionHeight.ts |   if (tallest > 0) style.setProperty | if (false) style.setProperty
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { STICKY_ACTION_H_VAR } from "@/components/ui/stickyActionHeight";

const src = (rel: string) => blankComments(readFileSync(join(process.cwd(), rel), "utf8"));

describe("toasts never squeeze into a column or cover a sticky bar (deep audit 11-22 #13)", () => {
  const sonner = src("src/components/ui/sonner.tsx");

  it("reads the real toaster (not vacuous)", () => {
    expect(sonner).toMatch(/<Sonner\b/);
    expect(sonner.length).toBeGreaterThan(2000);
  });

  it("on a phone the toast wraps and the action gets its own full-width 44px row under the words", () => {
    expect(sonner).toMatch(/toast:\s*"max-md:!flex-wrap /);
    const action = sonner.match(/const TOAST_PHONE_ACTION = "([^"]+)"/)?.[1] ?? "";
    for (const c of ["max-md:!order-5", "max-md:!basis-full", "max-md:!w-full", "max-md:!h-11", "max-md:!min-h-[44px]"]) {
      expect(action).toContain(c);
    }
    expect(sonner).toMatch(/actionButton:[\s\S]*?TOAST_PHONE_ACTION,/);
    // The words take the first row's room; the X stays on the first row after them.
    expect(sonner).toContain('content: "max-md:!order-2 max-md:!flex-1 max-md:!min-w-0"');
    expect(sonner).toMatch(/closeButton:\s*"max-md:!order-3 /);
  });

  it("every toast offset clears the taller of the dock and the sticky bar", () => {
    const phone = sonner.match(/const TOAST_PHONE_BOTTOM = `([^`]+)`/)?.[1] ?? "";
    const tablet = sonner.match(/const TOAST_TABLET_BOTTOM = `([^`]+)`/)?.[1] ?? "";
    for (const v of [phone, tablet]) expect(v).toMatch(/^calc\(max\(var\(--safe-area-bottom, 0px\) \+ var\(--bottom-nav-h, 96px\), var\(\$\{STICKY_ACTION_H_VAR\}, 0px\)\) \+ 1[26]px\)$/);
    expect(sonner).toMatch(/mobileOffset=\{\{[\s\S]*?bottom: TOAST_PHONE_BOTTOM,/);
    expect(sonner).toContain("bottom: navShown ? TOAST_TABLET_BOTTOM : `calc(var(${STICKY_ACTION_H_VAR}, 0px) + 24px)`");
  });

  describe("a phone StickyActionBar publishes its height for the toaster", () => {
    beforeEach(() => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 639px"), media: q, addEventListener() {}, removeEventListener() {} }));
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 81, width: 375, top: 731, bottom: 812, left: 0, right: 375, x: 0, y: 731, toJSON() {} } as DOMRect);
    });
    afterEach(() => {
      cleanup();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("sets --sticky-action-h while the fixed bar shows and removes it after", () => {
      const view = render(<StickyActionBar label="Buy or make an offer"><button type="button">Buy now</button></StickyActionBar>);
      expect(document.querySelector('[data-sticky-action-bar="fixed"]')).not.toBeNull();
      expect(document.documentElement.style.getPropertyValue(STICKY_ACTION_H_VAR)).toBe("81px");
      view.unmount();
      expect(document.documentElement.style.getPropertyValue(STICKY_ACTION_H_VAR)).toBe("");
    });

    it("an inactive bar publishes nothing", () => {
      render(<StickyActionBar label="Buy" active={false}><button type="button">Buy now</button></StickyActionBar>);
      expect(document.documentElement.style.getPropertyValue(STICKY_ACTION_H_VAR)).toBe("");
    });
  });
});
