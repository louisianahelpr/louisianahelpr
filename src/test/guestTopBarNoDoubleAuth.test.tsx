/**
 * Design audit 11-17 #1 (High): a guest on /declutter at 390 saw three Log in / Join free sets in the first 330 px:
 * the public header's, AppTopBar's guest pair under it, and the "Sign up to buy" card's. Under the public frame
 * (useGuestPublicFrame) AppTopBar now draws no guest pair; the native app and AppShell pages keep it.
 *
 * @mutate src/components/sections/AppTopBar.tsx | !isWebDesktop && !publicFrame && ( | !isWebDesktop && (
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const frame = vi.hoisted(() => ({ on: false }));
vi.mock("@/hooks/useGuestPublicFrame", () => ({ useGuestPublicFrame: () => frame.on }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/lib/persistedAuthToken", async (orig) => ({ ...(await orig<typeof import("@/lib/persistedAuthToken")>()), hasPersistedAuthToken: () => false }));

import { AppTopBar } from "@/components/sections/AppTopBar";

function mount() {
  return render(
    <MemoryRouter initialEntries={["/declutter"]}>
      <AppTopBar title="Declutter" />
    </MemoryRouter>,
  );
}

describe("AppTopBar draws no second guest auth pair under the public header", () => {
  it("under the public frame: no top-bar-guest", () => {
    frame.on = true;
    const { container } = mount();
    expect(container.querySelector('[data-testid="top-bar-guest"]')).toBeNull();
  });

  it("outside it (native, AppShell pages): the pair stays", () => {
    frame.on = false;
    const { container } = mount();
    expect(container.querySelector('[data-testid="top-bar-guest"]')).not.toBeNull();
  });
});
