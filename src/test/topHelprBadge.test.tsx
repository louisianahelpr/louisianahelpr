/**
 * Owner 2026-10-27 (Thumbtack "Top Pro" style): a "Top Helpr" badge, earned as
 * a Helpr with 10+ completed jobs, 5+ reviews and a 4.8+ rating, shown on the
 * public profile badge row and on applicant cards (phone and desktop).
 *
 * @mutate src/lib/helperTier.ts |     stats.avgRating >= TOP_HELPR.avgRating |     stats.avgRating >= 0
 * @mutate src/lib/helperTier.ts |     stats.completedJobs >= TOP_HELPR.completedJobs && |     true &&
 * @mutate src/components/profile/TopHelprChip.tsx |   if (stats && !isTopHelpr(stats)) return null; |   void stats;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { isTopHelpr, TOP_HELPR } from "@/lib/helperTier";
import { TopHelprChip } from "@/components/profile/TopHelprChip";

const ROOT = join(__dirname, "..", "..");

describe("Top Helpr badge", () => {
  it("needs all three: jobs, reviews and rating", () => {
    expect(TOP_HELPR).toEqual({ completedJobs: 10, avgRating: 4.8, reviewCount: 5 });
    expect(isTopHelpr({ completedJobs: 10, avgRating: 4.8, reviewCount: 5 })).toBe(true);
    expect(isTopHelpr({ completedJobs: 9, avgRating: 5, reviewCount: 9 })).toBe(false);
    expect(isTopHelpr({ completedJobs: 30, avgRating: 4.79, reviewCount: 20 })).toBe(false);
    expect(isTopHelpr({ completedJobs: 30, avgRating: 5, reviewCount: 4 })).toBe(false);
    expect(isTopHelpr(null)).toBe(false);
  });

  it("the chip renders nothing for a Helpr who hasn't earned it", () => {
    const { container } = render(<TopHelprChip stats={{ completedJobs: 2, avgRating: 5, reviewCount: 2 }} />);
    expect(container.textContent).toBe("");
  });

  it("the chip says what it is and how it was earned", () => {
    render(<TopHelprChip />);
    const chip = screen.getByText("Top Helpr");
    expect(chip.closest("[data-top-helpr]")?.getAttribute("title")).toMatch(/10\+ completed jobs, 5\+ reviews and a 4\.8\+ star rating/);
  });

  it("renders on the profile badge row and both applicant layouts", () => {
    for (const f of ["src/pages/user/RecognitionRow.tsx", "src/pages/posts/postedJobs/ApplicantsPanel.tsx", "src/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx"]) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).toMatch(/isTopHelpr\(|<TopHelprChip stats=/);
    }
  });
});
