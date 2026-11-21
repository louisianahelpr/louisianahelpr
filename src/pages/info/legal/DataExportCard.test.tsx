/**
 * The "Download your data" card chooses between the export button and a sign-in
 * link. It used to choose from `user` alone — and `user` is null for everyone
 * until the auth snapshot settles, so a signed-in reader whose session was still
 * restoring was told "Sign In to Download". The choice now waits for `isReady`.
 * Owner 11-21: signed out, the card is not drawn at all ("only show it for signed in users").
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
    expect(screen.getByRole("button", { name: "Download my data" })).toBeDisabled();
  });

  it("signed out once ready: no card at all (owner 11-21), only the GDPR/CCPA line, which keeps the anchor", () => {
    auth.state = { user: null, isReady: true };
    const { container } = renderCard();
    // @mutate src/pages/info/legal/DataExportCard.tsx |   const signedOut = isReady && !userId; |   const signedOut = false;
    // @mutate src/pages/info/legal/DataExportCard.tsx |       {!signedOut && <div | {true && <div
    expect(screen.queryByRole("heading", { name: "Download your data" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("[data-data-export-card]")).toBeNull();
    expect(screen.getByText(/Under the EU GDPR and California CCPA/)).toBeInTheDocument();
    expect(container.querySelector("#download-your-data")).not.toBeNull();
  });

  it("signed in once ready: the enabled export button", () => {
    auth.state = { user: { id: "user-1" }, isReady: true };
    renderCard();
    expect(screen.getByRole("button", { name: "Download my data" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
    // L030 (landing audit 11-09): plain words, never "JSON file".
    // @mutate src/pages/info/legal/DataExportCard.tsx |             One file |             JSON file
    expect(document.body.textContent).not.toMatch(/JSON/);
    expect(screen.getByText("One file")).toBeInTheDocument();
  });
});

// Decide from `user` alone again: a signed-in reader whose session is still
// restoring is told "Sign In to Download".
// @mutate src/pages/info/legal/DataExportCard.tsx | {!isReady ? ( | {false ? (
