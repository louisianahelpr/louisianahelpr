/**
 * D4-5: a Declutter sheet takes focus when it opens and gives it back to its button when it closes. Renders the REAL
 * shared sheet the Declutter screens use, on Radix's real focus scope. Inventory: every Declutter sheet that opts out of
 * Radix's default focus goes through focusSheetItself; none cancels it and focuses nothing.
 *
 * @mutate src/components/declutter/focusSheetItself.ts |   (e.target as HTMLElement \| null)?.focus?.({ preventScroll: true }); |   void e;
 * @mutate src/components/declutter/DeclutterConfirmSheet.tsx | onOpenAutoFocus={focusSheetItself} | onOpenAutoFocus={(e) => e.preventDefault()}
 * @mutate src/components/ui/sheet.tsx |             opener.current.focus(); |             void opener;
 * @mutate src/components/ui/sheet.tsx |             opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; |             opener.current = null;
 */
import { readFileSync } from "node:fs";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfirmSheet as DeclutterConfirmSheet } from "@/components/declutter/DeclutterConfirmSheet";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      <DeclutterConfirmSheet open={open} title="Sure?" confirmLabel="Yes" cancelLabel="Not now" pending={false} onConfirm={() => setOpen(false)} onClose={() => setOpen(false)}>
        Body
      </DeclutterConfirmSheet>
    </>
  );
}

describe("Declutter sheets and focus (D4-5)", () => {
  it("focus moves into the sheet on open and back to its button on close", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open it" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("no Declutter sheet cancels the opening focus and leaves it behind", () => {
    const files = trackedFiles("src/components/declutter").filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(60);
    let helped = 0;
    const bad: string[] = [];
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      if (/onOpenAutoFocus=\{\s*\(?\w*\)?\s*=>\s*\w+\.preventDefault\(\)\s*\}/.test(src)) bad.push(f);
      helped += (src.match(/onOpenAutoFocus=\{focusSheetItself\}/g) ?? []).length;
    }
    expect(bad).toEqual([]);
    expect(helped).toBeGreaterThan(8);
  });
});
