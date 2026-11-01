/**
 * B83, 11-01: the every-page signed-in chrome waits only for its own code.
 *
 * (1) The bottom bar on /home drew ~1.6 s after the page was ready (lab, HTTP/2, Slow 4G, x4 CPU, 375, mocked
 * member: dock at 4.36-4.42 s, ready 2.77-3.20 s, on main, b78 and b79 alike), because App.tsx wrapped all seven
 * chrome pieces in ONE Suspense: the dock waited for the slowest chunk beside it, the Identity sheet (172 KB gz past
 * boot) and the Terms re-consent dialog (101 KB). Every piece now has its own boundary.
 * (2) Those two dialogs are fetched only when one has to show: Terms when the account's accepted version is behind,
 * the ID sheet once it is opened or the page was reached by its entry link.
 *
 * @mutate src/App.tsx | <Suspense fallback={null}><MobileNav /></Suspense> | <Suspense fallback={null}><MobileNav /><IdentityCheckMount /></Suspense>
 * @mutate src/components/TermsReconsentMount.tsx |   if (!behind) return null; |   if (false) return null;
 * @mutate src/components/TermsReconsentMount.tsx | if (!termsAcceptanceIsCurrent(accepted, LATEST_TERMS_VERSION)) setBehind(true); | void accepted;
 * @mutate src/components/identity/IdentityCheckMount.tsx |   if (!wanted && !mounted) return null; |   if (false) return null;
 * @mutate src/components/identity/IdentityCheckMount.tsx |   const wanted = open \|\| hasIdentityEntryParam(params); |   const wanted = open;
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const st = vi.hoisted(() => ({ terms: 0, sheet: 0, accepted: "Oct 2026" as string, idOn: true }));

vi.mock("@/components/TermsReconsentDialog", () => {
  st.terms += 1;
  return { TermsReconsentDialog: () => <p>terms dialog</p> };
});
vi.mock("@/components/identity/IdentityCheckSheet", () => {
  st.sheet += 1;
  return { IdentityCheckHost: () => <p>identity sheet</p> };
});
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    profile: { ban_status: "active" },
    refresh: async () => {},
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { terms_version_accepted: st.accepted }, error: null }) }),
      }),
    }),
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("@/hooks/useIdentityCheckOn", () => ({ useIdentityCheckStatus: () => ({ on: st.idOn, settled: true }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

import { TermsReconsentMount } from "@/components/TermsReconsentMount";
import { IdentityCheckMount } from "@/components/identity/IdentityCheckMount";
import { closeIdentityCheck, openIdentityCheck } from "@/lib/identityCheck";
import { LATEST_TERMS_VERSION } from "@/lib/consent";

const ROOT = resolve(__dirname, "../..");

beforeEach(() => {
  st.terms = 0;
  st.sheet = 0;
  st.accepted = LATEST_TERMS_VERSION;
  st.idOn = true;
});
afterEach(() => {
  cleanup();
  act(() => closeIdentityCheck());
});

describe("App.tsx: every chrome piece has its own Suspense", () => {
  it("nothing inside SignedInChrome shares a boundary, and the two dialogs are not mounted directly", () => {
    const app = blankComments(readFileSync(resolve(ROOT, "src/App.tsx"), "utf8"));
    const block = app.match(/<SignedInChrome>([\s\S]*?)<\/SignedInChrome>/)?.[1] ?? "";
    const pieces = [...block.matchAll(/<([A-Z]\w*)\s*\/>/g)].map((m) => m[1]);
    // Floor: the dock and the six pieces beside it.
    expect(pieces.length).toBeGreaterThan(6);
    expect(pieces).toContain("MobileNav");
    for (const p of pieces) expect(block, p).toMatch(new RegExp(`<Suspense fallback=\\{null\\}><${p} /></Suspense>`));
    expect(block.match(/<Suspense\b/g)?.length).toBe(pieces.length);
    expect(app).not.toMatch(/<TermsReconsentDialog\s*\/>|<IdentityCheckHost\s*\/>/);
  });
});

describe("TermsReconsentMount fetches the dialog only for an account that is behind", () => {
  it("current: no dialog code is fetched", async () => {
    render(<MemoryRouter><TermsReconsentMount /></MemoryRouter>);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(st.terms).toBe(0);
    expect(screen.queryByText("terms dialog")).toBeNull();
  });

  it("behind (an empty accepted version, every pre-consent account): the dialog shows", async () => {
    st.accepted = "";
    render(<MemoryRouter><TermsReconsentMount /></MemoryRouter>);
    expect(await screen.findByText("terms dialog")).toBeTruthy();
  });
});

describe("IdentityCheckMount fetches the sheet only when it has something to show", () => {
  it("closed, no entry link: no sheet code is fetched", async () => {
    st.idOn = false;
    render(<MemoryRouter initialEntries={["/home"]}><IdentityCheckMount /></MemoryRouter>);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(st.sheet).toBe(0);
    expect(screen.queryByText("identity sheet")).toBeNull();
  });

  it("opened: the sheet shows", async () => {
    render(<MemoryRouter initialEntries={["/home"]}><IdentityCheckMount /></MemoryRouter>);
    await waitFor(() => expect(openIdentityCheck("post")).toBe(true));
    expect(await screen.findByText("identity sheet")).toBeTruthy();
  });

  it("reached by /home?verify_id=1 or Stripe's ?idv=complete: the sheet mounts to read the link", async () => {
    st.idOn = false;
    render(<MemoryRouter initialEntries={["/home?verify_id=1"]}><IdentityCheckMount /></MemoryRouter>);
    expect(await screen.findByText("identity sheet")).toBeTruthy();
    cleanup();
    render(<MemoryRouter initialEntries={["/jobs?idv=complete"]}><IdentityCheckMount /></MemoryRouter>);
    expect(await screen.findByText("identity sheet")).toBeTruthy();
  });
});
