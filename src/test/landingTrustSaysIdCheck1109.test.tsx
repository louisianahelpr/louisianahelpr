/**
 * L010 (landing audit 11-09): the landing's trust card told every signed-out visitor "Real accounts: every account
 * confirms its email", and the sections block "One account works in every section", because both read the member's
 * own identity_check answer, which is false signed out, while ID checks are on for everyone (prod, 11-09). The real
 * protection is the ID check. Both now read the switch for THIS viewer (useIdCheckOnForViewer): a guest reads whether
 * identity_check is open to everyone.
 *
 * @mutate src/components/landing/SectionsShowcase.tsx |   const idOn = useIdCheckOnForViewer(joinSeen); |   const idOn = false;
 * @mutate src/components/landing/SectionsShowcase.tsx |   const idOn = useIdCheckOnForViewer(seen); |   const idOn = false;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ open: null as ReadonlySet<string> | null }));
vi.mock("@/components/landing/useSectionsOpen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/useSectionsOpen")>();
  return { ...real, useSectionsOpen: () => ({ open: state.open, settled: state.open !== null, failed: false }) };
});
vi.mock("@/lib/routePrefetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/routePrefetch")>();
  return { ...real, whenPageSettled: () => () => {} };
});
vi.mock("@/lib/socialAuth", () => ({ SOCIAL_SIGN_IN_ENABLED: false, signInWithProvider: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));

import { SectionsShowcase, TrustAndJoin } from "@/components/landing/SectionsShowcase";

afterEach(() => {
  cleanup();
  state.open = null;
});

describe("L010: the landing tells a guest about the ID check while it is on for everyone", () => {
  it("open to everyone: the trust card says ID-verified people, never just email", () => {
    state.open = new Set(["identity_check", "declutter"]);
    render(<MemoryRouter><TrustAndJoin /></MemoryRouter>);
    expect(screen.getByText("ID-verified people")).toBeTruthy();
    expect(screen.queryByText("Real accounts")).toBeNull();
  });

  it("open to everyone: the sections block says one ID check counts everywhere", () => {
    state.open = new Set(["identity_check", "declutter"]);
    render(<MemoryRouter><SectionsShowcase /></MemoryRouter>);
    expect(screen.getByText("Verify your ID once and it counts everywhere on Helpr.")).toBeTruthy();
  });

  it("not open to everyone: no ID claim", () => {
    state.open = new Set(["declutter"]);
    render(<MemoryRouter><TrustAndJoin /></MemoryRouter>);
    expect(screen.getByText("Real accounts")).toBeTruthy();
    expect(screen.queryByText("ID-verified people")).toBeNull();
  });
});
