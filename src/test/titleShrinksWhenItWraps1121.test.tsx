/**
 * Jobs audit 11-21 (L23): "Saved Helprs" and "Host automation" wrapped to two lines at the large title size at 375
 * (beside search and Help), though shorter than LONG_TITLE_CHARS. PageHeader measures a wrapping title: more than one
 * line at the large size sets `page-title-wraps`, which index.css sets at the long-title size on a phone.
 *
 * @mutate src/components/header/useTitleShrinksWhenItWraps.ts |       el.classList.toggle(TITLE_WRAPS_CLASS, wraps); |       void wraps;
 * @mutate src/components/PageHeader.tsx | <h1 ref={titleRef} className= | <h1 className=
 * @mutate src/index.css |   [data-app-page-scroll] h1.text-page-title.page-title-wraps,\n |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { blankCssComments } from "@/test/helpers/blankNonCode";

/** jsdom has no layout: the title's box is `lines` lines of 31px. */
function layout(lines: number) {
  const real = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, p) => {
    const st = real(el, p);
    return el instanceof HTMLHeadingElement ? ({ ...st, lineHeight: "31px" } as CSSStyleDeclaration) : st;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const h = this instanceof HTMLHeadingElement ? 31 * lines : 0;
    return { x: 0, y: 0, width: 183, height: h, top: 0, left: 0, right: 183, bottom: h, toJSON: () => ({}) } as DOMRect;
  });
}
const page = (title: string) =>
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProfileTabHeader title={title} backTo="/profile" /></MemoryRouter></QueryClientProvider>);

afterEach(() => vi.restoreAllMocks());

describe("a page title that wraps at the large size is set at the long-title size (L23)", () => {
  it("two lines at the large size: page-title-wraps", () => {
    layout(2);
    page("Saved Helprs");
    expect(screen.getByRole("heading", { level: 1 }).className.split(/\s+/)).toContain("page-title-wraps");
  });

  it("one line: the full size stays", () => {
    layout(1);
    page("Saved Helprs");
    expect(screen.getByRole("heading", { level: 1 }).className.split(/\s+/)).not.toContain("page-title-wraps");
  });

  it("index.css sets page-title-wraps at the long-title size, phones only, in both selectors", () => {
    const css = blankCssComments(readFileSync("src/index.css", "utf8"));
    const block = /@media \(max-width: 639px\) \{([^@]*?page-title-wraps[^}]*\})/.exec(css)?.[1] ?? "";
    const selectors = block.match(/h1\.text-page-title\.page-title-(long|wraps)/g) ?? [];
    expect(selectors.length).toBeGreaterThan(3);
    expect(block).toMatch(/\[data-app-page-scroll\] h1\.text-page-title\.page-title-wraps,/);
    expect(block).toMatch(/font-size:\s*1\.25rem\s*!important/);
  });
});
