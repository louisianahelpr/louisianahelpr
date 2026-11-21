/**
 * Apple guideline 5.1.1(iv) (iOS pre-build check, lead 2026-11-20): a pre-permission screen in the iOS app may not
 * offer a way to decline or leave; it may only lead on to the system prompt, whose Allow / Don't Allow is the choice.
 * ease-1120's push ask ("Want a ping when someone applies?") offered "Not now" beside "Turn on notifications".
 *
 * So the rationale sheet has a continueOnly mode, which useWebPush's native iOS ask uses (appAsksWithTheSheetNotAToast):
 *  - exactly one button, "Continue", which always runs the OS call;
 *  - no "Not now", no corner X, and Escape does not close it;
 *  - without the mode (the website, Android, every other permission) the sheet keeps "Not now" and its own button.
 *
 * @mutate src/components/PermissionRationaleDialog.tsx |           {!state.continueOnly && ( |           {true && (
 * @mutate src/components/PermissionRationaleDialog.tsx | ? { closeDisabled: true, onEscapeKeyDown: (e: Event) => e.preventDefault(), onInteractOutside: (e: Event) => e.preventDefault() } : {} | ? {} : {}
 * @mutate src/hooks/usePermissionRationale.ts |   const copy = base && state.continueOnly ? { ...base, cta: "Continue" } : base; |   const copy = base;
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionRationaleDialog } from "@/components/PermissionRationaleDialog";
import { explainPermission, __resolveRationale } from "@/hooks/usePermissionRationale";

afterEach(() => {
  act(() => __resolveRationale(false));
});

const buttons = () => screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent?.trim());

describe("the iOS push ask leads only on to the system prompt (Apple 5.1.1(iv))", () => {
  it("continueOnly: one Continue, no Not now, no X; Escape keeps it; Continue runs the OS call", async () => {
    render(<PermissionRationaleDialog />);
    const run = vi.fn();
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = explainPermission("notifications", run, { continueOnly: true, words: { title: "Want a ping when someone applies?", body: "We'll let you know." } });
    });
    await act(async () => {});
    expect(screen.getByRole("alertdialog")).toHaveAttribute("data-continue-only");
    expect(buttons()).toEqual(["Continue"]);
    expect(screen.queryByText("Not now")).toBeNull();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    await act(async () => {});
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await expect(answer).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("without it (website, Android, other permissions) the sheet keeps Not now and its own button", async () => {
    render(<PermissionRationaleDialog />);
    act(() => {
      void explainPermission("notifications", () => {});
    });
    await act(async () => {});
    expect(screen.getByRole("alertdialog")).not.toHaveAttribute("data-continue-only");
    expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on notifications" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });
});
