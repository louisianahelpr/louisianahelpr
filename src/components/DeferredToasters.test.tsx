/**
 * The app's one toast host really mounts, after first paint (DeferredToasters).
 *
 * It was once switched off while its comment still claimed it was mounted, which silenced every
 * `toast.error` in the app, money paths included (see the note in DeferredToasters.tsx). Before this
 * test nothing rendered DeferredToasters (src/test/guestLoadsNoSignedInChrome.test.tsx only reads its
 * source), so dropping <Sonner /> from it stayed green. Here it is rendered for real: the lazy Sonner
 * host appears, and an error toast fired through the app's own wrapper is drawn in it.
 *
 * @mutate src/components/DeferredToasters.tsx |       <Sonner />\n | \n
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

// The signed-in-only half (SuccessMomentHost) is not under test: a guest sees none of it.
vi.mock("@/components/SignedInChrome", () => ({ SignedInOnly: () => null }));

import DeferredToasters from "./DeferredToasters";
import { toast } from "@/components/ui/sonner";

describe("DeferredToasters mounts the toast host", () => {
  it("draws the lazy Sonner host and shows an error toast in it", async () => {
    const { container } = render(<DeferredToasters />);
    await waitFor(() => expect(container.ownerDocument.querySelector("section[aria-label^='Notifications']")).not.toBeNull());
    act(() => {
      toast.error("We couldn't save that.");
    });
    expect(await screen.findByText("We couldn't save that.")).toBeTruthy();
  });
});
