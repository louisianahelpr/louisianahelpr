import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const reported = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/errorLogger", () => ({ report: (err: unknown) => { reported.push(err); } }));

import { createLazyModule } from "./lazyModule";

beforeEach(() => { reported.length = 0; });

describe("createLazyModule (Q1172)", () => {
  it("is null until started, then the module, and loads once however often it is started", async () => {
    const load = vi.fn(() => Promise.resolve({ answer: 42 }));
    const lazy = createLazyModule(load, "test");
    const { result } = renderHook(() => lazy.use());
    expect(result.current).toBeNull();
    expect(load).not.toHaveBeenCalled(); // `use` alone never fetches
    act(() => { lazy.start(); lazy.start(); lazy.start(); });
    await waitFor(() => expect(result.current).toEqual({ answer: 42 }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a component mounted after the load sees the module on its first render", async () => {
    const lazy = createLazyModule(() => Promise.resolve({ ok: true }), "test");
    lazy.start();
    await waitFor(() => expect(renderHook(() => lazy.use()).result.current).toEqual({ ok: true }));
  });

  it("a failed fetch is reported with its source and the next start retries", async () => {
    const load = vi.fn<() => Promise<{ n: number }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ n: 1 });
    const lazy = createLazyModule(load, "Dock.load");
    const { result } = renderHook(() => lazy.use());
    act(() => lazy.start());
    await waitFor(() => expect(reported).toHaveLength(1));
    expect(result.current).toBeNull(); // the plain version keeps working
    act(() => lazy.start());
    await waitFor(() => expect(result.current).toEqual({ n: 1 }));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
