/**
 * Audit #42 (Declutter deep audit, 2026-10-28): a section not open to the
 * viewer said "Coming soon" on the phone's Explore chips but "Soon" on the
 * desktop rail. The lead's rule: a member sees "Coming soon" wherever the
 * section is listed in the nav; a tester who can open it sees "Preview"
 * (previewMark.test.tsx). On the rail it is a muted line under the name: as a
 * pill beside "Declutter" it ran 21px past the nested row (WebKit, 1440,
 * ~/.lh-shots/b3-1028/s42).
 *
 * @mutate src/components/DesktopSidebarNav.tsx | {soon && <SoonPill variant="rail" aria-hidden="true" />} | {soon && <SoonPill variant="short" aria-hidden="true" />}
 * @mutate src/components/sections/SoonPill.tsx | leading-tight text-muted-foreground ${className}`}>\n        Coming soon | leading-tight text-muted-foreground ${className}`}>\n        Soon
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { SoonPill } from "@/components/sections/SoonPill";
import { blankComments } from "./helpers/blankNonCode";

describe("the desktop rail says Coming soon", () => {
  it("the rail pill reads 'Coming soon'", () => {
    render(<SoonPill variant="rail" data-x="" />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });

  it("the rail draws the rail pill for a section closed to the viewer", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/DesktopSidebarNav.tsx"), "utf8"));
    expect(src).toMatch(/\{soon && <SoonPill variant="rail"/);
  });
});
