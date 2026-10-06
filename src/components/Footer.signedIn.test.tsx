/**
 * No footer on ANY signed-in screen (owner, 2026-10-06). Every shell that
 * mounts <Footer> (AuthShell, PublicLayout) goes through this component, so
 * the rule is checked here once, rendered, both ways.
 *
 * @mutate src/components/Footer.tsx |   if (user) return null; |   if (false) return null;
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const authState = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: authState.user, ready: true, loading: false }) }));

import Footer from "./Footer";

describe("Footer", () => {
  it("renders for a signed-out visitor", () => {
    authState.user = null;
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    expect(container.textContent).toMatch(/Louisiana communities/);
  });
  it("renders NOTHING for a signed-in member", () => {
    authState.user = { id: "u1" };
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    expect(container.innerHTML).toBe("");
  });
});
