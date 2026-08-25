// SignedInRedirect is what actually decides whether a visitor sees the
// marketing landing page or gets sent into the app. Three states, and all
// three matter:
//
//   isLoading  → hold a calm surface. NOT a redirect (a signed-in user is
//                briefly `user: null` before the persisted session lands, so
//                deciding early sends exactly the wrong person to the wrong
//                place), and NOT the page either (that is the marketing flash
//                this whole change exists to remove).
//   user       → redirect into the app.
//   no user    → render the page, untouched.
//
// There is no test account to sign in with, so the auth hook is mocked and the
// three states are exercised directly.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import SignedInRedirect from "./SignedInRedirect";

const useCurrentUserMock = vi.fn();
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => useCurrentUserMock(),
}));

const LANDING = "Louisiana's Local Job Partner.";

const renderAt = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <SignedInRedirect to="/dashboard">
              <h1>{LANDING}</h1>
            </SignedInRedirect>
          }
        />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  useCurrentUserMock.mockReset();
});

describe("SignedInRedirect", () => {
  it("redirects a signed-in visitor to the app", () => {
    useCurrentUserMock.mockReturnValue({ user: { id: "u1" }, isLoading: false });
    renderAt();
    expect(screen.getByText("DASHBOARD")).toBeInTheDocument();
    expect(screen.queryByText(LANDING)).not.toBeInTheDocument();
  });

  it("renders the page for a signed-out visitor", () => {
    useCurrentUserMock.mockReturnValue({ user: null, isLoading: false });
    renderAt();
    expect(screen.getByText(LANDING)).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD")).not.toBeInTheDocument();
  });

  it("holds the calm placeholder while auth is still resolving — no redirect, no page", () => {
    useCurrentUserMock.mockReturnValue({ user: null, isLoading: true });
    const { container } = renderAt();
    expect(container.querySelector(".min-h-screen.bg-premium-page")).not.toBeNull();
    expect(screen.queryByText("DASHBOARD")).not.toBeInTheDocument();
    expect(screen.queryByText(LANDING)).not.toBeInTheDocument();
  });

  it("still holds when a user is already known but the profile is in flight", () => {
    // useCurrentUser reports isLoading until the profile query settles, so this
    // combination is real. The guard must win over the truthy user — the point
    // is that nothing is decided until auth has actually resolved.
    useCurrentUserMock.mockReturnValue({ user: { id: "u1" }, isLoading: true });
    const { container } = renderAt();
    expect(container.querySelector(".min-h-screen.bg-premium-page")).not.toBeNull();
    expect(screen.queryByText("DASHBOARD")).not.toBeInTheDocument();
  });

  it("redirects to whatever destination it is given", () => {
    useCurrentUserMock.mockReturnValue({ user: { id: "u1" }, isLoading: false });
    render(
      <MemoryRouter initialEntries={["/promo"]}>
        <Routes>
          <Route
            path="/promo"
            element={<SignedInRedirect to="/dashboard"><h1>{LANDING}</h1></SignedInRedirect>}
          />
          <Route path="/dashboard" element={<div>DASHBOARD</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("DASHBOARD")).toBeInTheDocument();
  });
});
