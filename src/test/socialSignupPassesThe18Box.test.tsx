/**
 * EVERY SIGN-UP REACHES THE APP ONLY THROUGH AN 18+ BOX (owner, 2026-10-14
 * ~3 PM CT pop-up): Google/Apple sign-ups get the same "I confirm I am 18
 * years of age or older" box an email sign-up ticks on sign-up step 1, and
 * Complete Profile asks NO birthday and NO phone.
 *
 * Before: ProtectedRoute's gate (isProfileComplete) required a birthday from
 * every Google/Apple sign-up, because it never saw step 1's box, and Complete
 * Profile asked a birthday (required) and a phone (optional).
 *
 * The class, built from the app's own inventory:
 *   1. every social provider the app signs in with (SocialProvider in
 *      src/lib/socialAuth.ts) is refused by the gate until the box is on
 *      record (profiles.age_attested_at), and passes once it is; an email
 *      sign-up passes on its provider (complete-signup refuses it without
 *      step 1's box); a pre-2026-10-14 social account that gave a birthday
 *      is not sent back;
 *   2. Complete Profile, the one screen a social sign-up completes on, shows
 *      the box unticked, no birthday and no phone field, cannot be finished
 *      without the box, and saves the box (age_attested_at) with no phone and
 *      no birthday in the write;
 *   3. the only code that reads or writes age_attested_at is the exact list
 *      below, so a second writer cannot appear without being named here.
 *
 * @mutate src/components/ProtectedRoute.tsx |   return filled(profile.age_attested_at) \|\| filled(profile.date_of_birth); |   return true;
 * @mutate src/pages/auth/CompleteProfile.tsx |       ...(ageBoxShown ? [{ label: "Confirm you're 18 or older", done: ageConfirmed }] : []), |
 * @mutate src/pages/auth/CompleteProfile.tsx |         ...(ageBoxShown && !profile?.age_attested_at ? { age_attested_at: nowIso } : {}), |
 * @mutate src/pages/auth/CompleteProfile.tsx |                   I confirm I am 18 years of age or older. <span | <span
 * @mutate src/pages/auth/CompleteProfile.tsx |   const ageBoxShown = user?.app_metadata?.provider !== "email"; |   const ageBoxShown = false;
 * @mutate src/pages/auth/CompleteProfile.tsx |   const ageBoxShown = user?.app_metadata?.provider !== "email"; |   const ageBoxShown = true;
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";
import { isProfileComplete } from "@/components/ProtectedRoute";

const ROOT = process.cwd();

/** The providers the app signs in with, read from its own type. */
function socialProviders(): string[] {
  const src = blankComments(readFileSync(join(ROOT, "src/lib/socialAuth.ts"), "utf8"));
  const m = src.match(/export type SocialProvider\s*=\s*([^;]+);/);
  return m ? [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]) : [];
}

type GateProfile = Parameters<typeof isProfileComplete>[0];
const filledIn = {
  full_name: "Gee O",
  avatar_url: null,
  date_of_birth: null,
  age_attested_at: null,
  phone: null,
  location: "Abbeville",
  is_legacy_user: false,
} as GateProfile;

describe("the gate: a social sign-up gets in only through the 18+ box", () => {
  const providers = socialProviders();

  it("reads the social providers from src/lib/socialAuth.ts (cannot pass vacuously)", () => {
    expect(providers.length).toBeGreaterThan(1);
  });

  it.each(providers)("%s: refused without the box, let in with it", (provider) => {
    const user = { app_metadata: { provider } };
    expect(isProfileComplete(filledIn, user)).toBe(false);
    expect(isProfileComplete({ ...filledIn!, age_attested_at: "2026-10-14T20:00:00Z" }, user)).toBe(true);
    // No birthday and no phone needed once the box is on record.
    expect(isProfileComplete({ ...filledIn!, age_attested_at: "2026-10-14T20:00:00Z", date_of_birth: null, phone: null }, user)).toBe(true);
    // A blank stamp is not a tick.
    expect(isProfileComplete({ ...filledIn!, age_attested_at: "  " }, user)).toBe(false);
    // An account that finished Complete Profile before 2026-10-14 gave a birthday.
    expect(isProfileComplete({ ...filledIn!, date_of_birth: "1990-01-01" }, user)).toBe(true);
  });

  it("no session or no provider is never let in without the box", () => {
    expect(isProfileComplete(filledIn, null)).toBe(false);
    expect(isProfileComplete(filledIn, { app_metadata: {} })).toBe(false);
  });

  it("an email sign-up passes on its provider (step 1's box, enforced by complete-signup)", () => {
    expect(isProfileComplete(filledIn, { app_metadata: { provider: "email" } })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Complete Profile, rendered: the box, no birthday, no phone.
// ---------------------------------------------------------------------------
const updates: Array<Record<string, unknown>> = [];
const socialUser = { id: "u-social", email: "gee@example.com", app_metadata: { provider: "google" } as { provider: string }, user_metadata: {} };
const socialProfile = {
  user_id: "u-social",
  full_name: "Gee O",
  phone: null,
  date_of_birth: null,
  age_attested_at: null,
  location: "Abbeville",
  zip_code: "70510",
  bio: null,
  avatar_url: null,
  accepted_terms_at: "2026-10-14T19:00:00Z",
  is_legacy_user: false,
};

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: socialUser, profile: socialProfile, isLoading: false, refresh: async () => {} }),
  // socialUser.app_metadata.provider is switched to "email" by one case below.
}));
vi.mock("@/hooks/useSignOutAction", () => ({ useSignOutAction: () => ({ signingOut: false, signOut: () => {} }) }));
vi.mock("@/hooks/useDeleteAccount", () => ({ useDeleteAccount: () => ({ mutate: () => {}, isPending: false }) }));
vi.mock("@/hooks/useParishForZip", () => ({ useParishForZip: () => ({ parish: "Vermilion", unknownZip: false }), UNKNOWN_ZIP_MESSAGE: "" }));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("@/pages/auth/completeProfile/uploadProfileFiles", () => ({
  uploadProfileFiles: async (_userId: string, _file: unknown, save: (f: { avatarUrl: string | null }) => Promise<unknown>) => ({
    saved: await save({ avatarUrl: null }),
    staleAvatarObjects: [],
  }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    let payload: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    for (const k of ["select", "eq", "order", "limit", "maybeSingle", "single", "in", "insert"]) q[k] = () => q;
    q.update = (p: Record<string, unknown>) => {
      payload = p;
      if (table === "profiles") updates.push(p);
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve(payload ? { data: [{ ...socialProfile, ...payload }], error: null } : { data: null, error: null });
    return q;
  };
  return {
    supabase: {
      rpc: async () => ({ data: null, error: null }),
      from: (table: string) => builder(table),
      auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: socialUser }, error: null }) },
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
  };
});

