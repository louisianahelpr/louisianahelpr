/**
 * F455 (whole-app audit 11-10, Builder 2): a member whose profile is already complete who opens /complete-profile (an
 * old link, the back button) was bounced to /home with no word. Now one toast says "Your profile is already complete."
 * A profile that still needs the form gets no such toast.
 *
 * @mutate src/pages/auth/CompleteProfile.tsx |     toast(t("profileGate.alreadyComplete"));\n |
 * @mutate src/pages/auth/CompleteProfile.tsx |     if (!alreadyComplete \|\| submitting \|\| savedHereRef.current \|\| toldAlreadyCompleteRef.current) return;\n |     if (submitting \|\| savedHereRef.current \|\| toldAlreadyCompleteRef.current) return;\n
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import CompleteProfile from "../CompleteProfile";

const user = { id: "u-1", email: "member@example.com", app_metadata: { provider: "email" }, user_metadata: {} };
const current = { profile: null as Record<string, unknown> | null };
const complete = { user_id: "u-1", full_name: "Ava Member", phone: null, date_of_birth: null, location: "Lafayette", zip_code: "70501", bio: null, avatar_url: null, is_legacy_user: false, accepted_terms_at: "2026-11-01T00:00:00Z" };
const incomplete = { ...complete, full_name: "", location: null, accepted_terms_at: null };

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user, profile: current.profile, isLoading: false, refresh: async () => {} }),
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
      rpc: async () => ({ data: null, error: null }),
      from: () => q,
      auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user }, error: null }) },
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
  };
});

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/complete-profile"]}>
        <Routes>
          <Route path="/complete-profile" element={<CompleteProfile />} />
          <Route path="/home" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => vi.mocked(toast).mockClear());

describe("F455: /complete-profile with a finished profile", () => {
  it("goes to /home and says the profile is already complete, once", () => {
    current.profile = complete;
    mount();
    expect(screen.getByText("home")).toBeInTheDocument();
    expect(vi.mocked(toast).mock.calls.filter((c) => c[0] === "Your profile is already complete.")).toHaveLength(1);
  });

  it("a profile that still needs the form stays and gets no such toast", () => {
    current.profile = incomplete;
    mount();
    expect(screen.queryByText("home")).toBeNull();
    expect(vi.mocked(toast)).not.toHaveBeenCalledWith("Your profile is already complete.");
  });
});
