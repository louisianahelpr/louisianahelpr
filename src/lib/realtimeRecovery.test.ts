import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * The whole point of this helper is behaviour that only shows up on a failure
 * nobody can reproduce by hand, so it is worth pinning precisely: that a dead
 * channel is rebuilt under a NEW name, that the rebuild is what fires the
 * caller's backfill, that a torn-down attempt's late CLOSED cannot start a
 * second retry loop, and that a closed subscription stops claiming the app is
 * degraded.
 */

type StatusCb = (status: string, err?: Error) => void;

interface FakeChannel {
  name: string;
  cb: StatusCb | null;
  on: () => FakeChannel;
  subscribe: (cb?: StatusCb) => FakeChannel;
}

const created: FakeChannel[] = [];
const removed: FakeChannel[] = [];

const channelMock = vi.fn((name: string) => {
  const ch: FakeChannel = {
    name,
    cb: null,
    on: () => ch,
    subscribe: (cb?: StatusCb) => {
      ch.cb = cb ?? null;
      return ch;
    },
  };
  created.push(ch);
  return ch;
});

const removeChannelMock = vi.fn((ch: FakeChannel) => {
  removed.push(ch);
  return Promise.resolve("ok");
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => channelMock(name),
    removeChannel: (ch: unknown) => removeChannelMock(ch as FakeChannel),
  },
}));

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportMock(...a) }));

const { subscribeWithRecovery, useRealtimeDegraded, __resetRealtimeHealth } = await import(
  "./realtimeRecovery"
);

/** Build one subscription whose channel we can drive by status. */
function makeSub(opts: Parameters<typeof subscribeWithRecovery>[1]) {
  return subscribeWithRecovery((name) => channelMock(name) as never, opts);
}

