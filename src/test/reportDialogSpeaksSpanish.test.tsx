/**
 * Design audit r3 #8 (HIGH, 11-18): in Español the Report listing dialog was entirely English (title, all six
 * reasons, "Tell us a little more", the placeholder, the counter help, the privacy line, Cancel, Send report) while
 * Delete account in the same session was Spanish (shot ~/.lh-shots/design-audit-r3/poster3-item-390-es-report.png).
 * Now every word reads from enReport.ts / esReport.ts; the reason VALUE written to reports.reason stays English.
 * Also r3 #12: the counter reads "0 / 500" and a listing report's placeholder fits a listing.
 *
 * @mutate src/components/ReportDialog.tsx | options={reasons.map(({ label }) => ({ value: label, label: t(reasonKey(label)) }))} | options={reasons.map(({ label }) => ({ value: label, label }))}
 * @mutate src/components/ReportDialog.tsx |       : t(`rep.title.${reportedType}` as MsgKey); |       : "Report listing";
 * @mutate src/components/ReportDialog.tsx |                 {t("rep.cancel")} |                 Cancel
 * @mutate src/components/ReportDialog.tsx |                   t("rep.send")\n |                   "Send report"\n
 * @mutate src/components/ReportDialog.tsx |               {t("rep.privacy")} |               The Louisiana Helpr team reviews every report.
 * @mutate src/components/ReportDialog.tsx | placeholder={LISTING_TYPES.includes(reportedType) ? t("rep.phListing") : t("rep.ph")} | placeholder={t("rep.ph")}
 * @mutate src/components/ReportDialog.tsx |                   {t("rep.count", { len: description.length, max: MAX_LENGTH })} |                   {charsLeft}
 * @mutate src/lib/i18n/es.ts |   ...esReport,\n |
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }) }, from: () => ({}) } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticLight: vi.fn() }));

import ReportDialog, { reasonKey } from "@/components/ReportDialog";
import { REASONS, type ReportedType } from "@/components/reportDialog/reportReasons";
import { enReport } from "@/lib/i18n/enReport";
import { esReport } from "@/lib/i18n/esReport";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";

beforeEach(() => {
  __resetLangForTests();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  __resetLangForTests();
});

const TYPES = Object.keys(REASONS) as ReportedType[];

describe("Report dialog in Spanish (design audit r3 #8)", () => {
  it("every reason of every report type has its English (the stored value) and a different Spanish", () => {
    let n = 0;
    for (const ty of TYPES) {
      for (const { label } of REASONS[ty]) {
        const k = reasonKey(label) as keyof typeof enReport;
        expect(enReport[k], `${ty}: ${label}`).toBe(label);
        expect(esReport[k], `${ty}: ${label}`).toBeTruthy();
        expect(esReport[k]).not.toBe(label);
        n++;
      }
      expect(enReport[`rep.title.${ty}` as keyof typeof enReport], ty).toBeTruthy();
      expect(esReport[`rep.q.${ty}` as keyof typeof esReport], ty).toBeTruthy();
    }
    expect(n).toBeGreaterThan(80);
  });

  it("English is unchanged: same title, reasons, buttons; the counter reads 0 / 500", () => {
    render(<ReportDialog open onClose={vi.fn()} reportedType="declutter_item" reportedId="i1" />);
    expect(screen.getByText("Report listing")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Prohibited item/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send report" })).toBeTruthy();
    expect(screen.getByText("0 / 500")).toBeTruthy();
    expect(screen.getByPlaceholderText("What's wrong with this listing?")).toBeTruthy();
  });

  it("a person's report keeps the 'when it happened' placeholder", () => {
    render(<ReportDialog open onClose={vi.fn()} reportedType="user" reportedId="u1" />);
    expect(screen.getByPlaceholderText("Start with when it happened…")).toBeTruthy();
  });

  it("in Español the listing report has no English left", async () => {
    setLang("es");
    await act(async () => { await ensureLangLoaded(); });
    render(<ReportDialog open onClose={vi.fn()} reportedType="declutter_item" reportedId="i1" />);
    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    expect(text).toContain("Reportar anuncio");
    expect(screen.getByRole("radio", { name: /Artículo prohibido/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enviar reporte" })).toBeTruthy();
    expect(screen.getByPlaceholderText("¿Cuál es el problema con este anuncio?")).toBeTruthy();
    const english = [
      "Report listing", "Prohibited item", "Scam or fake", "Offensive", "Shares contact info", "Something else",
      "Tell us a little more", "At least 10 characters", "reviews every report", "Send report",
    ];
    for (const w of english) expect(text, w).not.toContain(w);
  });
});
