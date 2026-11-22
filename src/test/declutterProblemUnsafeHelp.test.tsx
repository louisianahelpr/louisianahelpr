/**
 * Deep audit 11-22 #39: picking "I felt unsafe" on a Declutter problem report changed nothing: the same general box and
 * "nobody is paid until Louisiana Helpr decides", with no 911 line and no quick way to a person. Every side and stage
 * that offers "I felt unsafe" (the inventory is PROBLEM_REASONS itself) now shows the 911 phone link and Get help now
 * once it is picked, and no other reason shows them.
 *
 * @mutate src/components/declutter/DeclutterProblemForm.tsx |       {reason === "safety" && <SafetyHelp orderId={orderId} />} |       {false && <SafetyHelp orderId={orderId} />}
 * @mutate src/components/jobs/GetHelpNow.tsx | <a href="tel:911" | <a href="/support"
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/declutter/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/handover")>()), reportProblem: vi.fn(), setProblemWants: vi.fn() }));

import { ProblemForm } from "@/components/declutter/DeclutterProblemForm";
import { PROBLEM_REASONS, type ProblemStage } from "@/components/declutter/problemReasons";

const wrap = (ui: React.ReactNode) => render(<MemoryRouter><QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider></MemoryRouter>);

describe("#39: I felt unsafe gives safety help", () => {
  it("every form that offers I felt unsafe shows call 911 and Get help now once it is picked; other reasons don't", () => {
    let checked = 0;
    for (const side of ["buyer", "seller"] as const) {
      for (const [stage, reasons] of Object.entries(PROBLEM_REASONS[side]) as [ProblemStage, readonly (readonly [string, string])[]][]) {
        if (!reasons.some(([r]) => r === "safety")) continue;
        const r = wrap(<ProblemForm orderId="o1" side={side} stage={stage} open onOpenChange={() => undefined} />);
        expect(document.querySelector("[data-problem-safety]"), `${side}/${stage} before a pick`).toBeNull();
        const other = reasons.find(([x]) => x !== "safety");
        if (other) {
          fireEvent.click(screen.getByRole("radio", { name: other[1] }));
          expect(document.querySelector("[data-problem-safety]"), `${side}/${stage} ${other[0]}`).toBeNull();
        }
        fireEvent.click(screen.getByRole("radio", { name: "I felt unsafe" }));
        const help = document.querySelector("[data-problem-safety]") as HTMLElement | null;
        expect(help, `${side}/${stage}`).not.toBeNull();
        expect(help!.textContent).toMatch(/If you're in danger right now, call 911\./);
        expect(within(help!).getByRole("link", { name: "call 911" }).getAttribute("href")).toBe("tel:911");
        expect(within(help!).getByRole("button", { name: /Get help now/ })).toBeInTheDocument();
        r.unmount();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(4);
  });
});
