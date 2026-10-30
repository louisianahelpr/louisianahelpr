/**
 * The shared dialog gives focus back when it closes. Radix returns focus only to a Dialog.Trigger, and nearly every
 * dialog in the app is opened from its own state with no Trigger, so Esc left focus on the page body. Renders the REAL
 * DialogContent on Radix's real focus scope.
 *
 * @mutate src/components/ui/useDialogFocus.ts |       opener.current.focus({ preventScroll: true }); |       void opener;
 * @mutate src/components/ui/useDialogFocus.ts |       onCloseAutoFocus?.(event);\n |       void onCloseAutoFocus;\n
 * @mutate src/components/ui/useDialogFocus.ts | had instanceof HTMLElement && had !== document.body ? had : null; | had instanceof HTMLElement ? had : null;
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog, DialogContent, DialogHero, DialogTrigger } from "@/components/ui/dialog";

function Harness({ onCloseAutoFocus, removeOpener = false }: { onCloseAutoFocus?: (e: Event) => void; removeOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  return (
    <>
      {!gone && (
        <button type="button" onClick={() => { setOpen(true); if (removeOpener) setTimeout(() => setGone(true)); }}>Open it</button>
      )}
      <button type="button">Something else</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogHero title="Sure?" />
        </DialogContent>
      </Dialog>
    </>
  );
}

async function pressEscape() {
  const dialog = screen.getByRole("dialog");
  await act(async () => {
    fireEvent.keyDown(dialog, { key: "Escape" });
  });
  await waitFor(() => expect(dialog.isConnected).toBe(false));
}

describe("DialogContent and focus on close", () => {
  it("a dialog with no Trigger gives focus back to the button that opened it", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open it" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    await pressEscape();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("a caller's onCloseAutoFocus decides first", async () => {
    const other = () => screen.getByRole("button", { name: "Something else", hidden: true });
    render(<Harness onCloseAutoFocus={(e) => { e.preventDefault(); other().focus(); }} />);
    const opener = screen.getByRole("button", { name: "Open it" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    await pressEscape();
    await waitFor(() => expect(document.activeElement).toBe(other()));
  });

  it("an opener that left the page is not focused and nothing throws", async () => {
    render(<Harness removeOpener />);
    const opener = screen.getByRole("button", { name: "Open it" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    await waitFor(() => expect(opener.isConnected).toBe(false));
    await pressEscape();
    expect(document.activeElement).not.toBe(opener);
  });

  it("a real Trigger still gets focus back, also when the tap gave it no focus (WebKit)", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open with trigger</DialogTrigger>
        <DialogContent><DialogHero title="Sure?" /></DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Open with trigger" });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    await pressEscape();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
