/**
 * Q967 (VN-2, seen on prod 2026-09-14): the job popup's "Posted by" tile
 * showed a BLANK name for an applicant viewer. Every EnrichedJob builder but
 * one falls back to "a neighbor"; the map pin's fetchJobForPin left posterName
 * undefined whenever get_safe_profiles returned no row, and PersonTile printed
 * nothing under "Posted by".
 *
 * CLASS: the tile itself refuses a blank name, whatever built the job, so a
 * new builder that forgets the fallback cannot bring the blank back.
 *
 * @mutate src/components/dashboard/JobPosterCard.tsx | name={job.posterName?.trim() \|\| POSTER_NAME_FALLBACK} | name={job.posterName}
 * @mutate src/components/PersonTile.tsx | className="text-ds-12 font-sans font-medium" | className="text-ds-10 font-sans font-semibold uppercase"
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { JobPosterCard, POSTER_NAME_FALLBACK } from "./JobPosterCard";
// The paid-tier badge reads the memberships switch (usePaidTierBadge); not what this test is about.
vi.mock("@/hooks/usePaidTierBadge", () => ({ usePaidTierBadge: () => () => null }));
import type { EnrichedJob } from "./types";

const job = (posterName: string | undefined) =>
  ({ id: "j-1", customer_id: "p-1", posterName, posterAvgRating: 0, posterReviewCount: 0 }) as unknown as EnrichedJob;

const nameUnderEyebrow = () => {
  const eyebrow = screen.getByText("Posted by");
  const tile = eyebrow.closest("a") ?? eyebrow.parentElement!.parentElement!;
  return tile.querySelector("p[title], p.truncate")?.textContent ?? "";
};

describe("JobPosterCard never prints a blank poster name", () => {
  for (const missing of [undefined, "", "   "]) {
    it(`posterName ${JSON.stringify(missing)} -> "${POSTER_NAME_FALLBACK}"`, () => {
      render(
        <MemoryRouter>
          <JobPosterCard job={job(missing)} repeatJobs={0} />
        </MemoryRouter>,
      );
      expect(nameUnderEyebrow()).toBe(POSTER_NAME_FALLBACK);
    });
  }

  it("a real name is printed as given", () => {
    render(
      <MemoryRouter>
        <JobPosterCard job={job("Hallie B.")} repeatJobs={0} />
      </MemoryRouter>,
    );
    expect(nameUnderEyebrow()).toBe("Hallie B.");
  });

  it("the eyebrow reads in sentence case, never an uppercase label (spec v2, lead 2026-10-21)", () => {
    render(
      <MemoryRouter>
        <JobPosterCard job={job("Hallie B.")} repeatJobs={0} />
      </MemoryRouter>,
    );
    const eyebrow = document.querySelector("[data-person-eyebrow]")!;
    expect(eyebrow.textContent).toBe("Posted by");
    expect(eyebrow.className.split(/\s+/)).not.toContain("uppercase");
    expect((eyebrow as HTMLElement).style.textTransform).not.toBe("uppercase");
  });
});