const last = () => created[created.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  created.length = 0;
  removed.length = 0;
  channelMock.mockClear();
  removeChannelMock.mockClear();
  reportMock.mockClear();
  __resetRealtimeHealth();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subscribeWithRecovery", () => {
  it("subscribes immediately under a nonce-suffixed name", () => {
    const sub = makeSub({ name: "activity-realtime" });
    expect(created).toHaveLength(1);
    expect(created[0].name).toMatch(/^activity-realtime-.+/);
    expect(created[0].name).not.toBe("activity-realtime");
    sub.close();
  });

  it("uses the name verbatim when stableName is set", () => {
    // Presence is a rendezvous — both participants must land on one name.
    const sub = makeSub({ name: "presence-job-1", stableName: true });
    expect(created[0].name).toBe("presence-job-1");
    sub.close();
  });

  it("rebuilds under a NEW name after CHANNEL_ERROR", () => {
    const sub = makeSub({ name: "messages-realtime-u1" });
    const first = last();
    first.cb?.("SUBSCRIBED");

    first.cb?.("CHANNEL_ERROR", new Error("socket died"));
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1); // backoff not elapsed yet

    vi.advanceTimersByTime(1_500);
    expect(created).toHaveLength(2);
    // A rebuilt channel MUST NOT reuse the name — Supabase dedupes by name and
    // would silently drop the new subscription.
    expect(created[1].name).not.toBe(first.name);
    expect(removed).toContain(first);
    sub.close();
  });

  it("fires onRecovered on the reconnect, and never on the first subscribe", () => {
    const onRecovered = vi.fn();
    const sub = makeSub({ name: "unread-nav-u1", onRecovered });

    last().cb?.("SUBSCRIBED");
    expect(onRecovered).not.toHaveBeenCalled();

    last().cb?.("TIMED_OUT");
    vi.advanceTimersByTime(1_500);
    last().cb?.("SUBSCRIBED");

    // This is the half that matters: the socket missed every write during the
    // outage, so reconnecting without this leaves an invisibly stale screen.
    expect(onRecovered).toHaveBeenCalledTimes(1);
    sub.close();
  });

  it("ignores a late status from an abandoned attempt", () => {
    const onRecovered = vi.fn();
    const sub = makeSub({ name: "tracking-j1", onRecovered });
    const first = last();
    first.cb?.("SUBSCRIBED");
    first.cb?.("CHANNEL_ERROR");
    vi.advanceTimersByTime(1_500);
    expect(created).toHaveLength(2);

    // removeChannel makes the OLD channel emit CLOSED. Read as a fresh failure
    // it would start a second, parallel retry loop.
    first.cb?.("CLOSED");
    vi.advanceTimersByTime(60_000);
    expect(created).toHaveLength(2);
    sub.close();
  });

  it("backs off, and keeps retrying rather than giving up", () => {
    const sub = makeSub({ name: "activity-reviews" });
    last().cb?.("SUBSCRIBED");

    for (let i = 0; i < 8; i += 1) {
      last().cb?.("CHANNEL_ERROR");
      // Longest step is 30s plus up to 400ms jitter.
      vi.advanceTimersByTime(31_000);
    }
    expect(created.length).toBe(9);
    sub.close();
  });

  it("reports only once per outage, not once per retry", () => {
    const sub = makeSub({ name: "admin-realtime" });
    last().cb?.("SUBSCRIBED");
    last().cb?.("CHANNEL_ERROR");
    vi.advanceTimersByTime(1_500);
    last().cb?.("CHANNEL_ERROR");
    vi.advanceTimersByTime(3_000);
    expect(reportMock).toHaveBeenCalledTimes(1);
    sub.close();
  });

  it("forwards status to the caller's onStatus", () => {
    const onStatus = vi.fn();
    const sub = makeSub({ name: "presence-x", stableName: true, onStatus });
    last().cb?.("SUBSCRIBED");
    // The live channel is handed in, so a caller never has to reach back into
    // a subscription that may not be assigned yet.
    expect(onStatus).toHaveBeenCalledWith("SUBSCRIBED", undefined, created[0]);
    sub.close();
  });

  it("close() removes the channel and stops all retries", () => {
    const sub = makeSub({ name: "message_reactions:j1" });
    const first = last();
    first.cb?.("SUBSCRIBED");
    first.cb?.("CHANNEL_ERROR");
    sub.close();
    expect(removed).toContain(first);

    vi.advanceTimersByTime(120_000);
    // Nothing rebuilt after close.
    expect(created).toHaveLength(1);

    // Idempotent — effect cleanups can run twice under StrictMode.
    expect(() => sub.close()).not.toThrow();
  });

  it("publishes the outage to the banner, and clears it on recovery", () => {
    // Silent staleness is the defect; reconnection alone is not the fix. This
    // is the flag OfflineBanner reads to say "live updates paused".
    const { result } = renderHook(() => useRealtimeDegraded());
    expect(result.current).toBe(false);

    const sub = makeSub({ name: "notifications-realtime" });
    act(() => {
      last().cb?.("SUBSCRIBED");
    });
    expect(result.current).toBe(false);

    act(() => {
      last().cb?.("CHANNEL_ERROR");
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1_500);
      last().cb?.("SUBSCRIBED");
    });
    expect(result.current).toBe(false);
    sub.close();
  });

  it("a deliberately closed channel does not pin the banner open", () => {
    const { result } = renderHook(() => useRealtimeDegraded());
    const sub = makeSub({ name: "unread-sidebar-u1" });
    act(() => {
      last().cb?.("SUBSCRIBED");
      last().cb?.("CHANNEL_ERROR");
    });
    expect(result.current).toBe(true);
    act(() => {
      sub.close();
    });
    expect(result.current).toBe(false);
  });

  it("exposes the live channel through `current`", () => {
    const sub = makeSub({ name: "presence-y", stableName: true });
    expect(sub.current).toBe(created[0]);
    sub.close();
    expect(sub.current).toBeNull();
  });
});
