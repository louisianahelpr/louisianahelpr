// @mutate src/components/declutter/DeclutterSkeletons.tsx |         <Skeleton className="h-11 w-full rounded-ds-md" aria-hidden /> |         <><Skeleton className="h-11 w-full rounded-ds-md" aria-hidden /><Skeleton className="h-10 w-full rounded-full" aria-hidden /></>
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/components/sections/SectionScreen", () => ({
  SectionScreen: ({ tabs, children }: { tabs: React.ReactNode; children: React.ReactNode }) => (
    <div>
      <div data-slot="tabs">{tabs}</div>
      <div data-slot="body">{children}</div>
    </div>
  ),
}));
import { DeclutterHomeSkeleton } from "@/components/declutter/DeclutterSkeletons";

/**
 * Q1695 (loading-states refresh 2026-11-03 19:40Z, bot PR #3963, 375, customer and anon): /declutter's loading
 * frame drew a phone search row under the tabs, but Browse's phone search and filters end the tabs row itself
 * (DeclutterBrowseView's phone header, owner 10-30). The body started 43px lower than the page that replaced it
 * ("row 672px -> 715px"). The tabs slot now holds the tab row's one bone, on a phone as on desktop.
 */
describe("Q1695: /declutter's loading frame has no phone search row under the tabs", () => {
  it("the tabs slot is the tab row's one 44px bone at 375", () => {
    const r = render(<MemoryRouter><DeclutterHomeSkeleton /></MemoryRouter>);
    const slot = r.container.querySelector("[data-slot='tabs']") as HTMLElement;
    expect(slot.children).toHaveLength(1);
    expect((slot.children[0] as HTMLElement).className).toMatch(/\bh-11\b/);
    expect(r.container.querySelector("[data-slot='body'] [role='status']")).not.toBeNull();
  });

  it("the real phone Browse header puts search and filters at the end of the tabs row (the premise above)", () => {
    const view = blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeclutterBrowseView.tsx"), "utf8"));
    expect(view).toMatch(/data-browse-phone-controls/);
    expect(view).toMatch(/tabs=\{tabs\(header\)\}/);
  });
});
