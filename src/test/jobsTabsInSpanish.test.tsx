/**
 * Spanish language option (Builder 71, 2026-10-29): the Jobs browse header
 * (the section tabs Browse | Posted | Working, the "Soon" caption under a
 * closed section chip, the settings gear's name) shows the member's language.
 * Browse's Spanish must not be the dock's "Explorar" (two different places,
 * one word, B63's note).
 *
 * @mutate src/components/sections/SectionTabs.tsx |               {o.value === BROWSE ? tr("tabs.browse") : o.label}\n |               {o.label}\n
 * @mutate src/components/sections/SectionTabs.tsx | label: t.labelKey ? tr(t.labelKey) : t.label, | label: t.label,
 * @mutate src/components/sections/SoonPill.tsx |         {t("soon.short")}\n      </span>\n    );\n  }\n  if (variant === "rail") { |         Soon\n      </span>\n    );\n  }\n  if (variant === "rail") {
 * @mutate src/components/sections/AppTopBar.tsx |       aria-label={settings.labelKey ? tr(settings.labelKey) : settings.label}\n |       aria-label={settings.label}\n
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { en } from "@/lib/i18n/en";
import { SectionTabs } from "@/components/sections/SectionTabs";
import { SectionSettingsButton } from "@/components/sections/AppTopBar";
import { SoonPill } from "@/components/sections/SoonPill";
import { JOBS_TABS } from "@/pages/jobs/JobsSection";

describe("the Jobs browse header in Spanish", () => {
  beforeEach(async () => {
    __resetLangForTests();
    setLang("es");
    await ensureLangLoaded();
  });
  afterEach(() => __resetLangForTests());

  it("the tabs read Ver todo | Publicados | Trabajando", () => {
    render(
      <MemoryRouter>
        <SectionTabs label={es["jobs.tabsLabel"]} tabs={JOBS_TABS} value="browse" onChange={() => {}} />
      </MemoryRouter>,
    );
    const tabs = screen.getAllByRole("tab").map((b) => b.textContent?.trim());
    expect(tabs).toEqual([es["tabs.browse"], es["jobs.tabPosted"], es["jobs.tabWorking"]]);
    expect(tabs).not.toContain("Browse");
    expect(tabs).not.toContain("Posted");
  });

  it("the Soon caption and the settings gear's name are Spanish", () => {
    render(
      <MemoryRouter>
        <SoonPill variant="caption" data-testid="soon" />
        <SectionSettingsButton settings={{ label: "Jobs settings", labelKey: "jobs.settings", path: "/jobs/settings" }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("soon").textContent).toBe(es["soon.short"]);
    expect(screen.getByTestId("section-settings").getAttribute("aria-label")).toBe(es["jobs.settings"]);
  });

  it("Browse is not the dock's Explore word in Spanish", () => {
    expect(es["tabs.browse"]).not.toBe(es["nav.explore"]);
    expect(en["tabs.browse"]).toBe("Browse");
  });
});
