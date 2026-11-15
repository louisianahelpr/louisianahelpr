/**
 * Q2801 (Sentry JAVASCRIPT-5J, 2026-11-13 04:07Z): "Error: 404 — non-existent route: /sponsor." The event's url was
 * https://www.louisianahelpr.com/sponsor. — the real /sponsor page with a sentence's full stop on the end, opened by a
 * Mac Chrome in Boydton, VA (a link scanner's datacenter). A real page plus trailing punctuation now goes to the real
 * page and reports nothing; an unknown path still renders the 404 and reports it.
 *
 * @mutate src/pages/info/NotFound.tsx |   const clean = pathname.replace(/[.,;:!)\]'"’”]+$/u, ""); |   const clean = pathname;
 * @mutate src/pages/info/NotFound.tsx |     if (punctuationFree !== null) { |     if (false) {
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const report = vi.fn();
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));

import NotFound, { withoutTrailingPunctuation } from "@/pages/info/NotFound";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search + l.hash}</p>;
}

const app = (entry: string) => (
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/sponsor" element={<Where />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => report.mockReset());

describe("a link with a sentence's punctuation on the end (Q2801)", () => {
  it("drops only trailing punctuation", () => {
    expect(withoutTrailingPunctuation("/sponsor.")).toBe("/sponsor");
    expect(withoutTrailingPunctuation("/sponsor),")).toBe("/sponsor");
    expect(withoutTrailingPunctuation("/jobs/abc”")).toBe("/jobs/abc");
    expect(withoutTrailingPunctuation("/.")).toBe("/");
    expect(withoutTrailingPunctuation("/sponsor")).toBeNull();
    expect(withoutTrailingPunctuation("/v1.2/page")).toBeNull();
  });

  it("/sponsor. opens /sponsor, keeps the query, and reports nothing", async () => {
    render(app("/sponsor.?ref=mail#rules"));
    expect((await screen.findByTestId("where")).textContent).toBe("/sponsor?ref=mail#rules");
    expect(report).not.toHaveBeenCalled();
  });

  it("an unknown path still shows the 404 and reports it (floor)", async () => {
    render(app("/nope"));
    expect(await screen.findByTestId("not-found")).toBeTruthy();
    expect(report).toHaveBeenCalledTimes(1);
    expect(String((report.mock.calls[0][0] as Error).message)).toBe("404 — non-existent route: /nope");
  });

  it("an unknown path with a full stop reports the clean path once", async () => {
    render(app("/nope."));
    expect(await screen.findByTestId("not-found")).toBeTruthy();
    expect(report.mock.calls.map((c) => (c[0] as Error).message)).toEqual(["404 — non-existent route: /nope"]);
  });
});
