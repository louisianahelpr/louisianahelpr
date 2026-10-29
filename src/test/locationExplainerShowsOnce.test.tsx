/**
 * Audit 2026-10-28 part 4, F13 + F34: the "Location" explainer
 * (usePermissionRationale, kind "location") came back on every day-of step
 * after the Helpr had already shared their location (on my way, arrived,
 * done, ending on "Mark Complete"). The record of a "Share Location" yes lived
 * in sessionStorage, which a reopened app or a new tab starts empty.
 *
 * Now the yes is kept on the device: the explainer shows once, the first time
 * the location is needed, and every later step goes straight to the read.
 * A "Not now" is still not remembered (the next ask explains again).
 *
 * @mutate src/hooks/usePermissionRationale.ts |     const raw = localStorage.getItem(CONFIRMED_KEY); |     const raw = sessionStorage.getItem(CONFIRMED_KEY);
 * @mutate src/hooks/usePermissionRationale.ts |     localStorage.setItem(CONFIRMED_KEY, JSON.stringify(Array.from(set))); |     sessionStorage.setItem(CONFIRMED_KEY, JSON.stringify(Array.from(set)));
 * @mutate src/hooks/usePermissionRationale.ts |       if (readConfirmedSet().has(kind)) { |       if (false) {
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resolveRationale, usePermissionRationale, usePermissionRationaleState } from "@/hooks/usePermissionRationale";

/** The day-of steps that each read the location (JobTracking.getLocation / getLocationOutcome). */
const DAY_OF_STEPS = ["on_the_way", "arrived", "working", "done"] as const;

function explainerOpen(): boolean {
  const { result, unmount } = renderHook(() => usePermissionRationaleState());
  const open = result.current.state.open && result.current.state.kind === "location";
  unmount();
  return open;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  __resolveRationale(false);
});

describe("F13/F34: the location explainer shows once, the first time it is needed", () => {
  it("after Share Location, no later step shows it again, even in a reopened app (fresh sessionStorage)", async () => {
    expect(DAY_OF_STEPS.length).toBeGreaterThan(2);
    const { result } = renderHook(() => usePermissionRationale());
    const reads: string[] = [];
    let shown = 0;

    for (const [i, step] of DAY_OF_STEPS.entries()) {
      // The app is reopened between steps: the tab's own storage starts empty.
      if (i > 0) sessionStorage.clear();
      let p!: Promise<boolean>;
      act(() => {
        p = result.current.request("location", () => { reads.push(step); });
      });
      if (explainerOpen()) {
        shown++;
        act(() => __resolveRationale(true));
      }
      expect(await p, step).toBe(true);
    }

    expect(shown).toBe(1);
    expect(reads).toEqual([...DAY_OF_STEPS]);
  });

  it("'Not now' is not remembered: the next step explains again", async () => {
    const { result } = renderHook(() => usePermissionRationale());
    const read = vi.fn();
    let p!: Promise<boolean>;
    act(() => {
      p = result.current.request("location", read);
    });
    expect(explainerOpen()).toBe(true);
    act(() => __resolveRationale(false));
    expect(await p).toBe(false);

    act(() => {
      p = result.current.request("location", read);
    });
    expect(explainerOpen()).toBe(true);
    act(() => __resolveRationale(true));
    expect(await p).toBe(true);
    expect(read).toHaveBeenCalledOnce();
  });
});
