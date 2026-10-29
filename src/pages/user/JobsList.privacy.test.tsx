/**
 * A3-C8 (app audit 2026-10-29): another member's profile listed job titles,
 * dates and prices under "Jobs completed" while "Jobs posted" said "Helpr
 * keeps the details private". A public profile never lists a job the viewer
 * was not part of: no other person's job title or price, on either tile, for
 * any viewer (an admin's jobs RLS returns every row).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { JobsList, jobsViewerWasPartOf } from "./JobsList";
import type { ProfileJob } from "./types";

const VIEWER = "viewer-1";
const PROFILE = "hallie-1";
const STRANGER = "someone-else";

const job = (id: string, customer_id: string, helper_id: string | null, title: string, budget: number): ProfileJob => ({
  id, title, status: "completed", category: "yard_work", budget, created_at: "2026-10-20T12:00:00Z", customer_id, helper_id,
});

// Hallie's completed jobs: one for the viewer, two for another poster.
const WORKED = [
  job("j1", VIEWER, PROFILE, "Mow my lawn", 40),
  job("j2", STRANGER, PROFILE, "Stranger's secret move", 977),
  job("j3", STRANGER, PROFILE, "Stranger's attic", 913),
];
// Hallie's posted jobs: one the viewer worked, one another Helpr worked.
const POSTED = [
  job("p1", PROFILE, VIEWER, "Fix fence", 60),
  job("p2", PROFILE, STRANGER, "Private errand", 955),
];

describe("a public profile lists only jobs the viewer was part of", () => {
  it("keeps the viewer's own jobs and drops every other pair's", () => {
    expect(jobsViewerWasPartOf(WORKED, VIEWER).map((j) => j.id)).toEqual(["j1"]);
    expect(jobsViewerWasPartOf(POSTED, VIEWER).map((j) => j.id)).toEqual(["p1"]);
    expect(jobsViewerWasPartOf(WORKED, null)).toEqual([]);
  });

  it("Jobs completed shows no other poster's title or price", () => {
    render(<JobsList jobs={WORKED} variant="worked" knownCount={3} viewerId={VIEWER} />);
    expect(screen.getByText("Mow my lawn")).toBeTruthy();
    expect(screen.queryByText(/Stranger's/)).toBeNull();
    expect(screen.queryByText(/\$977|\$913/)).toBeNull();
    expect(screen.getByTestId("profile-jobs-only-yours").textContent).toMatch(/keeps the rest private/);
  });

  it("Jobs posted behaves the same way", () => {
    render(<JobsList jobs={POSTED} variant="posted" knownCount={2} viewerId={VIEWER} />);
    expect(screen.getByText("Fix fence")).toBeTruthy();
    expect(screen.queryByText("Private errand")).toBeNull();
  });

  it("a viewer who shared no job sees the private count, not titles", () => {
    render(<JobsList jobs={WORKED.slice(1)} variant="worked" knownCount={2} viewerId={VIEWER} />);
    expect(screen.queryByText(/Stranger's/)).toBeNull();
    expect(screen.getByText(/2 jobs completed — Helpr keeps the details private/)).toBeTruthy();
  });

  it("the profile passes the viewer to every JobsList it renders", () => {
    const src = blankComments(readFileSync("src/pages/user/UserProfile.tsx", "utf8"));
    const lists = src.match(/<JobsList\b[^>]*>/g) ?? [];
    expect(lists.length).toBeGreaterThan(1);
    for (const tag of lists) expect(tag).toMatch(/viewerId=\{currentUserId\}/);
  });
});

// Drop the party filter (the A3-C8 defect: every row RLS returns is listed).
// @mutate src/pages/user/JobsList.tsx | return jobs.filter((j) => j.customer_id === viewerId \|\| j.helper_id === viewerId); | return jobs;
