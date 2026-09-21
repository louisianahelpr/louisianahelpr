/**
 * The Privacy Policy's "Download your data" link (`#download-your-data`) must
 * always have a target. The card it points at used to sit in <HideOnSearch>
 * while the row carrying the link stays visible for any search that matches
 * its title — so during a search like "portability" the link went nowhere.
 *
 * Exhaustive over the queries that matter: every prefix and suffix of the
 * row's title (the only strings that keep that row on screen), plus the empty
 * query and unrelated ones.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PolicySearchContext } from "@/components/policy/CollapsedPolicy";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
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
  it.each(["", "portability", "PORTABILITY", "deletion", ...rowQueries, "download", "cookies", "stripe", "zzzz"])(
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

  it("an unrelated search still leaves the export card out of the results", () => {
    const { container } = renderWithQuery("cookies");
    expect(container.querySelector(`#${DATA_EXPORT_ANCHOR}`)).toBeNull();
  });
});

// Put the export card back under HideOnSearch semantics: the "Deletion &
// portability" row survives the search, its #download-your-data link does not.
// @mutate src/pages/legal/PrivacySection.tsx | policySearchMatches(query, EXPORT_CARD_SEARCH_TEXT) ? <>{children}</> : null | !query ? <>{children}</> : null
