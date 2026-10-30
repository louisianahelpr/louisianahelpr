/*
 * GUARD: a bell whose load failed loads again when the person comes back to
 * the app or the network returns.
 *
 * Sentry, iOS web: "notifications load timed out after 15000ms". The feed's
 * only reloads were a realtime reconnect and pull-to-refresh, so with the
 * channel still up a bell whose one load failed stayed empty for the rest of
 * the visit. RED on origin/main 8ca225a0e3: the focus and online tests fail
 * (one load, no reload).
 */
// @mutate src/components/notificationPanel/notificationFeed.ts | void load(ensureFreshNotificationFeed), INITIAL_LOAD_DELAY_MS | void load(), INITIAL_LOAD_DELAY_MS
// @mutate src/components/notificationPanel/notificationFeed.ts | const unsubscribeFocus = focusManager.subscribe((focused) => { if (focused) reloadIfFailed(); }); | const unsubscribeFocus = () => {};
// @mutate src/components/notificationPanel/notificationFeed.ts | const unsubscribeOnline = onlineManager.subscribe((online) => { if (online) reloadIfFailed(); }); | const unsubscribeOnline = () => {};
// @mutate src/components/notificationPanel/notificationFeed.ts | lastLoadFailed = true;\n        report(err, { tags: { source: "notificationFeed.load" } }); | report(err, { tags: { source: "notificationFeed.load" } });
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

const calls = { lists: 0, fail: true };
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const q: Record<string, unknown> = {};
    for (const k of ["select", "eq", "order"]) q[k] = () => q;
    q.limit = async () => {
      calls.lists += 1;
      return calls.fail ? { data: null, error: { message: "notifications load timed out" } } : { data: [], error: null };
    };
    // The head count: `.select(...).eq().eq()` awaited directly.
    q.then = (resolve: (v: unknown) => unknown) => resolve({ count: 0, error: null });
    return q;
  };
  return { supabase: { from: () => chain() } };
});
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { loadNotificationFeed, useNotificationFeed, __resetNotificationFeedLoad } from "./notificationFeed";

const U = "22222222-2222-2222-2222-222222222222";

async function mountWithFailedFirstLoad() {
  const hook = renderHook(() => useNotificationFeed(U));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
  // Two list selects per load (recent + unread).
  expect(calls.lists).toBe(2);
  return hook;
}

beforeEach(() => {
  calls.lists = 0;
  calls.fail = true;
  __resetNotificationFeedLoad();
  vi.useFakeTimers();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});
afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

describe("the bell recovers a failed load on return", () => {
  it("loads again when the app comes back to the foreground", async () => {
    const hook = await mountWithFailedFirstLoad();
    calls.fail = false;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.lists).toBeGreaterThan(2);
    hook.unmount();
  });

  it("loads again when the network comes back", async () => {
    const hook = await mountWithFailedFirstLoad();
    calls.fail = false;
    await act(async () => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.lists).toBeGreaterThan(2);
    hook.unmount();
  });

  it("does not reload a load that worked", async () => {
    calls.fail = false;
    const hook = renderHook(() => useNotificationFeed(U));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    const after = calls.lists;
    expect(after).toBe(2);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.lists).toBe(after);
    hook.unmount();
  });

  it("a feed opened just after a bell loaded the list does not read it twice", async () => {
    calls.fail = false;
    await loadNotificationFeed(U);
    expect(calls.lists).toBe(2);
    const hook = renderHook(() => useNotificationFeed(U));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(calls.lists).toBe(2);
    hook.unmount();
  });

  it("stops listening when the last bell unmounts", async () => {
    const hook = await mountWithFailedFirstLoad();
    hook.unmount();
    calls.fail = false;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.lists).toBe(2);
  });
});
