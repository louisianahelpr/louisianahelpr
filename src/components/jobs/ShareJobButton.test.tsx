// Tests for ShareJobButton — exercise each rung of the fallback ladder
// (native → web → clipboard → surfaced) plus cancellation silence.
//
// WHAT CHANGED, AND WHY THESE ASSERTIONS MOVED
// --------------------------------------------
// The button no longer carries its own copy of the share ladder. It used to
// call `Capacitor.isNativePlatform()` and `Share.share` directly — a second
// implementation of `src/lib/nativeShare.ts` that never received that module's
// fixes. It now goes through `shareNative` and acts on the `ShareOutcome` it
// returns.
//
// These tests deliberately DO NOT mock `@/lib/nativeShare`. Mocking it would
// only prove the button calls a function, and the three share bugs found on
// 2026-08-30 were all in the payload that reached the OS, not in whether a
// call happened. So the real ladder runs and the assertions are made at the
// actual boundary: the object handed to `@capacitor/share` / `navigator.share`.
//
// WHAT THE PREVIOUS VERSION OF THIS FILE COULD NOT CATCH: it located the
// button by its aria-label ("Share this job") and never asserted the VISIBLE
// label. The visible label is computed from `canNativeShare`, which tested
// only `typeof navigator.share === "function"` — undefined in the iOS
// WKWebView — so inside the shipped app the button read "Copy link" and then
// opened the real OS share sheet. Every assertion here passed the whole time.
// `renders "Share" (not "Copy link") on native` below is the guard for that.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---- Hoisted mocks ----------------------------------------------------
// Vitest hoists vi.mock calls to the top of the file, so the mock
// implementations must be declared with vi.hoisted to avoid temporal
// dead-zone errors when the mocks reference them.
const {
  isNativePlatformMock,
  capacitorShareMock,
  toastFnMock,
  toastSuccessMock,
  toastErrorMock,
  toastMessageMock,
} = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => false),
  capacitorShareMock: vi.fn(),
  toastFnMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastMessageMock: vi.fn(),
}));

// `isNativePlatform` is a synchronous CONST, read at module scope in
// nativeInit. A getter is what lets each test flip it. Note that stubbing
// `window.Capacitor` would NOT work — @capacitor/core overwrites that global
// at import — which is exactly why nativeInit exposes the const in the first
// place.
vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return isNativePlatformMock();
  },
  initNativeShell: vi.fn(),
}));

vi.mock("@capacitor/share", () => ({
  Share: {
    share: (...args: unknown[]) => capacitorShareMock(...args),
  },
}));

vi.mock("sonner", () => {
  // Real sonner's `toast` is callable directly AND carries
  // .success/.error/.message. The distinction is load-bearing here rather
  // than cosmetic: `src/lib/toastPolicy.ts` replaces `.success`/`.info`/
  // `.message` with no-ops app-wide at boot, so a confirmation written to
  // those channels renders NOTHING in production. `nativeShare` therefore
  // confirms through the bare callable, and these mocks keep them separate so
  // a regression back to `toast.success` shows up as a failing assertion
  // instead of a passing one.
  const toastFn = (...args: unknown[]) => toastFnMock(...args);
  toastFn.success = (...args: unknown[]) => toastSuccessMock(...args);
  toastFn.error = (...args: unknown[]) => toastErrorMock(...args);
  toastFn.message = (...args: unknown[]) => toastMessageMock(...args);
  return { toast: toastFn };
});

import { ShareJobButton } from "./ShareJobButton";

const job = { id: "abc-123", title: "Move couch upstairs", budget: 80, category: "moving" };

/** The one payload every rung is expected to carry. */
const EXPECTED_URL = "https://www.louisianahelpr.com/jobs/abc-123?ref=share";
const EXPECTED_TITLE = "Move couch upstairs — Need help in Louisiana";
const EXPECTED_TEXT = "Move couch upstairs · $80 · Louisiana\n\nApply on Helpr:";
const EXPECTED_CLIP = `${EXPECTED_TEXT}\n${EXPECTED_URL}`;

const originalLocation = window.location;
const originalNavigator = window.navigator;

beforeEach(() => {
  isNativePlatformMock.mockReset();
  isNativePlatformMock.mockReturnValue(false);
  capacitorShareMock.mockReset();
  toastFnMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  toastMessageMock.mockReset();

  // Stable origin so the URL assertion isn't flaky.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, origin: "https://example.test" },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  Object.defineProperty(window, "navigator", { configurable: true, value: originalNavigator });
});

function setNavigator(overrides: Partial<Navigator>) {
  Object.defineProperty(window, "navigator", {
    configurable: true,
    value: { ...originalNavigator, ...overrides },
  });
}

