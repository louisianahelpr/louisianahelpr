/**
 * Audit #41 (lead 2026-10-21): on "After a job" the two switches save the
 * moment they flip, like every other settings switch; the tip amount and cap
 * keep an explicit Save (money is never saved on blur). A failed write puts
 * the switch back.
 *
 * @mutate src/pages/profile/AutoTip.tsx |     const ok = await writeNow({ auto_release_on_complete: next }, "AutoTip.release"); |     const ok = true;
 * @mutate src/pages/profile/AutoTip.tsx |     if (!ok) setAutoRelease(!next); |     void ok;
 * @mutate src/pages/profile/AutoTip.tsx |       if (!amountOk \|\| !capOk) { |       if (!amountOk) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const updates: Record<string, unknown>[] = [];
let profileRow: Record<string, unknown> = {};
let failNext = false;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: () => ({ select: async () => (failNext ? { data: null, error: { message: "boom" } } : { data: [{ user_id: "u1" }], error: null }) }) };
      },
    }),
  },
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "u1" },
    profile: profileRow,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(async () => {}), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import AutoTip from "@/pages/profile/AutoTip";

const renderIt = () => render(<MemoryRouter><AutoTip onBack={() => {}} /></MemoryRouter>);

describe("After a job: switches save instantly", () => {
  beforeEach(() => {
    updates.length = 0;
    failNext = false;
    profileRow = { user_id: "u1", auto_tip_mode: "off", auto_tip_value: null, auto_tip_cap: null, auto_release_on_complete: false };
  });

  it("turning the tip on with an invalid cap stays off and writes nothing (money review)", async () => {
    profileRow = { ...profileRow, auto_tip_cap: 2 };
    renderIt();
    const tip = await screen.findByRole("switch", { name: /Tip automatically/ });
    fireEvent.click(tip);
    await new Promise((r) => setTimeout(r, 50));
    expect(updates).toEqual([]);
    expect(tip).toHaveAttribute("aria-checked", "false");
  });

  it("Instant release writes only its own column, at once", async () => {
    renderIt();
    const sw = await screen.findByRole("switch", { name: "Instant release" });
    fireEvent.click(sw);
    await waitFor(() => expect(updates).toEqual([{ auto_release_on_complete: true }]));
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("a failed write puts the switch back", async () => {
    failNext = true;
    renderIt();
    const sw = await screen.findByRole("switch", { name: "Instant release" });
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
  });

  it("turning the tip off writes off with no amount", async () => {
    renderIt();
    const tip = await screen.findByRole("switch", { name: /Tip automatically/ });
    fireEvent.click(tip); // on
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toMatchObject({ auto_tip_mode: "percent" });
    fireEvent.click(tip); // off
    await waitFor(() => expect(updates[1]).toEqual({ auto_tip_mode: "off", auto_tip_value: null, auto_tip_cap: null }));
  });
});
