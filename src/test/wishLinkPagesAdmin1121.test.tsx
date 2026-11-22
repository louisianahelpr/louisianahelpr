/**
 * Admin -> Wish list links, "Get shop details" (gift lists lane, 2026-11-21: "the server fetch of a pasted link's title,
 * photo and price for the link queue"): with waiting pasted links not read yet, the view offers "Get shop details (n)";
 * a tap calls the admin-only edge function wish-link-pages, says what it did (counts only) and reloads the queue; a row
 * whose page was read shows its photo, title and price with the day; a page we could not read says so; a refused or
 * failed call is an error toast, never a quiet nothing.
 * Server: supabase/functions/wish-link-pages (src/test/edge/wishLinkPages.test.ts) and migration 20261122034304
 * (src/test/pglite/wishLinkPageDetails.pglite.mjs).
 *
 * @mutate src/components/admin/AdminWishLinks.tsx |   const unread = waiting.filter((r) => r.kind === "link" && !r.page_checked_at && !isAmazonLink(r.url)).length; |   const unread = 0;
 * @mutate src/components/admin/AdminWishLinks.tsx |   const { data, error } = await supabase.functions.invoke("wish-link-pages", { body: {} }); |   const { data, error } = { data: { checked: 0 }, error: null };
 * @mutate src/components/admin/AdminWishLinks.tsx |   if (error) { |   if (false) {
 * @mutate src/components/admin/AdminWishLinks.tsx |       <PageLine r={r} /> | {null}
 * @mutate src/components/admin/AdminWishLinks.tsx |   if (r.page_status !== "ok") { |   if (r.page_status === "never") {
 * @mutate src/components/admin/AdminWishLinks.tsx | && !r.page_checked_at && !isAmazonLink(r.url)).length; | && !r.page_checked_at).length;
 * @mutate src/components/admin/AdminWishLinks.tsx |       if (run.unsaved > 0) errorToast( |       if (false) errorToast(
 * @mutate src/components/admin/AdminWishLinks.tsx |       if (ctx.status === 404) throw new Error( |       if (ctx.status === 40400) throw new Error(
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, functions: { invoke } } }));
const errorToast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ errorToast, successToast: vi.fn() }));

import AdminWishLinks, { pagesRunLine, type WishLinkRow } from "@/components/admin/AdminWishLinks";

const R1 = "11111111-2222-4333-8444-000000000001";
const R2 = "11111111-2222-4333-8444-000000000002";
const R3 = "11111111-2222-4333-8444-000000000003";
const base = { kind: "link" as const, list_key: "p1", list_name: "Mom", status: "open" as const, affiliate_url: null, created_at: "2026-11-21T20:00:00Z" };
let rows: WishLinkRow[] = [];

beforeEach(() => {
  rows = [
    { ...base, id: R1, words: "Hand knit scarf", url: "https://www.etsy.com/listing/1" },
    { ...base, id: R2, words: "Stanley cup", url: "https://www.target.com/p/1" },
    { ...base, id: R3, kind: "idea", words: "LSU hoodie", url: null },
    // An Amazon link is never read: it never counts as waiting for shop details.
    { ...base, id: "11111111-2222-4333-8444-000000000004", words: "Cozy throw", url: "https://www.amazon.com/dp/B000000002" },
  ];
  rpc.mockReset().mockImplementation(async (fn: string) => (fn === "admin_wish_link_requests" ? { data: rows, error: null } : { data: null, error: null }));
  invoke.mockReset();
  errorToast.mockReset();
});
afterEach(() => cleanup());

const view = () => render(<QueryClientProvider client={new QueryClient()}><AdminWishLinks /></QueryClientProvider>);

describe("Admin wish list links: Get shop details", () => {
  it("offers the read for unread pasted links (never for typed ideas), says what it did and shows each page", async () => {
    invoke.mockImplementation(async () => {
      rows = rows.map((r) => (r.id === R1
        ? { ...r, page_status: "ok", page_checked_at: "2026-11-21T21:00:00Z", page_title: "Hand Knit Scarf", page_image: "https://i.etsystatic.com/1.jpg", page_price: "38.50" }
        : r.id === R2 ? { ...r, page_status: "failed", page_checked_at: "2026-11-21T21:00:00Z" } : r));
      return { data: { checked: 2, ok: 1, none: 0, skipped: 0, blocked: 0, failed: 1, unsaved: 0, more: false }, error: null };
    });
    const v = view();
    const btn = await waitFor(() => {
      const b = v.container.querySelector<HTMLButtonElement>("[data-admin-wish-links-pages]");
      expect(b).not.toBeNull();
      return b!;
    });
    // Two pasted links unread; the typed idea is never a page.
    expect(btn.textContent).toBe("Get shop details (2)");
    fireEvent.click(btn);
    await waitFor(() => expect(v.container.querySelector("[data-admin-wish-links-pages-line]")?.textContent).toBe("Checked 2 links: 1 with details, 1 couldn't be read."));
    expect(errorToast).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("wish-link-pages", { body: {} });
    await waitFor(() => expect(v.container.querySelector(`[data-admin-wish-link-page="${R1}"]`)).not.toBeNull());
    const page = v.container.querySelector(`[data-admin-wish-link-page="${R1}"]`)!;
    expect(page.querySelector("img")!.getAttribute("src")).toBe("https://i.etsystatic.com/1.jpg");
    expect(page.querySelector("img")!.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(page.querySelector("[data-admin-wish-link-page-title]")!.textContent).toBe("Hand Knit Scarf");
    expect(page.querySelector("[data-admin-wish-link-page-price]")!.textContent).toBe("$38.50 on the page · ");
    expect(page.textContent).toContain("read Nov 21");
    expect(v.container.querySelector(`[data-admin-wish-link-page-note="${R2}"]`)!.textContent).toBe("Shop page couldn't be read · Nov 21");
    // Nothing unread now: the button goes, the line stays.
    await waitFor(() => expect(v.container.querySelector("[data-admin-wish-links-pages]")).toBeNull());
  });

  it("a refused or failed call is an error toast with the function's words, never a quiet nothing", async () => {
    const res = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
    invoke.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: res } });
    const v = view();
    const btn = await waitFor(() => {
      const b = v.container.querySelector<HTMLButtonElement>("[data-admin-wish-links-pages]");
      expect(b).not.toBeNull();
      return b!;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    expect(errorToast.mock.calls[0][0]).toBe("Shop details were not read");
    expect(errorToast.mock.calls[0][1].description).toBe("Only admins can read shop pages.");
    expect(v.container.querySelector("[data-admin-wish-links-pages-line]")).toBeNull();
    // Not deployed (404): said so, not "try again".
    errorToast.mockReset();
    invoke.mockResolvedValue({ data: null, error: { message: "not found", context: new Response("{}", { status: 404 }) } });
    fireEvent.click(btn);
    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    expect(errorToast.mock.calls[0][1].description).toMatch(/isn't deployed/);
  });

  it("pages read but not saved are an error toast too, and never 'Checked'", async () => {
    invoke.mockResolvedValue({ data: { checked: 1, ok: 1, none: 0, skipped: 0, blocked: 0, failed: 0, unsaved: 1, more: true }, error: null });
    const v = view();
    const btn = await waitFor(() => {
      const b = v.container.querySelector<HTMLButtonElement>("[data-admin-wish-links-pages]");
      expect(b).not.toBeNull();
      return b!;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    expect(errorToast.mock.calls[0][0]).toBe("Some shop details were not saved");
    // "More are waiting" is not offered while saves fail.
    expect(v.container.querySelector("[data-admin-wish-links-pages-line]")!.textContent).toBe("Checked 1 link: 1 with details, 1 not saved.");
  });

  it("the run line counts every kind, and asks for another tap when more wait", () => {
    expect(pagesRunLine({ checked: 0, ok: 0, none: 0, skipped: 0, blocked: 0, failed: 0, unsaved: 0, more: false })).toBe("No new shop pages to read.");
    expect(pagesRunLine({ checked: 0, ok: 0, none: 0, skipped: 0, blocked: 0, failed: 0, unsaved: 8, more: true })).toBe("None of the 8 links could be saved. Try again in a moment.");
    expect(pagesRunLine({ checked: 8, ok: 4, none: 1, skipped: 1, blocked: 1, failed: 1, unsaved: 0, more: true }))
      .toBe("Checked 8 links: 4 with details, 1 with nothing to show, 1 not on our shop list, 2 couldn't be read. More are waiting: tap again.");
  });
});
