import { describe, it, expect } from "vitest";
import {
  JOB_STATUS_LABELS,
  APPLICATION_STATUS_LABELS,
  jobStatusLabel,
  applicationStatusLabel,
} from "./statusLabels";

// These tests are the contract that #46 codifies: every job_status the
// Postgres enum emits must have a canonical sentence-case label, and the
// application-status table must use the softened "Declined" wording for
// `rejected`. If a new enum value lands, this file must be updated in
// the same PR.

describe("JOB_STATUS_LABELS", () => {
  it("covers every value in the job_status Postgres enum", () => {
    // Mirrors the enum literal in src/integrations/supabase/types.ts.
    // If the enum gains a value, add it here AND to JOB_STATUS_LABELS.
    const required = [
      "open",
      "accepted",
      "in_progress",
      "completed",
      "cancelled",
      "revision_requested",
      "disputed",
    ] as const;
    for (const value of required) {
      expect(JOB_STATUS_LABELS[value], `${value} missing from JOB_STATUS_LABELS`).toBeTruthy();
    }
  });

  it("uses sentence case — only the first word capitalized", () => {
    expect(JOB_STATUS_LABELS.in_progress).toBe("In progress");
    expect(JOB_STATUS_LABELS.revision_requested).toBe("Revision requested");
  });

  it("matches the canonical labels from issue #46", () => {
    expect(JOB_STATUS_LABELS.open).toBe("Open");
    expect(JOB_STATUS_LABELS.accepted).toBe("Accepted");
    expect(JOB_STATUS_LABELS.in_progress).toBe("In progress");
    expect(JOB_STATUS_LABELS.completed).toBe("Completed");
    expect(JOB_STATUS_LABELS.cancelled).toBe("Cancelled");
    expect(JOB_STATUS_LABELS.revision_requested).toBe("Revision requested");
    expect(JOB_STATUS_LABELS.disputed).toBe("Disputed");
  });
});

describe("APPLICATION_STATUS_LABELS", () => {
  it("renames `rejected` to the softer 'Declined'", () => {
    expect(APPLICATION_STATUS_LABELS.rejected).toBe("Declined");
  });

  it("covers pending / accepted / rejected / withdrawn", () => {
    expect(APPLICATION_STATUS_LABELS.pending).toBe("Pending");
    expect(APPLICATION_STATUS_LABELS.accepted).toBe("Accepted");
    expect(APPLICATION_STATUS_LABELS.rejected).toBe("Declined");
    expect(APPLICATION_STATUS_LABELS.withdrawn).toBe("Withdrawn");
  });
});

describe("jobStatusLabel()", () => {
  it("returns the canonical label for known statuses", () => {
    expect(jobStatusLabel("in_progress")).toBe("In progress");
    expect(jobStatusLabel("revision_requested")).toBe("Revision requested");
  });

  it("falls back to a humanized form for unknown values rather than throwing", () => {
    // Defensive: a fresh enum value rolled out server-side before the
    // client deploys must NOT crash the chip render.
    expect(jobStatusLabel("escrow_held")).toBe("Escrow held");
  });

  it("returns an empty string for null/undefined/empty", () => {
    expect(jobStatusLabel(null)).toBe("");
    expect(jobStatusLabel(undefined)).toBe("");
    expect(jobStatusLabel("")).toBe("");
  });
});

describe("applicationStatusLabel()", () => {
  it("returns 'Declined' for the DB value `rejected`", () => {
    expect(applicationStatusLabel("rejected")).toBe("Declined");
  });

  it("returns the canonical label for known statuses", () => {
    expect(applicationStatusLabel("pending")).toBe("Pending");
    expect(applicationStatusLabel("withdrawn")).toBe("Withdrawn");
  });

  it("falls back to a humanized form for unknown values", () => {
    expect(applicationStatusLabel("auto_declined")).toBe("Auto declined");
  });
});
