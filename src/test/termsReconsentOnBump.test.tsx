/**
 * Terms changed on 2026-09-23 ($1,000 price cap, standard pay 3 days after the
 * job is marked done), so every account re-accepts (docs/OPEN.md Q210(d), owner
 * decision 2026-09-23). The bump is three hand-kept copies, and the only thing
 * that makes it reach anyone is TermsReconsentDialog comparing an account's
 * profiles.terms_version_accepted with LATEST_TERMS_VERSION:
 *
 *   1. the three copies agree: src/lib/consent.ts LATEST_TERMS_VERSION (the
 *      dialog + CompleteProfile), supabase/functions/_shared/legalVersions.ts
 *      LEGAL_TERMS_VERSION (complete-signup) and LAST_UPDATED.terms (the date
 *      the Terms page shows). legalVersions.parity.test.ts checks only the last
 *      two, though consent.ts's header says it guards all three;
 *   2. the version is past "Jun 2026", the version every account accepted
 *      before the 2026-09-23 Terms change;
 *   2b. acceptances record LATEST_PRIVACY_VERSION as privacy_version (Q289:
 *      both call sites wrote the Terms version, harmless only while equal);
 *   3. the seed scripts that write terms_version_accepted directly pin it;
 *   4. behaviour: a confirmed, unbanned account whose accepted version is
 *      "Jun 2026" (or never set) is shown the non-dismissible dialog, and
 *      tapping I Agree pins the new version; an account on the new version is
 *      not prompted.
 *
 * Proven red 2026-09-23 on origin/main bf4007bed (all three copies "Jun 2026"):
 * the "past Jun 2026" case and the "Jun 2026 account is prompted" case failed.
 *
 * @mutate src/lib/consent.ts | export const LATEST_TERMS_VERSION = "Sep 2026"; | export const LATEST_TERMS_VERSION = "Jun 2026";
 * @mutate supabase/functions/_shared/legalVersions.ts | export const LEGAL_TERMS_VERSION = "Sep 2026"; | export const LEGAL_TERMS_VERSION = "Jun 2026";
 * @mutate scripts/audit/prod-seed.mjs | terms_version_accepted: "Sep 2026", | terms_version_accepted: "Jun 2026",
 * @mutate src/components/TermsReconsentDialog.tsx | privacy_version: LATEST_PRIVACY_VERSION, | privacy_version: LATEST_TERMS_VERSION,
 * @mutate src/components/TermsReconsentDialog.tsx | Terms of Service\n            </a>\n            . | Terms of Service\n            </a> and Privacy Policy.
 * @mutate src/components/TermsReconsentDialog.tsx | const isStale = loaded && acceptedVersion !== LATEST_TERMS_VERSION; | const isStale = false;
 */
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

let acceptedVersion: string | null = "Jun 2026";
const updates: Record<string, unknown>[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const build = () => {
    const b: Record<string, unknown> = {};
    let pending: Record<string, unknown> | null = null;
    for (const m of ["select", "eq"]) b[m] = () => b;
    b.update = (row: Record<string, unknown>) => { pending = row; return b; };
    b.maybeSingle = async () => ({ data: { terms_version_accepted: acceptedVersion }, error: null });
    b.insert = async () => ({ error: null });
    b.then = (res: (v: unknown) => void) => {
      if (pending) updates.push(pending);
      res({ data: pending ? [{ user_id: "u-1" }] : [], error: null });
    };
    return b;
  };
  return { supabase: { from: () => build() } };
});
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "u-1", email_confirmed_at: "2026-09-01T00:00:00Z" },
    profile: { ban_status: "active" },
    refresh: async () => {},
  }),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

import { RECONSENT_EXEMPT_PATHS, TermsReconsentDialog } from "@/components/TermsReconsentDialog";
import { LATEST_PRIVACY_VERSION, LATEST_TERMS_VERSION } from "@/lib/consent";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const TITLE = /Please Take a Moment to Re-Agree/;

/** "Mon YYYY" -> sortable number. */
function monthKey(v: string): number {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(v);
  if (!m || !months.includes(m[1])) throw new Error(`unexpected version format: ${v}`);
  return Number(m[2]) * 12 + months.indexOf(m[1]);
}

