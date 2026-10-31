// Owner 10-31 ~18:30: "people shouldnt see on my profile that the job was
// cancelled." A listing auto-expire-jobs closed with no Helpr (status
// 'cancelled' + its fixed reason) is never shown as "Cancelled" and never
// counted as a cancellation. Only its poster sees it, as "Expired", with
// Repost. Every surface that names or counts a cancellation is held here:
//   - the profile's job list chip (JobsList)
//   - the profile's posted-cancelled count (useUserProfileData)
//   - the public stats RPC (get_public_profile_stats, newest definition;
//     behaviour proven in src/test/pglite/publicStatsExpiredIsNotCancelled.pglite.mjs)
//   - the poster's own Posted card line (posterStatusLine)
// AtAGlanceCard has no cancelled tile (deleted 2026-09-19), so it shows none.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { EXPIRED_LISTING_REASON_PREFIX, NOT_AN_EXPIRED_LISTING_FILTER, isExpiredListing } from "@/lib/expiredListing";
import { JobsList } from "@/pages/user/JobsList";
import { posterStatusLine, EXPIRED_LISTING_DETAIL } from "@/components/job-card/jobStatusLine";
import type { Job } from "@/components/job-card/activityConstants";
import type { ProfileJob } from "@/pages/user/types";

const ROOT = join(__dirname, "..", "..");
// The exact words auto-expire-jobs writes, read from the function itself.
const SWEEP_SRC = readFileSync(join(ROOT, "supabase/functions/auto-expire-jobs/index.ts"), "utf8");
const SWEEP_REASON = /cancellation_reason:\s*"([^"]+)"/.exec(blankComments(SWEEP_SRC))?.[1] ?? "";

const POSTER = "poster-1";
const HELPR = "helpr-1";
const row = (over: Partial<ProfileJob>): ProfileJob => ({
  id: "j1", title: "Rake the yard", status: "cancelled", category: "yard_work", budget: 40,
  created_at: "2026-10-20T12:00:00Z", customer_id: POSTER, helper_id: null, cancellation_reason: null, ...over,
});

describe("the sweep's reason is the one the rule reads", () => {
  it("auto-expire-jobs writes a reason that starts with the prefix", () => {
    expect(SWEEP_REASON.length).toBeGreaterThan(10);
    expect(SWEEP_REASON.startsWith(EXPIRED_LISTING_REASON_PREFIX)).toBe(true);
  });

  it("isExpiredListing: only cancelled, unfilled, with the sweep's reason", () => {
    expect(isExpiredListing({ status: "cancelled", helper_id: null, cancellation_reason: SWEEP_REASON })).toBe(true);
    expect(isExpiredListing({ status: "cancelled", helper_id: null, cancellation_reason: null })).toBe(false);
    expect(isExpiredListing({ status: "cancelled", helper_id: HELPR, cancellation_reason: SWEEP_REASON })).toBe(false);
    expect(isExpiredListing({ status: "cancelled", helper_id: null, cancellation_reason: "Plans changed" })).toBe(false);
    expect(isExpiredListing({ status: "open", helper_id: null, cancellation_reason: SWEEP_REASON })).toBe(false);
  });
});

describe("profile job list (JobsList)", () => {
  it("the poster sees an expired listing as Expired, with Repost, never Cancelled", () => {
    render(
      <MemoryRouter>
        <JobsList jobs={[row({ cancellation_reason: SWEEP_REASON })]} variant="posted" knownCount={1} viewerId={POSTER} isOwnProfile />
      </MemoryRouter>,
    );
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.queryByText("Cancelled")).toBeNull();
    expect(screen.getByRole("link", { name: "Repost" }).getAttribute("href")).toBe("/post-job?rebook=j1");
  });

  it("a real cancellation still says Cancelled (can fail)", () => {
    render(<JobsList jobs={[row({ cancellation_reason: "Plans changed" })]} variant="posted" knownCount={1} viewerId={POSTER} isOwnProfile />);
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByText("Expired")).toBeNull();
  });

  it("nobody else is shown the expired listing at all", () => {
    render(<JobsList jobs={[row({ cancellation_reason: SWEEP_REASON })]} variant="posted" knownCount={1} viewerId="someone-else" />);
    expect(screen.queryByText("Expired")).toBeNull();
    expect(screen.queryByText("Cancelled")).toBeNull();
    expect(screen.queryByText("Rake the yard")).toBeNull();
  });
});

