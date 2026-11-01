/**
 * JA-14 (Jobs audit 2026-11-01; lead 11-01, B107): on the job page a 7-word title wrapped to 3 lines of ~30px heading
 * in the top bar at 375. B105 clamped it to two lines with "...", which hid the end of the title (it was printed
 * nowhere else). The lead's rule: the FULL title always shows; a long one is set smaller on a phone instead.
 * The job page's bar is AppPage -> ProfileTabHeader -> PageHeader with `wrapTitle` on.
 *
 * @mutate src/components/PageHeader.tsx | title.length > LONG_TITLE_CHARS ? " page-title-long" : "" | ""
 * @mutate src/index.css |   h1.text-page-title.page-title-long { font-size: 1.25rem !important; line-height: 1.2 !important; } |   h1.text-page-title.page-title-long { line-height: 1.2 !important; }
 * @mutate src/components/PageHeader.tsx | `break-words${ | `break-words line-clamp-2${
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { blankCssComments } from "@/test/helpers/blankNonCode";

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const longTitle = "Haul off an old couch and two chairs from the garage";

describe("JA-14: a long page title shows in full, smaller on a phone", () => {
  it("the job page's bar title is never clamped or truncated, and a long one gets the phone size", () => {
    wrap(<ProfileTabHeader title={longTitle} backTo="/posts" rightSlot={<button type="button">Share</button>} />);
    const h1 = screen.getByRole("heading", { level: 1, name: longTitle });
    const cls = h1.className.split(/\s+/);
    expect(cls).not.toContain("line-clamp-2");
    expect(cls.some((c) => /^line-clamp-/.test(c))).toBe(false);
    expect(cls).not.toContain("truncate");
    expect(cls).toContain("page-title-long");
    expect(h1.textContent).toBe(longTitle);
  });

  it("a short title keeps the full size", () => {
    wrap(<ProfileTabHeader title="Declutter settings" backTo="/profile" />);
    expect(screen.getByRole("heading", { level: 1 }).className).not.toMatch(/page-title-long/);
  });

  it("index.css sets the long title smaller than the page title on a phone", () => {
    const css = blankCssComments(readFileSync("src/index.css", "utf8"));
    const rules = [...css.matchAll(/@media \(max-width: 639px\) \{([^@]*?h1\.text-page-title\.page-title-long[^}]*\})/g)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThan(0);
    const size = /font-size:\s*([\d.]+)rem\s*!important/.exec(rules.join("\n"));
    expect(size).not.toBeNull();
    // The page title on a scroll page is 1.75rem (index.css); the long one must be smaller.
    expect(Number(size![1])).toBeLessThan(1.75);
  });
});
