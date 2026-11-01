/**
 * Audit 11-01 JA-54: the Job done review sheet had no close X (only "Skip for now"). Owner 10-31: every sheet keeps
 * the X. A dialog that is a sheet on a phone opts in with `keepClose`; every other dialog keeps the one-dismissal rule
 * (popupDismiss.tsx: a labelled Cancel drops the X).
 *
 * @mutate src/components/ui/dialog.tsx |       {(keepClose \|\| !hasDismiss) && !closeDisabled && ( |       {!hasDismiss && !closeDisabled && (
 * @mutate src/components/reviewPanel/ReviewForm.tsx |       <DialogContent keepClose> |       <DialogContent>
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogFooter, DialogHero, DialogSecondaryAction } from "@/components/ui/dialog";
import { blankComments } from "./helpers/blankNonCode";

const box = (keepClose: boolean) => (
  <Dialog open>
    <DialogContent keepClose={keepClose}>
      <DialogHero moment title="Job done" />
      <DialogFooter>
        <DialogSecondaryAction onClick={() => {}}>Skip for now</DialogSecondaryAction>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

describe("the review sheet keeps its X (JA-54)", () => {
  it("keepClose draws the X beside a labelled dismiss", () => {
    render(box(true));
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
  });

  it("without it, the one-dismissal rule still holds for every other dialog", () => {
    render(box(false));
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("the Job done review opts in", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/reviewPanel/ReviewForm.tsx"), "utf8"));
    expect(src).toMatch(/<DialogContent keepClose>/);
  });
});
