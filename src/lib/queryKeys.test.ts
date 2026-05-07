// queryKeys is the single source of truth for React Query cache keys
// across the app. A drift between a prefetcher's key and a consumer
// hook's key means the consumer always misses the cache. Tests are
// trivial but valuable as regression guards — if anyone tweaks a key
// shape without updating both sides, this fails.

import { describe, it, expect } from "vitest";
import { queryKeys } from "./queryKeys";

describe("queryKeys", () => {
  it("referral key shape: ['referral', userId]", () => {
    expect(queryKeys.referral("user-1")).toEqual(["referral", "user-1"]);
  });

  it("activity key shape: ['activity', userId]", () => {
    expect(queryKeys.activity("user-1")).toEqual(["activity", "user-1"]);
  });

  it("jobsOpen key shape: ['jobs', 'open']", () => {
    expect(queryKeys.jobsOpen()).toEqual(["jobs", "open"]);
  });

  it("profile key shape: ['profile', userId]", () => {
    expect(queryKeys.profile("user-1")).toEqual(["profile", "user-1"]);
  });

  it("different users yield different keys (no cross-user cache pollution)", () => {
    expect(queryKeys.activity("user-1")).not.toEqual(queryKeys.activity("user-2"));
    expect(queryKeys.profile("user-1")).not.toEqual(queryKeys.profile("user-2"));
    expect(queryKeys.referral("user-1")).not.toEqual(queryKeys.referral("user-2"));
  });

  it("same user + same factory yields identical keys (cache hit invariant)", () => {
    expect(queryKeys.activity("user-1")).toEqual(queryKeys.activity("user-1"));
  });
});
