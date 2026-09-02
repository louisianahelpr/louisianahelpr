/**
 * The `onPhotoRejected` contract.
 *
 * `UserAvatar` decides, internally and asynchronously, whether a real
 * photograph is on screen. Before this callback existed that verdict was
 * unreachable from outside, and two surfaces shipped the same defect as a
 * result: `ProfileHeaderCard` painted an "ID verified" shield over a monogram,
 * and `PhotoNameSection` told a member to "tap the photo to change it" while
 * they stared at a blank block. Both are only correct if the callback is
 * TOTAL — it has to fire on the way back to "a photo is showing" as well as on
 * rejection, or a stale verdict survives a re-upload and a list-row recycle.
 *
 * The other half of what is pinned here is the CORS retry, which is the one
 * path where this component can do more harm than the bug it fixes: a host
 * that sends no `access-control-allow-origin` fails a `crossOrigin` load
 * outright, so a first error must NOT be a verdict.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

/** Flipped per-test to stand in for the decoded-bitmap verdict, which cannot
 *  run for real in jsdom (no canvas implementation). */
let blankVerdict = false;

vi.mock("@/lib/avatarImage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/avatarImage")>("@/lib/avatarImage");
  return { ...actual, isBlankAvatarBitmap: () => blankVerdict };
});

const { UserAvatar } = await import("./UserAvatar");
type Rejection = import("@/lib/avatarImage").AvatarPhotoRejection | null;

const PHOTO = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/avatars/u/a.jpg";
const GENERATOR = "https://api.dicebear.com/7.x/initials/svg?seed=AH";

beforeEach(() => {
  blankVerdict = false;
});
afterEach(() => {
  vi.restoreAllMocks();
});

function setup(src: string | null) {
  const seen: Rejection[] = [];
  const view = render(
    <UserAvatar userId="u-1" src={src} name="Lexi Lombas" onPhotoRejected={(r) => seen.push(r)} />,
  );
  const img = () => view.container.querySelector("img");
  return { ...view, seen, img };
}

describe("UserAvatar — onPhotoRejected", () => {
  it("reports 'no-photo' and renders the monogram when there is no src", () => {
    const { seen, img, getByText } = setup(null);
    expect(seen).toEqual(["no-photo"]);
    expect(img()).toBeNull();
    expect(getByText("LL")).toBeInTheDocument();
  });

  it("reports 'placeholder-url' for a monogram generator, without a network request", () => {
    const { seen, img } = setup(GENERATOR);
    expect(seen).toEqual(["placeholder-url"]);
    // The whole point of the free synchronous check: no <img> is ever created.
    expect(img()).toBeNull();
  });

  it("reports nothing while a real photo is in flight, and shows it", () => {
    const { seen, img } = setup(PHOTO);
    // `null` is the initial verdict, so callers default to "assume a photo"
    // rather than flashing "no photo" on every load.
    expect(seen).toEqual([null]);
    expect(img()).toBeTruthy();
    expect(img()).toHaveAttribute("src", PHOTO);
  });

  it("reports 'blank-bitmap' for a 200 that decodes to nothing", () => {
    blankVerdict = true;
    const { seen, img } = setup(PHOTO);
    expect(seen[seen.length - 1]).toBe("blank-bitmap");
    // The photo is pulled and the always-mounted monogram is what remains.
    expect(img()).toBeNull();
  });

  it("keeps a photo it could not judge — 'cannot judge → show it'", () => {
    // A tainted canvas makes the real detector return false; the mock stands
    // in for that same false. The assertion is that a non-verdict is not
    // treated as a rejection.
    blankVerdict = false;
    const { seen, img } = setup(PHOTO);
    act(() => {
      fireEvent.load(img()!);
    });
    expect(seen.every((r) => r === null)).toBe(true);
    expect(img()).toBeTruthy();
  });
});

describe("UserAvatar — the CORS retry is not a verdict", () => {
  it("retries once WITHOUT crossOrigin before calling a load failure real", () => {
    const { seen, img } = setup(PHOTO);
    expect(img()).toHaveAttribute("crossorigin", "anonymous");

    act(() => {
      fireEvent.error(img()!);
    });

    // First failure: no rejection reported, and the same URL is re-requested
    // as an ordinary image. A real photograph on a non-CORS host lives here.
    expect(seen.every((r) => r === null)).toBe(true);
    expect(img()).toBeTruthy();
    expect(img()).not.toHaveAttribute("crossorigin");
    expect(img()).toHaveAttribute("src", PHOTO);
  });

  it("reports 'load-error' only on the SECOND failure", () => {
    const { seen, img } = setup(PHOTO);
    act(() => {
      fireEvent.error(img()!);
    });
    act(() => {
      fireEvent.error(img()!);
    });
    expect(seen[seen.length - 1]).toBe("load-error");
    expect(img()).toBeNull();
  });
});

describe("UserAvatar — the verdict never goes stale", () => {
  it("returns to null when the src changes to a good photo (re-upload)", () => {
    const seen: Rejection[] = [];
    const { container, rerender } = render(
      <UserAvatar userId="u-1" src={null} name="Lexi Lombas" onPhotoRejected={(r) => seen.push(r)} />,
    );
    expect(seen[seen.length - 1]).toBe("no-photo");

    // The cache-busted `?t=` src that lands after every upload.
    rerender(
      <UserAvatar
        userId="u-1"
        src={`${PHOTO}?t=2`}
        name="Lexi Lombas"
        onPhotoRejected={(r) => seen.push(r)}
      />,
    );
    expect(seen[seen.length - 1]).toBeNull();
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("resets a rejection when a list row is recycled onto a different person", () => {
    const seen: Rejection[] = [];
    const props = (src: string) => ({
      userId: "u-1",
      src,
      name: "Lexi Lombas",
      onPhotoRejected: (r: Rejection) => seen.push(r),
    });
    const { container, rerender } = render(<UserAvatar {...props(PHOTO)} />);

    act(() => {
      fireEvent.error(container.querySelector("img")!);
    });
    act(() => {
      fireEvent.error(container.querySelector("img")!);
    });
    expect(seen[seen.length - 1]).toBe("load-error");

    // Next occupant of the same slot. Without the src-change reset, this
    // person would inherit the previous row's failure and lose their photo.
    rerender(<UserAvatar {...props("https://example.com/other.jpg")} />);
    expect(seen[seen.length - 1]).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/other.jpg",
    );
  });

  it("does not re-fire when only the callback identity changes", () => {
    const seen: Rejection[] = [];
    const { rerender } = render(
      <UserAvatar userId="u-1" src={null} name="Lexi Lombas" onPhotoRejected={(r) => seen.push(r)} />,
    );
    const afterFirst = seen.length;
    // Every call site passes an inline arrow, so this happens on every parent
    // render. It must not produce a second report of the same verdict.
    rerender(
      <UserAvatar userId="u-1" src={null} name="Lexi Lombas" onPhotoRejected={(r) => seen.push(r)} />,
    );
    expect(seen.length).toBe(afterFirst);
  });
});
