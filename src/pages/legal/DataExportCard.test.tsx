/**
 * The "Download your data" card chooses between the export button and a sign-in
 * link. It used to choose from `user` alone — and `user` is null for everyone
 * until the auth snapshot settles, so a signed-in reader whose session was still
 * restoring was told "Sign In to Download". The choice now waits for `isReady`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const auth = vi.hoisted(() => ({
  state: { user: null as { id: string } | null, isReady: false },
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth.state }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { DataExportCard } from "./DataExportCard";

const renderCard = () =>
  render(
    <MemoryRouter>
      <DataExportCard />
    </MemoryRouter>,
  );

beforeEach(() => {
  auth.state = { user: null, isReady: false };
});

describe("DataExportCard waits for auth before choosing its control", () => {
  it("while auth is restoring: no Sign In link, a disabled neutral button", () => {
    auth.state = { user: null, isReady: false };
    renderCard();
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
    expect(screen.queryByText(/sign in to download/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Download My Data" })).toBeDisabled();
  });

  it("signed out once ready: the Sign In link, returning through /data-rights", () => {
    auth.state = { user: null, isReady: true };
    renderCard();
    const link = screen.getByRole("link", { name: "Sign In to Download" });
    expect(link).toHaveAttribute("href", `/login?redirect=${encodeURIComponent("/data-rights")}`);
  });

  it("signed in once ready: the enabled export button", () => {
    auth.state = { user: { id: "user-1" }, isReady: true };
    renderCard();
    expect(screen.getByRole("button", { name: "Download My Data" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  });
});
