/**
 * AUD31-64: "Quotes for your job" was cut to "Quotes for you..." at 375 and
 * "Quotes for yo..." at 360 (owner rule: no cut-off words at 360/375). AppPage
 * now forwards PageHeader's `wrapTitle`, and the quote request page passes it:
 * the phone title wraps onto a second line instead of ending in "...".
 *
 * @mutate src/pages/quotes/QuoteRequestPage.tsx |       <AppPage title={TITLE} backTo={QUOTE_HOMES.myRequests} wrapTitle> |       <AppPage title={TITLE} backTo={QUOTE_HOMES.myRequests}>
 * @mutate src/components/AppPage.tsx | phoneHidesTitle={phoneHidesTitle} sticky={stickyHeader} wrapTitle={wrapTitle} /> | phoneHidesTitle={phoneHidesTitle} sticky={stickyHeader} />
 * @mutate src/components/profile/ProfileTabHeader.tsx |         wrapTitle={wrapTitle}\n |
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, isLoading: false }) }));
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { blankComments } from "./helpers/blankNonCode";

afterEach(cleanup);

const titleClasses = (wrap: boolean) => {
  render(
    <MemoryRouter>
      <ProfileTabHeader title="Quotes for your job" backTo="/quotes" wrapTitle={wrap} />
    </MemoryRouter>,
  );
  const h1 = screen.getByRole("heading", { level: 1, name: "Quotes for your job" });
  return (h1.getAttribute("class") ?? "").split(/\s+/);
};

describe("the quote request page's title wraps, never cut (AUD31-64)", () => {
  it("the title header's wrapTitle reaches the phone h1", () => {
    const wrapped = titleClasses(true);
    expect(wrapped).toContain("break-words");
    expect(wrapped).not.toContain("truncate");
    cleanup();
    // Floor: without it the title is the one-line truncated kind.
    expect(titleClasses(false)).toContain("truncate");
  });

  it("AppPage forwards it and the quote request page passes it", () => {
    const appPage = blankComments(readFileSync(resolve(__dirname, "../..", "src/components/AppPage.tsx"), "utf8"));
    expect(appPage).toMatch(/<ProfileTabHeader [^>]*\bwrapTitle=\{wrapTitle\}[^>]*\/>/);
    const src = blankComments(readFileSync(resolve(__dirname, "../..", "src/pages/quotes/QuoteRequestPage.tsx"), "utf8"));
    expect(src).toMatch(/<AppPage title=\{TITLE\}[^>]*\bwrapTitle\b[^>]*>/);
  });
});
