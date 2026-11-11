// @mutate src/components/HelperAvailability.tsx | disabled={!changesWeek(preset.apply)} | disabled={false}
// @mutate src/components/HelperAvailability.tsx | label: "Turn weekends off" | label: "Weekends off"
/**
 * Q34: A "QUICK SET" PRESET THAT WOULD CHANGE NOTHING IS DISABLED.
 *
 * The press sweep (run 35837735324, customer AND helper) flagged "Copy Mon to
 * all" as a press with no observable change. Measured from source: with no
 * saved rows the week defaults to every day 09:00-17:00, so copying Monday
 * is a no-op, and a live button that does nothing reads as broken. Each
 * preset is now disabled exactly when applying it leaves the week unchanged,
 * and enabled again the moment it would do something.
 *
 * Audit 11-10 W2 F264a: the presets read as states ("Weekdays 9–5", "Weekends off") while the rows under them
 * could say the opposite. They are now actions: "Set weekdays 9–5", "Turn weekends off", "Copy Mon to all".
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.order = () => Promise.resolve({ data: [], error: null });
  return { supabase: { from: () => chain } };
});
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { HelperAvailability } from "./HelperAvailability";

const preset = (name: string) => screen.getByRole("button", { name });

describe("HelperAvailability quick-set presets", () => {
  it("disables a preset exactly when it would change nothing", async () => {
    render(<HelperAvailability userId="u-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy Mon to all" })).toBeTruthy());

    // Default week: every day 09:00-17:00. Copying Monday changes nothing.
    expect(preset("Copy Mon to all")).toHaveProperty("disabled", true);
    expect(preset("Set weekdays 9–5")).toHaveProperty("disabled", false);
    expect(preset("Turn weekends off")).toHaveProperty("disabled", false);

    // Weekdays 9-5 turns the weekend off: now it (and Weekends off) are
    // no-ops, and copying Monday to Sunday/Saturday would change them.
    fireEvent.click(preset("Set weekdays 9–5"));
    expect(preset("Set weekdays 9–5")).toHaveProperty("disabled", true);
    expect(preset("Turn weekends off")).toHaveProperty("disabled", true);
    expect(preset("Copy Mon to all")).toHaveProperty("disabled", false);

    fireEvent.click(preset("Copy Mon to all"));
    expect(preset("Copy Mon to all")).toHaveProperty("disabled", true);
    expect(preset("Turn weekends off")).toHaveProperty("disabled", false);
  });
});
