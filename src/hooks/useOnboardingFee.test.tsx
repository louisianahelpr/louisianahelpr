import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Q753 (3): a failed `get_public_platform_settings` read used to return null
 * with no trace, so every payout preview quietly lost its fee line. It still
 * degrades to null (an unquoted fee is a gap, a wrong fee is a lie) but now
 * leaves a report.
 */
// @mutate src/hooks/useOnboardingFee.ts | report(error, { severity: "warning", tags: { source: "useOnboardingFeeCents" } }); | void error;

const rpc = vi.fn();
const reportMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportMock(...a) }));

import { useOnboardingFeeCents } from "./useOnboardingFee";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => { rpc.mockReset(); reportMock.mockReset(); });

describe("useOnboardingFeeCents", () => {
  it("reports a failed lookup and still answers null", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "500" } });
    const { result } = renderHook(() => useOnboardingFeeCents(), { wrapper });
    await waitFor(() => expect(reportMock).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it("returns the platform's cents and reports nothing on success", async () => {
    rpc.mockResolvedValue({ data: [{ onboarding_fee_cents: 200 }], error: null });
    const { result } = renderHook(() => useOnboardingFeeCents(), { wrapper });
    await waitFor(() => expect(result.current).toBe(200));
    expect(reportMock).not.toHaveBeenCalled();
  });
});
