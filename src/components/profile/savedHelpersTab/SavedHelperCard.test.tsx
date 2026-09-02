/**
 * The saved-helpr card's affordances.
 *
 * This card used to be a `div[role="button"]` wrapping a note textarea and
 * three `<Button>`s — axe `nested-interactive`, SERIOUS, one node per card
 * (measured on /profile?tab=saved_helpers at 320/375/768/1440, senior mode on
 * and off). It is worth a test rather than a review note because the failure
 * is completely invisible from the outside: every click still worked, because
 * each child called `stopPropagation`. What did NOT work was assistive tech —
 * a `button` role flattens its subtree into its own accessible name, so
 * "Offer a Job", the note control and "Remove from saved" were swallowed into
 * the card's label and could not be reached or operated by name.
 *
 * So the assertions below are about SHAPE, not behaviour: exactly one link,
 * no interactive ancestor around the controls, and the controls still wired to
 * their own callbacks. Anyone re-introducing a card-level `onClick` will trip
 * the first two.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SavedHelperCard } from "./SavedHelperCard";
import type { SavedHelper } from "./types";

const HELPER_ID = "00000000-0000-4000-8000-0000000000a1";

const helper: SavedHelper = {
  helper_id: HELPER_ID,
  full_name: "Marie Boudreaux",
  avatar_url: null,
  bio: "Painter.",
  parish: "Orleans",
  skills: "Painting, Yard Work",
  saved_at: "2026-08-01T12:00:00Z",
  completed_jobs_together: 3,
  last_job_at: "2026-08-20T12:00:00Z",
  avg_rating: 4.8,
  private_note: "Great with painting, prefers Tuesdays",
};

function renderCard(overrides: Partial<Parameters<typeof SavedHelperCard>[0]> = {}) {
  const props = {
    h: helper,
    editingNoteFor: null,
    noteDraft: "",
    setNoteDraft: vi.fn(),
    savingNote: false,
    openNoteEditor: vi.fn(),
    cancelNoteEditor: vi.fn(),
    saveNote: vi.fn(),
    handleRemove: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <SavedHelperCard {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe("SavedHelperCard", () => {
  it("opens the profile through a real link, not a role=button card", () => {
    renderCard();
    const link = screen.getByRole("link", { name: "View Marie B.'s profile" });
    expect(link).toHaveAttribute("href", `/user/${HELPER_ID}`);
    // The whole-card affordance must not be a button — that is the nesting.
    expect(screen.queryByRole("button", { name: /profile/i })).toBeNull();
  });

  it("nests no interactive element inside another", () => {
    renderCard();
    const interactive = document.querySelectorAll(
      'a[href], button, textarea, input, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
    );
    expect(interactive.length).toBeGreaterThan(1);
    interactive.forEach((el) => {
      const ancestor = el.parentElement?.closest(
        'a[href], button, textarea, [role="button"], [role="link"]',
      );
      expect(ancestor).toBeNull();
    });
  });

  it("keeps each control wired to its own callback", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit private note" }));
    expect(props.openNoteEditor).toHaveBeenCalledWith(HELPER_ID, helper.private_note);
    fireEvent.click(screen.getByRole("button", { name: "Remove from saved" }));
    expect(props.handleRemove).toHaveBeenCalledWith(HELPER_ID);
  });

  it("keeps the note editor out of the link too", () => {
    renderCard({ editingNoteFor: HELPER_ID, noteDraft: "a note" });
    const textarea = screen.getByLabelText("Private note about this Helpr");
    expect(textarea.closest('a[href], button, [role="button"]')).toBeNull();
  });
});
