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
/** Every element the component handed to the detector. Asserted on, so that a
 *  refactor which sampled a DETACHED clone — always tainted, or `complete`
 *  false, so the detector could only ever answer "cannot judge" — would fail
 *  here instead of silently disabling the guard in production. */
let sampled: (HTMLImageElement | null)[] = [];

vi.mock("@/lib/avatarImage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/avatarImage")>("@/lib/avatarImage");
  return {
    ...actual,
    isBlankAvatarBitmap: (img: HTMLImageElement) => {
      sampled.push(img);
      return blankVerdict;
    },
  };
});

const { UserAvatar } = await import("./UserAvatar");
type Rejection = import("@/lib/avatarImage").AvatarPhotoRejection | null;

const PHOTO = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/avatars/u/a.jpg";
const GENERATOR = "https://api.dicebear.com/7.x/initials/svg?seed=AH";

beforeEach(() => {
  blankVerdict = false;
  sampled = [];
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
    // FULL SEQUENCE, not just the last emission. Asserting only the tail hid a
    // real defect: the mount run of the reset effect clobbered the verdict the
    // ref callback had already reached, so this emitted
    // [null, "blank-bitmap", null, "blank-bitmap"] — a `null` AFTER a
    // confirmed rejection, which un-hides a caller's badge for a frame and
    // makes the aria-live caption announce the wrong verdict.
    expect(seen).toEqual([null, "blank-bitmap"]);
    // The photo is pulled and the always-mounted monogram is what remains.
    expect(img()).toBeNull();
  });

  it("samples the LIVE <img> element, not a detached copy", () => {
    // The detector's four "cannot judge" paths all key off the element it is
    // given (`complete`, `naturalWidth`, canvas taint). Hand it a detached
    // clone and it can only ever answer "cannot judge", which silently
    // disables the guard while every other assertion here still passes.
    const { img } = setup(PHOTO);
    expect(sampled.length).toBeGreaterThan(0);
    expect(sampled[0]).toBe(img());
  });

  it("keeps a photo it could not judge — 'cannot judge → show it'", async () => {
    // Drives the REAL `isBlankAvatarBitmap` against a TAINTED canvas, which is
    // what a host sending no `access-control-allow-origin` produces. The
    // mocked version cannot test this: it ignores its argument, so asserting
    // on it only restates the mock. This is the single most damaging possible
    // regression — a real photograph replaced by a monogram because the check
    // could not run — so it is driven end-to-end through the component.
    const real = await vi.importActual<typeof import("@/lib/avatarImage")>("@/lib/avatarImage");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => {
        throw new DOMException("Tainted canvases may not be read", "SecurityError");
      },
    } as unknown as CanvasRenderingContext2D);

    const { seen, img } = setup(PHOTO);
    const el = img()!;
    Object.defineProperty(el, "complete", { value: true, configurable: true });
    Object.defineProperty(el, "naturalWidth", { value: 240, configurable: true });
    // The real detector, on the real element, through the real canvas path.
    expect(real.isBlankAvatarBitmap(el)).toBe(false);

    act(() => {
      fireEvent.load(el);
    });
    expect(seen).toEqual([null]);
    expect(img()).toBeTruthy();
  });
});

describe("UserAvatar — the CORS retry is not a verdict", () => {
  it("retries once WITHOUT crossOrigin before calling a load failure real", () => {
    const { seen, img } = setup(PHOTO);
    const first = img();
    expect(first).toHaveAttribute("crossorigin", "anonymous");

    act(() => {
      fireEvent.error(first!);
    });

    // First failure: no rejection reported, and the same URL is re-requested
    // as an ordinary image. A real photograph on a non-CORS host lives here.
    expect(seen).toEqual([null]);
    expect(img()).toBeTruthy();
    expect(img()).not.toHaveAttribute("crossorigin");
    expect(img()).toHaveAttribute("src", PHOTO);
    // A NEW element — this is what `key={corsMode}` buys, and the whole point
    // of the retry. Without the key React patches `crossOrigin` off the
    // element that is ALREADY in its error state and nothing re-requests, so
    // the photo is silently lost. Every other assertion above still passes in
    // that broken state; only element identity detects it.
    expect(img()).not.toBe(first);
  });

  it("reports 'load-error' only on the SECOND failure", () => {
    const { seen, img } = setup(PHOTO);
    act(() => {
      fireEvent.error(img()!);
    });
    act(() => {
      fireEvent.error(img()!);
    });
    expect(seen).toEqual([null, "load-error"]);
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
