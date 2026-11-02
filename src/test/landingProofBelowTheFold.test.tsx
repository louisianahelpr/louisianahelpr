/**
 * THE FIRST SCREEN IS JUST THE HEADLINE, THE SUBHEAD AND THE SEARCH (owner, 2026-11-02, via the lead: the
 * landing on a phone had the "Just finished · 2 yards in New Iberia" proof row sitting alone at the very
 * bottom of the full-height hero). The hero keeps its empty space (owner correction, same day: "no spacing
 * change"); the proof row (with its "Paid when it's done" line) moves OUT of the hero to the top of the next
 * section, "Open jobs near you", below the fold, at every width.
 *
 * Before/after screenshots at 390x844, 375x667 and 1440x900: ~/.lh-shots/b188/hero-*.png.
 *
 * @mutate src/components/landing/HeroSection.tsx |       </div>\n    </section> |       </div>\n      <LandingProof />\n    </section>
 * @mutate src/components/landing/LiveJobsSection.tsx |         <LandingProof />\n |
 * @mutate src/components/landing/LandingProof.tsx | className="w-full border-b pb-5 lg:pb-6 grid | className="mt-8 w-full border-t pt-5 lg:pt-6 grid
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } }));

import HeroSection from "@/components/landing/HeroSection";
import { LandingProof } from "@/components/landing/LandingProof";

const read = (rel: string) => blankComments(readFileSync(join(process.cwd(), rel), "utf8"));

afterEach(() => cleanup());

describe("the landing's first screen is the headline, subhead and search only (owner 2026-11-02)", () => {
  it("the hero renders its headline and search but no proof row", () => {
    render(<MemoryRouter><HeroSection /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("search")).toBeTruthy();
    expect(screen.queryByTestId("landing-proof")).toBeNull();
    expect(screen.queryByText("Just finished")).toBeNull();
  });

  it("the proof row is the first thing in Open jobs near you, above its heading", () => {
    const hero = read("src/components/landing/HeroSection.tsx");
    expect(hero).not.toMatch(/<LandingProof\b/);
    const live = read("src/components/landing/LiveJobsSection.tsx");
    const measure = live.indexOf('data-testid="landing-live-jobs-measure"');
    const proof = live.indexOf("<LandingProof />");
    const heading = live.indexOf('id="landing-live-jobs-title"');
    expect(measure).toBeGreaterThan(0);
    expect(proof).toBeGreaterThan(measure);
    expect(heading).toBeGreaterThan(proof);
    // Exactly one proof row on the page.
    expect(live.match(/<LandingProof \/>/g)).toHaveLength(1);
  });

  it("at the top of a section the row is ruled off BELOW (it no longer hangs under a search)", () => {
    render(<LandingProof />);
    const cls = screen.getByTestId("landing-proof").className.split(/\s+/);
    expect(cls.length).toBeGreaterThan(3);
    expect(cls).toContain("border-b");
    expect(cls).not.toContain("border-t");
    expect(cls).not.toContain("mt-8");
  });
});
