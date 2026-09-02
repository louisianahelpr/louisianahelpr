import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ShortLinkRedirect from "./ShortLinkRedirect";

/**
 * The web half of the AASA contract, exercised through a real router.
 *
 * `src/test/aasaRouteParity.test.ts` proves App.tsx REGISTERS these patterns.
 * This proves what happens once one of them matches: the short link resolves to
 * the canonical route with its query and fragment intact, rather than the
 * in-app 404 every one of them used to render on the web.
 */

/** Renders the resolved location so the assertion is on the router, not text. */
function Landed() {
  const { pathname, search, hash } = useLocation();
  return <div data-testid="landed">{`${pathname}${search}${hash}`}</div>;
}

function renderAt(path: string) {
  // Scoped to THIS render's container: RTL's default queries search the whole
  // document.body, so two renders inside one `it` would both match.
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {/* Mirrors the five (six, with /legal/:tab) patterns App.tsx points at
            ShortLinkRedirect. */}
        <Route path="/j/:id" element={<ShortLinkRedirect />} />
        <Route path="/u/:id" element={<ShortLinkRedirect />} />
        <Route path="/m/:id" element={<ShortLinkRedirect />} />
        <Route path="/messages/:id" element={<ShortLinkRedirect />} />
        <Route path="/post-job/*" element={<ShortLinkRedirect />} />
        <Route path="/legal/:tab" element={<ShortLinkRedirect />} />
        {/* Destinations — stand-ins for the real pages. */}
        <Route path="/jobs/:id" element={<Landed />} />
        <Route path="/user/:userId" element={<Landed />} />
        <Route path="/messages" element={<Landed />} />
        <Route path="/post-job" element={<Landed />} />
        <Route path="/legal" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
  return within(view.container).getByTestId("landed").textContent;
}

describe("ShortLinkRedirect", () => {
  it("maps /j/:id to the canonical job route", () => {
    expect(renderAt("/j/abc123")).toBe("/jobs/abc123");
  });

  it("maps /u/:id to the canonical user route", () => {
    expect(renderAt("/u/user-1")).toBe("/user/user-1");
  });

  it("maps both thread forms to /messages?jobId=", () => {
    expect(renderAt("/m/job-1")).toBe("/messages?jobId=job-1");
    expect(renderAt("/messages/job-1")).toBe("/messages?jobId=job-1");
  });

  it("collapses a /post-job sub-path to /post-job", () => {
    expect(renderAt("/post-job/draft/7")).toBe("/post-job");
  });

  it("maps /legal/:tab to /legal?tab=", () => {
    expect(renderAt("/legal/terms")).toBe("/legal?tab=terms");
  });

  it("carries the query string across", () => {
    // A shared job link is `/jobs/{id}?ref=share`; the short form must not drop
    // the attribution on the way through.
    expect(renderAt("/j/abc123?ref=share")).toBe("/jobs/abc123?ref=share");
  });

  it("carries the fragment across", () => {
    // The hash is what c538e318 fixed in normalizeDeepLinkUrl; the web path
    // goes through the same function, so it inherits that fix rather than
    // needing its own.
    expect(renderAt("/legal/terms#cancellations")).toBe("/legal?tab=terms#cancellations");
  });
});
