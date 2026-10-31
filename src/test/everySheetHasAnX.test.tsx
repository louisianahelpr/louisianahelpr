/**
 * LEAD-SHEET-X-ONLY (owner 10-31: "every sheet has an X; no drag bar"). Every sheet draws its corner X, a
 * sheet whose footer has a Cancel too. Sheets used to follow popupDismiss.tsx's one-dismissal rule and hide
 * the X when a SheetSecondaryAction was in the footer; that is gone for sheets (dialogs keep it).
 *
 * Red first (10-31) on wip/b5-1031 32514897cc: the Cancel-footer sheet had no "Close" button.
 *
 * @mutate src/components/ui/sheet.tsx |           <SheetCloseButton top={closeTop} right={closeRight} /> |           {!children && <SheetCloseButton top={closeTop} right={closeRight} />}
 * @mutate src/components/ui/sheet.tsx |     // No dismiss registration: every sheet keeps its X beside this (owner 10-31, LEAD-SHEET-X-ONLY).\n    return ( |     useRegisterPopupDismiss();\n    return (
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHero,
  SheetPrimaryAction,
  SheetSecondaryAction,
} from "@/components/ui/sheet";
import { blankComments } from "@/test/helpers/blankNonCode";

const openSheet = (footer: boolean, floor: boolean) =>
  render(
    <Sheet open onOpenChange={() => {}}>
      <SheetContent side="bottom" floor={floor}>
        <SheetHero title="Manage listing" />
        <p>Body</p>
        {footer && (
          <SheetFooter>
            <SheetSecondaryAction onClick={() => {}}>Cancel</SheetSecondaryAction>
            <SheetPrimaryAction onClick={() => {}}>Save</SheetPrimaryAction>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>,
  );

describe("every sheet has an X (owner 10-31, LEAD-SHEET-X-ONLY)", () => {
  for (const floor of [false, true]) {
    it(`a sheet with a footer Cancel still shows the X${floor ? " (floor sheet)" : ""}`, () => {
      openSheet(true, floor);
      const sheet = screen.getByRole("dialog");
      // Inventory floor: the footer drew both of its actions.
      expect(within(sheet).getAllByRole("button").length).toBeGreaterThan(2);
      expect(within(sheet).getByRole("button", { name: "Cancel" })).toBeTruthy();
      expect(within(sheet).getByRole("button", { name: "Close" })).toBeTruthy();
    });

    it(`a sheet with no footer shows the X${floor ? " (floor sheet)" : ""}`, () => {
      openSheet(false, floor);
      expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" })).toBeTruthy();
    });
  }

  it("no grab handle or drag bar is drawn", () => {
    openSheet(true, true);
    const sheet = screen.getByRole("dialog");
    expect(sheet.querySelector("[data-sheet-handle]")).toBeNull();
  });

  it("every sheet in the app goes through the shared SheetContent (so it gets the X)", () => {
    const files = execSync("git ls-files src", { encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".tsx") && !/\.test\./.test(f) && f !== "src/components/ui/sheet.tsx");
    let sheets = 0;
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      if (/<SheetContent\b/.test(src)) sheets++;
      // A hand-rolled Radix sheet would skip the X; the only other Radix dialog users are the dialog family and
      // BirthdayPopup (a dialog, not a sheet).
      if (/@radix-ui\/react-dialog/.test(src)) {
        expect(
          ["src/components/ui/dialog.tsx", "src/components/ui/dialogActions.tsx", "src/components/BirthdayPopup.tsx"],
          `${f} builds its own Radix popup`,
        ).toContain(f);
      }
    }
    expect(sheets).toBeGreaterThan(30);
  });

  it("SheetSecondaryAction no longer registers a dismiss (source)", () => {
    const sheet = blankComments(readFileSync("src/components/ui/sheet.tsx", "utf8"));
    expect(sheet).not.toMatch(/useRegisterPopupDismiss\s*\(/);
    expect(sheet).not.toMatch(/!hasDismiss\s*&&/);
  });
});
