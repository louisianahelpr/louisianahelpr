/**
 * useSpendableGiftCards: the one definition of "a gift waiting for you" that
 * the gift card banner on Post a Job reads. These pin the conditions
 * redeem_gift_card checks (funded, sent/available, unexpired), the sorted id
 * spelling the banner's dismissal signature depends on, and that a failed read
 * is reported instead of passing as "no gifts".
 * Shown able to fail: with the paid check dropped, the filtering test reds.
 * @mutate src/hooks/useSpendableGiftCards.ts | r.payment_status === "paid" && | true &&
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let user: { id: string; email?: string } | null = null;
let result: { data: unknown; error: unknown } = { data: [], error: null };
const orSpy = vi.fn();
const report = vi.fn();

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user }) }));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        or: (clause: string) => {
          orSpy(clause);
          return Promise.resolve(result);
        },
      }),
    }),
  },
}));

import { useSpendableGiftCards } from "./useSpendableGiftCards";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
  user = null;
  result = { data: [], error: null };
  orSpy.mockClear();
  report.mockClear();
});

describe("useSpendableGiftCards", () => {
  it("signed out: settled with no gifts and no read", () => {
    const { result: r } = renderHook(() => useSpendableGiftCards(), { wrapper });
    expect(r.current).toEqual({ userId: undefined, ids: [], settled: true });
    expect(orSpy).not.toHaveBeenCalled();
  });

  it("keeps only paid, sent/available, unexpired gifts, ids sorted", async () => {
    user = { id: "u1", email: "a@b.co" };
    result = {
      data: [
        { id: "z-sent", status: "sent", payment_status: "paid", expires_at: null },
        { id: "a-avail", status: "available", payment_status: "paid", expires_at: future },
        { id: "unpaid", status: "sent", payment_status: "pending", expires_at: null },
        { id: "redeemed", status: "redeemed", payment_status: "paid", expires_at: null },
        { id: "expired", status: "sent", payment_status: "paid", expires_at: past },
      ],
      error: null,
    };
    const { result: r } = renderHook(() => useSpendableGiftCards(), { wrapper });
    await waitFor(() => expect(r.current.ids).toEqual(["a-avail", "z-sent"]));
    expect(r.current.settled).toBe(true);
    expect(orSpy).toHaveBeenCalledWith('recipient_id.eq.u1,recipient_email.eq."a@b.co"');
  });

  it("no email: reads by recipient id alone", async () => {
    user = { id: "u2" };
    renderHook(() => useSpendableGiftCards(), { wrapper });
    await waitFor(() => expect(orSpy).toHaveBeenCalledWith("recipient_id.eq.u2"));
  });

  it("PGRST202 reads as no gifts, unreported", async () => {
    user = { id: "u3" };
    result = { data: null, error: { code: "PGRST202", message: "missing" } };
    const { result: r } = renderHook(() => useSpendableGiftCards(), { wrapper });
    await waitFor(() => expect(orSpy).toHaveBeenCalled());
    await waitFor(() => expect(r.current.settled).toBe(true));
    expect(r.current.ids).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it("any other error is reported and reads as no gifts", async () => {
    user = { id: "u4" };
    result = { data: null, error: { code: "42501", message: "denied" } };
    const { result: r } = renderHook(() => useSpendableGiftCards(), { wrapper });
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(report.mock.calls[0][1]).toMatchObject({ tags: { source: "useSpendableGiftCards" } });
    expect(r.current.ids).toEqual([]);
  });
});
