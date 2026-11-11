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
 * @mutate src/components/declutter/DeclutterHomeView.tsx |       <YourPageLink slim /> |       <YourPageLink forSale={1} />
 * @mutate src/components/profile/YourPageLink.tsx |   if (slim) { |   if (slim && forSale < 0) {
 * @mutate src/components/profile/YourPageLink.tsx | if (await copyToClipboard(profileLinkUrl(handle))) | if (await copyToClipboard(handle))
 * @mutate src/components/profile/YourPageLink.tsx |   if (forSale > 0) { |   if (forSale < 0) {
 * @mutate src/components/declutter/DeclutterShareCard.tsx | data-listing-share="" onClick={() => shareListing(item)} | data-listing-share="" onClick={() => undefined}
 * @mutate src/components/profile/YourPageLink.tsx |     enabled: !knownHandle, |     enabled: true,
 * @mutate src/components/profile/YourPageLink.tsx |   if (publicPage === null) { |   if (publicPage === undefined && false) {
 * @mutate src/components/profile/YourPageLink.tsx |     queryFn: () => fetchPublicProfile(handle as string), |     queryFn: async () => fetchPublicProfile(handle as string).catch(() => null),
 * @mutate src/pages/home/HomeDashboard.tsx | {profile?.handle && <YourPageLink knownHandle={profile.handle} name={first ?? null} className="mb-2" />} | {null}
 * @mutate src/pages/home/HomeDashboard.tsx | className="mb-2" />}\n            <HomeMoneyTiles money={money} placement="side" /> | className="mb-2" />}\n            {null}
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
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

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

  it("with items for sale it is a clear Share your listings button (owner request 11-05)", async () => {
    rpc.mockResolvedValue({ data: "eli-b", error: null });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <YourPageLink name="Eli" forSale={3} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Share your listings" })).toBeTruthy());
    expect(screen.getByText("3 items for sale")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Share your listings" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect((share.mock.calls[0][0] as { url: string }).url).toBe("https://www.louisianahelpr.com/u/eli-b");
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith("https://www.louisianahelpr.com/u/eli-b"));
  });

  it("Selling leads with it, and each live listing row has its own Share", () => {
    const home = code("src/components/declutter/DeclutterHomeView.tsx");
    const view = home.slice(home.indexOf("function SellingView"), home.indexOf("<SellingDash", home.indexOf("function SellingView")));
    expect(view.indexOf("<YourPageLink")).toBeLessThan(view.indexOf("<ListedWhatNext"));
    expect(home).toMatch(/\{item\.status === "live" && <ListingShareButton item=\{item\} \/>\}/);
    const card = code("src/components/declutter/DeclutterShareCard.tsx");
    expect(card).toMatch(/<Button[^>]*aria-label=\{`Share \$\{item\.title\}`\}[^>]*onClick=\{\(\) => shareListing\(item\)\}/);
  });

  it("Home shows it from the profile row it already has: no extra read (owner request 11-05)", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <YourPageLink knownHandle="eli-b" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: "louisianahelpr.com/u/eli-b" })).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith("rpc_ensure_my_handle");
    const home = code("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain("{profile?.handle && <YourPageLink knownHandle={profile.handle} name={first ?? null} className=\"mb-2\" />}");
  });

  it("Home puts the card at the TOP of the right column, above the money tiles and sections (owner 11-10)", () => {
    const home = code("src/pages/home/HomeDashboard.tsx");
    const side = home.indexOf('<section data-home-side');
    expect(side).toBeGreaterThan(0);
    const end = home.indexOf("</section>}", side);
    const body = home.slice(home.indexOf(">", side) + 1, end);
    // The first JSX child of the right column is the Your page card; the money tiles and the chips come after it.
    // (Comments are blanked to spaces, so a comment line reads "{   }" and is skipped.)
    const firstChild = body.split("\n").map((l) => l.trim()).find((l) => l.replace(/[{}\s]/g, "") !== "") ?? "";
    expect(firstChild).toContain("<YourPageLink");
    expect(body).toContain('<HomeMoneyTiles money={money} placement="side" />');
    expect(body.indexOf("<YourPageLink")).toBeLessThan(body.indexOf("<HomeMoneyTiles"));
    expect(body.indexOf("<YourPageLink")).toBeLessThan(body.indexOf("data-section-chips"));
  });

  // F259k (audit 11-10, lead confirmed live): the card offered Copy and Share for a link that opened "This profile isn't
  // available". When the page's own read answers "no page", the card says the page is hidden and offers nothing to share.
  it("F259k: a hidden page gets no Copy or Share, just a plain note", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "public_profile_by_handle" ? { data: null, error: null } : { data: "eli-b", error: null });
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <YourPageLink knownHandle="eli-b" name="Eli" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(container.querySelector("[data-your-page-hidden]")).not.toBeNull());
    expect(rpc).toHaveBeenCalledWith("public_profile_by_handle", { p_handle: "eli-b" });
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
    expect(screen.queryByText("louisianahelpr.com/u/eli-b")).toBeNull();
    expect(container.textContent).toContain("Your page is hidden right now, so others can't open it.");
  });

  it("F259k: a failed page read keeps the card (a network blip never hides a working link)", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "public_profile_by_handle" ? { data: null, error: { message: "boom", code: "XX000" } } : { data: "eli-b", error: null });
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <YourPageLink knownHandle="eli-b" name="Eli" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("public_profile_by_handle", { p_handle: "eli-b" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-your-page-hidden]")).toBeNull();
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
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
    // F127 (UI audit 11-09; owner 11-05 placements; lead 11-09): Selling's is the slim one-line link.
    expect(selling).toContain("<YourPageLink slim />");
  });

  it("F127: the slim line is 'Your page · Copy · Share' with the same two actions, never a card", async () => {
    rpc.mockResolvedValue({ data: "eli-b", error: null });
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <YourPageLink name="Eli" slim />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(container.querySelector("[data-your-page-slim]")).not.toBeNull());
    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector("[data-your-page-slim]")?.textContent).toBe("Your page· Copy· Share");
    fireEvent.click(screen.getByRole("button", { name: "Copy your page link" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith("https://www.louisianahelpr.com/u/eli-b"));
    fireEvent.click(screen.getByRole("button", { name: "Share your page" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
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