describe("Terms re-acceptance after the 2026-09-23 Terms change (Q210(d))", () => {
  beforeEach(() => {
    updates.length = 0;
    document.body.innerHTML = "";
  });

  it("the three copies of the Terms version agree", () => {
    const edge = /export const LEGAL_TERMS_VERSION = "([^"]+)";/.exec(read("supabase/functions/_shared/legalVersions.ts"))?.[1];
    const block = /LAST_UPDATED:\s*Record<TabKey,\s*string>\s*=\s*\{([\s\S]*?)\}/.exec(read("src/pages/legal/legalSections.ts"))?.[1] ?? "";
    const page = /terms:\s*"([^"]+)"/.exec(block)?.[1];
    expect(edge).toBe(LATEST_TERMS_VERSION);
    expect(page).toBe(LATEST_TERMS_VERSION);
  });

  it("acceptances record the Privacy version, not the Terms version (Q289)", () => {
    const edge = /export const LEGAL_PRIVACY_VERSION = "([^"]+)";/.exec(read("supabase/functions/_shared/legalVersions.ts"))?.[1];
    expect(LATEST_PRIVACY_VERSION).toBe(edge);
    for (const f of ["src/components/TermsReconsentDialog.tsx", "src/pages/CompleteProfile.tsx"]) {
      const src = blankComments(read(f));
      expect(src, f).toMatch(/privacy_version: LATEST_PRIVACY_VERSION,/);
      expect(src, f).not.toMatch(/privacy_version: LATEST_TERMS_VERSION/);
    }
  });

  it("seed scripts pin the current version, so seeded accounts are not stuck behind the gate", () => {
    const files = ["scripts/audit/prod-seed.mjs", "scripts/create-app-review-demo-account.mjs"];
    let seen = 0;
    for (const f of files) {
      for (const m of blankComments(read(f)).matchAll(/terms_version_accepted:\s*"([^"]*)"/g)) {
        seen++;
        expect(m[1], f).toBe(LATEST_TERMS_VERSION);
      }
    }
    expect(seen).toBeGreaterThan(1);
  });

  it("the version is past Jun 2026, the one every account accepted before the change", () => {
    expect(monthKey(LATEST_TERMS_VERSION)).toBeGreaterThan(monthKey("Jun 2026"));
  });

  it("an account that accepted Jun 2026 is prompted, and I Agree pins the new version", async () => {
    acceptedVersion = "Jun 2026";
    render(<MemoryRouter><TermsReconsentDialog /></MemoryRouter>);
    expect(await screen.findByText(TITLE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I Agree" }));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0].terms_version_accepted).toBe(LATEST_TERMS_VERSION);
  });

  it("an account that never recorded a version is prompted", async () => {
    acceptedVersion = "";
    render(<MemoryRouter><TermsReconsentDialog /></MemoryRouter>);
    expect(await screen.findByText(TITLE)).toBeTruthy();
  });

  it("an account already on the new version is not prompted", async () => {
    acceptedVersion = LATEST_TERMS_VERSION;
    render(<MemoryRouter><TermsReconsentDialog /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it.each(["/legal", "/terms", "/privacy"])("a stale account is not prompted on %s, the page the dialog links to", async (path) => {
    acceptedVersion = "Jun 2026";
    render(<MemoryRouter initialEntries={[path]}><TermsReconsentDialog /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("every exempt path is still a route in App.tsx (a stale entry fails)", () => {
    const app = readFileSync(join(resolve(__dirname, "../.."), "src/App.tsx"), "utf8");
    const stale = RECONSENT_EXEMPT_PATHS.filter((p) => !app.includes(`path="${p}"`));
    expect(stale, `exempt path is no longer a route: ${stale.join(", ")} — remove it`).toEqual([]);
  });

  it("the dialog names only the documents its trigger compares (Q306)", () => {
    // isStale compares the Terms version alone, so the copy must not claim a
    // Privacy Policy update; if a Privacy comparison is ever added, the copy
    // may name it again.
    const src = read("src/components/TermsReconsentDialog.tsx");
    const stale = /const isStale = [^;]+;/.exec(src)?.[0] ?? "";
    expect(stale).toContain("LATEST_TERMS_VERSION");
    const body = /<DialogBody>([\s\S]*?)<\/DialogBody>/.exec(src)?.[1] ?? "";
    expect(body).toContain("Terms of Service");
    if (!stale.includes("PRIVACY")) expect(body).not.toMatch(/Privacy/);
  });
});
