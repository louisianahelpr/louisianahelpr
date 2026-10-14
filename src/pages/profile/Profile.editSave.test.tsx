/**
 * Edit Profile: after a successful save the save bar goes away and STAYS away.
 *
 * handleSave wrote the row but never moved the `profile` state that the form's
 * dirty check compares against. Measured live on the local build: "Saved" at
 * +0.7s, then "Save Changes" back at +3.7s, once the 1.8s confirmation cleared.
 * And editing a field back to its pre-save value showed no bar at all, so that
 * edit could not be saved.
 *
 * Renders the real Profile page (real handleSave, real state) with the tab
 * panel stubbed to the two things this is about: the real dirty predicate and
 * the real SaveBar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const PROFILE = {
  id: "profile-1",
  user_id: "user-1",
  full_name: "Marie Boudreaux",
  phone: "3375550100",
  location: "Lafayette",
  zip_code: "70503",
  parish: "Lafayette",
  bio: "Twenty years fixing fences and gates around Acadiana.",
  skills: "Handyman",
  date_of_birth: "1980-01-01",
};

const db = vi.hoisted(() => ({ lastUpdate: null as Record<string, unknown> | null }));

vi.mock("@/integrations/supabase/client", () => {
  const from = () => {
    const builder: Record<string, unknown> = {};
    builder.update = (values: Record<string, unknown>) => {
      db.lastUpdate = values;
      return builder;
    };
    builder.eq = () => builder;
    builder.select = () =>
      Promise.resolve({ data: [{ ...db.lastUpdate }], error: null });
    return builder;
  };
  return { supabase: { from, rpc: vi.fn(), storage: { from: vi.fn() } } };
});
// Stable identities: Profile seeds its form from these in an effect keyed on
// them, so a fresh object per render would re-seed (and re-render) forever.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => {
    session.current ??= {
      user: { id: "user-1", email: "marie@example.com" },
      profile: PROFILE,
      isLoading: false,
      refresh: () => Promise.resolve(),
    };
    return session.current;
  },
}));
vi.mock("@/hooks/useProfileTabData", () => {
  const result = { data: undefined, isError: false, refetch: () => Promise.resolve() };
  const empty = () => result;
  return {
    useProfileStats: empty,
    useProfileReviews: empty,
    useProfileEarnings: empty,
    useProfileSchedule: empty,
    useProfileViolations: empty,
  };
});
vi.mock("@/lib/parishLookup", () => ({ lookupParishByZip: () => Promise.resolve("Lafayette") }));
vi.mock("@/lib/requireOnline", () => ({ requireOnline: () => true }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/useDeleteAccount", () => {
  const value = { isOpen: false, requestDelete: () => {}, dialogProps: {} };
  return { useDeleteAccount: () => value };
});
vi.mock("@/components/profile/AvatarCropDialog", () => {
  const value = { requestCrop: () => Promise.resolve(null), dialog: null };
  return { useAvatarCrop: () => value };
});
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/profile/ProfileLanding", () => ({ ProfileLanding: () => null }));

// The Edit Profile panel, reduced to what this test is about. `dirty` comes
// from the SAME predicate ProfileEditForm uses; the bar is the real SaveBar.
vi.mock("./ProfileTabPanels", async () => {
  const { SaveBar } = await import("@/components/profile/profileEditForm/SaveBar");
  const { isProfileEditDirty } = await import("@/components/profile/profileEditForm/isProfileEditDirty");
  type P = {
    profile: typeof PROFILE | null;
    phone: string; location: string; zipCode: string; bio: string; skills: string;
    setBio: (v: string) => void;
    saving: boolean; justSaved: boolean;
    onSave: (e: React.FormEvent) => void;
    onBackFromTab: () => void;
  };
  return {
    ProfileTabPanels: (p: P) => (
      <div>
        <textarea aria-label="Bio" value={p.bio} onChange={(e) => p.setBio(e.target.value)} />
        <SaveBar
          dirty={isProfileEditDirty(
            { phone: p.phone, location: p.location, zipCode: p.zipCode, bio: p.bio, skills: p.skills },
            p.profile as never,
          )}
          saving={p.saving}
          justSaved={p.justSaved}
          onBack={p.onBackFromTab}
          onSave={p.onSave}
        />
      </div>
    ),
  };
});

import ProfilePage from "./Profile";

const renderEdit = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/profile?tab=profile"]}>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const saveBarButton = () => screen.queryByRole("button", { name: /Save Changes|Saving|Saved/ });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  db.lastUpdate = null;
});
afterEach(() => {
  vi.useRealTimers();
});

async function editAndSave(bio: string) {
  fireEvent.change(screen.getByLabelText("Bio"), { target: { value: bio } });
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  });
  expect(screen.getByRole("button", { name: /Saved/ })).toBeInTheDocument();
  // The "Saved" confirmation clears after 1.8s — go well past it.
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
}

describe("Edit Profile save bar after a successful save", () => {
  it("renders nothing once Saved clears — it does not come back as Save Changes", async () => {
    renderEdit();
    expect(saveBarButton()).toBeNull();
    await editAndSave("Twenty years fixing fences, gates and decks around Acadiana.");
    expect(saveBarButton()).toBeNull();
  });

  it("trailing whitespace is saved trimmed and still leaves nothing to save", async () => {
    renderEdit();
    await editAndSave("Twenty years fixing fences, gates and decks around Acadiana.   ");
    expect(db.lastUpdate?.bio).toBe("Twenty years fixing fences, gates and decks around Acadiana.");
    expect(saveBarButton()).toBeNull();
  });

  it("editing a field back to its pre-save value is a real, saveable change", async () => {
    renderEdit();
    await editAndSave("Twenty years fixing fences, gates and decks around Acadiana.");
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: PROFILE.bio } });
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  });
});

// PROVEN RED: not moving the dirty-check baseline after a save — the exact
// defect (Saved at +0.7s, "Save Changes" back at +3.7s) — fails "renders
// nothing once Saved clears".
// BLIND TO: the real ProfileTabPanels. The panel is stubbed to the real
// dirty predicate + real SaveBar, so a regression in the full form's own
// wiring is outside this file.
// @mutate src/pages/profile/Profile.tsx | setProfile((prev) => (prev ? { ...prev, ...saved } : prev)); | void saved;
