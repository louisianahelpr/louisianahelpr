/**
 * Audit 11-10 F402: a signed-out member who taps an order, offer or order-talk link (from an email or text) saw the
 * public Browse grid with only "Sign up to buy, make offers or sell."; nothing said the order was waiting behind a log
 * in. The join card now reads the link: "Log in to see your order" (offer: "your offer"; tab=selling: "your sales"),
 * Log in is the filled button and keeps ?redirect= to the same link, and "New here?" leads the Sign up link. A plain
 * Browse visit keeps the old line.
 *
 * @mutate src/components/declutter/DeclutterGuest.tsx |   const want = guestWants(location.search); |   const want = null;
 * @mutate src/components/declutter/DeclutterGuest.tsx |   if (q.has("offer")) return "your offer"; |   if (q.has("offer")) return "your order";
 * @mutate src/components/declutter/DeclutterGuest.tsx |   if (q.get("tab") === "selling") return "your sales"; |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

import { DeclutterGuestBrowseJoin } from "./DeclutterGuest";

afterEach(cleanup);

function show(url: string) {
  render(<MemoryRouter initialEntries={[url]}><DeclutterGuestBrowseJoin /></MemoryRouter>);
}

describe("F402: a guest's order link says the order is behind a log in", () => {
  it("?tab=buying&order=: 'Log in to see your order', Log in keeps the link, 'New here?' Sign up", () => {
    show("/declutter?tab=buying&order=o1");
    expect(screen.getByText("Log in to see your order")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?redirect=" + encodeURIComponent("/declutter?tab=buying&order=o1"));
    expect(screen.getByText("New here?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up" })).toBeInTheDocument();
    expect(screen.queryByText("Sign up to buy, make offers or sell.")).toBeNull();
  });

  it("?offer= says your offer; ?order_talk= says your order; ?tab=selling says your sales", () => {
    show("/declutter?offer=f1");
    expect(screen.getByText("Log in to see your offer")).toBeInTheDocument();
    cleanup();
    show("/declutter?tab=buying&order_talk=o1");
    expect(screen.getByText("Log in to see your order")).toBeInTheDocument();
    cleanup();
    show("/declutter?tab=selling");
    expect(screen.getByText("Log in to see your sales")).toBeInTheDocument();
  });

  it("plain Browse keeps the join line", () => {
    show("/declutter");
    expect(screen.getByText("Sign up to buy, make offers or sell.")).toBeInTheDocument();
    expect(screen.queryByText(/Log in to see/)).toBeNull();
  });
});
