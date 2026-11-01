/**
 * JA-14 (Jobs audit 2026-11-01): on the job page a 7-word title wrapped to 3 lines of ~30px heading in the top bar
 * at 375 (4 lines on Posted, where the share icon narrows it), pushing the whole page down. The job page's bar is
 * AppPage -> ProfileTabHeader -> PageHeader with `wrapTitle` on; a wrapping title now stops at two lines, and the
 * whole title stays readable (tooltip and accessible name).
 *
 * @mutate src/components/PageHeader.tsx | wrapTitle ? "break-words line-clamp-2" : "truncate" | wrapTitle ? "break-words" : "truncate"
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const longTitle = "Haul off an old couch and two chairs from the garage";

describe("JA-14: a wrapping page title stops at two lines", () => {
  it("the job page's bar title is clamped to two lines and keeps the whole title", () => {
    wrap(<ProfileTabHeader title={longTitle} backTo="/posts" rightSlot={<button type="button">Share</button>} />);
    const h1 = screen.getByRole("heading", { level: 1, name: longTitle });
    expect(h1.className.split(/\s+/)).toContain("line-clamp-2");
    expect(h1.className).not.toMatch(/\btruncate\b/);
    expect(h1.getAttribute("title")).toBe(longTitle);
  });
});
