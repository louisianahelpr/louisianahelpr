/**
 * Q1286 (owner decision 2026-10-12): /complete-profile SAYS why a taken-over
 * account's fields are empty.
 *
 * WHAT WAS WRONG: after the Q447 pre-verification wipe (details typed on an
 * address that was never confirmed are cleared when the real owner signs in
 * with Google/Apple), the person landed on /complete-profile, whose intro read
 * only "We need a few details before you can use Helpr." A real owner who had
 * typed their own profile saw it empty with no reason.
 *
 * Now: has_pre_verification_wipe() (migration 20261012170325; behaviour proven
 * in src/test/pglite/preVerificationWipeNotice.pglite.mjs) answers for the
 * caller, and the page shows the owner's exact sentence when it is true, and
 * nothing extra otherwise. A missing function (before deploy) is silent; any
 * other failed read is reported, never dropped, and shows no line.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

let user: { id: string } | null = null;
let result: { data: unknown; error: unknown } = { data: false, error: null };
const rpc = vi.fn();
const report = vi.fn();

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user }) }));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => {
      rpc(name);
      return Promise.resolve(result);
    },
  },
}));

import { CompleteProfileIntro, WIPE_NOTICE } from "@/pages/auth/completeProfile/CompleteProfileIntro";

const OWNER_WORDING =
  "For your security, details entered before your email was confirmed were cleared. Please add them again.";

function renderIntro() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<CompleteProfileIntro />, { wrapper });
}

beforeEach(() => {
  user = { id: "u1" };
  result = { data: false, error: null };
  rpc.mockClear();
  report.mockClear();
});

describe("Q1286: /complete-profile explains a pre-verification wipe", () => {
  it("uses the owner's exact wording", () => {
    expect(WIPE_NOTICE).toBe(OWNER_WORDING);
  });

  it("a wiped account sees the line, under the usual intro", async () => {
    result = { data: true, error: null };
    renderIntro();
    expect(await screen.findByText(OWNER_WORDING)).toBeInTheDocument();
    expect(screen.getByText(/We need a few details before you can use Helpr/)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("has_pre_verification_wipe");
  });

  it("an account with no wipe sees no line", async () => {
    renderIntro();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(OWNER_WORDING)).toBeNull();
    expect(screen.getByText(/We need a few details before you can use Helpr/)).toBeInTheDocument();
  });

  it("before the migration deploys (PGRST202): no line, nothing reported", async () => {
    result = { data: null, error: { code: "PGRST202", message: "missing" } };
    renderIntro();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(OWNER_WORDING)).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("any other failed read: no line, and the error is reported (not dropped)", async () => {
    result = { data: null, error: { code: "42501", message: "permission denied" } };
    renderIntro();
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(OWNER_WORDING)).toBeNull();
  });

  it("signed out: no read at all", () => {
    user = null;
    renderIntro();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the live function answers for the CALLER only, skips failed wipes, and is closed to anon", () => {
    const dir = join(__dirname, "..", "..", "supabase", "migrations");
    const def = effectiveDefs(dir).get("has_pre_verification_wipe");
    expect(def, "has_pre_verification_wipe must be defined by a migration").toBeDefined();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/has_pre_verification_wipe\s*\(\s*\)/);
    expect(body).toMatch(/SECURITY\s+DEFINER/i);
    expect(body).toMatch(/SET\s+search_path/i);
    expect(body).toMatch(/w\.user_id\s*=\s*auth\.uid\(\)/);
    expect(body).toContain("NOT LIKE 'wipe failed:%'");
    const all = migrationFiles(dir).map((f) => blankSqlComments(readFileSync(join(dir, f), "utf8"))).join("\n");
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.has_pre_verification_wipe\(\) FROM PUBLIC, anon;/);
  });

  it("the real page renders this intro (not its own copy of the old line)", () => {
    const page = blankComments(
      readFileSync(join(__dirname, "..", "pages", "auth", "CompleteProfile.tsx"), "utf8"),
    );
    expect(page.length).toBeGreaterThan(10_000);
    expect(page).toContain("<CompleteProfileIntro />");
    expect(page).not.toContain("We need a few details before you can use Helpr");
  });
});

// @mutate src/pages/auth/completeProfile/CompleteProfileIntro.tsx |       {wiped && ( |       {false && (
// @mutate src/pages/auth/completeProfile/CompleteProfileIntro.tsx |       return wiped === true; |       return true;
// @mutate src/pages/auth/CompleteProfile.tsx |             <CompleteProfileIntro /> |             <p>We need a few details before you can use Helpr.</p>
// @mutate supabase/migrations/20261012170325_pre_verification_wipe_notice.sql |           AND coalesce(w.error, '') NOT LIKE 'wipe failed:%' |           AND true
// @mutate supabase/migrations/20261012170325_pre_verification_wipe_notice.sql | REVOKE ALL ON FUNCTION public.has_pre_verification_wipe() FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.has_pre_verification_wipe() FROM PUBLIC;
