/**
 * useCrewSlot: the signed-in member's own roster row on a crew job (Q1382).
 *
 * What it must do: ask for nothing without a member or when disabled, read
 * exactly this member's row on this job, hand back null (not undefined) when
 * they are not on the crew, and surface a failed read as an error instead of
 * a "not on the crew" null (CLAUDE.md: never drop the Supabase error).
 */
// @mutate src/hooks/useCrewSlot.ts |     enabled: enabled && !!userId, |     enabled: true,
// @mutate src/hooks/useCrewSlot.ts |           .eq("helper_id", userId as string) |           .neq("helper_id", "")
// @mutate src/hooks/useCrewSlot.ts |       return ((rows ?? [])[0] as unknown as CrewSlot \| undefined) ?? null; |       return ((rows ?? [])[0] as unknown as CrewSlot);
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
let answer: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, filters: [] as Array<[string, unknown]> };
      calls.push(call);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          call.filters.push([col, val]);
          return chain;
        },
        limit: async () => answer,
      };
      return chain;
    },
  },
}));

import { useCrewSlot } from "./useCrewSlot";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  calls.length = 0;
  answer = { data: [], error: null };
});

describe("useCrewSlot", () => {
  it("asks for nothing without a signed-in member", async () => {
    const { result } = renderHook(() => useCrewSlot("job-1", null, true), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("asks for nothing when the caller disables it", async () => {
    renderHook(() => useCrewSlot("job-1", "member-1", false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });

  it("reads exactly this member's row on this job", async () => {
    answer = { data: [{ job_id: "job-1", helper_id: "member-1", status: "confirmed" }], error: null };
    const { result } = renderHook(() => useCrewSlot("job-1", "member-1", true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ helper_id: "member-1", status: "confirmed" });
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("group_job_helpers");
    expect(calls[0].filters).toEqual([["job_id", "job-1"], ["helper_id", "member-1"]]);
  });

  it("hands back null, not undefined, when the member is not on the crew", async () => {
    const { result } = renderHook(() => useCrewSlot("job-1", "member-1", true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("surfaces a failed read as an error, never as 'not on the crew'", async () => {
    answer = { data: null, error: { message: "boom", code: "57014" } };
    const { result } = renderHook(() => useCrewSlot("job-1", "member-1", true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
