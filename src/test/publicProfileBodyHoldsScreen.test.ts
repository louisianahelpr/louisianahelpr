// @mutate src/pages/u/PublicProfilePage.tsx | <div className="min-h-[100dvh]" data-testid="pp-body"> | <div data-testid="pp-body">
/**
 * F253 (whole-app audit 11-10; measured B3g 11-12 on a local build, guest /u/nobody at 375: CLS 0.405 before,
 * 0.017 after). The loading bones were taller than the "This profile isn't available" card, so when the answer
 * came the body shrank and the site footer slid up into the first screen: one big layout shift. The guest shell's
 * body now holds at least a screen's height in every state (loading, error, unavailable, loaded), so the footer
 * starts below the fold and does not move into view on load.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../pages/u/PublicProfilePage.tsx"), "utf8");

describe("F253: the public profile body holds a screen's height", () => {
  it("wraps the guest-shell body (every state) in a min-h-[100dvh] box", () => {
    const shell = src.slice(src.indexOf("<PublicHeaderPage"), src.indexOf("</PublicHeaderPage>"));
    expect(shell).toMatch(/<div className="min-h-\[100dvh\]" data-testid="pp-body">\{body\}<\/div>/);
  });
  it("the skeleton, the error and the unavailable card all render inside body", () => {
    const body = src.slice(src.indexOf("const body = ("), src.indexOf("return guestShell"));
    expect(body).toContain("<PublicProfileSkeleton");
    expect(body).toContain("<ErrorState");
    expect(body).toContain("unavailable");
  });
});
