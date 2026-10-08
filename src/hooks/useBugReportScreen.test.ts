// @mutate src/hooks/useBugReportScreen.ts |     return () => clearTimeout(t); |     return () => {};
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const noteScreen = vi.fn();
vi.mock("@/lib/bugReportContext", () => ({ noteScreen: (...a: unknown[]) => noteScreen(...a) }));

import { useBugReportScreen } from "./useBugReportScreen";

describe("useBugReportScreen (Q1028): a bug report names the screen the person was on", () => {
  beforeEach(() => { vi.useFakeTimers(); noteScreen.mockReset(); document.title = "Money"; });
  afterEach(() => vi.useRealTimers());

  it("notes the route and the page title once the screen has settled", () => {
    renderHook(() => useBugReportScreen({ pathname: "/profile", search: "?tab=earnings" }));
    expect(noteScreen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(noteScreen).toHaveBeenCalledWith("/profile", "?tab=earnings", "Money");
  });

  it("a route left before it settles is never noted", () => {
    const { rerender } = renderHook((p: { pathname: string }) => useBugReportScreen({ pathname: p.pathname, search: "" }), {
      initialProps: { pathname: "/home" },
    });
    vi.advanceTimersByTime(300);
    rerender({ pathname: "/jobs" });
    vi.advanceTimersByTime(600);
    expect(noteScreen).toHaveBeenCalledTimes(1);
    expect(noteScreen).toHaveBeenCalledWith("/jobs", "", "Money");
  });
});
