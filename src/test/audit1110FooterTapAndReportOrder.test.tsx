/**
 * Whole-app audit 11-10, Builder 2:
 *   F214 Home footer: the links (Jobs, Declutter, Find a Helpr, Help center, Contact us, Terms, Rules, Privacy) were 24px
 *         tall with a fine pointer and 44px only on a coarse one, so a phone emulator and /browse's raw-HTML shell
 *         disagreed. Every footer link is now a 44px tall tap area on every pointer (padding, same 13px text).
 *   F430 Report sheet (a person): "Fake profile or impersonation" led the list although most chat reports are for
 *         off-Helpr payment or harassment. The order is now Payment requested off Helpr, Harassment or abuse,
 *         Spam or scam, then the rest.
 *
 * @mutate src/components/Footer.tsx | const FOOTER_LINK = "link-standard inline-flex items-center min-h-11"; | const FOOTER_LINK = "link-standard inline-flex items-center min-h-6 [@media(pointer:coarse)]:min-h-11";
 * @mutate src/components/reportDialog/reportReasons.ts | { label: "Payment requested off Helpr" },\n    { label: "Harassment or abuse" },\n    { label: "Spam or scam" },\n    { label: "Fake profile or impersonation" }, | { label: "Fake profile or impersonation" },\n    { label: "Payment requested off Helpr" },\n    { label: "Harassment or abuse" },\n    { label: "Spam or scam" },
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Footer from "@/components/Footer";
import { REASONS } from "@/components/reportDialog/reportReasons";
import { SHELL_FOOTER_HTML } from "@/lib/browseShellCards.mjs";

afterEach(() => cleanup());

describe("F214: footer links are 44px tap areas on every pointer", () => {
  it("every footer list link carries min-h-11 with no coarse-pointer gate, in the app and the /browse shell", () => {
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const links = [...container.querySelectorAll<HTMLAnchorElement>("footer ul a")];
    expect(links.length).toBeGreaterThan(6);
    for (const a of links) {
      const classes = a.className.split(/\s+/);
      expect(classes, a.textContent!).toContain("min-h-11");
      expect(classes, a.textContent!).not.toContain("min-h-6");
      expect(classes, a.textContent!).not.toContain("[@media(pointer:coarse)]:min-h-11");
    }
    expect(SHELL_FOOTER_HTML).not.toContain("min-h-6 ");
    expect(SHELL_FOOTER_HTML.match(/class="link-standard inline-flex items-center min-h-11"/g)?.length).toBe(10); // 8 + Fees and Safety (F255)
  });
});

describe("F430: a person's report reasons lead with the common ones", () => {
  it("orders Payment requested off Helpr, Harassment or abuse, Spam or scam first, then the rest, Something else last", () => {
    const labels = REASONS.user.map((r) => r.label);
    expect(labels.slice(0, 3)).toEqual(["Payment requested off Helpr", "Harassment or abuse", "Spam or scam"]);
    expect(labels).toHaveLength(7);
    expect(labels[labels.length - 1]).toBe("Something else");
    expect(new Set(labels).size).toBe(7);
  });
});
