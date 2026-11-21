// @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsStates.tsx |         Try again\n      </Button> |         Retry\n      </Button>
// @mutate src/components/declutter/DeclutterBrowseView.tsx | <DeclutterActiveFilters filters={filters} maxMiles={from ? maxMiles : null} | <DeclutterActiveFilters filters={filters} maxMiles={maxMiles}
// @mutate src/pages/auth/signup/SignupStep1.tsx | <Link to={loginHref} className="tap-44 | <Link to="/login" className="tap-44
// @mutate src/pages/declutter/DeclutterSettingsPage.tsx | , "Pickup places": "[data-porch-places-card]" | 
// @mutate src/lib/i18n/enListingParts.ts | it's kept under History in Selling. | it's kept under Taken down in Selling.
/**
 * App audit 2026-11-20 night, quick Lows (findings 19, 13, 26, 7, 5):
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

  it("6 (settings): Declutter settings reads the dictionary, and its chips find their sections in either language", () => {
    const src = readSource("src/pages/declutter/DeclutterSettingsPage.tsx");
    expect(src).not.toMatch(/(?:title|aria-label)="[A-Z]/);
    expect(src).not.toMatch(/>(?:Declutter notifications|Choose what you hear)/);
    // The chip looks its section up by the same translated words the section's aria-label carries.
    expect(src).toContain('`section[aria-label="${t(INDEX_LABEL[name])}"]`');
    expect(src).toContain('aria-label={t("dset.defaults")}');
    expect(src).toContain('aria-label={t("dset.notifications")}');
    for (const key of ["dset.pageTitle", "dset.title", "dset.selling", "dset.onThisPage", "dset.defaults", "dset.notifications", "dset.notifRow", "dset.notifHint"]) {
      expect(readSource("src/lib/i18n/enDeclSell.ts"), key).toContain(`"${key}": "`);
      expect(readSource("src/lib/i18n/esDeclSell.ts"), key).toContain(`"${key}": "`);
    }
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
    const entry = readSource("src/pages/post-job/EntryChoice.tsx") ?? "";
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
  it("6 (payouts): the payout prompt, the payout line and its setup link read the dictionary", () => {
    const prompt = readSource("src/components/declutter/SellerPayoutPrompt.tsx");
    // The Sell and Move screens load neither Declutter dictionary: the prompt brings its own words.
    expect(prompt).toContain('import "@/lib/i18n/enDeclPayout";');
    expect(prompt).toContain('title={t("dpo.promptTitle", { amount: formatPrice(cents) })}');
    expect(prompt).not.toMatch(/Set up payouts <|You sold \$\{|held safely/);
    const link = readSource("src/components/declutter/FailedPayoutLink.tsx");
    expect(link).toContain("payoutLineWaitsOnSetup(line)");
    expect(link).not.toMatch(/once you set up payouts in Settings\||>Check your payouts<|>Set up payouts</);
    const line = readSource("src/components/declutter/declutterPayoutWords.ts");
    expect(line).not.toMatch(/`\$\{gets\}[,. ]+[A-Za-z]/);
    expect(readSource("src/lib/declutter/payoutWords.ts")).not.toMatch(/"Nothing to pay out|you owed`|refund`/);
    expect(readSource("src/lib/declutter/timeLeft.ts")).not.toContain('toLocaleDateString("en-US"');
    const es = readSource("src/lib/i18n/esDeclPayout.ts");
    expect(es).toContain('"dpo.setUp": "Configurar pagos"');
    expect(es).toContain('"dpo.onceSetup": "{gets} cuando configure los pagos en Ajustes."');
    expect(readSource("src/lib/i18n/es.ts")).toContain("...esDeclPayout,");
    expect(readSource("src/lib/i18n/en.ts")).toContain("...enDeclPayout,");
  });
  it("6 (order card): the paid-order card's own words read the dictionary", () => {
    const views = readSource("src/components/declutter/DeclutterHandoverViews.tsx");
    expect(views).toContain('import "@/lib/i18n/enDeclSell";');
    expect(views.match(/\bt\("dho\./g)?.length ?? 0).toBeGreaterThan(30);
    expect(views.match(/^ {2}useLanguage\(\);/gm)?.length).toBe(4);
    expect(views).not.toMatch(/>(Paid: pickup and handover|Out all day|Finding a Helpr for this delivery\.|Your buyer is on the way\.)</);
    expect(views).not.toMatch(/"(Saving…|Take the porch photo|Retake the porch photo|Take your pickup photo|Saved\.|When will it be out\?)"/);
    expect(views).not.toMatch(/toast\((r\.noteProblem \? `|"[A-Z])/);
    expect(views).not.toMatch(/The handover is when|You said it|Photo of the|Out until/);
    expect(readSource("src/components/declutter/DeclutterPorchHandover.tsx")).not.toContain("`on ${w}`");
    const es = readSource("src/lib/i18n/esDeclSell.ts");
    expect(es).toContain('"dho.takePorch": "Tomar la foto del porche"');
    expect(es).toContain('"dho.gotIt": "Lo recibí"');
  });
});
