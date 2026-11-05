/**
 * Edit Profile never throws away what the member typed when the profile
 * (re)loads.
 *
 * Profile.tsx copied the saved profile into every field each time the cached
 * profile changed, so a profile that arrived late, or a refetch while the
 * member typed, put the saved values back over their edit. e2e-journeys
 * 41934715217 (journeys-webkit, 03-account profile, largest-text on a dropping
 * network): the journey filled "About you", the field then read the saved
 * "SEED test account." again and Save changes never came.
 *
 * Renders the real Profile page (real hydration effect, real state) with the
 * tab panel stubbed to the bio field and the area it shows.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

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
      // The select reads the whole saved row back, as PostgREST does: the
      // phone is no longer in the UPDATE (Q1586(a), save_my_phone) but is
      // still in the row.
      Promise.resolve({ data: [{ ...PROFILE, ...db.lastUpdate }], error: null });
    return builder;
  };
  return { supabase: { from, rpc: vi.fn(), storage: { from: vi.fn() } } };
});
// The signed-in member, swapped by each test to stand for the profile query's
// late first answer and its refetches.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => session.current }));
// Profile asks the hidden-feature switches through useAuthReady (Q1894); this
// Supabase stub has no auth client, so give it the signed-in member directly.
vi.mock("@/hooks/useAuthReady", () => {
  const value = { user: { id: "user-1" }, isReady: true };
  return { useAuthReady: () => value };
});
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
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
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

// The Edit Profile panel, reduced to the two fields this test drives.
vi.mock("./ProfileTabPanels", () => ({
  ProfileTabPanels: (p: { bio: string; setBio: (v: string) => void; location: string }) => (
    <div>
      <textarea aria-label="Bio" value={p.bio} onChange={(e) => p.setBio(e.target.value)} />
      <output aria-label="Area">{p.location}</output>
    </div>
  ),
}));

import ProfilePage from "./Profile";

const USER = { id: "user-1", email: "marie@example.com" };
const signedIn = (profile: Record<string, unknown> | null) => ({
  user: USER, profile, isLoading: false, refresh: () => Promise.resolve(),
});
const TYPED = "Thirty years building decks, porches and fences in Acadiana.";

function renderEdit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (): ReactElement => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/profile?tab=profile"]}>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { reload: (profile: Record<string, unknown> | null) => { session.current = signedIn(profile); view.rerender(tree()); } };
}
const bio = () => screen.getByLabelText<HTMLTextAreaElement>("Bio");

describe("Edit Profile keeps the member's edits when the profile loads or refetches", () => {
  it("a refetch keeps the typed bio and still takes a field the member did not touch", () => {
    session.current = signedIn(PROFILE);
    const { reload } = renderEdit();
    expect(bio().value).toBe(PROFILE.bio);
    fireEvent.change(bio(), { target: { value: TYPED } });
    reload({ ...PROFILE, location: "Breaux Bridge" });
    expect(bio().value, "the refetch put the saved bio back over the member's edit").toBe(TYPED);
    expect(screen.getByLabelText("Area").textContent).toBe("Breaux Bridge");
  });

  it("a profile that arrives after the member started typing keeps what they typed", () => {
    session.current = signedIn(null);
    const { reload } = renderEdit();
    fireEvent.change(bio(), { target: { value: TYPED } });
    reload(PROFILE);
    expect(bio().value, "the late load put the saved bio back over the member's edit").toBe(TYPED);
    expect(screen.getByLabelText("Area").textContent).toBe(PROFILE.location);
  });

  it("an unedited form follows every load", () => {
    session.current = signedIn(PROFILE);
    const { reload } = renderEdit();
    reload({ ...PROFILE, bio: "Now also doing gutters and pressure washing in Lafayette." });
    expect(bio().value).toBe("Now also doing gutters and pressure washing in Lafayette.");
  });
});

// PROVEN RED: the old hydration (every field overwritten on each load) fails
// the first two tests.
// BLIND TO: the real ProfileTabPanels form; it is stubbed to the bio field and the area.
// @mutate src/pages/profile/Profile.tsx | setBio(unlessEdited(was.bio, now.bio)); | setBio(now.bio);
