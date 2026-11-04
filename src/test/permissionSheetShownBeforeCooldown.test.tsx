/**
 * Q2003 (lead 11-04): "shown" means ON SCREEN. explainPermission's onShown runs when PermissionRationaleDialog has
 * rendered the open rationale, never when it was only asked for; useWebPush stamps its 14-day cooldown there, so a
 * page that leaves before the sheet renders (a post handing off to Stripe Checkout) does not spend the ask.
 *
 * @mutate src/components/PermissionRationaleDialog.tsx |     __markRationaleShown();\n  }, [token]); |   }, [token]);
 * @mutate src/hooks/usePermissionRationale.ts |   return explainThenRun(kind, run, opts?.onShown); |   opts?.onShown?.(); return explainThenRun(kind, run);
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PermissionRationaleDialog } from "@/components/PermissionRationaleDialog";
import { explainPermission, __resolveRationale } from "@/hooks/usePermissionRationale";

describe("the notifications sheet reports shown only once it rendered", () => {
  it("no dialog mounted (the page left first): onShown never runs", async () => {
    const onShown = vi.fn();
    let done = false;
    const answer = explainPermission("notifications", () => {}, { onShown }).then(() => { done = true; });
    await act(async () => {});
    expect(onShown).not.toHaveBeenCalled();
    act(() => __resolveRationale(false));
    await answer;
    expect(done).toBe(true);
    expect(onShown).not.toHaveBeenCalled();
  });

  it("the dialog renders the sheet: onShown runs once, after it is on screen", async () => {
    render(<PermissionRationaleDialog />);
    const seen: boolean[] = [];
    const onShown = vi.fn(() => seen.push(!!screen.queryByText("Turn on notifications")));
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = explainPermission("notifications", () => {}, { onShown });
    });
    await act(async () => {});
    expect(onShown).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([true]);
    act(() => __resolveRationale(false));
    await answer;
    expect(onShown).toHaveBeenCalledTimes(1);
  });
});
