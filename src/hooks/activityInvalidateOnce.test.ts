/**
 * One realtime event = ONE activity invalidation, however many useActivityData instances hear it (privacy-journey
 * 41792903580: get_my_activity_cores x7; /profile and /home mount the hook twice, posted + applied).
 */
// @mutate src/hooks/useActivityData.ts | if (slot.timer) clearTimeout(slot.timer); | if (false) clearTimeout(slot.timer);
// @mutate src/hooks/useActivityData.ts | if (slot.holders === 0 && slot.timer) { | if (slot.timer) {
// @mutate src/hooks/useActivityData.ts | const invalidate = () => scheduleActivityInvalidate(queryClient); | const invalidate = () => { queryClient.invalidateQueries({ queryKey: queryKeys.activity.all }); };
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { cancelActivityInvalidate, holdActivityInvalidate, scheduleActivityInvalidate } from "@/hooks/useActivityData";
import { blankComments } from "@/test/helpers/blankNonCode";

afterEach(() => vi.useRealTimers());

describe("activity invalidation is shared by every mounted useActivityData", () => {
  it("two instances hearing the same event invalidate once", () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    holdActivityInvalidate(qc);
    holdActivityInvalidate(qc);
    scheduleActivityInvalidate(qc);
    scheduleActivityInvalidate(qc);
    vi.advanceTimersByTime(800);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["activity"] });
    // A later event is its own invalidation.
    scheduleActivityInvalidate(qc);
    vi.advanceTimersByTime(800);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("one instance unmounting keeps the other's pending invalidation; the last one drops it", () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    holdActivityInvalidate(qc);
    holdActivityInvalidate(qc);
    scheduleActivityInvalidate(qc);
    cancelActivityInvalidate(qc);
    vi.advanceTimersByTime(800);
    expect(spy).toHaveBeenCalledTimes(1);
    scheduleActivityInvalidate(qc);
    cancelActivityInvalidate(qc);
    vi.advanceTimersByTime(800);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the hook's realtime handler goes through the shared invalidation", () => {
    const src = blankComments(readFileSync("src/hooks/useActivityData.ts", "utf8"));
    expect(src).toContain("const invalidate = () => scheduleActivityInvalidate(queryClient);");
    const calls = src.match(/invalidateQueries\(\{ queryKey: queryKeys\.activity\.all \}\)/g) ?? [];
    expect(calls.length, "the only whole-cache invalidation is the shared one").toBe(1);
  });
});
