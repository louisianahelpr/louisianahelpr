/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the member's own "Your page" link card (YourPageLink: Home, You and
 * Selling) in the member's language: the card, Selling's slim line, "Share your listings", the hidden-page line and the
 * copy toasts. Words in the one-importer panel dictionary enYourPage. An English member reads the old words.
 *
 * @mutate src/components/profile/YourPageLink.tsx |         {t("yp.pageLead")}{" "} |         Your page:{" "}
 * @mutate src/components/profile/YourPageLink.tsx | {forSale === 1 ? t("yp.forSale1") : t("yp.forSaleN", { n: forSale })} | {forSale === 1 ? t("yp.forSale1") : `${forSale} items for sale`}
 * @mutate src/components/profile/YourPageLink.tsx | <Share2 className="w-4 h-4" aria-hidden /> {t("yp.shareListings")} | <Share2 className="w-4 h-4" aria-hidden /> Share your listings
 * @mutate src/components/profile/YourPageLink.tsx |         {t("yp.hidden")}{" "} |         Your page is hidden right now, so others can't open it.{" "}
 * @mutate src/components/profile/YourPageLink.tsx | aria-label={t("yp.copyLabel")} | aria-label="Copy your page link"
 * @mutate src/components/profile/YourPageLink.tsx | toast(t("yp.copied")); | toast("Link copied");
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enYourPage } from "@/lib/i18n/enYourPage";
import { esYourPage } from "@/lib/i18n/esYourPage";

const page = { current: {} as object | null };
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/nativeShare", () => ({ copyToClipboard: async () => true, shareNative: async () => "shared" }));
vi.mock("@/lib/profileLink/api", async (orig) => ({
  ...(await orig<object>()),
  ensureMyHandle: async () => ({ handle: "eli-b" }),
  fetchPublicProfile: async () => page.current,
}));

const { YourPageLink } = await import("@/components/profile/YourPageLink");

const show = async (props: { forSale?: number; slim?: boolean } = {}) => {
  cleanup();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><YourPageLink knownHandle="eli-b" name="Eli" {...props} /></MemoryRouter>
    </QueryClientProvider>,
  );
  const ready = page.current === null ? "[data-your-page-hidden]" : "[data-your-page-link]";
  await waitFor(() => expect(document.querySelector(ready)).toBeTruthy());
  return document.body.textContent ?? "";
};

describe("Your page link card follows the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
    page.current = {};
    toast.mockClear();
  });

  it("every word has its Spanish, and es.ts carries it", () => {
    for (const k of Object.keys(enYourPage) as (keyof typeof enYourPage)[]) {
      expect(es[k], k).toBe(esYourPage[k]);
      expect(esYourPage[k], `${k} still English`).not.toBe(enYourPage[k]);
      expect([...esYourPage[k].matchAll(/\{\w+\}/g)].map((m) => m[0])).toEqual([...enYourPage[k].matchAll(/\{\w+\}/g)].map((m) => m[0]));
    }
  });

  it("English: the old words", async () => {
    expect(await show()).toContain("Your page: louisianahelpr.com/u/eli-b");
    const sale = await show({ forSale: 3 });
    expect(sale).toContain("3 items for sale");
    expect(sale).toContain("Share your listings");
    await show({ slim: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy your page link" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Link copied"));
    page.current = null;
    expect(await show()).toContain("Your page is hidden right now, so others can't open it.");
  });

  it("Spanish: the card, the sale card, the slim line, the toast and the hidden line change", async () => {
    setLang("es");
    await ensureLangLoaded();
    expect(await show()).toContain("Su página: louisianahelpr.com/u/eli-b");
    const sale = await show({ forSale: 3 });
    expect(sale).toContain("3 artículos a la venta");
    expect(sale).toContain("Compartir sus publicaciones");
    expect(sale).not.toContain("Share your listings");
    await show({ slim: true });
    fireEvent.click(screen.getByRole("button", { name: "Copiar el enlace de su página" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Enlace copiado"));
    page.current = null;
    expect(await show()).toContain("Su página está oculta ahora, así que otros no pueden abrirla.");
  });
});
