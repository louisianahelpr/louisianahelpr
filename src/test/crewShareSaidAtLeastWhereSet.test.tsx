/**
 * Deep audit 11-22 #43: on a crew job, each Helpr's share was not shown where the budget is set. "At least $40 per
 * Helpr" showed only on the earlier Where screen, so the price screen said just "$80", and review then said "about $40
 * each", which disagreed with "at least" (the number is the smallest frozen share, crewSmallestShare / allocateCents).
 *
 * Fix: BudgetSection takes the crew size and says "Each of your N Helprs gets at least $X." under the price; the review
 * line reads "N Helprs, at least $X each".
 *
 * CLASS GUARD: every screen that computes a crew share for display (imports crewSmallestShare or allocateCents, outside
 * tests and the helper itself) words it "at least" (in its source or in the en string it reads), never "about" or "~".
 *
 * @mutate src/components/postjob/BudgetSection.tsx |           {crewSize > 1 && budgetNum > 0 && ( |           {false && (
 * @mutate src/pages/post-job/FormStep.tsx |             crewSize={form.isGroupJob ? (parseInt(form.helpersNeeded) \|\| 2) : 1} |             crewSize={1}
 * @mutate src/components/postjob/CheckoutBudgetLine.tsx |       {crewSize} Helprs, at least ${formatPriceExact(crewShare)} each |       {crewSize} Helprs, about ${formatPriceExact(crewShare)} each
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetSection } from "@/components/postjob/BudgetSection";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";
import { enPostJob } from "@/lib/i18n/enPostJob";

const noop = () => {};
function show(budget: string, crewSize?: number) {
  render(
    <BudgetSection stepNumber={3} budget={budget} setBudget={noop} isUrgent={false} setIsUrgent={noop} urgentFee="" setUrgentFee={noop}
      customUrgentFee={false} setCustomUrgentFee={noop} budgetComplete crewSize={crewSize} />,
  );
}

describe("deep audit 11-22 #43: the price screen says each crew Helpr's share", () => {
  it("$80 for a crew of 2: 'Each of your 2 Helprs gets at least $40.'", () => {
    show("80", 2);
    expect(screen.getByText("Each of your 2 Helprs gets at least $40.")).toBeInTheDocument();
  });

  it("an uneven split quotes the smallest share", () => {
    show("100", 3);
    expect(screen.getByText("Each of your 3 Helprs gets at least $33.33.")).toBeInTheDocument();
  });

  it("a one-Helpr job, or no budget yet, says nothing", () => {
    show("80");
    expect(document.querySelector("[data-crew-each]")).toBeNull();
    show("", 3);
    expect(document.querySelector("[data-crew-each]")).toBeNull();
  });

  it("Post a job passes the crew size to the price screen", () => {
    const form = blankComments(readFileSync(join(process.cwd(), "src/pages/post-job/FormStep.tsx"), "utf8"));
    expect(form).toContain("crewSize={form.isGroupJob ? (parseInt(form.helpersNeeded) || 2) : 1}");
  });
});

describe("CLASS: a crew share is worded 'at least', never 'about'", () => {
  const root = process.cwd();
  const files = walkSource([join(root, "src")])
    .filter((f) => !/\.test\.tsx?$|\/src\/test\//.test(f) && !f.endsWith("crewSmallestShare.ts"))
    .filter((f) => /\b(crewSmallestShare|allocateCents)\b/.test(blankComments(readFileSync(f, "utf8"))));

  it("finds the screens that show a crew share", () => {
    // GroupJobCard (Where), BudgetSection (price), CheckoutBudgetLine (review).
    expect(files.length).toBeGreaterThan(2);
  });

  it("each says 'at least' and none says 'about $' or '~$'", () => {
    const bad: string[] = [];
    for (const f of files) {
      const code = blankComments(readFileSync(f, "utf8"));
      const keys = [...code.matchAll(/\btr?\("([\w.]+)"/g)].map((m) => (enPostJob as Record<string, string>)[m[1]] ?? "");
      const words = code + "\n" + keys.join("\n");
      if (!/at least/.test(words) || /about \$|~\$/.test(words)) bad.push(relative(root, f));
    }
    expect(bad).toEqual([]);
  });
});
