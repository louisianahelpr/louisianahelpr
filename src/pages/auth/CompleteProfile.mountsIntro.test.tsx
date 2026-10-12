/**
 * MOUNT WIRING: /complete-profile really renders its intro, wipe notice
 * included.
 *
 * CompleteProfileIntro is tested ALONE in src/test/preVerificationWipeNotice
 * .test.tsx (the owner's Q1286 sentence). Nothing rendered the page that
 * mounts it, so deleting the mount, or the page hitting an early return
 * before it, stayed green (vacuity class (b), mount-wiring). This renders the
 * real CompleteProfile for a signed-in, incomplete account and asserts the
 * intro line is under "Almost there." and the wipe notice shows when the
 * server says the account was wiped.
 *
 * @mutate src/pages/auth/CompleteProfile.tsx | <CompleteProfileIntro /> | {null}
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CompleteProfile from "./CompleteProfile";
import { WIPE_NOTICE } from "./completeProfile/CompleteProfileIntro";

let wiped = false;
const USER = { id: "user-mount-1", email: "mount@example.test" };
const PROFILE = { user_id: "user-mount-1", full_name: "", avatar_url: null };

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: USER, profile: PROFILE, isLoading: false, refresh: async () => {} }),
}));
vi.mock("@/hooks/useSignOutAction", () => ({ useSignOutAction: () => ({ signingOut: false, signOut: async () => {} }) }));
vi.mock("@/hooks/useDeleteAccount", () => ({ useDeleteAccount: () => ({ isOpen: false, dialogProps: {}, open: () => {} }) }));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) =>
      Promise.resolve(name === "has_pre_verification_wipe" ? { data: wiped, error: null } : { data: null, error: null }),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/complete-profile"]}>
        <CompleteProfile />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CompleteProfile mounts CompleteProfileIntro", () => {
  beforeEach(() => {
    wiped = false;
  });

  it("the intro line sits under the page heading", async () => {
    renderPage();
    expect(await screen.findByText("Almost there.")).toBeInTheDocument();
    expect(screen.getByText(/We need a few details before you can use Helpr\./)).toBeInTheDocument();
    expect(screen.queryByTestId("pre-verification-wipe-notice")).toBeNull();
  });

  it("a wiped account sees the owner's notice on the page", async () => {
    wiped = true;
    renderPage();
    expect(await screen.findByTestId("pre-verification-wipe-notice")).toHaveTextContent(WIPE_NOTICE);
  });
});
