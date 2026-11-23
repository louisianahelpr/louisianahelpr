/**
 * The Privacy Policy's "Download your data" link (`#download-your-data`) must
 * always have a target. The card it points at used to sit in <HideOnSearch>
 * while the row carrying the link stays visible for any search that matches
 * its title — so during a search like "portability" the link went nowhere.
 *
 * Exhaustive over the queries that matter: every prefix and suffix of the
 * row's title, words only in the row's body (app audit 11-23 LT-3: search reads
 * row bodies too, so they keep the row on screen), plus the empty query and
 * unrelated ones.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PolicySearchContext } from "@/components/policy/CollapsedPolicy";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
// A guest's ID wording reads the switches open to everyone (L003); none here.
vi.mock("@/components/landing/useSectionsOpen", () => ({ useSectionsOpen: () => ({ open: new Set<string>(), settled: true, failed: false }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { PrivacyContent } from "./PrivacySection";
import { DATA_EXPORT_ANCHOR } from "./dataExportAnchor";

const renderWithQuery = (query: string) =>
  render(
    <MemoryRouter>
      <PolicySearchContext.Provider value={query}>
        <PrivacyContent />
      </PolicySearchContext.Provider>
    </MemoryRouter>,
  );

const ROW_TITLE = "Deletion & portability";
const rowQueries = new Set<string>();
for (let i = 1; i <= ROW_TITLE.length; i++) {
  rowQueries.add(ROW_TITLE.slice(0, i));
  rowQueries.add(ROW_TITLE.slice(-i));
}

describe("Privacy Policy: the in-policy export link always has a target", () => {
  it.each(["", "portability", "PORTABILITY", "deletion", ...rowQueries, "download", "cookies", "stripe", "zzzz", "machine-readable", "California", "strikes", "Cal. Code Regs"])(
    "query %j",
    (query) => {
      const { container, unmount } = renderWithQuery(query);
      const links = container.querySelectorAll(`a[href="#${DATA_EXPORT_ANCHOR}"]`);
      if (links.length > 0) {
        expect(container.querySelector(`#${DATA_EXPORT_ANCHOR}`)).not.toBeNull();
      }
      unmount();
    },
  );

  it("the link is actually reachable during a search (the check above is not vacuous)", () => {
    const { container } = renderWithQuery("portability");
    expect(container.querySelector(`a[href="#${DATA_EXPORT_ANCHOR}"]`)).not.toBeNull();
  });

  it("LT-3: a word only in the row's body keeps the row AND its link target", () => {
    const { container } = renderWithQuery("machine-readable");
    expect(container.querySelector(`a[href="#${DATA_EXPORT_ANCHOR}"]`)).not.toBeNull();
    expect(container.querySelector(`#${DATA_EXPORT_ANCHOR}`)).not.toBeNull();
  });

  it("an unrelated search still leaves the export card out of the results", () => {
    const { container } = renderWithQuery("cookies");
    expect(container.querySelector(`#${DATA_EXPORT_ANCHOR}`)).toBeNull();
  });
});

// Put the export card back under HideOnSearch semantics: the "Deletion &
// portability" row survives the search, its #download-your-data link does not.
// @mutate src/pages/info/legal/PrivacySection.tsx | policySearchMatches(query, EXPORT_CARD_SEARCH_TEXT) ? <>{children}</> : null | !query ? <>{children}</> : null
// LT-3: the card's search text drops the row body, so a body-only word shows the link with no target.
// @mutate src/pages/info/legal/PrivacySection.tsx | const EXPORT_CARD_SEARCH_TEXT = `${PORTABILITY_ROW_TITLE} ${policyNodeText(PORTABILITY_ROW_BODY)} | const EXPORT_CARD_SEARCH_TEXT = `${PORTABILITY_ROW_TITLE}
