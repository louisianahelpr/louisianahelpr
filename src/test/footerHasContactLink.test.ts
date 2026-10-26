// @mutate src/components/Footer.tsx |               <Link to="/support" className="link-standard">\n                Contact us | <Link to="/help" className="link-standard">\n                Contact us
/**
 * The footer has a way to reach us (lead item 14, 2026-10-25: /contact 404'd
 * and the footer had no contact link). /contact now redirects to /support
 * (vercel.json); the footer's Explore column links "Contact us" to /support.
 * Screenshots at 375 and 1440, light and dark, reviewed 2026-10-26.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

describe("the footer links Contact us to /support", () => {
  const footer = blankComments(readFileSync("src/components/Footer.tsx", "utf8"));
  const links = [...footer.matchAll(/<Link\s+to="([^"]+)"[^>]*>\s*([^<{]+?)\s*<\/Link>/g)].map((m) => ({ to: m[1], text: m[2] }));

  it("reads the footer's links", () => {
    expect(links.length).toBeGreaterThan(3);
  });

  it("has a Contact us link to /support", () => {
    expect(links).toContainEqual({ to: "/support", text: "Contact us" });
  });

  it("/contact still redirects to /support", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { redirects?: { source: string; destination: string }[] };
    expect(vercel.redirects?.some((r) => r.source === "/contact" && r.destination === "/support")).toBe(true);
  });
});
