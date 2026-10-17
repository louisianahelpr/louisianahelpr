// @mutate src/components/admin/adminJobs/EndSeriesSection.tsx | if (!ok) {\n      setBusy(false);\n      return;\n    } | if (!ok) {\n      setBusy(false);\n    }
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { EndSeriesSection } from "./EndSeriesSection";

/**
 * Q417 (c): ending a recurring series as the platform sits behind the biometric
 * gate every money-adjacent admin action has (a paid visit nobody is booked on
 * is refunded). requireBiometric returns true on web, so without this test the
 * whole gate could be deleted with the suite green
 * (src/test/biometricGatesAreProven.test.ts).
 *
 * A refusal must send nothing: no rpc_admin_end_recurring_series call, no
 * success or error toast, and the button back to "End series" (not stuck on
 * "Ending…"). The accepted case is here so the refusal case is shown able to
 * see a call at all.
 */
const requireBiometricMock = vi.fn<(reason: string) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (reason: string) => requireBiometricMock(reason),
}));

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));
const confirmMock = vi.fn();
vi.mock("@/lib/toastPolicy", () => ({ confirmConsequential: (...a: unknown[]) => confirmMock(...a) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const SERIES_PARENT = { id: "job-series", recurrence_days: [1, 3], parent_job_id: null, status: "open" };
const REASON = "the poster asked support to stop it";

function pressEnd() {
  render(<EndSeriesSection job={SERIES_PARENT} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: REASON } });
  fireEvent.click(screen.getByRole("button", { name: /end series/i }));
}

describe("EndSeriesSection — the biometric gate in front of ending a series", () => {
  beforeEach(() => {
    requireBiometricMock.mockReset();
    rpcMock.mockReset();
    toastError.mockReset();
    confirmMock.mockReset();
  });

  it("a refused gate sends nothing and frees the button", async () => {
    requireBiometricMock.mockResolvedValue(false);
    pressEnd();
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledWith("Confirm ending this recurring series"));
    await waitFor(() => expect(screen.getByRole("button", { name: /end series/i })).not.toBeDisabled());
    expect(rpcMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.queryByText("Ending…")).toBeNull();
  });

  it("an accepted gate ends the series once and says so", async () => {
    requireBiometricMock.mockResolvedValue(true);
    rpcMock.mockResolvedValue({ data: { action: "ended", booked_visits_remaining: 0 }, error: null });
    pressEnd();
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("rpc_admin_end_recurring_series", { p_job_id: "job-series", p_reason: REASON });
    expect(toastError).not.toHaveBeenCalled();
  });
});
