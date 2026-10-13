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
// Q1586(a): the phone goes through save_my_phone, never a profiles UPDATE.
const rpcResult = vi.fn<() => Promise<{ data: unknown; error: unknown }>>();
const rpcCalls: { name: string; args: unknown }[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return rpcResult();
    },
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
// The wheel date picker is a native-feeling widget jsdom cannot spin; a plain
// labelled input stands in so the tests type a birthday through the prompt's
// own onChange (the save path under test is PhotoPrompt's, not the picker's).
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

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
  rpcCalls.length = 0;
  rpcResult.mockReset();
  rpcResult.mockResolvedValue({ data: { ok: true }, error: null });
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
    expect(rpcCalls).toEqual([{ name: "save_my_phone", args: { p_phone: "(337) 555-0142" } }]);
    expect(updated).toEqual([]);
  });

  it("a phone another account has is refused in words, and the action waits", async () => {
    needsAll();
    // The RPC answers the refusal (and counts it) instead of raising it.
    rpcResult.mockResolvedValue({ data: { ok: false, reason: "phone_in_use" }, error: null });
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
// @mutate src/components/PhotoPrompt.tsx | onOpenChange={(next) => { if (!next) decline(); }} | onOpenChange={(next) => { if (!next) setOpen(false); }}
// A duplicate phone is said in words, not a generic retry.
// @mutate src/components/PhotoPrompt.tsx |         if (!phoneResult.ok) { |         if (false) {
// A typed phone must be saved.
// @mutate src/components/PhotoPrompt.tsx |     const savePhone = missing.phone && digits.length >= 10 ? phone.trim() : undefined; |     const savePhone = undefined;
// The pending action is taken exactly once.
// @mutate src/components/PhotoPrompt.tsx |     const go = pendingRef.current;\n    pendingRef.current = null;\n    setOpen(false); |     const go = pendingRef.current;\n    setOpen(false);
// Get Started opens the job list.
// @mutate src/components/Navbar.tsx | ? "/signup" : "/browse"; | ? "/signup" : "/signup";

/**
 * Q1586(c), owner 2026-10-13: the 18+ box at sign-up is the requirement; a
 * birthday under 18 typed here is SAVED, and the Apply/Post it was opened for
 * does not run, by Save & Continue, Not Now or a close. Before this the prompt
 * refused to save it ("You'll need to be 18 or older to use Helpr.") and Not
 * Now then let the action through with the birthday still empty, so nothing
 * greyed out and the server let it in (lh-authz-rls review of 0f7786627,
 * must-fix 1). These drive the prompt's real save path: the profiles UPDATE the
 * server's lock_under_18_birthday then holds (proved for a member session in
 * src/test/pglite/under18CannotApplyOrPost.pglite.mjs, S1-S4).
 * @mutate src/components/PhotoPrompt.tsx |     if (typedUnder18) return void saveUnder18AndStop(); |     if (false) return void saveUnder18AndStop();
 * @mutate src/components/PhotoPrompt.tsx |     if (typedUnder18) return saveUnder18AndStop(); |     if (typedUnder18) return setFieldError("You'll need to be 18 or older to use Helpr.");
 * @mutate src/components/PhotoPrompt.tsx |       if (isUnder18(cached?.profile?.date_of_birth)) { |       if (false) {
 */
describe("a birthday under 18 is saved and stops the action (Q1586(c))", () => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yearsAgo = (y: number) => {
    const d = new Date();
    return `${d.getFullYear() - y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const MINOR_DOB = yearsAgo(16);
  const needsAll = () =>
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: null, phone: null, date_of_birth: null } });
  const cachedDob = () =>
    (queryClient.getQueryData(queryKeys.currentUser.byId("u1")) as { profile?: { date_of_birth?: string | null } } | undefined)?.profile?.date_of_birth;

  async function typeBirthday(go: () => void, dob: string) {
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    await screen.findByText("Finish your profile");
    fireEvent.change(screen.getByLabelText("Birthday"), { target: { value: dob } });
  }

  it("Save & Continue saves the under-18 birthday, the action does not run, and the cached profile greys out at once", async () => {
    needsAll();
    const go = vi.fn();
    await typeBirthday(go, MINOR_DOB);
    fireEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() => expect(updated).toEqual([{ date_of_birth: MINOR_DOB }]));
    await waitFor(() => expect(screen.queryByText("Finish your profile")).toBeNull());
    expect(go).not.toHaveBeenCalled();
    expect(cachedDob()).toBe(MINOR_DOB);
  });

  it("Not Now after typing an under-18 birthday saves it and does NOT let the Apply through", async () => {
    needsAll();
    const go = vi.fn();
    await typeBirthday(go, MINOR_DOB);
    fireEvent.click(screen.getByText("Not Now"));
    await waitFor(() => expect(updated).toEqual([{ date_of_birth: MINOR_DOB }]));
    expect(go).not.toHaveBeenCalled();
  });

  it("closing the prompt after typing an under-18 birthday is the same: saved, no action", async () => {
    needsAll();
    const go = vi.fn();
    await typeBirthday(go, MINOR_DOB);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(updated).toEqual([{ date_of_birth: MINOR_DOB }]));
    expect(go).not.toHaveBeenCalled();
  });

  it("a save that fails keeps the prompt open with the error, and the action still does not run", async () => {
    needsAll();
    updateResult.mockResolvedValue({ data: [], error: null });
    const go = vi.fn();
    await typeBirthday(go, MINOR_DOB);
    fireEvent.click(screen.getByText("Save & Continue"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/birthday/i);
    expect(go).not.toHaveBeenCalled();
  });

  it("a saved under-18 birthday stops every later Apply/Post before any prompt", async () => {
    queryClient.setQueryData(queryKeys.currentUser.byId("u1"), { profile: { avatar_url: "a", phone: "3375550142", date_of_birth: MINOR_DOB } });
    safeStorage.setItem(photoPromptDoneKey("u1"), "1");
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("Apply Now"));
    await act(async () => {});
    expect(go).not.toHaveBeenCalled();
    expect(screen.queryByText("Finish your profile")).toBeNull();
  });

  it("an adult birthday still saves and continues; no birthday at all still continues (the 18+ box is the requirement)", async () => {
    needsAll();
    const go = vi.fn();
    await typeBirthday(go, yearsAgo(30));
    fireEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(updated).toEqual([{ date_of_birth: yearsAgo(30) }]);
  });
});
