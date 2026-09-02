/**
 * The profile-edit photo row: the caption that tells a member what happened to
 * their upload, and the public-visibility notice beside the camera control.
 *
 * The notice is the guard added on 2026-08-31 after a member uploaded a
 * photograph of their driver's licence as their avatar and it sat anonymously
 * fetchable in the public `avatars` bucket — no login, no token, no Helpr
 * account. It is asserted here rather than left to review because it is a
 * single line of copy that is trivially "tidied away" by anyone shortening
 * this block, and its absence is invisible: nothing breaks, nothing warns, and
 * the next member to publish their ID finds out the same way the first one
 * did.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhotoNameSection, avatarCaption } from "./PhotoNameSection";
import type { Profile } from "./types";

const profile = {
  user_id: "u-1",
  avatar_url: null,
} as unknown as Profile;

function renderRow() {
  return render(
    <PhotoNameSection
      profile={profile}
      firstName="Lexi"
      lastName="Lombas"
      initials="LL"
      avatarBroken={false}
      setAvatarBroken={vi.fn()}
      avatarUploading={false}
      onAvatarUpload={vi.fn()}
    />,
  );
}

describe("avatarCaption", () => {
  it("prompts for a first upload when there is no photo", () => {
    expect(avatarCaption("no-photo")).toBe("Add a photo so people know who they're hiring.");
  });

  it.each(["blank-bitmap", "placeholder-url"] as const)(
    "tells the member their upload came through blank (%s)",
    (reason) => {
      // The distinction this whole callback exists for: a member looking at a
      // coloured square must be told the upload did not take, not invited to
      // "change" a photo they believe is fine.
      expect(avatarCaption(reason)).toBe("That photo came through blank — tap to pick another.");
    },
  );

  it("does not blame the member for a load failure they cannot fix", () => {
    const copy = avatarCaption("load-error");
    expect(copy).toBe("We couldn't load your photo — tap to try another.");
    expect(copy).not.toMatch(/blank/i);
  });

  it("falls back to the neutral caption when a photo is showing", () => {
    expect(avatarCaption(null)).toBe("Tap the photo to change it.");
  });
});

describe("PhotoNameSection", () => {
  it("always warns that the photo is public and must not be an ID", () => {
    renderRow();
    const notice = screen.getByText(/Anyone can see this photo/i);
    expect(notice).toBeInTheDocument();
    // Both halves matter: that it is public, AND what specifically not to
    // upload. "Your photo is public" alone did not stop this happening.
    expect(notice.textContent).toMatch(/never use a photo of an ID, licence or document/i);
  });

  it("shows the notice before any photo exists — that is when it is read", () => {
    // Rendered with `avatar_url: null`, i.e. a member who has not uploaded
    // yet. A notice that only appears once a photo is present is useless.
    renderRow();
    expect(screen.getByText(/Anyone can see this photo/i)).toBeInTheDocument();
  });

  it("announces the caption politely — the verdict arrives after decode", () => {
    const { container } = renderRow();
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    // With no avatar_url, `<UserAvatar>` reports "no-photo" synchronously.
    expect(live).toHaveTextContent("Add a photo so people know who they're hiring.");
  });

  it("keeps the file input reachable and named", () => {
    const { container } = renderRow();
    expect(screen.getByText("Change profile photo")).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toHaveAttribute("accept", "image/*");
  });
});
