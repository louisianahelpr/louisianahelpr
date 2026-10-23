/**
 * /sms-opt-in, THE PUBLIC LINK TWILIO'S A2P FORM ASKS FOR (owner, 2026-10-23): the form takes a URL, not an upload.
 * The page shows the real opt-in box (public/sms-opt-in-form.png) and the same box ticked
 * (public/sms-opt-in-confirmed.png), one sentence each, and links to /terms/full and /privacy/full (every section open, nothing to tap). It is a public
 * route (signed out works) with its own head.
 *
 * @mutate src/App.tsx |       <Route path="/sms-opt-in" element= |       <Route path="/sms-opt-in-old" element=
 * @mutate src/pages/info/SmsOptIn.tsx | backTo="/" wrapTitle bottomPaddingClassName | backTo="/" bottomPaddingClassName
 * @mutate src/pages/info/SmsOptInBody.tsx |           src="/sms-opt-in-confirmed.png" |           src="/missing.png"
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SmsOptIn from "@/pages/info/SmsOptIn";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";

const ROOT = resolve(__dirname, "..", "..");
afterEach(cleanup);

describe("/sms-opt-in, the opt-in link for Twilio's A2P review", () => {
  it("shows the two opt-in screenshots that exist in public/, and links to the Terms and the Privacy Policy", () => {
    render(<MemoryRouter><SmsOptIn /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("How to opt in to Louisiana Helpr text alerts");
    // The title is a sentence: it wraps instead of ending in "..." (it truncated to "How to opt in to Louisia..." at
    // 375, WebKit, 2026-10-23).
    expect(screen.getByRole("heading", { level: 1 }).className).not.toMatch(/\btruncate\b/);
    // The page's own screenshots (the shared navbar and footer carry their own images).
    const srcs = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src")).filter((s) => s?.startsWith("/sms-opt-in"));
    expect(srcs.length).toBeGreaterThan(1);
    expect(srcs).toEqual(["/sms-opt-in-form.png", "/sms-opt-in-confirmed.png"]);
    for (const src of srcs) {
      const file = resolve(ROOT, "public", src!.slice(1));
      expect({ src, exists: existsSync(file) }).toEqual({ src, exists: true });
      expect(statSync(file).size).toBeLessThan(300 * 1024);
    }
    expect(screen.getByRole("link", { name: "Terms of Service" }).getAttribute("href")).toBe("/terms/full");
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe("/privacy/full");
  });

  it("is a public route with its own head", () => {
    const app = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
    expect(app).toMatch(/<Route path="\/sms-opt-in" element=\{<RouteErrorBoundary>\{routeEl\(<PageTransition><SmsOptIn \/>/);
    expect(PUBLIC_PAGE_META["/sms-opt-in"].title).toMatch(/^How to opt in to Louisiana Helpr text alerts/);
  });
});
