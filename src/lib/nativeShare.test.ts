// nativeShare wraps the share-sheet flow with 3 fallback layers:
// (1) native OS sheet via @capacitor/share, (2) Web Share API, (3)
// copy-to-clipboard. Bugs here either skip the right layer (user
// gets clipboard instead of OS sheet) or fail to surface the toast
// when copy works.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const writeTextMock = vi.fn();

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  writeTextMock.mockReset();
  // Reset Capacitor presence (default: web)
  Reflect.deleteProperty(window, "Capacitor");
  // Web Share API not available by default
  Reflect.deleteProperty(navigator, "share");
  // Clipboard available
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText: writeTextMock },
  });
  vi.resetModules();
});

afterEach(() => {
  Reflect.deleteProperty(window, "Capacitor");
  Reflect.deleteProperty(navigator, "share");
});

async function load() {
  return await import("./nativeShare");
}

describe("nativeShare — web with Web Share API available", () => {
  it("uses navigator.share + returns true on success", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: shareMock,
    });

    const { nativeShare } = await load();
    const ok = await nativeShare({ title: "T", text: "X", url: "https://x.com" });

    expect(ok).toBe(true);
    expect(shareMock).toHaveBeenCalledWith({
      title: "T",
      text: "X",
      url: "https://x.com",
    });
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("falls through to clipboard when navigator.share rejects (user cancelled)", async () => {
    const shareMock = vi.fn().mockRejectedValue(new Error("AbortError"));
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: shareMock,
    });
    writeTextMock.mockResolvedValue(undefined);

    const { nativeShare } = await load();
    const ok = await nativeShare({ url: "https://x.com" });

    expect(shareMock).toHaveBeenCalled();
    expect(writeTextMock).toHaveBeenCalledWith("https://x.com");
    expect(ok).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith("Link copied!");
  });
});

describe("nativeShare — web without Web Share API (clipboard fallback)", () => {
  it("copies to clipboard, fires success toast, returns true", async () => {
    writeTextMock.mockResolvedValue(undefined);

    const { nativeShare } = await load();
    const ok = await nativeShare({ url: "https://x.com" });

    expect(writeTextMock).toHaveBeenCalledWith("https://x.com");
    expect(ok).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith("Link copied!");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("returns false + error toast when clipboard write fails", async () => {
    writeTextMock.mockRejectedValue(new Error("clipboard denied"));

    const { nativeShare } = await load();
    const ok = await nativeShare({ url: "https://x.com" });

    expect(ok).toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't share"),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("nativeShare — argument forwarding", () => {
  it("forwards title, text, url to navigator.share", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: shareMock,
    });

    const { nativeShare } = await load();
    await nativeShare({
      title: "Helpr",
      text: "Check this out",
      url: "https://www.louisianahelpr.com",
    });

    expect(shareMock).toHaveBeenCalledWith({
      title: "Helpr",
      text: "Check this out",
      url: "https://www.louisianahelpr.com",
    });
  });

  it("works with only url provided (other fields optional)", async () => {
    writeTextMock.mockResolvedValue(undefined);
    const { nativeShare } = await load();
    const ok = await nativeShare({ url: "https://x.com" });
    expect(ok).toBe(true);
  });
});
