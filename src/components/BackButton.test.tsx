import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

// react-router is mocked wholesale so each test can dictate the exact history
// shape it is asserting about — a real <MemoryRouter> can't mint the
// "fresh key, no new entry" state that a `<Navigate replace />` redirect
// produces, and that state is the whole point of these tests.
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: {
    current: { key: "default", pathname: "/login", search: "", hash: "", state: null },
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location.current,
}));

import BackButton from "./BackButton";

/** Set the react-router history state jsdom reports, as the real router does. */
const setRouterIndex = (idx: number | null) => {
  window.history.replaceState(idx === null ? null : { usr: null, key: "abc", idx }, "");
};

const clickBack = () => fireEvent.click(screen.getByRole("button", { name: "Go back" }));

describe("BackButton", () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.location.current = { key: "default", pathname: "/login", search: "", hash: "", state: null };
    setRouterIndex(null);
  });

  afterEach(() => {
    cleanup();
    setRouterIndex(null);
  });

  it("goes back in history when there IS an in-app entry behind this one", () => {
    mocks.location.current = { ...mocks.location.current, key: "xyz123" };
    setRouterIndex(2);
    render(<BackButton to="/" />);
    clickBack();
    expect(mocks.navigate).toHaveBeenCalledWith(-1);
  });

  it("cold deep link: falls back to `to` instead of leaving the app", () => {
    // A browser tab opened straight on /login. react-router index 0 = its first
    // entry; navigate(-1) here would walk the user out of the app (or do
    // nothing at all in a fresh tab, which reads as a dead button).
    setRouterIndex(0);
    render(<BackButton to="/" />);
    clickBack();
    expect(mocks.navigate).toHaveBeenCalledWith("/");
    expect(mocks.navigate).not.toHaveBeenCalledWith(-1);
  });

  it("cold deep link THROUGH a replace redirect: still falls back to `to`", () => {
    // The real /login defect: a guest cold-opens /dashboard, ProtectedRoute
    // renders <Navigate to="/login?redirect=/dashboard" replace />. The replace
    // mints a fresh location.key but adds NO history entry, so the old
    // `key !== "default"` test wrongly reported in-app history and Back left
    // the app (observed: about:blank).
    mocks.location.current = {
      key: "1esb5mvi",
      pathname: "/login",
      search: "?redirect=%2Fdashboard",
      hash: "",
      state: null,
    };
    setRouterIndex(0);
    render(<BackButton to="/" />);
    clickBack();
    expect(mocks.navigate).toHaveBeenCalledWith("/");
    expect(mocks.navigate).not.toHaveBeenCalledWith(-1);
  });

  it("cold deep link with no `to`: falls back to the app root", () => {
    setRouterIndex(0);
    render(<BackButton />);
    clickBack();
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("onClick overrides both history-back and `to`", () => {
    const onClick = vi.fn();
    setRouterIndex(3);
    render(<BackButton to="/" onClick={onClick} />);
    clickBack();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("an explicitly undefined onClick (AuthShell's default) does not swallow the click", () => {
    // AuthShell always spreads `onClick={backOnClick}`; every screen except
    // Signup step 2 leaves that undefined.
    setRouterIndex(0);
    render(<BackButton to="/" onClick={undefined} />);
    clickBack();
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  describe("without a browser history index (MemoryRouter / SSR)", () => {
    it("treats the 'default' key as no in-app history", () => {
      render(<BackButton to="/jobs" />);
      clickBack();
      expect(mocks.navigate).toHaveBeenCalledWith("/jobs");
    });

    it("treats a non-default key as in-app history", () => {
      mocks.location.current = { ...mocks.location.current, key: "xyz123" };
      render(<BackButton to="/jobs" />);
      clickBack();
      expect(mocks.navigate).toHaveBeenCalledWith(-1);
    });
  });
});
