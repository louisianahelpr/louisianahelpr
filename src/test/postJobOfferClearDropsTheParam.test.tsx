/**
 * Jobs audit 11-21 (L32): clearing the direct-offer banner left ?offerTo= in the address, so a reload brought the
 * offer back. The real form hook (usePostJobForm) clears the param with the offer, and keeps every other param.
 *
 * @mutate src/pages/post-job/usePostJobForm.ts |       next.delete("offerTo"); |       void next;
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => false,
  useFeatureStatus: () => ({ on: false, settled: true, lastAnswer: false }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: { id: "u1" }, isLoading: false }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ useRecentPostedJobs: () => ({ data: [], isLoading: false }), usePostedBefore: () => false }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));
// No network: every Supabase read the form makes on mount answers empty (none bears on the offer param).
vi.mock("@/integrations/supabase/client", () => {
  const done = Promise.resolve({ data: null, error: null });
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? done.then.bind(done) : chain),
    apply: () => chain,
  });
  return { supabase: chain };
});

import { usePostJobForm } from "@/pages/post-job/usePostJobForm";

const HELPR = "00000000-0000-4000-8000-0000000a1132";

describe("clearing a direct offer drops ?offerTo= (audit 11-21 L32)", () => {
  it("the param goes with the offer; other params stay", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/post-job?offerTo=${HELPR}&cat=cleaning`]}>{children}</MemoryRouter></QueryClientProvider>
    );
    const { result } = renderHook(() => ({ form: usePostJobForm(), location: useLocation() }), { wrapper });
    expect(new URLSearchParams(result.current.location.search).get("offerTo")).toBe(HELPR);
    act(() => result.current.form.clearOffer());
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get("offerTo")).toBeNull();
    expect(params.get("cat")).toBe("cleaning");
    expect(result.current.form.offerToHelperId).toBeNull();
  });
});
