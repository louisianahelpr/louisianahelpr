// @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsStates.tsx :: "        Try again\n      </Button>" => "        Retry\n      </Button>"
// @mutate src/components/declutter/DeclutterBrowseView.tsx :: "<DeclutterActiveFilters filters={filters} maxMiles={from ? maxMiles : null}" => "<DeclutterActiveFilters filters={filters} maxMiles={maxMiles}"
// @mutate src/pages/auth/signup/SignupStep1.tsx :: "<Link to={loginHref} className=\"tap-44" => "<Link to=\"/login\" className=\"tap-44"
// @mutate src/pages/declutter/DeclutterSettingsPage.tsx :: ", \"Pickup places\": \"[data-porch-places-card]\"" => ""
// @mutate src/lib/i18n/enListingParts.ts :: "it's kept under History in Selling." => "it's kept under Taken down in Selling."
/**
 * App audit 11-20 night, quick Lows (findings 19, 13, 26, 7, 5):
 *  19 the applicants error button reads "Try again", as its own words say;
 *  13 the "Within N mi" chip only shows when the distance filter is really applied (a location is known);
 *  26 the bottom Log in link on sign-up keeps the page the member came for;
 *   7 the Settings "Pickup places" chip finds its card in Spanish too (by attribute, not by its translated name);
 *   5 the delete toast names the History tab, which exists, in both languages.
 */
import { describe, expect, it } from "vitest";
import { readSource } from "@/test/helpers/walkSource";

describe("audit 11-20 night quick Lows", () => {
  it("19: the applicants error state button says Try again", () => {
    const src = readSource("src/pages/posts/postedJobs/applicantsPanel/ApplicantsStates.tsx");
    expect(src).toMatch(/onClick=\{onRetry\}\s*>\s*Try again\s*<\/Button>/);
    expect(src).not.toMatch(/>\s*Retry\s*<\/Button>/);
  });

  it("13: the active-filter chips get the distance only when a location is known", () => {
    const src = readSource("src/components/declutter/DeclutterBrowseView.tsx");
    expect(src).toContain("<DeclutterActiveFilters filters={filters} maxMiles={from ? maxMiles : null}");
    expect(src).not.toContain("<DeclutterActiveFilters filters={filters} maxMiles={maxMiles}");
  });

  it("26: no plain /login link is left on sign-up step 1", () => {
    const src = readSource("src/pages/auth/signup/SignupStep1.tsx");
    expect(src).not.toMatch(/to="\/login"/);
    expect(src).toContain("<Link to={loginHref}");
  });

  it("7: the Pickup places chip targets the card's attribute, which the card carries", () => {
    expect(readSource("src/pages/declutter/DeclutterSettingsPage.tsx")).toContain('"Pickup places": "[data-porch-places-card]"');
    expect(readSource("src/components/declutter/SellPorchPlaces.tsx")).toContain('data-porch-places-card=""');
  });

  it("28: the buttons that go to /home say Go to Home (translated), not Go to Dashboard", () => {
    for (const f of ["src/pages/auth/ResetPassword.tsx", "src/pages/post-job/GoToDashboardButton.tsx", "src/components/shops/shopsUi.tsx", "src/components/rentals/rentalsUi.tsx"]) {
      const src = readSource(f);
      expect(src, f).toContain('t("nav.goHome")');
      expect(src, f).not.toContain("Go to Dashboard\n");
      expect(src, f).not.toContain(">Go to Dashboard<");
    }
    expect(readSource("src/lib/i18n/enCore.ts")).toContain('"nav.goHome": "Go to Home"');
    expect(readSource("src/lib/i18n/es.ts")).toContain('"nav.goHome": "Ir a Inicio"');
  });

  it("4: the price-raise refusal says what to do about a typo, in both languages", () => {
    expect(readSource("src/lib/i18n/enListingParts.ts")).toContain("Listed too low by mistake? Delete it and post again.");
    expect(readSource("src/lib/i18n/esListingParts.ts")).toContain("Bórrelo y publíquelo de nuevo.");
  });

  it("5: the delete toast names History, not a Taken down section", () => {
    const en = readSource("src/lib/i18n/enListingParts.ts");
    const es = readSource("src/lib/i18n/esListingParts.ts");
    expect(en).toContain("it's kept under History in Selling.");
    expect(en).not.toContain("Taken down in Selling");
    expect(es).toContain("se guarda en Historial, en Vendiendo.");
    expect(es).not.toContain("Retirado, en Vendiendo");
  });
  it("27: Messages failure toasts come from the dictionary, with Spanish words", () => {
    const files = ["src/pages/messages/Messages.tsx", "src/pages/messages/useThreadMuteActions.ts", "src/pages/messages/useMessagesData.ts", "src/pages/messages/messagesData/sendHandlers.ts"];
    for (const f of files) expect(readSource(f), f).not.toMatch(/toast\.error\(["`](Couldn't|Message didn't|Messages are limited)/);
    const es = readSource("src/lib/i18n/esMessages.ts");
    for (const k of ["msg.editFailed", "msg.muteFailed", "msg.refreshFailed", "msg.olderFailed", "msg.sendFailed"]) expect(es, k).toContain(`"${k}"`);
  });
  it("18: at the 5-open-job cap a category tap brings the limit notice into view instead of doing nothing", () => {
    const entry = readSource("src/pages/post-job/EntryChoice.tsx");
    expect(entry.match(/if \(atOpenJobLimit\) return showLimitNotice\(\);/g)?.length).toBe(2);
    expect(entry).not.toMatch(/if \(atOpenJobLimit( \|\| !g)?\) return;/);
    expect(entry).toContain('document.querySelector<HTMLElement>("[data-open-job-limit]")');
    expect(readSource("src/pages/post-job/OpenJobLimitNotice.tsx")).toContain('data-open-job-limit=""');
  });
  it("6 (part): Selling history, Relist and the waiting trade label read the dictionary", () => {
    const down = readSource("src/components/declutter/DeclutterTakenDown.tsx");
    expect(down).toContain('t("dsl.hist.title")');
    expect(down).not.toContain('"Sold elsewhere."');
    expect(readSource("src/components/declutter/DeclutterReopenListing.tsx")).toContain('t("dsl.hist.relist")');
    expect(readSource("src/components/declutter/DeclutterSalesWaiting.tsx")).not.toContain('" · Trade"');
    expect(readSource("src/lib/i18n/esDeclutter.ts")).toContain('"dsl.hist.relist": "Volver a publicar"');
    expect(readSource("src/components/declutter/DeclutterEndedSales.tsx")).not.toContain("Nothing was charged.");
    expect(readSource("src/components/declutter/SellerHandedOver.tsx")).not.toContain('confirmLabel="Handed over"');
    expect(readSource("src/components/declutter/SellerQuestionsToAnswer.tsx")).not.toContain('title="Questions to answer"');
    expect(readSource("src/lib/i18n/esDeclutter.ts")).toContain('"dsl.qa.title": "Preguntas por responder"');
  });
});
