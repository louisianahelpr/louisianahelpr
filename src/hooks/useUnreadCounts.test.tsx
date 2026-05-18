// useUnreadCounts feeds the dashboard "today" row's unread-message
// + pending-application badges. Tests pin down both the count fetch
// and the realtime filter shape (the column-name bug we caught
// during the audit pass — applicant_id was wrong; helper_id is the
// real column).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const headMock = vi.fn();
const eqEqMock = vi.fn();
const eqMock = vi.fn(() => ({ eq: eqEqMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn((_table?: string) => ({ select: selectMock }));

const channelOnMock = vi.fn();
const channelSubscribeMock = vi.fn();
const removeChannelMock = vi.fn();
const channelMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    channel: (...args: unknown[]) => channelMock(...args),
    removeChannel: (...args: unknown[]) => removeChannelMock(...args),
  },
}));

const filters: Array<{
  table: string;
  filter: string;
  handler: () => void;
}> = [];

beforeEach(() => {
  fromMock.mockClear();
  selectMock.mockClear();
  eqMock.mockClear();
  eqEqMock.mockReset();
  headMock.mockReset();
  channelOnMock.mockReset();
  channelSubscribeMock.mockReset();
  removeChannelMock.mockReset();
  channelMock.mockReset();
  filters.length = 0;

  // Default: count queries return 0
  eqEqMock.mockResolvedValue({ count: 0, error: null });

  // Channel chain mock — capture all `.on()` filter strings + handlers
  channelMock.mockImplementation(() => {
    const builder: Record<string, unknown> = {};
    builder.on = (
      _event: string,
      opts: { table: string; filter: string },
      handler: () => void,
    ) => {
      filters.push({ table: opts.table, filter: opts.filter, handler });
      return builder;
    };
    builder.subscribe = () => ({});
    return builder;
  });
});

import { useUnreadCounts } from "./useUnreadCounts";

describe("useUnreadCounts", () => {
  it("returns zeros when userId is null/undefined (no fetch attempted)", () => {
    const { result } = renderHook(() => useUnreadCounts(null));
    expect(result.current).toEqual({ messages: 0, applications: 0 });
    expect(fromMock).not.toHaveBeenCalled();
    expect(channelMock).not.toHaveBeenCalled();
  });

  it("fetches counts for messages.receiver_id + applications.helper_id (NOT applicant_id)", async () => {
    eqEqMock
      .mockResolvedValueOnce({ count: 3, error: null }) // messages
      .mockResolvedValueOnce({ count: 7, error: null }); // applications

    const { result } = renderHook(() => useUnreadCounts("user-1"));

    await waitFor(() => {
      expect(result.current.messages).toBe(3);
      expect(result.current.applications).toBe(7);
    });

    expect(fromMock).toHaveBeenCalledWith("messages");
    expect(fromMock).toHaveBeenCalledWith("applications");
  });

  it("subscribes to realtime channel with the correct filter columns", async () => {
    renderHook(() => useUnreadCounts("user-1"));

    await waitFor(() => expect(channelMock).toHaveBeenCalled());
    expect(channelMock).toHaveBeenCalledWith("unread-counts-user-1");

    // The 2 filters must use the canonical column names matching the
    // schema: messages.receiver_id + applications.helper_id.
    // Regression guard against the applicant_id bug fixed in f4940243.
    const messagesFilter = filters.find((f) => f.table === "messages");
    const appsFilter = filters.find((f) => f.table === "applications");

    expect(messagesFilter?.filter).toBe("receiver_id=eq.user-1");
    expect(appsFilter?.filter).toBe("helper_id=eq.user-1");
    // Critical: NOT applicant_id (the wrong column from the original bug)
    expect(appsFilter?.filter).not.toMatch(/applicant_id/);
  });

  it("realtime event triggers a refetch (load function called twice)", async () => {
    eqEqMock.mockResolvedValue({ count: 0, error: null });
    renderHook(() => useUnreadCounts("user-1"));

    await waitFor(() => expect(channelMock).toHaveBeenCalled());
    expect(eqEqMock).toHaveBeenCalledTimes(2); // initial messages + applications

    // Fire the realtime handler — should re-run both queries
    filters[0].handler();
    await waitFor(() => expect(eqEqMock).toHaveBeenCalledTimes(4));
  });

  it("falls back to 0 when count field is missing/null (defensive)", async () => {
    eqEqMock.mockResolvedValue({ count: null, error: null });
    const { result } = renderHook(() => useUnreadCounts("user-1"));

    await waitFor(() => {
      expect(result.current.messages).toBe(0);
      expect(result.current.applications).toBe(0);
    });
  });

  it("removes channel on unmount (no leaked subscription)", async () => {
    const { unmount } = renderHook(() => useUnreadCounts("user-1"));
    await waitFor(() => expect(channelMock).toHaveBeenCalled());
    unmount();
    expect(removeChannelMock).toHaveBeenCalledOnce();
  });
});
