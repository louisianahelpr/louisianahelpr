// queryKeys is the single source of truth for React Query cache keys
// across the app. A drift between a prefetcher's key and a consumer
// hook's key means the consumer always misses the cache. Tests are
// trivial but valuable as regression guards — if anyone tweaks a key
// shape without updating both sides, this fails.

import { describe, it, expect } from "vitest";
import { queryKeys } from "./queryKeys";

describe("queryKeys", () => {
  describe("referral", () => {
    it("byUser key shape: ['referral', userId]", () => {
      expect(queryKeys.referral.byUser("user-1")).toEqual(["referral", "user-1"]);
    });

    it("domain prefix: ['referral']", () => {
      expect(queryKeys.referral.all).toEqual(["referral"]);
    });
  });

  describe("activity", () => {
    it("byUser key shape: ['activity', userId]", () => {
      expect(queryKeys.activity.byUser("user-1")).toEqual(["activity", "user-1"]);
    });

    it("domain prefix: ['activity']", () => {
      expect(queryKeys.activity.all).toEqual(["activity"]);
    });
  });

  describe("jobs", () => {
    it("open key shape: ['jobs', 'open']", () => {
      expect(queryKeys.jobs.open()).toEqual(["jobs", "open"]);
    });

    it("domain prefix: ['jobs'] — invalidating this should match every job-related key", () => {
      expect(queryKeys.jobs.all).toEqual(["jobs"]);
      expect(queryKeys.jobs.open()[0]).toBe(queryKeys.jobs.all[0]);
    });
  });

  describe("profile", () => {
    it("byId key shape: ['profile', userId]", () => {
      expect(queryKeys.profile.byId("user-1")).toEqual(["profile", "user-1"]);
    });

    it("domain prefix: ['profile']", () => {
      expect(queryKeys.profile.all).toEqual(["profile"]);
    });
  });

  describe("currentUser", () => {
    it("byId key shape: ['currentUser', userId]", () => {
      expect(queryKeys.currentUser.byId("user-1")).toEqual(["currentUser", "user-1"]);
    });

    it("byId tolerates undefined (React Query handles disabled queries)", () => {
      expect(queryKeys.currentUser.byId(undefined)).toEqual(["currentUser", undefined]);
    });

    it("domain prefix invalidates every currentUser-keyed query", () => {
      expect(queryKeys.currentUser.all).toEqual(["currentUser"]);
      expect(queryKeys.currentUser.byId("user-1")[0]).toBe(queryKeys.currentUser.all[0]);
    });
  });

  describe("business", () => {
    it("mine key shape: ['myBusiness', userId]", () => {
      expect(queryKeys.business.mine("user-1")).toEqual(["myBusiness", "user-1"]);
    });

    it("members key shape: ['businessMembers', businessId]", () => {
      expect(queryKeys.business.members("biz-1")).toEqual(["businessMembers", "biz-1"]);
    });
  });

  describe("payoutSetup", () => {
    it("status key shape: ['payout-setup', 'status', userId]", () => {
      expect(queryKeys.payoutSetup.status("user-1")).toEqual(["payout-setup", "status", "user-1"]);
    });

    it("methods key shape: ['payout-setup', 'methods', userId]", () => {
      expect(queryKeys.payoutSetup.methods("user-1")).toEqual(["payout-setup", "methods", "user-1"]);
    });

    it("status and methods share the ['payout-setup'] prefix for one-call invalidation", () => {
      expect(queryKeys.payoutSetup.status("user-1")[0]).toBe(queryKeys.payoutSetup.methods("user-1")[0]);
      expect(queryKeys.payoutSetup.all).toEqual(["payout-setup"]);
    });

    it("different users yield different payoutSetup keys", () => {
      expect(queryKeys.payoutSetup.status("user-1")).not.toEqual(queryKeys.payoutSetup.status("user-2"));
      expect(queryKeys.payoutSetup.methods("user-1")).not.toEqual(queryKeys.payoutSetup.methods("user-2"));
    });
  });

  describe("jobHistory", () => {
    it("byUser key shape: ['job-history', userId]", () => {
      expect(queryKeys.jobHistory.byUser("user-1")).toEqual(["job-history", "user-1"]);
    });

    it("domain prefix: ['job-history']", () => {
      expect(queryKeys.jobHistory.all).toEqual(["job-history"]);
      expect(queryKeys.jobHistory.byUser("user-1")[0]).toBe(queryKeys.jobHistory.all[0]);
    });
  });

  describe("stripePayouts", () => {
    it("byUser key shape: ['stripe-payouts', userId]", () => {
      expect(queryKeys.stripePayouts.byUser("user-1")).toEqual(["stripe-payouts", "user-1"]);
    });

    it("domain prefix: ['stripe-payouts']", () => {
      expect(queryKeys.stripePayouts.all).toEqual(["stripe-payouts"]);
    });
  });

  describe("admin", () => {
    it("payoutLedger is admin-scoped", () => {
      expect(queryKeys.admin.payoutLedger("admin-1")).toEqual(["admin-payout-ledger", "admin-1"]);
    });

    it("notificationLogs encodes admin id + filters", () => {
      const filters = { category: "all", status: "all", channel: "all", page: 0 };
      expect(queryKeys.admin.notificationLogs("admin-1", filters)).toEqual([
        "admin-notification-logs",
        "admin-1",
        filters,
      ]);
    });

    it("notificationLogsAll is the prefix every filter variant shares", () => {
      const filters = { category: "all", status: "all", channel: "all", page: 0 };
      expect(queryKeys.admin.notificationLogsAll).toEqual(["admin-notification-logs"]);
      expect(queryKeys.admin.notificationLogs("admin-1", filters)[0]).toBe(
        queryKeys.admin.notificationLogsAll[0],
      );
    });

    it("helperVerifications key shape: ['helper-verifications', userId]", () => {
      expect(queryKeys.admin.helperVerifications("user-1")).toEqual([
        "helper-verifications",
        "user-1",
      ]);
    });

    it("helperVerificationActors key shape: ['helper-verifications-actors', csv]", () => {
      expect(queryKeys.admin.helperVerificationActors("a,b,c")).toEqual([
        "helper-verifications-actors",
        "a,b,c",
      ]);
    });
  });

  describe("userProfile", () => {
    it("byId key shape: ['user-profile', userId]", () => {
      expect(queryKeys.userProfile.byId("user-1")).toEqual(["user-profile", "user-1"]);
    });
  });

  describe("credentials", () => {
    it("byUser key shape: ['credentials', userId]", () => {
      expect(queryKeys.credentials.byUser("user-1")).toEqual(["credentials", "user-1"]);
    });
  });

  describe("savedHelpers", () => {
    it("byUser key shape: ['savedHelpers', userId]", () => {
      expect(queryKeys.savedHelpers.byUser("user-1")).toEqual(["savedHelpers", "user-1"]);
    });
  });

  describe("payoutTransfers", () => {
    it("byHelper key shape: ['payout-transfers', helperId]", () => {
      expect(queryKeys.payoutTransfers.byHelper("helper-1")).toEqual([
        "payout-transfers",
        "helper-1",
      ]);
    });
  });

  describe("helperStreak", () => {
    it("byHelper key shape: ['helper-five-star-streak', helperId]", () => {
      // Shape MUST stay [<prefix>, helperId] — useHelperMilestones reads
      // this value out of the cache via getQueryData using the same key.
      expect(queryKeys.helperStreak.byHelper("helper-1")).toEqual([
        "helper-five-star-streak",
        "helper-1",
      ]);
    });
  });

  describe("helperSchedule", () => {
    it("forWindow key shape includes start + end ISO bounds", () => {
      expect(
        queryKeys.helperSchedule.forWindow("helper-1", "2026-05-01", "2026-05-07"),
      ).toEqual(["helper-schedule-strip", "helper-1", "2026-05-01", "2026-05-07"]);
    });
  });

  describe("earningsForecast", () => {
    it("forWindow key shape includes start + end ISO bounds + fee fallback", () => {
      expect(
        queryKeys.earningsForecast.forWindow("helper-1", "2026-05-01", "2026-05-07", 12),
      ).toEqual(["earnings-forecast", "helper-1", "2026-05-01", "2026-05-07", 12]);
    });
  });

  describe("publicReviewWall", () => {
    it("byHelper key shape: ['public-review-wall', helperId, limit]", () => {
      expect(queryKeys.publicReviewWall.byHelper("helper-1", 5)).toEqual([
        "public-review-wall",
        "helper-1",
        5,
      ]);
    });
  });

  describe("publicPayouts", () => {
    it("ticker key shape: ['public-payouts-ticker']", () => {
      expect(queryKeys.publicPayouts.ticker()).toEqual(["public-payouts-ticker"]);
    });
  });

  describe("dashboard", () => {
    it("preserves legacy literal shapes (cache compatibility)", () => {
      // Each entry below is the EXACT tuple the legacy literal-array
      // call site used. Drift here would invalidate every existing
      // in-flight entry in clients running the old shape.
      expect(queryKeys.dashboard.context("user-1")).toEqual(["dashboardContext", "user-1"]);
      expect(queryKeys.dashboard.jobs("user-1")).toEqual(["dashboardJobs", "user-1"]);
      expect(queryKeys.dashboard.proTier("user-1")).toEqual(["proTier", "user-1"]);
      expect(queryKeys.dashboard.savedSearches("user-1")).toEqual([
        "savedSearches",
        "user-1",
      ]);
      expect(queryKeys.dashboard.lastApplication("user-1")).toEqual([
        "lastApplication",
        "user-1",
      ]);
      expect(queryKeys.dashboard.savedJobs("user-1")).toEqual(["savedJobs", "user-1"]);
      expect(queryKeys.dashboard.guestJobs()).toEqual(["guestDashboardJobs"]);
    });
  });

  describe("isolation invariants", () => {
    it("different users yield different keys (no cross-user cache pollution)", () => {
      expect(queryKeys.activity.byUser("user-1")).not.toEqual(queryKeys.activity.byUser("user-2"));
      expect(queryKeys.profile.byId("user-1")).not.toEqual(queryKeys.profile.byId("user-2"));
      expect(queryKeys.referral.byUser("user-1")).not.toEqual(queryKeys.referral.byUser("user-2"));
      expect(queryKeys.currentUser.byId("user-1")).not.toEqual(queryKeys.currentUser.byId("user-2"));
      expect(queryKeys.jobHistory.byUser("user-1")).not.toEqual(queryKeys.jobHistory.byUser("user-2"));
      expect(queryKeys.stripePayouts.byUser("user-1")).not.toEqual(queryKeys.stripePayouts.byUser("user-2"));
      expect(queryKeys.admin.payoutLedger("admin-1")).not.toEqual(queryKeys.admin.payoutLedger("admin-2"));
    });

    it("same user + same factory yields identical keys (cache hit invariant)", () => {
      expect(queryKeys.activity.byUser("user-1")).toEqual(queryKeys.activity.byUser("user-1"));
      expect(queryKeys.currentUser.byId("user-1")).toEqual(queryKeys.currentUser.byId("user-1"));
      expect(queryKeys.jobHistory.byUser("user-1")).toEqual(queryKeys.jobHistory.byUser("user-1"));
    });
  });
});