describe("ShareJobButton", () => {
  it("renders a Share button labelled for accessibility", () => {
    render(<ShareJobButton job={job} />);
    expect(screen.getByRole("button", { name: "Share this job" })).toBeInTheDocument();
  });

  it("uses the Capacitor Share plugin on native platforms", async () => {
    isNativePlatformMock.mockReturnValue(true);
    capacitorShareMock.mockResolvedValue({ activityType: "com.apple.UIKit.activity.Mail" });

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(capacitorShareMock).toHaveBeenCalledTimes(1);
    });
    expect(capacitorShareMock).toHaveBeenCalledWith({
      title: EXPECTED_TITLE,
      text: EXPECTED_TEXT,
      url: EXPECTED_URL,
      dialogTitle: "Share this job",
    });
    // Native handoff — the sheet is its own confirmation, so no toast of any
    // kind and no inline "Copied" (which would claim the wrong thing happened).
    expect(toastFnMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it('renders "Share" (not "Copy link") on native even though WKWebView has no navigator.share', () => {
    // REGRESSION GUARD. `canNativeShare` used to consult only
    // `navigator.share`, which the iOS WKWebView does not expose — so the
    // shipped app drew "Copy link" on a button that opens the real OS share
    // sheet. The label must follow what actually runs, and on native that is
    // always the Capacitor bridge.
    isNativePlatformMock.mockReturnValue(true);
    setNavigator({ share: undefined as unknown as Navigator["share"] });

    render(<ShareJobButton job={job} />);
    expect(screen.getByText("Share")).toBeTruthy();
    expect(screen.queryByText("Copy link")).toBeNull();
  });

  it('renders "Copy link" on a desktop browser with no share sheet', () => {
    isNativePlatformMock.mockReturnValue(false);
    setNavigator({ share: undefined as unknown as Navigator["share"] });

    render(<ShareJobButton job={job} />);
    expect(screen.getByText("Copy link")).toBeTruthy();
  });

  it("falls back to navigator.share when not native but Web Share API exists", async () => {
    const navigatorShare = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share: navigatorShare });

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(navigatorShare).toHaveBeenCalledTimes(1);
    });
    // No dialogTitle on the web payload — that key is Android-chooser only.
    expect(navigatorShare).toHaveBeenCalledWith({
      title: EXPECTED_TITLE,
      text: EXPECTED_TEXT,
      url: EXPECTED_URL,
    });
    expect(capacitorShareMock).not.toHaveBeenCalled();
  });

  it("copies to the clipboard and confirms ON THE BUTTON when there is no share API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({
      // Force navigator.share to be undefined for this run.
      share: undefined as unknown as Navigator["share"],
      clipboard: { writeText } as unknown as Clipboard,
    });

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(EXPECTED_CLIP);
    });
    // The confirmation MUST be visible in the DOM, not a toast.
    // `toast.success` is neutered app-wide at boot by src/lib/toastPolicy.ts,
    // so the old assertion (`toastSuccessMock` called with "Link copied…")
    // passed here while the user saw absolutely nothing — which is the whole
    // "share button does nothing" report. Assert what a user can perceive.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Link copied to clipboard" })).toBeTruthy();
    });
    expect(screen.getByText("Copied")).toBeTruthy();
    // Exactly ONE confirmation. The button owns it, so shareNative's own
    // "Link copied" toast must be suppressed via `suppressCopyConfirmation` —
    // without that flag the same copy is announced twice.
    expect(toastFnMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(capacitorShareMock).not.toHaveBeenCalled();
  });

  it("still copies a link when the share sheet itself fails, rather than dead-ending", async () => {
    // A non-cancellation share failure (OS bridge down, permission refused)
    // used to end at an error toast with nothing on the clipboard. The user
    // asked for a link; the clipboard rung can still deliver one.
    isNativePlatformMock.mockReturnValue(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    capacitorShareMock.mockRejectedValue(new Error("Share plugin unavailable"));
    setNavigator({
      share: undefined as unknown as Navigator["share"],
      clipboard: { writeText } as unknown as Clipboard,
    });

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(EXPECTED_CLIP);
    });
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeTruthy();
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("silently swallows user cancellation (AbortError) without toasting an error", async () => {
    isNativePlatformMock.mockReturnValue(true);
    const abort = new Error("share canceled");
    abort.name = "AbortError";
    capacitorShareMock.mockRejectedValue(abort);

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(capacitorShareMock).toHaveBeenCalled();
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
    // A dismissed sheet must NOT flip the label — nothing was copied.
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("surfaces the raw link when neither share nor clipboard are available", async () => {
    // No navigator.share, and copyToClipboard resolves false (clipboard
    // API rejects; jsdom doesn't implement execCommand so the legacy
    // fallback can't land it either). This is shareNative's "surfaced" tier:
    // it shows the link itself so the tap is never a no-op. It goes through
    // the bare `toast(...)` callable, which toastPolicy does NOT suppress.
    setNavigator({
      share: undefined as unknown as Navigator["share"],
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("clipboard blocked")),
      } as unknown as Clipboard,
    });

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(toastFnMock).toHaveBeenCalledWith(
        "Copy this link",
        expect.objectContaining({ description: EXPECTED_CLIP }),
      );
    });
    // "surfaced" is not "copied" — nothing reached the clipboard, so claiming
    // a copy on the button would be a lie about where the link ended up.
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("toasts a hard error only when the share call itself throws AND clipboard is unavailable", async () => {
    // Route through the catch block by making navigator.share exist but
    // reject with a non-cancel error, so the recovery clipboard attempt
    // runs and, when that also comes up empty, the hard-error toast fires.
    setNavigator({
      share: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("clipboard blocked")),
      } as unknown as Clipboard,
    });

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Couldn't share — try again.");
    });
    // `suppressCopyConfirmation` must not silence FAILURE — only the
    // success confirmation the button renders itself.
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("never hands the OS a bare url with no text (the Work Record failure mode)", async () => {
    // iOS prefers a URL over text and renders its link preview. A payload
    // that is url-only gives the recipient a naked link with no context —
    // which is what PaymentSuccess used to send. Every rung here must carry
    // both, and the url must be the PUBLIC /jobs/:id preview route (guest
    // readable), never a /dashboard or other ProtectedRoute path.
    isNativePlatformMock.mockReturnValue(true);
    capacitorShareMock.mockResolvedValue({});

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => expect(capacitorShareMock).toHaveBeenCalled());
    const payload = capacitorShareMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.text).toBeTruthy();
    expect(payload.url).toBe(EXPECTED_URL);
    expect(String(payload.url)).toContain("/jobs/");
    expect(String(payload.url)).not.toContain("/dashboard");
    // `files` must never be a sibling of text/url — a mixed activity makes
    // iOS suppress the document handlers outright.
    expect(payload.files).toBeUndefined();
  });
});
