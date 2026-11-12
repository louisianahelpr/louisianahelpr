/**
 * F260q: the job page's list-it-for-the-seller panel (ListForSellerPanelOpen.tsx) reads in the member's language:
 * its words from enListForSeller/esListForSeller (one-importer panel dictionary, inlined into the lazy panel), the
 * status by its CODE (lfs.st.<status>), category / condition / size options by code (decl.cat/cond/size, wordInLang).
 *
 * @mutate src/pages/jobs/appliedJobCard/steps/ListForSellerPanelOpen.tsx | const statusWord = (s: HelprJobListing["status"]) => t(`lfs.st.${s}` as MsgKey); | const statusWord = (s: HelprJobListing["status"]) => s;
 * @mutate src/pages/jobs/appliedJobCard/steps/ListForSellerPanelOpen.tsx | {drafts === 1 ? t("lfs.sendOne", { name: seller }) : t("lfs.sendAll", { count: drafts, name: seller })} | {t("lfs.sendAll", { count: drafts, name: seller })}
 * @mutate src/pages/jobs/appliedJobCard/steps/ListForSellerPanelOpen.tsx | <option key={n} value={n}>{wordInLang(`decl.cond.${n}`, CONDITION_LABEL[n])}</option> | <option key={n} value={n}>{CONDITION_LABEL[n]}</option>
 * @mutate src/pages/jobs/appliedJobCard/steps/ListForSellerPanelOpen.tsx | <option key={k} value={k}>{wordInLang(`decl.size.${k}`, SIZE_LABEL[k])}</option> | <option key={k} value={k}>{SIZE_LABEL[k]}</option>
 * @mutate src/pages/jobs/appliedJobCard/steps/ListForSellerPanelOpen.tsx | {wordInLang(`decl.cat.${c.key}`, c.label)} | {c.label}
 * @mutate src/lib/i18n/es.ts |   ...esListForSeller, |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { enListForSeller } from "@/lib/i18n/enListForSeller";
import { esListForSeller } from "@/lib/i18n/esListForSeller";

const lib = vi.hoisted(() => ({
  fetchHelprJobListings: vi.fn(), helprCreateListing: vi.fn(), helprUpdateListing: vi.fn(), helprDeleteListing: vi.fn(),
  helprSendListings: vi.fn(), helprUploadListingPhoto: vi.fn(),
}));
vi.mock("@/lib/declutter/listForSeller", () => lib);
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "helpr-1" } }) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));

import ListForSellerPanelOpen from "@/pages/jobs/appliedJobCard/steps/ListForSellerPanelOpen";

const row = (over: Record<string, unknown> = {}) => ({
  item_id: "item-1", title: "Oak dresser", description: "Six drawers", category: "furniture", condition_stars: 4,
  delivery_size: "large", price_cents: 15000, floor_price_cents: 9000, area_label: "Mid City", status: "draft",
  photo_count: 2, sent_at: null, ...over,
});
const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ListForSellerPanelOpen jobId="job-1" job={{ category: "declutter_help" }} posterName="Ann Guidry" />
  </QueryClientProvider>,
);

describe("F260q: the list-for-the-seller panel follows the member's language", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); __resetLangForTests(); });

  it("every key has its Spanish, with the same {placeholders}", () => {
    for (const k of Object.keys(enListForSeller) as (keyof typeof enListForSeller)[]) {
      expect(esListForSeller[k], k).toBeTruthy();
      expect(esListForSeller[k], k).not.toBe(enListForSeller[k]);
      expect((esListForSeller[k].match(/\{\w+\}/g) ?? []).sort(), k).toEqual((enListForSeller[k].match(/\{\w+\}/g) ?? []).sort());
    }
  });

  it("Spanish: intro, actions, status words by code, and the form's labels and options", async () => {
    setLang("es");
    await ensureLangLoaded();
    lib.fetchHelprJobListings.mockResolvedValue([row(), row({ item_id: "item-2", title: "Brass lamp", status: "pending_seller_approval" })]);
    mount();
    expect(await screen.findByRole("button", { name: "Enviársela a Ann para que la apruebe" })).toBeTruthy();
    expect(screen.getByText(/Va a la cuenta de Ann/)).toBeTruthy();
    expect(screen.getByText(/Aún no enviada/)).toBeTruthy();
    expect(screen.getByText(/Esperando su aprobación/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Agregar publicación para Ann" }));
    const form = screen.getByRole("form", { name: "Nueva publicación para Ann" });
    expect(form.textContent).toContain("Título");
    expect(form.textContent).toContain("Vecindario o pueblo");
    const options = [...form.querySelectorAll("option")].map((o) => o.textContent ?? "");
    for (const english of ["Lightly used", "Large: needs a truck", "Furniture"]) expect(options, english).not.toContain(english);
    expect(screen.getByRole("button", { name: "Guardar publicación" })).toBeTruthy();
  });

  it("Spanish: several drafts say how many", async () => {
    setLang("es");
    await ensureLangLoaded();
    lib.fetchHelprJobListings.mockResolvedValue([row(), row({ item_id: "item-2", title: "Brass lamp" })]);
    mount();
    expect(await screen.findByRole("button", { name: "Enviar las 2 a Ann para que las apruebe" })).toBeTruthy();
  });
});
