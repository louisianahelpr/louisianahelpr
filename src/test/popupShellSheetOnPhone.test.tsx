/**
 * THE SHARED POPUP SHELL (spec v2 §3 "Sheets and menus"; lead 2026-10-20):
 * on the phone every popup is a bottom sheet (full width, pinned to the bottom,
 * 28px top corners, square bottom corners, NO drag bar: owner 10-31 14:22, every sheet keeps the X only); from sm it is a
 * centred 480px dialog; its primary and secondary actions are pills.
 *
 * ONE place: DialogContent wears POPUP_SHEET_CLS + POPUP_DIALOG_CLS
 * (popupFooter.ts), and every Dialog-family action reads POPUP_ACTION_RADIUS,
 * so no popup can opt out by accident.
 *
 * @mutate src/components/ui/popupFooter.ts |   "fixed inset-x-0 bottom-0 w-full max-w-full max-h-[92dvh] !rounded-b-none " + |   "fixed left-1/2 top-1/2 w-full max-w-full max-h-[92dvh] " +
 * @mutate src/components/ui/popupFooter.ts | sm:w-full sm:max-w-[480px] | sm:w-full sm:max-w-lg
 * @mutate src/components/ui/popupFooter.ts | const POPUP_ACTION_RADIUS = "rounded-full"; | const POPUP_ACTION_RADIUS = "rounded-ds-md";
 * @mutate src/components/ui/sheet.tsx | `overflow-y-auto data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 ${POPUP_SHEET_CLS} ${POPUP_DIALOG_CLS}` | `overflow-y-auto data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0`
 * @mutate src/components/ui/dialog.tsx |       <DialogConfirmCtx.Provider value={isConfirm}> |       <span data-sheet-handle aria-hidden className="sm:hidden absolute left-1/2 top-2 h-1 w-9 rounded-full" /><DialogConfirmCtx.Provider value={isConfirm}>
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from "@/components/ui/dialog";
import { POPUP_DIALOG_CLS, POPUP_SHEET_CLS } from "@/components/ui/popupFooter";

afterEach(cleanup);

function open() {
  render(
    <Dialog open>
      <DialogContent>
        <DialogHero title="Log out?" />
        <DialogFooter>
          <DialogSecondaryAction>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction>Log out</DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
  return screen.getByRole("dialog");
}

describe("every popup: a sheet on the phone, a 480px dialog on desktop, pill actions", () => {
  it("the phone half is a bottom sheet", () => {
    for (const c of ["fixed", "inset-x-0", "bottom-0", "w-full", "!rounded-b-none", "data-[state=open]:slide-in-from-bottom"]) {
      expect(POPUP_SHEET_CLS.split(/\s+/)).toContain(c);
    }
  });

  it("the desktop half is the centred 480px dialog", () => {
    for (const c of ["sm:left-1/2", "sm:top-1/2", "sm:[translate:-50%_-50%]", "sm:max-w-[480px]", "sm:bottom-auto", "sm:!rounded-b-[28px]"]) {
      expect(POPUP_DIALOG_CLS.split(/\s+/)).toContain(c);
    }
  });

  it("a rendered dialog wears both halves, no drag bar, and pill actions", () => {
    const d = open();
    const cls = d.className.split(/\s+/);
    for (const c of ["bottom-0", "inset-x-0", "!rounded-b-none", "sm:max-w-[480px]", "sm:top-1/2"]) expect(cls).toContain(c);
    // The old centred-on-phone card is gone.
    expect(cls).not.toContain("top-1/2");
    expect(cls).not.toContain("w-[calc(100vw-2rem)]");
    // Owner 10-31 14:22: no drag bar on any sheet, app-wide (b19 took it off SheetContent; this is the dialog's).
    expect(d.querySelector("[data-sheet-handle]")).toBeNull();
    expect(d.querySelector("[class*='rounded-full'][aria-hidden]")).toBeNull();
    for (const name of ["Cancel", "Log out"]) {
      expect(screen.getByRole("button", { name }).className).toMatch(/\brounded-full\b/);
    }
  });
});

describe("sheets share the shell: a bottom sheet on the phone, the 480px dialog from sm", () => {
  it("sheetVariants' bottom side wears both popup strings, and the floor sheet is phone-only CSS", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { blankComments } = await import("./helpers/blankNonCode");
    const sheet = blankComments(readFileSync(resolve(__dirname, "../components/ui/sheet.tsx"), "utf8"));
    expect(sheet).toContain("${POPUP_SHEET_CLS} ${POPUP_DIALOG_CLS}");
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    const at = css.indexOf(".sheet-floor {");
    expect(css.lastIndexOf("@media (max-width: 639.98px) {", at)).toBeGreaterThan(at - 400);
  });
});
