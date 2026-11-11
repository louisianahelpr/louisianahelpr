/**
 * F360a (whole-app audit 11-10; owner pop-up 11-11 ~2:10 PM): "Report a problem adds 'Refund me' vs 'Swap / fix it'
 * choice; refund rules unchanged." A first-timer did not know whether to ask for money back or a swap.
 *
 * The buyer's item report (damaged, not as described, something else) asks "What would make it right?"; the choice is
 * saved on the report (declutter_problem_set_wants, migration 20261111204024, PGlite proof
 * src/test/pglite/declutterProblemBuyerWants.pglite.mjs) and both sides read it on the open-problem note. Nothing about
 * the refund changes: the report path, its reasons and Louisiana Helpr's decision are as before.
 *
 * @mutate src/components/declutter/DeclutterProblemForm.tsx | try { await setProblemWants(id, wants); } | try { void id; }
 * @mutate src/components/declutter/DeclutterProblemForm.tsx | const asksWants = side === "buyer" && !!reason && WANTS_REASONS.includes(reason); | const asksWants = false;
 * @mutate src/components/declutter/DeclutterProblemForm.tsx | const WANTS_REASONS: readonly ProblemReason[] = ["damaged", "not_as_described", "other"]; | const WANTS_REASONS: readonly ProblemReason[] = ["damaged", "not_as_described", "other", "safety"];
 * @mutate src/components/declutter/DeclutterProblemOpen.tsx | {problem.reporter_side === "buyer" && problem.buyer_wants && ( | {false && (
 * @mutate src/lib/declutter/handover.ts | .select("id, order_id, reporter_side, reason, buyer_wants") | .select("id, order_id, reporter_side, reason")
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const calls = vi.hoisted(() => ({ report: [] as unknown[][], wants: [] as unknown[][] }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/declutter/handover", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/handover")>()),
  reportProblem: async (...a: unknown[]) => { calls.report.push(a); return "p1"; },
  setProblemWants: async (...a: unknown[]) => { calls.wants.push(a); return a[1]; },
}));

import { ProblemForm } from "@/components/declutter/DeclutterProblemForm";
import { ProblemOpenNote } from "@/components/declutter/DeclutterProblemOpen";

const REPO = resolve(__dirname, "..", "..");
const code = (p: string) => blankComments(readFileSync(resolve(REPO, p), "utf8"));
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => { calls.report = []; calls.wants = []; });

describe("F360a: Refund me or Swap / fix it", () => {
  it("the buyer's item report asks, and the choice is saved on the report after it is sent", async () => {
    wrap(<ProblemForm orderId="o1" side="buyer" stage="handover" open onOpenChange={() => undefined} />);
    expect(screen.queryByRole("radiogroup", { name: "What would make it right?" })).toBeNull(); // not before a reason
    fireEvent.click(screen.getByRole("radio", { name: "It's damaged" }));
    const group = screen.getByRole("radiogroup", { name: "What would make it right?" });
    expect([...group.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual(["Refund me", "Swap / fix it"]);
    fireEvent.click(screen.getByRole("radio", { name: "Swap / fix it" }));
    fireEvent.change(screen.getByLabelText("Tell us what happened"), { target: { value: "The leg is cracked through." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls.wants).toEqual([["p1", "swap_fix"]]));
    expect(calls.report).toHaveLength(1);
    expect(calls.report[0].slice(0, 2)).toEqual(["o1", "damaged"]);
  });

  it("not asked for a report with no item to swap, nor of the seller; a report without a choice saves none", async () => {
    const a = wrap(<ProblemForm orderId="o1" side="buyer" stage="handover" open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("radio", { name: "I felt unsafe" }));
    expect(screen.queryByRole("radiogroup", { name: "What would make it right?" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tell us what happened"), { target: { value: "They shouted at me." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls.report).toHaveLength(1));
    expect(calls.wants).toEqual([]);
    a.unmount();
    wrap(<ProblemForm orderId="o1" side="seller" stage="handover" open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("radio", { name: "Something else" }));
    expect(screen.queryByRole("radiogroup", { name: "What would make it right?" })).toBeNull();
  });

  it("both sides read the buyer's choice on the open-problem note", () => {
    const problem = { id: "p1", order_id: "o1", reporter_side: "buyer" as const, reason: "damaged" as const, buyer_wants: "swap_fix" as const };
    const s = render(<ProblemOpenNote problem={problem} side="seller" />);
    expect(s.container.querySelector("[data-problem-wants]")?.textContent).toBe("The buyer asks for: a swap or a fix.");
    s.unmount();
    const b = render(<ProblemOpenNote problem={{ ...problem, buyer_wants: "refund" }} side="buyer" />);
    expect(b.container.querySelector("[data-problem-wants]")?.textContent).toBe("You asked for: a refund.");
    b.unmount();
    const none = render(<ProblemOpenNote problem={{ ...problem, buyer_wants: null }} side="seller" />);
    expect(none.container.querySelector("[data-problem-wants]")).toBeNull();
  });

  it("the open-problems read asks for the column; the migration is buyer-only and grants no UPDATE", () => {
    expect(code("src/lib/declutter/handover.ts")).toContain('.from("declutter_problems").select("id, order_id, reporter_side, reason, buyer_wants")');
    const sql = readFileSync(resolve(REPO, "supabase/migrations/20261111204024_declutter_problem_buyer_wants.sql"), "utf8");
    expect(sql).toContain("p.reporter_id IS DISTINCT FROM v_uid OR p.reporter_side <> 'buyer'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_problem_set_wants(uuid, text) FROM PUBLIC, anon;");
    expect(sql).not.toMatch(/GRANT\s+UPDATE/i);
  });
});
