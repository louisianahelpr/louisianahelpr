/**
 * The document viewer's Download / Open in new tab never fail silently (security review 2026-11-15, two Lows,
 * DocumentViewer.tsx leaveTo):
 *   - web: a blocked new tab (window.open returns null) toasts POPUP_BLOCKED, the way openSignedDocument did;
 *   - native: a Capacitor Browser.open that rejects is caught, reported, and toasts LEAVE_FAILED (it was `void`ed).
 * Also pins the shared controls the viewer now uses (OWN-SHARED): DarkGroundChromeButton's 44px floor and name.
 *
 * @mutate src/components/documents/DocumentViewer.tsx | if (!tab) {\n    toast.error(POPUP_BLOCKED); | if (!tab) {
 * @mutate src/components/documents/DocumentViewer.tsx |       toast.error(LEAVE_FAILED); |
 * @mutate src/components/documents/DocumentViewer.tsx |   tab.opener = null; |
 * @mutate src/components/ui/DarkGroundChromeButton.tsx | className={`min-h-11 min-w-11 | className={`min-h-9 min-w-9
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const native = vi.hoisted(() => ({ on: false }));
const toastError = vi.hoisted(() => vi.fn());
const browserOpen = vi.hoisted(() => vi.fn());
const reportFn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/nativeInit", () => ({ get isNativePlatform() { return native.on; } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: browserOpen } }));
vi.mock("@/lib/errorLogger", () => ({ report: reportFn }));
vi.mock("@/components/documents/PdfPages", () => ({ default: () => <div data-testid="pdf-pages" /> }));

import { DocumentViewer, LEAVE_FAILED, POPUP_BLOCKED } from "@/components/documents/DocumentViewer";

const DOC = { url: "https://x.supabase.co/storage/v1/object/sign/b/cover.docx?token=t", name: "cover.docx" };

function viewer() {
  render(<DocumentViewer doc={DOC} onClose={() => {}} />);
  return screen.getByRole("dialog", { name: "Document viewer" });
}

beforeEach(() => {
  native.on = false;
  toastError.mockReset();
  browserOpen.mockReset();
  reportFn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("document viewer: leaving the app never fails silently", () => {
  it("web, pop-up blocked: Download and Open in new tab each toast POPUP_BLOCKED", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const v = viewer();
    fireEvent.click(within(v).getByRole("button", { name: "Download" }));
    fireEvent.click(within(v).getByRole("button", { name: "Open in new tab" }));
    fireEvent.click(within(v).getByRole("button", { name: "Download cover.docx" }));
    expect(open).toHaveBeenCalledTimes(3);
    expect(toastError.mock.calls).toEqual([[POPUP_BLOCKED], [POPUP_BLOCKED], [POPUP_BLOCKED]]);
  });

  it("web, tab opened: no toast, opener cut, tab pointed at the file", () => {
    const tab = { opener: window as unknown, location: { href: "" } };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    fireEvent.click(within(viewer()).getByRole("button", { name: "Open in new tab" }));
    expect(toastError).not.toHaveBeenCalled();
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe(DOC.url);
  });

  it("native, Browser.open rejects: reported and LEAVE_FAILED toasted, not dropped", async () => {
    native.on = true;
    const boom = new Error("sheet failed");
    browserOpen.mockRejectedValue(boom);
    fireEvent.click(within(viewer()).getByRole("button", { name: "Open in new tab" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(LEAVE_FAILED));
    expect(browserOpen).toHaveBeenCalledWith({ url: DOC.url, presentationStyle: "popover" });
    expect(reportFn).toHaveBeenCalledWith(boom, expect.anything());
  });

  it("native, Browser.open succeeds: no toast", async () => {
    native.on = true;
    browserOpen.mockResolvedValue(undefined);
    fireEvent.click(within(viewer()).getByRole("button", { name: "Download" }));
    await waitFor(() => expect(browserOpen).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("the bar's controls are the shared dark-ground chrome button, 44px, named", () => {
    const v = viewer();
    const buttons = within(v).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(3);
    for (const name of ["Download", "Open in new tab"]) {
      const b = within(v).getByRole("button", { name });
      expect(b.className).toMatch(/\bmin-h-11\b/);
      expect(b.className).toMatch(/\bmin-w-11\b/);
      expect(b.className).toMatch(/\bctl-tint-invert\b/);
    }
  });
});
