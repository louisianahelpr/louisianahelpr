// Q1476 — the slow ping-pong Sentry JAVASCRIPT-25 caught (2026-10-07 on /jobs;
// /my-jobs on 09-14, 09-19 and 09-22). error_logs' trail for every one is
//   writes: filter=waiting -> (empty) | (empty) -> filter=waiting | ...
//   adopts: adopt@(empty) local=waiting | adopt@filter=waiting local=(default) | ...
// i.e. the adopt effect fires on the hook's OWN write landing, after the local
// state has already moved on, and "adopts" the stale value back. The write
// effect then writes the other way, and the two alternate for as long as the
// screen is open (25 writes in 10 s tripped the report).
//
// React Router 7 applies a navigation in a transition, so a write lands a
// render or more after the commit that made it. That timing cannot be pinned
// with a real router under jsdom, so this file drives the hook with a router
// whose writes land only when the test says so.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSearchParamMirror } from "./useSearchParamMirror";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const router = vi.hoisted(() => ({
  search: "",
  pending: [] as string[],
  writes: [] as string[],
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [
    new URLSearchParams(router.search),
    (next: URLSearchParams) => {
      router.writes.push(next.toString());
      router.pending.push(next.toString());
    },
  ],
}));

describe("Q1476 — the hook never adopts its own late-landing write", () => {
  it("a write that lands after the local state moved on is not adopted back", () => {
    router.search = "";
    router.pending = [];
    router.writes = [];
    const adopted: string[] = [];
    let local = "";
    const view = renderHook(({ filter }: { filter: string }) =>
      useSearchParamMirror({ filter }, (read) => {
        adopted.push(read("filter"));
        local = read("filter");
      }),
    { initialProps: { filter: "" } });

    // The user picks "waiting": the hook writes it (still in flight).
    act(() => view.rerender({ filter: "waiting" }));
    expect(router.writes).toEqual(["filter=waiting"]);

    // Before it lands the state moves back to the default (a second tap, or an
    // action resetting the bucket). The URL still reads empty: nothing to write.
    act(() => view.rerender({ filter: "" }));
    local = "";

    // Now the first write lands.
    act(() => {
      router.search = router.pending.shift()!;
      view.rerender({ filter: local });
    });

    expect(adopted, "the hook adopted its own stale write back into the state").toEqual([]);

    // And it converges: the hook writes the default back once, and that write
    // landing is not adopted either.
    for (let i = 0; i < 10 && router.pending.length; i++) {
      act(() => {
        router.search = router.pending.shift()!;
        view.rerender({ filter: local });
      });
    }
    expect(adopted).toEqual([]);
    expect(router.search).toBe("");
    expect(router.writes.length, `writes: ${router.writes.join(" | ")}`).toBeLessThanOrEqual(2);
  });

  it("can fail: an OUTSIDE change (Back, a deep link) is still adopted", () => {
    router.search = "";
    router.pending = [];
    router.writes = [];
    const adopted: string[] = [];
    const view = renderHook(({ filter }: { filter: string }) =>
      useSearchParamMirror({ filter }, (read) => adopted.push(read("filter"))),
    { initialProps: { filter: "" } });
    act(() => {
      router.search = "filter=done";
      view.rerender({ filter: "" });
    });
    expect(adopted).toEqual(["done"]);
  });
});

// Shown able to fail: without the in-flight check the late-landing write is
// adopted back and the ping-pong starts.
// @mutate src/hooks/useSearchParamMirror.ts | if (search === pending.from) return; // stale: our write has not landed yet | // removed
// @mutate src/hooks/useSearchParamMirror.ts | if (!prev \|\| (prev.search !== search && prev.stateKey === stateKey && !ownLanding)) return; | if (!prev) return;
