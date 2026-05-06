import { describe, it, expect } from "vitest";
import { AhaEvent } from "./analytics";

// AhaEvent is the single source of truth for analytics event names. A typo
// here ships silently — the runtime accepts any string, so a misspelled
// constant just emits a different event under a wrong name forever.
// These tests lock the shape so refactors and human edits don't break
// dashboard queries that depend on these exact names.

describe("AhaEvent constants", () => {
  it("uses snake_case for every value", () => {
    const snakeCase = /^[a-z]+(_[a-z0-9]+)*$/;
    for (const [key, value] of Object.entries(AhaEvent)) {
      expect(value, `${key} should be snake_case but was '${value}'`).toMatch(snakeCase);
    }
  });

  it("has unique values across the whole enum", () => {
    const values = Object.values(AhaEvent);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("includes the documented activation funnel events", () => {
    expect(AhaEvent.SignupStarted).toBe("signup_started");
    expect(AhaEvent.SignupCompleted).toBe("signup_completed");
    expect(AhaEvent.EmailVerified).toBe("email_verified");
    expect(AhaEvent.ProfileCompleted).toBe("profile_completed");
  });

  it("includes the documented aha-moment events", () => {
    expect(AhaEvent.FirstJobPosted).toBe("first_job_posted");
    expect(AhaEvent.FirstJobApplication).toBe("first_job_application_sent");
    expect(AhaEvent.FirstHelperHired).toBe("first_helper_hired");
    expect(AhaEvent.FirstJobCompleted).toBe("first_job_completed");
    expect(AhaEvent.FirstReviewLeft).toBe("first_review_left");
    expect(AhaEvent.FirstPayoutReceived).toBe("first_payout_received");
  });

  it("includes friction events used by the error pipeline", () => {
    expect(AhaEvent.ErrorShown).toBe("error_shown");
    expect(AhaEvent.PermissionDenied).toBe("permission_denied");
    expect(AhaEvent.AppCrashed).toBe("app_crashed");
  });
});
