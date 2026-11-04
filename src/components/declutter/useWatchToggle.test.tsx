/**
 * Q2018 (instant feel): the Declutter heart fills on the tap, not after declutter_set_watch answers,
 * and goes back if the write is refused. All three hearts (Browse cards, Free cards, the item page)
 * use the one hook, so none can drift back to a wait-for-the-server mutation.
 *
 * @mutate src/components/declutter/useWatchToggle.ts | qc.setQueryData(key, next); | void next;
 * @mutate src/components/declutter/useWatchToggle.ts | if (ctx?.before) qc.setQueryData(key, ctx.before); | void ctx;
 * @mutate src/components/declutter/DeclutterFreeView.tsx | const toggleWatch = useWatchToggle(userId); | const toggleWatch = useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => setWatch(id, on) });
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";

const setWatch = vi.fn<(id: string, on: boolean) => Promise<string>>();
vi.mock("@/lib/declutter/api", () => ({ setWatch: (id: string, on: boolean) => setWatch(id, on) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { useWatchToggle } from "./useWatchToggle";

const USER = "u-1";
const KEY = ["declutter", "watching", USER];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(KEY, new Set(["a"]));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const onWatched = vi.fn();
  const { result } = renderHook(() => useWatchToggle(USER, onWatched), { wrapper });
  return { qc, result, onWatched };
}

function deferred() {
  let resolve!: (v: string) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  setWatch.mockReset();
});

describe("the Declutter heart is optimistic (Q2018)", () => {
  it("fills on the tap, before the server answers", async () => {
    const d = deferred();
    setWatch.mockReturnValue(d.promise);
    const { qc, result, onWatched } = setup();
    act(() => result.current.mutate({ id: "b", on: true }));
    await waitFor(() => expect((qc.getQueryData(KEY) as Set<string>).has("b")).toBe(true));
    expect(setWatch).toHaveBeenCalledWith("b", true);
    expect(onWatched).not.toHaveBeenCalled();
    await act(async () => { d.resolve("ok"); await d.promise; });
    await waitFor(() => expect(onWatched).toHaveBeenCalledTimes(1));
  });

  it("empties on the tap when un-hearting", async () => {
    setWatch.mockReturnValue(new Promise(() => {}));
    const { qc, result } = setup();
    act(() => result.current.mutate({ id: "a", on: false }));
    await waitFor(() => expect((qc.getQueryData(KEY) as Set<string>).has("a")).toBe(false));
  });

  it("goes back to what it was when the write is refused", async () => {
    const d = deferred();
    setWatch.mockReturnValue(d.promise);
    const { qc, result, onWatched } = setup();
    act(() => result.current.mutate({ id: "b", on: true }));
    await waitFor(() => expect((qc.getQueryData(KEY) as Set<string>).has("b")).toBe(true));
    await act(async () => { d.reject(new Error("refused")); await d.promise.catch(() => {}); });
    await waitFor(() => expect((qc.getQueryData(KEY) as Set<string>).has("b")).toBe(false));
    expect((qc.getQueryData(KEY) as Set<string>).has("a")).toBe(true);
    expect(onWatched).not.toHaveBeenCalled();
  });

  it("every Declutter heart uses the one optimistic hook", () => {
    const files = ["DeclutterBrowseView.tsx", "DeclutterFreeView.tsx", "DeclutterItemView.tsx"];
    for (const f of files) {
      const code = blankComments(readFileSync(join(__dirname, f), "utf8"));
      expect(code, f).toMatch(/useWatchToggle\(/);
      expect(code, f).not.toMatch(/setWatch\(/);
    }
    expect(files.length).toBeGreaterThan(2);
  });
});
