/**
 * NIGHT-BUYINGopenpr-8 (buying night audit 10-30), the words part: the open-problem note said "reported by the helpr"
 * with a small h, built from `the ${reporter_side}`, while the next box says "The Helpr". Helpr is a name.
 * (The rest of that finding, three boxes that say nearly one thing and the tracker's place, is a layout call and
 * stays open.)
 *
 * @mutate src/components/declutter/DeclutterProblemOpen.tsx | problem.reporter_side === "helpr" ? "the Helpr" : | false ? "the Helpr" :
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProblemOpenNote } from "./DeclutterProblemOpen";
import type { OpenProblem } from "@/lib/declutter/handover";

const problem = (reporter_side: OpenProblem["reporter_side"]) =>
  ({ id: "p1", order_id: "o1", reporter_side, reason: "damaged" }) as OpenProblem;

describe("NIGHT-BUYINGopenpr-8: the problem note names the Helpr with a capital H", () => {
  it("a Helpr's report says the Helpr; the buyer's and the seller's say who in plain words", () => {
    const { unmount } = render(<ProblemOpenNote problem={problem("helpr")} side="buyer" />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("reported by the Helpr.");
    expect(text).not.toContain("the helpr");
    unmount();
    render(<ProblemOpenNote problem={problem("seller")} side="buyer" />);
    expect(screen.getByRole("status").textContent).toContain("reported by the seller.");
  });
});
