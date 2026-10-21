/**
 * Audit #24 (2026-10-21): Money showed three milestone toasts stacked on load.
 * A visit crossing several fresh milestones shows ONE toast (the biggest) and
 * records all of them, so none replays later.
 *
 * @mutate src/hooks/useHelperMilestones.ts |     if (!show) return;\n    toast(show.title, { description: show.description }); |     if (!show) return;\n    for (const m of fresh) toast(m.title, { description: m.description });
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.fn();
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toastMock(...a) }));
vi.mock("@/lib/celebrate", () => ({ maybeCelebrate: vi.fn(async () => {}) }));

import { useHelperMilestones } from "@/hooks/useHelperMilestones";
import { safeStorage } from "@/lib/safeStorage";

const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

describe("milestone toasts never stack", () => {
  beforeEach(() => { toastMock.mockReset(); try { localStorage.clear(); } catch { /* ignore */ } });
  it("crossing first, fifth and tenth job at once shows one toast", () => {
    const helperId = `h-${Math.random()}`;
    renderHook(() => useHelperMilestones({ helperId, completedJobCount: 10, totalEarningsDollars: 200, lastCompletedAt: new Date().toISOString() }), { wrapper: wrap });
    expect(toastMock).toHaveBeenCalledTimes(1);
    // All three are recorded, so the next visit shows nothing.
    toastMock.mockReset();
    renderHook(() => useHelperMilestones({ helperId, completedJobCount: 10, totalEarningsDollars: 200, lastCompletedAt: new Date().toISOString() }), { wrapper: wrap });
    expect(toastMock).not.toHaveBeenCalled();
    expect(safeStorage).toBeTruthy();
  });
});
