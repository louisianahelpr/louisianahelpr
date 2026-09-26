/**
 * Q295: the credential queue's "Open" must open its tab INSIDE the click
 * (WebKit blocks window.open after an await, silently under noopener), and
 * every outcome is visible: opened, blocked (toast), signing failed (tab
 * closed + toast).
 *
 * @mutate src/lib/openSignedDocument.ts |   const tab = deps.open("", "_blank");\n  if (!tab) { |   let url0 = await deps.sign(); const tab = deps.open(url0 ?? "", "_blank");\n  if (!tab) {
 * @mutate src/lib/openSignedDocument.ts |     tab.close();\n    deps.toastError(SIGN_FAILED); |     deps.toastError(SIGN_FAILED);
 * @mutate src/lib/openSignedDocument.ts |     deps.toastError(POPUP_BLOCKED);\n    return "blocked"; |     return "blocked";
 * @mutate src/lib/openSignedDocument.ts |   tab.opener = null; |   void 0;
 * @mutate src/components/admin/AdminCredentialQueue.tsx |     await openSignedDocument({ |     await Promise.resolve({
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openSignedDocument, POPUP_BLOCKED, SIGN_FAILED } from "./openSignedDocument";

type FakeTab = { opener: unknown; closed: boolean; location: { href: string }; close: () => void };
const fakeTab = (): FakeTab => {
  const t: FakeTab = { opener: {}, closed: false, location: { href: "" }, close: () => { t.closed = true; } };
  return t;
};

describe("openSignedDocument (Q295)", () => {
  it("opens the tab before signing (inside the click), then navigates it", async () => {
    const order: string[] = [];
    const tab = fakeTab();
    const toastError = vi.fn();
    const out = await openSignedDocument({
      open: () => { order.push("open"); return tab as unknown as Window; },
      sign: async () => { order.push("sign"); return "https://x.test/signed"; },
      toastError,
    });
    expect(out).toBe("opened");
    expect(order).toEqual(["open", "sign"]);
    expect(tab.location.href).toBe("https://x.test/signed");
    expect(tab.opener, "the opened document cannot reach the admin page").toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a blocked popup is said, never silent", async () => {
    const toastError = vi.fn();
    const sign = vi.fn(async () => "https://x.test/signed");
    const out = await openSignedDocument({ open: () => null, sign, toastError });
    expect(out).toBe("blocked");
    expect(toastError).toHaveBeenCalledWith(POPUP_BLOCKED);
  });

  it("a signing failure (null or thrown) closes the blank tab and says so", async () => {
    for (const sign of [async () => null, async () => { throw new Error("boom"); }]) {
      const tab = fakeTab();
      const toastError = vi.fn();
      const out = await openSignedDocument({ open: () => tab as unknown as Window, sign, toastError });
      expect(out).toBe("sign-failed");
      expect(tab.closed).toBe(true);
      expect(toastError).toHaveBeenCalledWith(SIGN_FAILED);
    }
  });

  it("SignedOpenLink signs through openSignedDocument, with no window.open after an await", () => {
    const src = readFileSync(resolve(__dirname, "../components/admin/AdminCredentialQueue.tsx"), "utf8");
    const fn = src.slice(src.indexOf("function SignedOpenLink"), src.indexOf("function DocPreview"));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toMatch(/await openSignedDocument\(\{/);
    expect(fn).not.toMatch(/window\.open\(data\.signedUrl/);
  });
});
