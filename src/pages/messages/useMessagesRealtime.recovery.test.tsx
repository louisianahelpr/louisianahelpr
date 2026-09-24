// useMessagesRealtime — after a socket loss BOTH channels (the shared inbound
// bus and the page's own channel) come back, in either order and up to seconds
// apart. The catch-up re-read must run after the LAST one is back: a message
// received between the two recoveries was delivered on neither, and only the
// re-read can bring it in. A leading throttle (re-read on the first, ignore the
// second for 2s) shipped with Q105 and was caught in review.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const recoverers: Array<() => void> = [];

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/realtimeRecovery", () => ({
  subscribeWithRecovery: (_build: unknown, opts: { onRecovered: () => void }) => {
    recoverers[1] = opts.onRecovered;
    return { close: vi.fn() };
  },
}));
vi.mock("@/lib/userRealtimeBus", () => ({
  subscribeUserRealtime: (_u: string, _t: string, _l: unknown, opts: { onRecovered: () => void }) => {
    recoverers[0] = opts.onRecovered;
    return vi.fn();
  },
}));

import { useMessagesRealtime, RECOVERY_SETTLE_MS } from "./useMessagesRealtime";

function mount(onRecovered: () => void) {
  return renderHook(() =>
    useMessagesRealtime({
      userId: "u1",
      activeConvoRef: { current: null },
      setMessages: vi.fn(),
      scrollToBottom: vi.fn(),
      patchConversationForMessage: vi.fn(),
      onJobStatusAnnouncement: vi.fn(),
      onRecovered,
    }),
  );
}

describe("useMessagesRealtime catch-up after reconnect", () => {
  beforeEach(() => { vi.useFakeTimers(); recoverers.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it("re-reads AFTER the second channel is back when they recover 1.5s apart", () => {
    const onRecovered = vi.fn();
    mount(onRecovered);
    recoverers[1]();                       // page channel back first
    vi.advanceTimersByTime(1500);
    const before = onRecovered.mock.calls.length;
    recoverers[0]();                       // shared bus back 1.5s later
    vi.advanceTimersByTime(RECOVERY_SETTLE_MS + 10);
    // A message received between the two recoveries is only on this re-read.
    expect(onRecovered.mock.calls.length).toBeGreaterThan(before);
  });

  it("re-reads ONCE when both come back together", () => {
    const onRecovered = vi.fn();
    mount(onRecovered);
    recoverers[0]();
    vi.advanceTimersByTime(100);
    recoverers[1]();
    vi.advanceTimersByTime(RECOVERY_SETTLE_MS + 10);
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it("never re-reads after unmount", () => {
    const onRecovered = vi.fn();
    const { unmount } = mount(onRecovered);
    recoverers[0]();
    unmount();
    vi.advanceTimersByTime(RECOVERY_SETTLE_MS + 10);
    expect(onRecovered).not.toHaveBeenCalled();
  });
});

// @mutate src/pages/messages/useMessagesRealtime.ts | clearTimeout(recoveryTimer);\n      recoveryTimer = setTimeout(onRecovered, RECOVERY_SETTLE_MS); | recoveryTimer = setTimeout(onRecovered, RECOVERY_SETTLE_MS);
// @mutate src/pages/messages/useMessagesRealtime.ts | return () => {\n      clearTimeout(recoveryTimer); | return () => {
