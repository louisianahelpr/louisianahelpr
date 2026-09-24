// @mutate src/components/HelperAvailability.tsx | if (inverted) { | if (false) {
// @mutate supabase/migrations/20260924051826_helper_availability_range_forward.sql | OR start_time < end_time) | OR start_time <= end_time OR true)
/**
 * ST-002: an available day whose end is before its start (live: Sunday 9 PM
 * to 5 PM) showed as bookable while the browse filter could match no job on
 * it. The editor refuses to save that shape and names the day; the table's
 * CHECK refuses it for any writer.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { rpc, toastError } = vi.hoisted(() => ({
  rpc: vi.fn(() => Promise.resolve({ data: 7, error: null })),
  toastError: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.order = () =>
    Promise.resolve({
      data: [{ day_of_week: 0, is_available: true, start_time: "21:00:00", end_time: "17:00:00" }],
      error: null,
    });
  return { supabase: { from: () => chain, rpc } };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (m: string) => toastError(m), success: vi.fn() }) }));

import { HelperAvailability } from "./HelperAvailability";

describe("availability end must follow start (ST-002)", () => {
  it("the editor refuses an inverted available day and names it", async () => {
    render(<HelperAvailability userId="u-1" />);
    const save = await waitFor(() => screen.getAllByRole("button", { name: "Save Availability" })[0]);
    fireEvent.click(save);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/^Sunday: the end time/)));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the table refuses it too", () => {
    const sql = readFileSync("supabase/migrations/20260924051826_helper_availability_range_forward.sql", "utf8");
    expect(sql).toMatch(/CHECK \(is_available IS NOT TRUE OR start_time IS NULL OR end_time IS NULL OR start_time < end_time\)/);
  });
});
