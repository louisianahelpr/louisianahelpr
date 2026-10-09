/**
 * PHOTO OPTIONAL AT SIGN-UP, ASKED BEFORE THE FIRST APPLY OR POST (owner,
 * 2026-10-09). Real sign-ups stopped at the required photo. Now: the profile
 * gate passes without one, and `usePhotoPrompt` asks at Apply/Post, once per
 * account on this device, and never blocks or doubles the action: Not Now,
 * closing the prompt, and a profile not loaded yet all let it through once.
 * Browse first: the header's Get Started opens the job list, and on the job
 * list it is the sign-up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { isProfileComplete } from "@/components/ProtectedRoute";

const readAvatar = vi.fn<(id: string) => Promise<string | null>>();
vi.mock("@/lib/readProfileAvatarUrl", () => ({ readProfileAvatarUrl: (id: string) => readAvatar(id) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: authUser, isReady: true }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
let resolveCrop: ((f: File | null) => void) | null = null;
vi.mock("@/components/profile/AvatarCropDialog", () => ({
  useAvatarCrop: () => ({ requestCrop: () => new Promise((r) => { resolveCrop = r; }), dialog: null }),
}));
vi.mock("@/lib/avatarStorage", () => ({
  assertUploadableAvatar: () => {},
  replaceAvatarObject: async () => ({ path: "u1/avatar.jpg", publicUrl: "https://x/avatar.jpg", removed: [], staleRemaining: [] }),
}));
let authUser: { id: string } | null = { id: "u1" };

import { usePhotoPrompt, photoPromptDoneKey } from "./PhotoPrompt";
import Navbar from "./Navbar";
import { safeStorage } from "@/lib/safeStorage";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";

function Harness({ go }: { go: () => void }) {
  const { askThen, dialog } = usePhotoPrompt();
  return (
    <>
      <button type="button" onClick={() => void askThen(go)}>Apply Now</button>
      {dialog}
    </>
  );
}

beforeEach(() => {
  authUser = { id: "u1" };
  readAvatar.mockReset();
  resolveCrop = null;
  safeStorage.removeItem(photoPromptDoneKey("u1"));
  queryClient.removeQueries({ queryKey: queryKeys.currentUser.byId("u1") });
});

describe("profile photo is optional", () => {
  it("the profile gate passes a profile with no photo", () => {
    expect(
      isProfileComplete({
        full_name: "Ben L",
        avatar_url: null,
        date_of_birth: "1968-06-17",
        phone: "3375550100",
        location: "Lafayette",
        is_legacy_user: false,
      } as Parameters<typeof isProfileComplete>[0]),
    ).toBe(true);
  });

  it("asks when there is no photo; Not Now lets the action through once and is remembered", async () => {
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: null } });
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    expect(await screen.findByText("Add a profile photo?")).toBeTruthy();
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Not Now"));
    expect(go).toHaveBeenCalledTimes(1);
    expect(safeStorage.getItem(photoPromptDoneKey("u1"))).toBe("1");
    // Second time: no prompt, no profile read.
    readAvatar.mockClear();
    fireEvent.click(screen.getByText("Apply Now"));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(2));
    expect(readAvatar).not.toHaveBeenCalled();
  });

  it("closing the prompt (Escape) is a Not Now, never a dropped Apply", async () => {
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: null } });
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    const title = await screen.findByText("Add a profile photo?");
    fireEvent.keyDown(title, { key: "Escape" });
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
  });

  it("Not Now while a photo is being picked runs the action once, not twice", async () => {
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: null } });
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    await screen.findByText("Add a profile photo?");
    const input = screen.getByLabelText("Choose a profile photo");
    fireEvent.change(input, { target: { files: [new File(["x"], "me.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(resolveCrop).not.toBeNull());
    fireEvent.click(screen.getByText("Not Now"));
    expect(go).toHaveBeenCalledTimes(1);
    // The crop and upload then finish: the action does not run a second time.
    await act(async () => { resolveCrop?.(new File(["x"], "me.jpg", { type: "image/jpeg" })); });
    await screen.findByText("Apply Now");
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("goes straight through when the cached profile already has a photo, with no read", async () => {
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: "https://x/avatar.jpg" } });
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(readAvatar).not.toHaveBeenCalled();
    expect(screen.queryByText("Add a profile photo?")).toBeNull();
  });

  it("fails open: a profile not loaded yet never blocks the Apply, and nothing is fetched", async () => {
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    expect(go).toHaveBeenCalledTimes(1);
    expect(readAvatar).not.toHaveBeenCalled();
    expect(screen.queryByText("Add a profile photo?")).toBeNull();
  });
});

describe("browse first: the header's Get Started", () => {
  const getStarted = (path: string) => {
    authUser = null;
    const { unmount } = render(<MemoryRouter initialEntries={[path]}><Navbar /></MemoryRouter>);
    const href = screen.getByRole("link", { name: "Get Started" }).getAttribute("href");
    unmount();
    return href;
  };
  it("opens the job list from the landing page", () => expect(getStarted("/")).toBe("/browse"));
  it("is the sign-up on the job list itself", () => expect(getStarted("/browse")).toBe("/signup"));
});

// The photo must not be a gate field again.
// @mutate src/components/ProtectedRoute.tsx |   { key: "date_of_birth", label: "Date of birth" }, |   { key: "avatar_url", label: "Profile picture" }, { key: "date_of_birth", label: "Date of birth" },
// A profile not loaded yet must let the action through.
// @mutate src/components/PhotoPrompt.tsx |       if (!cached?.profile) return go(); |       if (!cached?.profile) return;
// Closing the prompt must not drop the action.
// @mutate src/components/PhotoPrompt.tsx | onOpenChange={(next) => { if (!next && !uploading) proceed(); }} | onOpenChange={(next) => { if (!next && !uploading) setOpen(false); }}
// The pending action is taken exactly once.
// @mutate src/components/PhotoPrompt.tsx |     pendingRef.current = null;\n    setOpen(false); |     setOpen(false);
// Get Started opens the job list.
// @mutate src/components/Navbar.tsx | ? "/signup" : "/browse"; | ? "/signup" : "/signup";
