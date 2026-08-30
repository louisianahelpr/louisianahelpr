// Tests for ShareJobButton — exercise each rung of the fallback ladder
// (native → web → clipboard) plus cancellation silence.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---- Hoisted mocks ----------------------------------------------------
// Vitest hoists vi.mock calls to the top of the file, so the mock
// implementations must be declared with vi.hoisted to avoid temporal
// dead-zone errors when the mocks reference them.
const { isNativePlatformMock, capacitorShareMock, toastSuccessMock, toastErrorMock, toastMessageMock } =
  vi.hoisted(() => ({
    isNativePlatformMock: vi.fn(),
    capacitorShareMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastMessageMock: vi.fn(),
  }));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
  },
}));

vi.mock("@capacitor/share", () => ({
  Share: {
    share: (...args: unknown[]) => capacitorShareMock(...args),
  },
}));

vi.mock("sonner", () => {
  // Real sonner's `toast` is callable directly (a default/info toast) AND
  // carries .success/.error/.message methods. A plain object mock without
  // the callable part throws when nativeShare's last-ditch tier calls
  // `toast("Copy this link", ...)` bare — that throw was silently caught by
  // shareNative's outer try/catch and misread as "clipboard also failed,"
  // which is why this file used to assert the hard-error toast for what's
  // actually the graceful fallback tier.
  const toastFn = (...args: unknown[]) => toastMessageMock(...args);
  toastFn.success = (...args: unknown[]) => toastSuccessMock(...args);
  toastFn.error = (...args: unknown[]) => toastErrorMock(...args);
  toastFn.message = (...args: unknown[]) => toastMessageMock(...args);
  return { toast: toastFn };
});

import { ShareJobButton } from "./ShareJobButton";

const job = { id: "abc-123", title: "Move couch upstairs", budget: 80, category: "moving" };

const originalLocation = window.location;
const originalNavigator = window.navigator;

beforeEach(() => {
  isNativePlatformMock.mockReset();
  capacitorShareMock.mockReset();
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
    isNativePlatformMock.mockReturnValue(false);
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
      title: "Move couch upstairs — Need help in Louisiana",
      text: "Move couch upstairs · $80 · Louisiana\n\nApply on Helpr:",
      url: "https://www.louisianahelpr.com/jobs/abc-123?ref=share",
      dialogTitle: "Share this job",
    });
    // Native handoff — neither clipboard toast nor error toast.
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("falls back to navigator.share when not native but Web Share API exists", async () => {
    isNativePlatformMock.mockReturnValue(false);
    const navigatorShare = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share: navigatorShare });

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(navigatorShare).toHaveBeenCalledTimes(1);
    });
    expect(navigatorShare).toHaveBeenCalledWith({
      title: "Move couch upstairs — Need help in Louisiana",
      text: "Move couch upstairs · $80 · Louisiana\n\nApply on Helpr:",
      url: "https://www.louisianahelpr.com/jobs/abc-123?ref=share",
    });
    expect(capacitorShareMock).not.toHaveBeenCalled();
  });

  it("copies to the clipboard and confirms ON THE BUTTON when there is no share API", async () => {
    isNativePlatformMock.mockReturnValue(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({
      // Force navigator.share to be undefined for this run.
      share: undefined as unknown as Navigator["share"],
      clipboard: { writeText } as unknown as Clipboard,
    });

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "Move couch upstairs · $80 · Louisiana\n\nApply on Helpr:\nhttps://www.louisianahelpr.com/jobs/abc-123?ref=share"
      );
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
      expect(writeText).toHaveBeenCalledWith(
        "Move couch upstairs · $80 · Louisiana\n\nApply on Helpr:\nhttps://www.louisianahelpr.com/jobs/abc-123?ref=share"
      );
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
  });

  it("surfaces the raw link when neither share nor clipboard are available", async () => {
    // No navigator.share, and copyToClipboard resolves false (clipboard
    // API rejects; jsdom doesn't implement execCommand so the legacy
    // fallback can't land it either) — this is step 4 in handleShare's
    // *try* block (not the catch/error-recovery block), which surfaces the
    // link directly instead of a generic "try again" with nothing to act on.
    isNativePlatformMock.mockReturnValue(false);
    setNavigator({
      share: undefined as unknown as Navigator["share"],
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("clipboard blocked")),
      } as unknown as Clipboard,
    });

    render(<ShareJobButton job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Couldn't copy automatically — the link is https://www.louisianahelpr.com/jobs/abc-123?ref=share",
        expect.objectContaining({ duration: 10_000 })
      );
    });
  });

  it("toasts a hard error only when the share call itself throws AND clipboard is unavailable", async () => {
    // Route through the catch block by making navigator.share exist but
    // reject with a non-cancel error, so the recovery clipboard attempt
    // runs and, when that also comes up empty, the hard-error toast fires.
    isNativePlatformMock.mockReturnValue(false);
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
  });
});
