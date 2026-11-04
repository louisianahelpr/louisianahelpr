/**
 * Owner 2026-11-04 (via lead): profile links "should be made when they sign up, it's not something they should
 * have to create", and easy to find. Every member's handle is made at sign-up and backfilled
 * (20261104142602_profile_handle_at_signup; PGlite proof src/test/pglite/profileHandleAtSignup.pglite.mjs,
 * --before red 6/6). This file pins:
 *  - "Your page: louisianahelpr.com/u/<handle>" with Copy and Share, on the member's own profile and on
 *    Declutter's Selling tab;
 *  - Copy copies, and Share shares, the full https URL;
 *  - the migration's insert trigger, backfill and grants as the newest definitions.
 *
 * @mutate src/components/profile/ProfileLanding.tsx | <YourPageLink name={displayName?.trim().split(/\s+/)[0] ?? null} /> | {null}
 * @mutate src/components/declutter/DeclutterHomeView.tsx |       <YourPageLink /> |       {null}
 * @mutate src/components/profile/YourPageLink.tsx | if (await copyToClipboard(profileLinkUrl(handle))) | if (await copyToClipboard(handle))
 * @mutate supabase/migrations/20261104142602_profile_handle_at_signup.sql |   BEFORE INSERT ON public.profiles\n  FOR EACH ROW EXECUTE FUNCTION public.profile_handle_default_on_insert(); |   BEFORE UPDATE OF bio ON public.profiles\n  FOR EACH ROW EXECUTE FUNCTION public.profile_handle_default_on_insert();
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";

const rpc = vi.fn();
const share = vi.fn(async (_c: unknown) => "shared");
const copy = vi.fn(async (_t: string) => true);
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: (c: unknown) => share(c), copyToClipboard: (t: string) => copy(t) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { YourPageLink } from "@/components/profile/YourPageLink";

const ROOT = join(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

beforeEach(() => {
  rpc.mockReset();
  share.mockClear();
  copy.mockClear();
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <YourPageLink name="Eli" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Your page link (made at sign-up, easy to find)", () => {
  it("shows the member's link with Copy and Share", async () => {
    rpc.mockResolvedValue({ data: "eli-b", error: null });
    mount();
    await waitFor(() => expect(screen.getByText("louisianahelpr.com/u/eli-b")).toBeTruthy());
    expect(screen.getByText(/Your page:/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "louisianahelpr.com/u/eli-b" }).getAttribute("href")).toBe("/u/eli-b");
    expect(rpc).toHaveBeenCalledWith("rpc_ensure_my_handle");
  });

  it("Copy copies and Share shares the full https link", async () => {
    rpc.mockResolvedValue({ data: "eli-b", error: null });
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith("https://www.louisianahelpr.com/u/eli-b"));
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect((share.mock.calls[0][0] as { url: string }).url).toBe("https://www.louisianahelpr.com/u/eli-b");
  });

  it("shows nothing when the handle cannot be read", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    const { container } = mount();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container.querySelector("[data-your-page-link]")).toBeNull();
  });

  it("is on the member's own profile and on Declutter's Selling tab", () => {
    expect(code("src/components/profile/ProfileLanding.tsx")).toMatch(/<YourPageLink name=\{displayName/);
    const home = code("src/components/declutter/DeclutterHomeView.tsx");
    const selling = home.slice(home.indexOf("function SellingView"), home.indexOf("<SellingDash", home.indexOf("function SellingView")));
    expect(selling).toContain("<YourPageLink />");
  });
});

describe("20261104142602: every member gets a handle at sign-up, and every existing member is backfilled", () => {
  const sql = blankSqlComments(readFileSync(join(ROOT, "supabase/migrations/20261104142602_profile_handle_at_signup.sql"), "utf8"));
  it("a BEFORE INSERT trigger fills the handle, after the server-owned check", () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_profile_handle_zz_default\s+BEFORE INSERT ON public\.profiles\s+FOR EACH ROW EXECUTE FUNCTION public\.profile_handle_default_on_insert\(\);/);
    // Postgres fires BEFORE row triggers by name: the client-supplied-handle refusal must run first.
    expect("trg_profile_handle_insert_server_owned" < "trg_profile_handle_zz_default").toBe(true);
    expect("trg_profile_handle_retire" < "trg_profile_handle_zz_default").toBe(true);
  });
  it("the backfill covers every row with no handle and does not move updated_at", () => {
    expect(sql).toMatch(/WHERE p\.handle IS NULL AND p\.user_id IS NOT NULL/);
    // Lead review 11-04: no handle is reserved for a deleted (anonymized) account, in the backfill or on insert.
    expect(sql).toMatch(/WHERE p\.handle IS NULL AND p\.user_id IS NOT NULL\s+AND p\.anonymized_at IS NULL/);
    expect(sql).toMatch(/IF NEW\.handle IS NULL AND NEW\.user_id IS NOT NULL AND NEW\.anonymized_at IS NULL THEN/);
    expect(sql).toMatch(/DISABLE TRIGGER update_profiles_updated_at[\s\S]*ENABLE TRIGGER update_profiles_updated_at/);
  });
  it("the picker is not callable by members", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.profile_handle_pick\(uuid, text, boolean\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/SET search_path TO 'public', 'pg_temp'/);
  });
});