describe("profile counts (useUserProfileData)", () => {
  const src = blankComments(readFileSync(join(ROOT, "src/pages/user/useUserProfileData.ts"), "utf8"));

  it("the posted-cancelled count leaves out unfilled expired listings", () => {
    const q = /supabase\.from\("jobs"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("customer_id", userId!\)\.eq\("status", "cancelled"\)([^\n]*)/.exec(src);
    expect(q).not.toBeNull();
    expect(q![1]).toContain(".or(NOT_AN_EXPIRED_LISTING_FILTER)");
  });

  it("the job rows carry cancellation_reason so the list can tell them apart", () => {
    const selects = src.match(/select\("id, title, status, category, budget, created_at, customer_id, helper_id[^"]*"\)/g) ?? [];
    expect(selects.length).toBeGreaterThan(1);
    for (const s of selects) expect(s).toContain("cancellation_reason");
  });

  it("the filter keeps a hired job, a null reason and any other reason", () => {
    expect(NOT_AN_EXPIRED_LISTING_FILTER).toBe(
      `helper_id.not.is.null,cancellation_reason.is.null,cancellation_reason.not.like."${EXPIRED_LISTING_REASON_PREFIX}*"`,
    );
  });
});

describe("public stats RPC (get_public_profile_stats, newest definition)", () => {
  it("cancelled_jobs leaves out an unfilled expired listing", () => {
    const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
    const key = [...defs.keys()].find((k) => k === "get_public_profile_stats" || k.startsWith("get_public_profile_stats("));
    expect(key).toBeTruthy();
    const body = blankSqlComments(defs.get(key!)!.stmt);
    const line = /COUNT\(\*\) FILTER \(WHERE j\.status = 'cancelled'([\s\S]*?)\)::integer AS cancelled_jobs/.exec(body);
    expect(line).not.toBeNull();
    expect(line![1].replace(/\s+/g, " ")).toContain(
      `AND NOT (j.helper_id IS NULL AND COALESCE(j.cancellation_reason, '') LIKE '${EXPIRED_LISTING_REASON_PREFIX}%')`,
    );
  });
});

describe("the poster's own Posted card line", () => {
  const job = (over: Partial<Job>) =>
    ({ id: "j1", status: "cancelled", helper_id: null, customer_id: POSTER, payment_status: "refunded", cancellation_reason: SWEEP_REASON, ...over }) as unknown as Job;

  it("an expired listing reads Expired, not Cancelled, and keeps the refund", () => {
    const line = posterStatusLine(job({}), 0);
    expect(line.eyebrow).toBe("Expired");
    expect(line.detail).toBe(EXPIRED_LISTING_DETAIL);
    const all = [line.eyebrow, line.detail, line.suffix].join(" ");
    expect(all).not.toMatch(/cancel/i);
    expect(line.suffix).toBe("Your payment was refunded");
  });

  it("a real cancellation still reads Cancelled with its reason (can fail)", () => {
    const line = posterStatusLine(job({ cancellation_reason: "Plans changed" }), 0);
    expect(line.detail).toBe("Cancelled");
    expect(line.suffix).toContain("Plans changed");
  });
});

// @mutate src/lib/expiredListing.ts |     !job.helper_id && |     true &&
// @mutate src/lib/expiredListing.ts |   return (\n    job.status === "cancelled" && |   return false && (\n    job.status === "cancelled" &&
// @mutate src/pages/user/JobsList.tsx |             {isExpiredListing(job) ? ( |             {false ? (
// @mutate src/pages/user/JobsList.tsx |                 {job.customer_id === viewerId && ( |                 {false && (
// @mutate src/pages/user/useUserProfileData.ts | .eq("status", "cancelled").or(NOT_AN_EXPIRED_LISTING_FILTER), | .eq("status", "cancelled"),
// @mutate src/components/job-card/jobStatusLine.ts |   const expired = id === "cancelled" && isExpiredListing(job); |   const expired = false;
// @mutate src/components/job-card/jobStatusLine.ts |   const reason = isExpiredListing(job) ? null : sanitizeCancellationReason(job.cancellation_reason); |   const reason = sanitizeCancellationReason(job.cancellation_reason);
// @mutate supabase/migrations/20261031234653_public_stats_expired_is_not_cancelled.sql |         AND NOT (j.helper_id IS NULL AND COALESCE(j.cancellation_reason, '') LIKE 'Job listing expired%'))::integer AS cancelled_jobs | )::integer AS cancelled_jobs
