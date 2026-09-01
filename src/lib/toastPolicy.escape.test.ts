import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { toast } from "sonner";
import { applyToastPolicy } from "./toastPolicy";

/**
 * THE ESCAPE HATCH IS LOAD-BEARING. PIN IT.
 *
 * `applyToastPolicy` no-ops `toast.success` / `.info` / `.message`, so every
 * confirmation that cannot afford to vanish — a clipboard copy, a file
 * download — is written through the BARE `toast(...)` callable instead
 * (`confirmCopied` and `confirmDownloaded` in src/lib/nativeShare.ts,
 * calendarExport's `.ics` download, WorkRecord's PDF download).
 *
 * That works because of an implementation detail of a third-party package.
 * Sonner 2.0.8 does:
 *
 *     const ToastState = new Observer();
 *     const toastFunction = (message, data) => ToastState.message(message, data);
 *     const toast = Object.assign(toastFunction, { message: ToastState.message, ... });
 *
 * The policy reassigns the `.message` PROPERTY; the callable closes over the
 * observer and never reads that property. If a sonner upgrade ever re-routes
 * `toastFunction` through the exported object — a perfectly reasonable
 * refactor for them to make — every one of those confirmations goes silent at
 * once, with no error, no type change, and no failing test anywhere else.
 * That is the exact silent-no-op class this codebase keeps getting bitten by,
 * so it gets a test that drives the REAL sonner build rather than a mock.
 *
 * `src/lib/toastPolicy.test.ts` is the other half: it stubs the methods and
 * asserts the suppression rules. It cannot see this, because stubbing
 * `toast.success` with a spy hides whether the property was the live path.
 */

/** Sonner's own store — what the <Toaster /> renders from. */
const activeIds = () => toast.getToasts().map((t) => t.id);

describe("the bare toast() callable survives applyToastPolicy", () => {
  beforeAll(() => {
    // Real, unstubbed sonner. The policy is applied once here exactly as
    // main.tsx applies it once at boot.
    applyToastPolicy();
  });

  afterEach(() => {
    for (const id of activeIds()) toast.dismiss(id);
  });

  it("renders a toast with no action — the channel the download/copy confirmations use", () => {
    const before = activeIds().length;
    toast("helpr-work-record.pdf downloaded", { description: "It's in your browser's downloads." });
    const after = toast.getToasts();

    expect(after.length).toBe(before + 1);
    // `getToasts()` is typed as a union with the internal dismiss record, so
    // narrow rather than index-and-hope.
    const titles = after.map((t) => ("title" in t ? t.title : undefined));
    expect(titles).toContain("helpr-work-record.pdf downloaded");
  });

  it("toast.success with no action still renders NOTHING — the two are not interchangeable", () => {
    // The whole point of the pin: same message, same absent action, opposite
    // outcome. A reviewer swapping one for the other must break a test.
    const before = activeIds().length;
    toast.success("helpr-work-record.pdf downloaded");
    expect(activeIds().length).toBe(before);
  });

  it("toast.error is untouched", () => {
    const before = activeIds().length;
    toast.error("Couldn't download the file — try again.");
    expect(activeIds().length).toBe(before + 1);
  });
});
