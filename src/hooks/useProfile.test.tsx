import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { sharedProfileOrNullSchema } from "@/lib/schemas";
import { useProfile, fetchProfile, useInvalidateProfile } from "./useProfile";

// validateResult dynamically imports @sentry/react to report drift. Mock it
// here so the BOUNDARY CHECK ITSELF is observable: without this, deleting the
// `validateResult(...)` line from useProfile.ts left every test in this file
// green — the runtime guard at the highest-traffic read in the app was
// unproven, exactly the "fix nothing can fail on" shape.
const captureMessageMock = vi.fn();
vi.mock("@sentry/react", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn((_fields?: string) => ({ eq: eqMock }));
const fromMock = vi.fn((..._args: unknown[]) => ({ select: selectMock }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

const sampleRow = {
  user_id: "user-1",
  full_name: "Marie Beaumont",
  email: "marie@example.com",
  avatar_url: null,
  ban_status: null,
  idv_status: "verified",
  created_at: "2026-01-01T00:00:00Z",
  bio: null,
  location: "New Orleans",
  onboarding_fee_paid: true,
};

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
}

describe("fetchProfile", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    maybeSingleMock.mockReset();
  });

  it("queries profiles table with the right column list and user_id filter", async () => {
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    const result = await fetchProfile("user-1");
    expect(fromMock).toHaveBeenCalledWith("profiles");
    expect(selectMock).toHaveBeenCalledWith(expect.stringContaining("user_id"));
    expect(selectMock).toHaveBeenCalledWith(expect.stringContaining("full_name"));
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual(sampleRow);
  });

  it("returns null when no row found", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const result = await fetchProfile("missing-user");
    expect(result).toBeNull();
  });

  it("throws when supabase returns an error", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: new Error("RLS denied") });
    await expect(fetchProfile("user-1")).rejects.toThrow("RLS denied");
  });

  it("selects EXACTLY the columns the shared-profile schema declares", async () => {
    // The inventory is the PRODUCTION schema, not a list retyped here: every
    // consumer of this hook reads those fields, and `.passthrough()` means a
    // column dropped from the select is invisible to Zod. Two
    // `stringContaining` probes covered 2 of 11 — dropping `ban_status` (the
    // column the ban banner and every hiring gate read) stayed green.
    const schemaKeys = Object.keys(sharedProfileOrNullSchema.unwrap().shape);
    // 10 since Q205b dropped approval_status from the shared select.
    expect(schemaKeys.length).toBeGreaterThanOrEqual(10);
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    await fetchProfile("user-1");
    const selected = String(selectMock.mock.calls[0][0])
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    expect([...selected].sort()).toEqual([...schemaKeys].sort());
  });

  it("reports schema drift from THIS call site — the boundary check is wired", async () => {
    captureMessageMock.mockReset();
    // `ban_status` arrives as a number: real drift shape (enum → int).
    maybeSingleMock.mockResolvedValue({
      data: { ...sampleRow, ban_status: 7 },
      error: null,
    });
    await fetchProfile("user-1");
    // captureDriftToSentry awaits a dynamic import; poll rather than race it.
    for (let i = 0; i < 50 && captureMessageMock.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Schema drift at useProfile.fetchProfile",
      expect.objectContaining({ level: "error" }),
    );
  });
});

describe("useProfile", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    maybeSingleMock.mockReset();
  });

  it("does not fetch when userId is null", async () => {
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProfile(null), { wrapper });
    // Wait a tick — should still be idle/disabled
    await new Promise((r) => setTimeout(r, 10));
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when userId is undefined", async () => {
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    const { wrapper } = makeWrapper();
    renderHook(() => useProfile(undefined), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("fetches and returns the profile when userId is provided", async () => {
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProfile("user-1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(sampleRow));
    expect(fromMock).toHaveBeenCalledWith("profiles");
  });

  it("surfaces errors via the query result", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: new Error("boom") });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProfile("user-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useInvalidateProfile", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    maybeSingleMock.mockReset();
  });

  it("invalidates the profile query slot for the given user", async () => {
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    const { wrapper, client } = makeWrapper();

    const { result: profileResult } = renderHook(() => useProfile("user-1"), { wrapper });
    await waitFor(() => expect(profileResult.current.data).toEqual(sampleRow));
    expect(fromMock).toHaveBeenCalledTimes(1);

    const { result: invalidateResult } = renderHook(() => useInvalidateProfile(), { wrapper });
    // After invalidate, react-query re-fetches; with our 0 staleTime, it should fire immediately.
    await act(async () => {
      await invalidateResult.current("user-1");
    });
    await waitFor(() => expect(fromMock).toHaveBeenCalledTimes(2));
    // Sanity: invalidate hit the right key
    expect(client.getQueryState(["profile", "user-1"])).toBeDefined();
  });
});
// @mutate src/hooks/useProfile.ts | if (error) throw error; | void error;
// The boundary check was unproven until 2026-09-21: this whole file stayed
// green with the validateResult() line deleted from fetchProfile.
// @mutate src/hooks/useProfile.ts | validateResult(sharedProfileOrNullSchema, data ?? null, "useProfile.fetchProfile"); | void 0;
