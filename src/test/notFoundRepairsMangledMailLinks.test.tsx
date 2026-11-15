/**
 * error_logs 2026-11-15 18:26Z: "404 — non-existent route: /sponsor&source=gmail&ust=1794853458143000&sa=E". A Gmail
 * google.com/url?q=... wrapper decoded badly and glued its own parameters onto the sponsor link's path; other clients
 * leave the link's "?" encoded (/sponsor%3Fref%3Dberkana-crystal). Sentry JAVASCRIPT-5J ("/sponsor.") is the trailing
 * punctuation half, covered by notFoundDropsTrailingPunctuation.test.tsx. Any path that is a real path plus email
 * junk now opens the real path, keeps the sponsor ref code when the junk carries one, and reports nothing.
 *
 * @mutate src/pages/info/NotFound.tsx |   const cut = pathname.search(/&\|%3f\|%26/iu); |   const cut = pathname.search(/&/u);
 * @mutate src/pages/info/NotFound.tsx |   const cut = pathname.search(/&\|%3f\|%26/iu); |   const cut = -1;
 * @mutate src/pages/info/NotFound.tsx |   if (ref && !params.has("ref")) params.set("ref", ref); |   if (false) params.set("ref", ref);
 * @mutate src/pages/info/NotFound.tsx |     decoded = decodeURIComponent(junk); |     decoded = junk;
 * @mutate src/pages/info/NotFound.tsx |   const clean = withoutTrailingPunctuation(head) ?? (head \|\| "/"); |   const clean = head \|\| "/";
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const report = vi.fn();
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));

import NotFound, { mangledLinkTarget } from "@/pages/info/NotFound";

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

const target = (p: string, q = "") => {
  const t = mangledLinkTarget(p, q);
  return t && t.pathname + t.search;
};

beforeEach(() => report.mockReset());

describe("a sponsor link mangled by a mail client opens /sponsor", () => {
  it("cuts the junk and keeps the ref code", () => {
    // The logged path, verbatim.
    expect(target("/sponsor&source=gmail&ust=1794853458143000&sa=E")).toBe("/sponsor");
    expect(target("/sponsor%3Fref%3Dberkana-crystal")).toBe("/sponsor?ref=berkana-crystal");
    expect(target("/sponsor%3fref%3Dberkana-crystal&source=gmail")).toBe("/sponsor?ref=berkana-crystal");
    expect(target("/sponsor&ref=berkana-crystal&sa=E")).toBe("/sponsor?ref=berkana-crystal");
    expect(target("/sponsor%26ref%3Dberkana-crystal.")).toBe("/sponsor?ref=berkana-crystal");
    expect(target("/sponsor.&source=gmail")).toBe("/sponsor");
    expect(target("/sponsor),")).toBe("/sponsor");
    // Undecodable junk does not throw; a plain ref= in it is still read.
    expect(target("/sponsor&ref=berkana-crystal%E0%A4%A")).toBe("/sponsor?ref=berkana-crystal");
    // A ref already in the real query wins over one in the junk.
    expect(target("/sponsor&ref=other", "?ref=berkana-crystal")).toBe("/sponsor?ref=berkana-crystal");
    // "pref=" is not "ref=".
    expect(target("/sponsor&pref=x")).toBe("/sponsor");
    // Clean paths are left alone (floor: the normaliser does not touch them).
    expect(mangledLinkTarget("/sponsor", "?ref=a")).toBeNull();
    expect(mangledLinkTarget("/nope", "")).toBeNull();
  });

  it("the logged Gmail path opens /sponsor and reports nothing", async () => {
    render(app("/sponsor&source=gmail&ust=1794853458143000&sa=E"));
    expect((await screen.findByTestId("where")).textContent).toBe("/sponsor");
    expect(report).not.toHaveBeenCalled();
  });

  it("an encoded ?ref= link opens /sponsor?ref=<code> and reports nothing", async () => {
    render(app("/sponsor%3Fref%3Dberkana-crystal&source=gmail#top"));
    expect((await screen.findByTestId("where")).textContent).toBe("/sponsor?ref=berkana-crystal#top");
    expect(report).not.toHaveBeenCalled();
  });

  it("an unknown path with junk still reports its clean path once", async () => {
    render(app("/nope&source=gmail"));
    expect(await screen.findByTestId("not-found")).toBeTruthy();
    expect(report.mock.calls.map((c) => (c[0] as Error).message)).toEqual(["404 — non-existent route: /nope"]);
  });
});
