/**
 * Platform-branch tests for `exportJobToCalendar`.
 *
 * These exist because of a defect that was invisible on the web: the native
 * branch handed iOS a `data:text/calendar` URL, which `UIActivityViewController`
 * treats as an untyped URL rather than a calendar document, so the share sheet
 * never offered "Add to Calendar" and the button silently did nothing. The
 * regression guard is therefore not "share was called" — it is *what* was
 * shared: a `file://` URI, staged on disk, with no sibling text/url item.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  nativeFlagRef,
  writeFileMock,
  shareMock,
  toastFnMock,
  toastErrorMock,
  toastSuccessMock,
  reportMock,
} = vi.hoisted(() => ({
  nativeFlagRef: { value: false },
  writeFileMock: vi.fn(),
  shareMock: vi.fn(),
  toastFnMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  reportMock: vi.fn(),
}));

vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return nativeFlagRef.value;
  },
}));

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { writeFile: (...args: unknown[]) => writeFileMock(...args) },
  Directory: { Cache: "CACHE", Documents: "DOCUMENTS" },
  Encoding: { UTF8: "utf8" },
}));

vi.mock("@capacitor/share", () => ({
  Share: { share: (...args: unknown[]) => shareMock(...args) },
}));

// The BARE callable and `.success` are separate spies on purpose, and the
// callable is no longer aliased to `toastErrorMock`. `src/lib/toastPolicy.ts`
// no-ops every action-less `toast.success` app-wide at boot, so the two are
// not interchangeable in production: one renders, one is dead code that reads
// as live. The download confirmation below must therefore be asserted on the
// channel that actually reaches the user, and a regression back to
// `toast.success` has to show up as a FAILING test rather than a passing one.
vi.mock("sonner", () => {
  const toastFn = (...args: unknown[]) => toastFnMock(...args);
  toastFn.success = (...args: unknown[]) => toastSuccessMock(...args);
  toastFn.error = (...args: unknown[]) => toastErrorMock(...args);
  return { toast: toastFn };
});

vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => reportMock(...args),
}));

import { exportJobToCalendar } from "@/lib/calendarExport";

const job = {
  id: "job-123",
  title: "Move a couch",
  location: "1408 Rue Beauregard, Delcambre, LA 70528",
  description: "Two flights of stairs.",
  dateNeeded: "2026-09-15",
  startTime: "14:30",
  estimatedHours: 2,
};

beforeEach(() => {
  nativeFlagRef.value = false;
  writeFileMock.mockReset();
  shareMock.mockReset();
  toastFnMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  reportMock.mockReset();
});

describe("exportJobToCalendar — native branch", () => {
  beforeEach(() => {
    nativeFlagRef.value = true;
  });

  it("writes a real .ics file and shares it as a FILE, not a data: URL", async () => {
    writeFileMock.mockResolvedValue({ uri: "file:///var/mobile/Caches/move-a-couch.ics" });
    shareMock.mockResolvedValue({ activityType: "com.apple.UIKit.activity.Unknown" });

    await exportJobToCalendar(job);

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const write = writeFileMock.mock.calls[0][0] as {
      path: string;
      data: string;
      directory: string;
      encoding: string;
    };
    expect(write.path).toBe("move-a-couch.ics");
    expect(write.directory).toBe("CACHE");
    expect(write.encoding).toBe("utf8");
    expect(write.data).toContain("BEGIN:VEVENT");
    expect(write.data).toContain("DTSTART:20260915T143000");

    expect(shareMock).toHaveBeenCalledTimes(1);
    const shared = shareMock.mock.calls[0][0] as Record<string, unknown>;
    expect(shared.files).toEqual(["file:///var/mobile/Caches/move-a-couch.ics"]);
    // The whole point: no extra activity items. A sibling `text`/`url` makes
    // the share a mixed-type activity and iOS drops the Calendar handler.
    expect(shared).not.toHaveProperty("url");
    expect(shared).not.toHaveProperty("text");
    // And nothing about a browser download happened. The share sheet IS the
    // confirmation on native, so there is no toast of any kind.
    expect(toastFnMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("toasts AND reports when the file can't be written", async () => {
    writeFileMock.mockRejectedValue(new Error("disk full"));

    await exportJobToCalendar(job);

    expect(shareMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("toasts AND reports when the share sheet fails", async () => {
    writeFileMock.mockResolvedValue({ uri: "file:///tmp/move-a-couch.ics" });
    shareMock.mockRejectedValue(new Error("Can't share while sharing is in progress"));

    await exportJobToCalendar(job);

    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the user just dismisses the sheet", async () => {
    writeFileMock.mockResolvedValue({ uri: "file:///tmp/move-a-couch.ics" });
    // The literal message @capacitor/share's iOS implementation rejects with.
    shareMock.mockRejectedValue(new Error("Share canceled"));

    await exportJobToCalendar(job);

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(reportMock).not.toHaveBeenCalled();
  });
});

describe("exportJobToCalendar — web branch", () => {
  it("downloads the .ics and never touches the native plugins", async () => {
    const created: string[] = [];
    const clicked: HTMLAnchorElement[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => {
      const u = "blob:mock-url";
      created.push(u);
      return u;
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this);
      });

    try {
      await exportJobToCalendar(job);
      expect(created).toHaveLength(1);
      expect(clicked).toHaveLength(1);
      expect(clicked[0].download).toBe("move-a-couch.ics");
      expect(writeFileMock).not.toHaveBeenCalled();
      expect(shareMock).not.toHaveBeenCalled();
      // A `<a download>` leaves the page pixel-identical, so this toast is the
      // only thing that tells the user the file exists. It must go through the
      // bare callable — `toast.success` here renders NOTHING (toastPolicy.ts),
      // which is what it used to do.
      expect(toastFnMock).toHaveBeenCalledTimes(1);
      expect(toastFnMock.mock.calls[0][0]).toBe("move-a-couch.ics downloaded");
      expect(toastSuccessMock).not.toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
