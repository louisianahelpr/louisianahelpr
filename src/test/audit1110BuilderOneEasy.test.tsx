/**
 * Whole-app audit 11-10, Builder 1's small Declutter fixes (one file so each has a red-then-green proof):
 *
 *  F360 — the floating "+ Sell" pill is not drawn on the Buying tab (it sat on the order cards' price, pickup chip,
 *         trade title and "See the item"; a member looking at what they bought is not here to sell). Same switch as
 *         owner pick 4 (Wanted and Deliver have their own main button): DeclutterHomeView's `ownMainButton`.
 *  F313 — Browse's category chips are the shared FilterChip in its `tall` size (min-h-11 = 44px); the default chip is
 *         40px, under the tap floor for a strip thumbed sideways on a phone.
 *  F388 — while the "Report a problem" form is open it mounts HideSectionCreateFab, so the pill never sits on the
 *         photos row next to Send.
 *
 * @mutate src/components/declutter/DeclutterHomeView.tsx | view === "wanted" \|\| view === "deliver" \|\| view === "buying" \|\| view === "selling"; | view === "wanted" \|\| view === "deliver" \|\| view === "selling";
 * @mutate src/components/declutter/DeclutterProblemForm.tsx |       <HideSectionCreateFab />\n |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/lib/declutter/handover", () => ({ reportProblem: vi.fn() }));

import { ProblemForm } from "@/components/declutter/DeclutterProblemForm";
import { useSectionCreateFabHidden } from "@/components/sections/createFabHidden";

afterEach(cleanup);
const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));

describe("F360: no + Sell pill on the Buying tab", () => {
  it("DeclutterHomeView counts Buying among the views with no pill, beside Wanted and Deliver", () => {
    const src = code("src/components/declutter/DeclutterHomeView.tsx");
    const line = src.split("\n").find((l) => l.includes("const ownMainButton ="));
    expect(line).toBeDefined();
    expect(line).toContain('view === "buying"');
    expect(line).toContain('view === "wanted"');
    expect(line).toContain('view === "deliver"');
    // The pill still follows that switch (not a second one).
    expect(src).toMatch(/const fab = desktop \|\| ownMainButton \? undefined : <SectionCreateFab/);
  });
});

// F313 (category chips at the 44px floor) retired with the chip row: owner 11-25 moved the categories into Filters.

describe("F388: the pill steps aside while Report a problem is open", () => {
  it("the open form hides the section's create pill; closed, it does not", () => {
    const qc = new QueryClient();
    const probe = renderHook(() => useSectionCreateFabHidden());
    expect(probe.result.current).toBe(false);
    const closed = render(<QueryClientProvider client={qc}><ProblemForm orderId="o1" side="buyer" stage="waiting" open={false} onOpenChange={() => undefined} /></QueryClientProvider>);
    expect(probe.result.current).toBe(false);
    closed.unmount();
    render(<QueryClientProvider client={qc}><ProblemForm orderId="o1" side="buyer" stage="waiting" open onOpenChange={() => undefined} /></QueryClientProvider>);
    expect(screen.getByLabelText("Tell us what happened")).toBeInTheDocument();
    expect(probe.result.current).toBe(true);
  });
});
