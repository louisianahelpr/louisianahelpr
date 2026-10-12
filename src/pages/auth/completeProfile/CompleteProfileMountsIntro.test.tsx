/**
 * Mount wiring: the real Finish-your-profile page (CompleteProfile) draws its
 * intro, and with it the "details were cleared" notice when the server says a
 * pre-verification wipe happened.
 *
 * preVerificationWipeNotice.test.tsx renders CompleteProfileIntro alone, so a
 * page that stopped mounting it stayed green; main's Vacuity (run
 * 38317156550, 2026-10-12) flagged it as a mount-wiring gap.
 *
 * @mutate src/pages/auth/CompleteProfile.tsx |             <CompleteProfileIntro />\n |             \n
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CompleteProfile from "../CompleteProfile";

const user = { id: "u-1", email: "member@example.com", app_metadata: {}, user_metadata: {} };
const profile = { user_id: "u-1", full_name: "", phone: null, date_of_birth: null, location: null, zip_code: null, bio: null, avatar_url: null, is_legacy_user: false };

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user, profile, isLoading: false, refresh: async () => {} }),
}));
vi.mock("@/hooks/useSignOutAction", () => ({ useSignOutAction: () => ({ signingOut: false, signOut: () => {} }) }));
vi.mock("@/hooks/useDeleteAccount", () => ({ useDeleteAccount: () => ({ mutate: () => {}, isPending: false }) }));
vi.mock("@/hooks/useParishForZip", () => ({ useParishForZip: () => ({ parish: null, unknownZip: false }), UNKNOWN_ZIP_MESSAGE: "" }));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit", "maybeSingle", "single", "in"]) q[k] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
  return {
    supabase: {
      rpc: async (fn: string) => ({ data: fn === "has_pre_verification_wipe" ? true : null, error: null }),
      from: () => q,
      auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user }, error: null }) },
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
  };
});

describe("Finish your profile mounts its intro", () => {
  it("the page shows the intro sentence and, after a wipe, the cleared-details notice", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CompleteProfile />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/We need a few details before you can use Helpr/)).toBeInTheDocument();
    expect(await screen.findByTestId("pre-verification-wipe-notice")).toBeInTheDocument();
  });
});
