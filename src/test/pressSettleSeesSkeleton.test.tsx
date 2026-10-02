// THE PRESS HARNESS MUST WAIT FOR THE APP'S OWN SKELETON.
//
// press-every-control's settle() decided a screen was loaded when no
// `[aria-busy]` and no `animate-pulse` remained. The shared <Skeleton> shimmers
// with `animate-[shimmer_2s_infinite]` instead, so settle never saw it: on run
// 36986080914 /profile?tab=earnings was pressed while EarningsPageSkeleton was
// still waiting on Stripe, and "More Insights" was reported "not found on a
// freshly loaded page". The selector settle() uses is LOADING_SEL; this pins
// that every loading primitive the app renders matches it.
//
// @mutate scripts/audit/pressLoadHealth.mjs | , [class*="animate-[shimmer"]' | '
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";

import { LOADING_SEL } from "../../scripts/audit/pressLoadHealth.mjs";
import { Skeleton } from "@/components/ui/skeleton";

describe("press settle() sees every loading primitive", () => {
  it("matches the shared <Skeleton>", () => {
    const { container } = render(<Skeleton className="h-4 w-10" />);
    expect(container.querySelectorAll(LOADING_SEL).length).toBe(1);
  });

  it("matches animate-pulse and aria-busy", () => {
    const { container } = render(
      <div>
        <div className="animate-pulse" />
        <div aria-busy="true" />
      </div>,
    );
    expect(container.querySelectorAll(LOADING_SEL).length).toBe(2);
  });

  it("settle() waits on LOADING_SEL, not a hand-written subset", () => {
    const src = readFileSync("scripts/audit/press-every-control.mjs", "utf8");
    const settle = src.slice(src.indexOf("const settle = async"), src.indexOf("const settle = async") + 600);
    expect(settle).toContain("LOADING_SEL");
    expect(settle).not.toContain('"animate-pulse"');
  });
});