import CompleteProfile from "@/pages/auth/CompleteProfile";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CompleteProfile />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Complete Profile: the 18+ box, no birthday, no phone", () => {
  it("shows the box unticked and asks no birthday and no phone", () => {
    const { container } = renderPage();
    const box = screen.getByRole("checkbox", { name: /I confirm I am 18 years of age or older/ });
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(container.querySelector("#dob")).toBeNull();
    expect(container.querySelector("#phone")).toBeNull();
    expect(container.querySelector('input[type="tel"]')).toBeNull();
    expect(screen.queryByText(/date of birth/i)).toBeNull();
    expect(screen.queryByText(/^Phone/)).toBeNull();
  });

  it("cannot be finished without the box, and saves it with no phone and no birthday", async () => {
    updates.length = 0;
    renderPage();
    expect(screen.getByText("Confirm you're 18 or older")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Complete Required Fields/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm I am 18 years of age or older/ }));
    const enter = screen.getByRole("button", { name: /Enter App/ });
    expect(enter).toBeEnabled();
    fireEvent.click(enter);

    await waitFor(() => expect(updates).toHaveLength(1));
    const saved = updates[0];
    expect(typeof saved.age_attested_at).toBe("string");
    expect(Number.isNaN(Date.parse(String(saved.age_attested_at)))).toBe(false);
    expect(saved).not.toHaveProperty("phone");
    expect(saved).not.toHaveProperty("date_of_birth");
  });

  it("an email sign-up (step 1's box already ticked) is not asked twice", () => {
    // An email account only lands here with a gate field missing (no city).
    socialUser.app_metadata.provider = "email";
    const city = socialProfile.location;
    socialProfile.location = "";
    try {
      renderPage();
      expect(screen.getByRole("button", { name: /Complete Required Fields/ })).toBeDisabled(); // the page, not a redirect
      expect(screen.queryByRole("checkbox", { name: /18 years of age or older/ })).toBeNull();
      expect(screen.queryByText("Confirm you're 18 or older")).toBeNull();
    } finally {
      socialUser.app_metadata.provider = "google";
      socialProfile.location = city;
    }
  });
});

// ---------------------------------------------------------------------------
// The exact list of code that touches the record.
// ---------------------------------------------------------------------------
const TOUCHES_AGE_ATTESTED_AT: Record<string, string> = {
  "src/pages/auth/CompleteProfile.tsx": "the box: the only writer",
  "src/pages/auth/completeProfile/types.ts": "Complete Profile's update type",
  "src/components/ProtectedRoute.tsx": "the gate: the only reader that lets an account in",
  "src/integrations/supabase/types.ts": "generated column types",
};

describe("only the named code touches profiles.age_attested_at", () => {
  const found = new Set<string>();
  for (const dir of ["src", "supabase/functions"]) {
    for (const abs of walkSource([join(ROOT, dir)])) {
      const rel = relative(ROOT, abs);
      if (/\.(test|spec)\.[tj]sx?$/.test(rel) || rel.startsWith("src/test/")) continue;
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      if (/age_attested_at/.test(blankComments(readFileSync(abs, "utf8")))) found.add(rel);
    }
  }

  it("finds the readers and writers from the source (cannot pass vacuously)", () => {
    expect(found.size).toBeGreaterThan(3);
  });

  it("matches the exact list", () => {
    expect([...found].sort()).toEqual(Object.keys(TOUCHES_AGE_ATTESTED_AT).sort());
  });
});
