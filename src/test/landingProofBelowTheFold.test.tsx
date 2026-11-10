/**
 * THE FIRST SCREEN IS JUST THE HEADLINE, THE SUBHEAD AND THE SEARCH (owner, 2026-11-02, via the lead: the
 * landing on a phone had the "Just finished · 2 yards in New Iberia" proof row sitting alone at the very
 * bottom of the full-height hero). The hero keeps its empty space (owner correction, same day: "no spacing
 * change"); the proof row (with its "Paid when it's done" line) moves OUT of the hero to the top of the next
 * section, below the fold, at every width. Since Direction A (owner 11-10) the finished job is the photo band UNDER
 * the hero (LandingPhotoBand, src/test/landingDirectionA1110.test.tsx), never inside it.
 *
 * Before/after screenshots at 390x844, 375x667 and 1440x900: ~/.lh-shots/b188/hero-*.png.
 *
 * @mutate src/components/landing/HeroSection.tsx |       </div>\n    </section> |       </div>\n      <LandingPhotoBand />\n    </section>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } }));

import HeroSection from "@/components/landing/HeroSection";

afterEach(() => cleanup());

describe("the landing's first screen is the headline, subhead and search only (owner 2026-11-02)", () => {
  it("the hero renders its headline and search but no proof row", () => {
    render(<MemoryRouter><HeroSection /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("search")).toBeTruthy();
    expect(screen.queryByTestId("landing-proof")).toBeNull();
    expect(screen.queryByTestId("landing-photo-band")).toBeNull();
    expect(screen.queryByText("Just finished")).toBeNull();
  });
});
