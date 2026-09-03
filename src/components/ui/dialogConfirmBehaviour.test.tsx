/**
 * The three BEHAVIOURS the alert-dialog merge could have broken silently.
 *
 * Everything else about that merge is checked by reading source
 * (`dialogShell.test.ts`). These three cannot be: they are what Radix does at
 * runtime, they produce no error when wrong, and each one looks completely
 * correct in a diff.
 *
 *   1. A confirm's buttons must DISMISS it. `AlertDialogAction` and
 *      `AlertDialogCancel` were both `DialogPrimitive.Close` under the hood, so
 *      this was free; `DialogPrimaryAction` is a plain <Button> and it is not.
 *      A straight rename would have left ban-user, remove-review, delete-note
 *      and delete-account open after you confirmed.
 *   2. A confirm must close on TAP-OUTSIDE — the owner's instruction, and the
 *      thing Radix's AlertDialog made impossible (it assigns
 *      `onPointerDownOutside` to preventDefault after spreading caller props).
 *   3. `closeDisabled` must shut BOTH routes again, for TermsReconsent, where
 *      leaving is not a legitimate outcome. Dialog's defaults are the opposite
 *      of AlertDialog's, so migrating that one untouched would have let a user
 *      tap the scrim and skip re-consenting to the terms.
 *
 * A regular (non-confirm) dialog is asserted alongside each, because "the
 * confirm closes" is only half the claim — the other half is that a FORM dialog
 * still does NOT auto-close, which is what 29 of them depend on.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";

/**
 * `fireEvent`, not `@testing-library/user-event` — that package is not a
 * dependency here and adding one to prove a behaviour is the wrong trade.
 *
 * Radix's DismissableLayer listens for `pointerdown` on the DOCUMENT and
 * decides "outside" from the event target, so a pointerdown on <body> is
 * exactly the gesture under test. It is dispatched with `bubbles` because the
 * listener is on document, not on body.
 */
const tapOutside = async () => {
  // Radix attaches its outside-pointerdown listener inside a setTimeout(…, 0),
  // so firing immediately after render hits a document that is not listening
  // yet — the test fails and the code is fine. Let the timeout run first.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  // Fire on the OVERLAY, not <body>. Radix decides "outside" from the event
  // TARGET, and a modal Dialog sets `pointer-events: none` on body — in a real
  // browser the scrim is what receives the tap, and jsdom does no hit-testing
  // so it must be named explicitly.
  const overlay = document.querySelector("[data-state=open][aria-hidden=true]") ?? document.body;
  fireEvent.pointerDown(overlay, { bubbles: true, pointerType: "mouse", button: 0 });
  fireEvent.mouseDown(overlay, { bubbles: true, button: 0 });
  fireEvent.click(overlay, { bubbles: true, button: 0, detail: 1 });
};
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from "@/components/ui/dialog";

function Harness({
  confirm,
  closeDisabled,
  onOpenChange,
}: {
  confirm: boolean;
  closeDisabled?: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        {...(confirm ? { role: "alertdialog" as const } : {})}
        closeDisabled={closeDisabled}
      >
        <DialogHero title="Delete This Thing?" />
        <DialogFooter>
          <DialogSecondaryAction>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction>Delete</DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

afterEach(cleanup);

describe("confirm dialog behaviour", () => {
  it("a confirm's Cancel and commit both dismiss it; a form dialog's do not", async () => {
    for (const label of ["Cancel", "Delete"]) {
      const onOpenChange = vi.fn();
      const { unmount } = render(<Harness confirm onOpenChange={onOpenChange} />);
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(
        onOpenChange,
        `a confirm's "${label}" must close it — this is what MaybeClose restores`,
      ).toHaveBeenCalledWith(false);
      unmount();
    }

    // The other half of the claim. 29 form dialogs submit and then decide what
    // happens next; auto-closing them would be a regression, not a fix.
    for (const label of ["Cancel", "Delete"]) {
      const onOpenChange = vi.fn();
      const { unmount } = render(<Harness confirm={false} onOpenChange={onOpenChange} />);
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(
        onOpenChange,
        `a FORM dialog's "${label}" must NOT auto-close — the caller owns that`,
      ).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("a confirm closes on tap-outside — the thing AlertDialog made impossible", async () => {
    const onOpenChange = vi.fn();
    render(<Harness confirm onOpenChange={onOpenChange} />);

    // The overlay is the scrim behind the card; clicking it is "tap out".
    await tapOutside();
    await waitFor(() =>
      expect(
        onOpenChange,
        'owner: "But also allow tap out to close on all." Radix\'s AlertDialog ' +
          "hard-coded onPointerDownOutside to preventDefault AFTER spreading caller " +
          "props, so this was unreachable for all 43 confirm boxes.",
      ).toHaveBeenCalledWith(false),
    );
  });

  it("closeDisabled shuts every exit — no X, no tap-outside, no Escape", async () => {
    const onOpenChange = vi.fn();
    render(<Harness confirm closeDisabled onOpenChange={onOpenChange} />);

    expect(
      screen.queryByRole("button", { name: /close/i }),
      "closeDisabled must remove the corner X",
    ).toBeNull();

    await tapOutside();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(
      onOpenChange,
      "TermsReconsent must not be dismissable — Dialog closes on backdrop and " +
        "Escape where AlertDialog closed on neither, so migrating it untouched " +
        "would have let a user skip re-consenting to the terms",
    ).not.toHaveBeenCalled();
  });

  it("a confirm renders role=alertdialog, and a form dialog does not", () => {
    const { unmount } = render(<Harness confirm onOpenChange={vi.fn()} />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    unmount();
    render(<Harness confirm={false} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
