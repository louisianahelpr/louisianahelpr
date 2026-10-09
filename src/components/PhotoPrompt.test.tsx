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
const updateResult = vi.fn<() => Promise<{ data: unknown; error: unknown }>>();
const updated: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (row: unknown) => {
        updated.push(row);
        return { eq: () => ({ select: () => updateResult() }) };
      },
    }),
  },
}));
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
  updated.length = 0;
  updateResult.mockReset();
  updateResult.mockResolvedValue({ data: [{ id: "p1" }], error: null });
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
        // Phone and birthday left the gate too (2026-10-09): asked later.
        date_of_birth: null,
        phone: null,
        location: "Lafayette",
        is_legacy_user: false,
      } as Parameters<typeof isProfileComplete>[0], { app_metadata: { provider: "email" } }),
    ).toBe(true);
  });

  it("a Google/Apple sign-up still needs a birthday: their only age check (no step-1 18+ box)", () => {
    const p = { full_name: "Gee O", avatar_url: null, date_of_birth: null, phone: null, location: "Abbeville", is_legacy_user: false } as Parameters<typeof isProfileComplete>[0];
    expect(isProfileComplete(p, { app_metadata: { provider: "google" } })).toBe(false);
    expect(isProfileComplete(p, { app_metadata: { provider: "apple" } })).toBe(false);
    expect(isProfileComplete(p, null)).toBe(false);
    expect(isProfileComplete({ ...p!, date_of_birth: "1990-01-01" }, { app_metadata: { provider: "google" } })).toBe(true);
  });

  it("asks when there is no photo; Not Now lets the action through once and is remembered", async () => {
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: null, phone: "(337) 555-0100", date_of_birth: "1990-01-01" } });
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
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: null, phone: "(337) 555-0100", date_of_birth: "1990-01-01" } });
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    const title = await screen.findByText("Add a profile photo?");
    fireEvent.keyDown(title, { key: "Escape" });
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
  });

  it("Not Now while a photo is being picked runs the action once, not twice", async () => {
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: null, phone: "(337) 555-0100", date_of_birth: "1990-01-01" } });
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
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: "https://x/avatar.jpg", phone: "(337) 555-0100", date_of_birth: "1990-01-01" } });
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

describe("finish your profile: phone and birthday are asked later (owner, 2026-10-09)", () => {
  const needsAll = () =>
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: null, phone: null, date_of_birth: null } });

  it("asks for what is missing and saves phone + birthday, then runs the action once", async () => {
    needsAll();
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    expect(await screen.findByText("Finish your profile")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "3375550142" } });
    expect((screen.getByLabelText("Phone number") as HTMLInputElement).value).toBe("(337) 555-0142");
    fireEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(JSON.parse(JSON.stringify(updated))).toEqual([{ phone: "(337) 555-0142" }]);
  });

  it("a phone another account has is refused in words, and the action waits", async () => {
    needsAll();
    updateResult.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "This phone number is already on another account. Log in to that account instead." },
    });
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    await screen.findByText("Finish your profile");
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "3375550142" } });
    fireEvent.click(screen.getByText("Save & Continue"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already on another account/);
    expect(go).not.toHaveBeenCalled();
    // Not Now still lets the action through.
    fireEvent.click(screen.getByText("Not Now"));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("a half-typed phone is caught before any save", async () => {
    needsAll();
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    await screen.findByText("Finish your profile");
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "33755" } });
    fireEvent.click(screen.getByText("Save & Continue"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/10-digit/);
    expect(updated).toEqual([]);
    expect(go).not.toHaveBeenCalled();
  });

  it("nothing typed: Save & Continue just continues", async () => {
    needsAll();
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    await screen.findByText("Finish your profile");
    fireEvent.click(screen.getByText("Save & Continue"));
    expect(go).toHaveBeenCalledTimes(1);
    expect(updated).toEqual([]);
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

// A Google/Apple sign-up must keep the birthday as its age check.
// @mutate src/components/ProtectedRoute.tsx |   return emailSignup \|\| (typeof profile.date_of_birth === "string" && profile.date_of_birth.trim() !== ""); |   return true;
// The photo must not be a gate field again.
// @mutate src/components/ProtectedRoute.tsx |   { key: "location", label: "City" }, |   { key: "phone", label: "Phone number" }, { key: "location", label: "City" },
// A profile not loaded yet must let the action through.
// @mutate src/components/PhotoPrompt.tsx |       if (!cached?.profile) return go(); |       if (!cached?.profile) return;
// Closing the prompt must not drop the action.
// @mutate src/components/PhotoPrompt.tsx | onOpenChange={(next) => { if (!next && !busy) proceed(); }} | onOpenChange={(next) => { if (!next && !busy) setOpen(false); }}
// A duplicate phone is said in words, not a generic retry.
// @mutate src/components/PhotoPrompt.tsx |       if (inUse) { |       if (false) {
// A typed phone must be saved.
// @mutate src/components/PhotoPrompt.tsx |     const savePhone = missing.phone && digits.length >= 10 ? phone.trim() : undefined; |     const savePhone = undefined;
// The pending action is taken exactly once.
// @mutate src/components/PhotoPrompt.tsx |     pendingRef.current = null;\n    setOpen(false); |     setOpen(false);
// Get Started opens the job list.
// @mutate src/components/Navbar.tsx | ? "/signup" : "/browse"; | ? "/signup" : "/signup";
