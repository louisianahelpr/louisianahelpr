/**
 * Saved Helprs' header keeps its right-hand 44px slot in every state (prod-audit run 43691657529, 2026-11-15,
 * page-settle at 375: 0.032 at ~471 ms, "div.flex.flex-col.leading-none 17→10 h34→65 ↑div.shrink-0 h44" and the list
 * "div.space-y-3 57→86"). While the list loaded (and when it was empty) the header had no right slot, so the title had
 * the row to itself; when the saved Helprs arrived the magnifier took 44px, the title wrapped to a second line and the
 * list moved down 29px. The slot is now held open (SearchTriggerSlot) whenever the magnifier is not drawn.
 *
 * @mutate src/components/profile/SavedHelpersTab.tsx |           ) : (\n            <SearchTriggerSlot />\n          )\n        } |           ) : undefined\n        }
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: null, gatedProps: () => ({}) }) }));
vi.mock("@/components/profile/savedHelpersTab/SavedHelperCard", () => ({ SavedHelperCard: () => <div>helper card</div> }));

let hook: Record<string, unknown>;
vi.mock("@/components/profile/savedHelpersTab/useSavedHelpers", () => ({ useSavedHelpers: () => hook }));

import { SavedHelpersTab } from "./SavedHelpersTab";

const HELPER = { helper_id: "h1", saved_at: "2026-11-01T00:00:00Z", note: null, profiles: { full_name: "Hallie H." } };
const base = {
  helpers: [], loading: true, loadError: null, retrying: false, wasOffline: false, search: "", setSearch: () => {},
  sortBy: "recent", setSortBy: () => {}, categoryFilter: null, setCategoryFilter: () => {}, editingNoteFor: null,
  noteDraft: "", setNoteDraft: () => {}, savingNote: false, loadSavedHelpers: () => {}, openNoteEditor: () => {},
  cancelNoteEditor: () => {}, saveNote: () => {}, handleRemove: () => {}, filtered: [], activeSortLabel: "Recent activity", metaText: () => "",
};
const mount = () => render(<MemoryRouter><SavedHelpersTab onBack={() => {}} /></MemoryRouter>);
const slot = () => document.querySelector("[data-search-trigger-slot]");
const magnifier = () => document.querySelector("[data-search-trigger]");

beforeEach(() => { hook = { ...base }; });

describe("Saved Helprs: the header's right slot is there in every state (Q1816)", () => {
  it("while the list loads, the slot is held open", () => {
    mount();
    expect(slot()).not.toBeNull();
    expect(magnifier()).toBeNull();
  });

  it("with an empty list, the slot stays held open", () => {
    hook = { ...base, loading: false };
    mount();
    expect(slot()).not.toBeNull();
  });

  it("with saved Helprs, the magnifier takes the slot (one or the other, never neither)", () => {
    hook = { ...base, loading: false, helpers: [HELPER], filtered: [HELPER] };
    mount();
    expect(magnifier()).not.toBeNull();
    expect(slot()).toBeNull();
  });
});
