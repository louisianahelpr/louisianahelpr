/**
 * Polish audit 11-27 #46 (~/.lh-shots/polish-audit-1127/FINDINGS.md, jobs/combo-map-done.png): the Location sheet a
 * signed-out guest gets on the Jobs map said "your most recent location is saved to your profile". A guest has no
 * profile, so that was untrue for them. Signed out, both location sheets (Jobs and Declutter) now use their guest
 * line; signed in, the full line with the saving clause stays (the write path saves it to the profile).
 * Inventory: every permission kind whose words mention the profile.
 *
 * @mutate src/components/PermissionRationaleDialog.tsx |           {!user && copy.guestBody ? copy.guestBody : copy.body} |           {copy.body}
 * @mutate src/hooks/usePermissionRationale.ts | ...state.words, guestBody: undefined } | ...state.words }
 */
import { act, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: auth.user, isReady: true }) }));

import { PermissionRationaleDialog } from "@/components/PermissionRationaleDialog";
import { explainPermission, __resolveRationale, type PermissionKind } from "@/hooks/usePermissionRationale";

afterEach(() => {
  act(() => __resolveRationale(false));
  cleanup();
});

const KINDS: PermissionKind[] = ["location", "declutter_location"];

async function open(kind: PermissionKind, words?: { title: string; body: string }) {
  render(<PermissionRationaleDialog />);
  act(() => { void explainPermission(kind, () => {}, words ? { words } : undefined); });
  await act(async () => {});
  return screen.getByRole("alertdialog").textContent ?? "";
}

describe("#46: the location sheet never tells a guest about their profile", () => {
  it("checks both location kinds (inventory floor)", () => {
    expect(KINDS.length).toBeGreaterThan(1);
  });
  it.each(KINDS)("%s signed out: no profile sentence, still says others never see the exact spot", async (kind) => {
    auth.user = null;
    const text = await open(kind);
    expect(text).not.toMatch(/profile/i);
    expect(text).toMatch(/only checked while you're using the app/);
    expect(text).toMatch(/never (?:see )?your exact location/);
  });
  it.each(KINDS)("%s signed in: the saving clause stays", async (kind) => {
    auth.user = { id: "u1" };
    const text = await open(kind);
    expect(text).toMatch(/saved to your profile/);
  });
  it("an ask in context keeps its own line for a guest", async () => {
    auth.user = null;
    const text = await open("location", { title: "Find jobs near you?", body: "Our own words here." });
    expect(text).toMatch(/Our own words here\./);
  });
});
