import { describe, it, expect } from "vitest";
import { notificationDestination } from "./notificationDestination";

const JOB = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";

describe("notificationDestination", () => {
  describe("no job_id — the URL path must keep working", () => {
    it.each([
      ["/my-posts", "/my-posts"],
      ["/my-jobs?filter=done", "/my-jobs?filter=done"],
      [`/my-posts?job=${JOB}`, `/my-posts?job=${JOB}`],
      ["/admin?view=disputes", "/admin?view=disputes"],
      ["/earnings", "/earnings"],
      ["/profile?tab=reviews", "/profile?tab=reviews"],
    ])("passes %s through untouched", (link, expected) => {
      expect(notificationDestination({ link, job_id: null })).toBe(expected);
    });

    it("returns null for a row with no link (6 such rows in prod)", () => {
      expect(notificationDestination({ link: null, job_id: null })).toBeNull();
    });

    it("refuses a link that is not root-relative", () => {
      expect(notificationDestination({ link: "https://evil.example", job_id: null })).toBeNull();
      expect(notificationDestination({ link: "//evil.example", job_id: null })).toBeNull();
      expect(notificationDestination({ link: "javascript:alert(1)", job_id: null })).toBeNull();
    });

    it("still refuses a bad link even when a job_id is present", () => {
      expect(notificationDestination({ link: "//evil.example", job_id: JOB }))
        .toBe(`/jobs/${JOB}`);
    });
  });

  describe("job_id present — the reference is preferred over the URL", () => {
    it("upgrades a BARE /my-posts to ?job= (the ~40-producer defect)", () => {
      expect(notificationDestination({ link: "/my-posts", job_id: JOB }))
        .toBe(`/my-posts?job=${JOB}`);
    });

    it("upgrades a bare /my-jobs too", () => {
      expect(notificationDestination({ link: "/my-jobs", job_id: JOB }))
        .toBe(`/my-jobs?job=${JOB}`);
    });

    it("DROPS a stale fixed ?filter= — carrying both defeats resolution", () => {
      // Activity gives an explicit ?filter= precedence over ?job=, so this is
      // the assertion that matters most in this file.
      expect(notificationDestination({ link: "/my-posts?filter=offered", job_id: JOB }))
        .toBe(`/my-posts?job=${JOB}`);
      expect(notificationDestination({ link: "/my-jobs?filter=scheduled", job_id: JOB }))
        .toBe(`/my-jobs?job=${JOB}`);
    });

    it("drops a chip-less legacy filter key too (the 66)", () => {
      for (const k of ["offered", "in_progress", "completed", "not_selected", "open", "revision"]) {
        expect(notificationDestination({ link: `/my-posts?filter=${k}`, job_id: JOB }))
          .toBe(`/my-posts?job=${JOB}`);
      }
    });

    it("trusts the column over a job id already in the string", () => {
      const other = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      expect(notificationDestination({ link: `/my-posts?job=${other}`, job_id: JOB }))
        .toBe(`/my-posts?job=${JOB}`);
    });

    it("keeps ?highlight= so the applied-tab card still pulses", () => {
      const dest = notificationDestination({ link: "/my-jobs?highlight=app-1", job_id: JOB });
      const params = new URLSearchParams(dest!.split("?")[1]);
      expect(dest!.startsWith("/my-jobs?")).toBe(true);
      expect(params.get("highlight")).toBe("app-1");
      expect(params.get("job")).toBe(JOB);
      expect(params.get("filter")).toBeNull();
    });

    it("routes a job-bearing row with NO link to the job detail page", () => {
      // reject_pending_job writes no link at all while holding p_job_id.
      expect(notificationDestination({ link: null, job_id: JOB })).toBe(`/jobs/${JOB}`);
    });

    it.each([
      ["/earnings"],
      ["/profile?tab=earnings"],
      ["/admin"],
      ["/admin?view=disputes"],
      ["/pay-it-forward"],
      [`/messages?jobId=${JOB}&userId=u1`],
      [`/dashboard?quickApply=${JOB}`],
      [`/jobs/${JOB}`],
      [`/profile?tab=reviews&job=${JOB}`],
    ])("leaves the deliberate non-Activity destination %s alone", (link) => {
      expect(notificationDestination({ link, job_id: JOB })).toBe(link);
    });
  });

  it("tolerates a row shape with no job_id key at all", () => {
    expect(notificationDestination({ link: "/my-posts" })).toBe("/my-posts");
  });
});
