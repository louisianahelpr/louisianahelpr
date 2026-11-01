/**
 * PERF-SHELL footer (lead decision 11-01): /browse's raw HTML draws the site Footer exactly as the app does, because
 * while few jobs are open the footer's H emblem is on the first screen and is the page's LCP element.
 *
 * Pins, each against the app's own code:
 *   1. SHELL_FOOTER_HTML is React's static render of the real Footer (signed out) byte for byte, with only the
 *      emblem's src/srcset and the year left as slots; editing Footer.tsx without updating the copy turns this red;
 *   2. SHELL_LAYOUT_CLASS is PublicLayout's root class, and the shell wraps its body in PublicLayout's `flex-1`, so
 *      the footer stands where the app's does (pinned to the bottom of a short page);
 *   3. the drawn copy carries the page's own emblem file, this year, and is inert + aria-hidden (a picture only).
 *
 * @mutate src/lib/browseShellCards.mjs |     (emblem ? shellFooterHtml(emblem, now) : "") + |     "" +
 * @mutate src/lib/browseShellCards.mjs | <p class="text-ds-11 text-[hsl(var(--olivewood))]/80 max-w-xs leading-relaxed">Jobs, Declutter | <p class="text-ds-11 text-[hsl(var(--olivewood))]/80 max-w-sm leading-relaxed">Jobs, Declutter
 * @mutate src/lib/browseShellCards.mjs |   "min-h-screen page-warmth pb-[calc(var(--safe-area-bottom,0px)_+_var(--bottom-nav-h,96px))] relative flex flex-col overflow-x-clip"; |   "min-h-screen page-warmth relative flex flex-col overflow-x-clip";
 * @mutate src/lib/browseShellCards.mjs | " style="--bottom-nav-h:0px"><div aria-hidden | "><div aria-hidden
 * @mutate src/lib/browseShellCards.mjs |     `<div class="flex-1"><div class="mx-auto page-measure | `<div><div class="mx-auto page-measure
 * @mutate src/lib/browseShellCards.mjs |     .replace("© __YEAR__ ", `© <!-- -->${year}<!-- --> `) |     .replace("© __YEAR__ ", `© ${year} `)
 * @mutate src/lib/browseShellCards.mjs |     .replace("<footer ", '<footer aria-hidden="true" inert="" '); |     .replace("<footer ", "<footer ");
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, ready: true }) }));

import Footer from "@/components/Footer";
import helprLogoSm from "@/assets/helpr-logo-96.webp";
import helprLogoMd from "@/assets/helpr-logo-256.webp";
import { browseShellHtml, SHELL_FOOTER_HTML, SHELL_LAYOUT_CLASS, shellFooterHtml } from "@/lib/browseShellCards.mjs";

const EMBLEM = { src: "/assets/helpr-logo-256-abc.webp", srcset: "/assets/helpr-logo-96-abc.webp 96w, /assets/helpr-logo-256-abc.webp 256w" };
const NOW = Date.parse("2026-11-01T12:00:00Z");
const ROW = { title: "Mow the front yard", category: "yard_work", budget: 85, location: "Lafayette, LA", status: "open", created_at: "2026-10-31T12:00:00Z" };

describe("/browse's raw HTML draws the app's own Footer", () => {
  it("SHELL_FOOTER_HTML is the real signed-out Footer's render, byte for byte", () => {
    const real = renderToStaticMarkup(<MemoryRouter><Footer /></MemoryRouter>);
    const slotted = real
      .replace(`src="${helprLogoMd}" srcSet="${helprLogoSm} 96w, ${helprLogoMd} 256w"`, 'src="__EMBLEM_SRC__" srcset="__EMBLEM_SRCSET__"')
      .replace(`© ${new Date().getFullYear()} `, "© __YEAR__ ");
    expect(slotted, "Footer.tsx changed: paste this string into SHELL_FOOTER_HTML").toBe(SHELL_FOOTER_HTML);
    expect(SHELL_FOOTER_HTML.length).toBeGreaterThan(3000);
    expect(SHELL_FOOTER_HTML).toContain('alt="Helpr" class="helpr-emblem h-10');
  });

  it("the shell sits in PublicLayout's frame, footer last", () => {
    const layout = blankComments(fs.readFileSync("src/components/marketing/PublicLayout.tsx", "utf8"));
    expect(layout).toContain(`<div className={\`${SHELL_LAYOUT_CLASS}\${landing ? " landing-page" : ""}\`}>`);
    expect(layout).toMatch(/<div className="flex-1">\{children\}<\/div>\s*\{footer && <Footer landing=\{landing\} \/>\}/);
    const html = browseShellHtml([ROW], NOW, EMBLEM);
    expect(html).toContain(`<div class="${SHELL_LAYOUT_CLASS}" style="--bottom-nav-h:0px"><div aria-hidden="true" class="mesh-gradient-global"></div>`);
    // The body (header + cards) is one flex-1 block, and the footer follows it as the frame's last child.
    expect(html).toMatch(/<div class="flex-1"><div class="mx-auto page-measure[\s\S]*data-feed-card[\s\S]*<\/div><\/div><\/div><\/div><footer /);
    expect(html.endsWith("</footer></div></div>")).toBe(true);
  });

  it("the drawn copy wears the page's emblem file and this year, as a picture only", () => {
    const html = shellFooterHtml(EMBLEM, NOW);
    expect(html).toContain(`src="${EMBLEM.src}" srcset="${EMBLEM.srcset}" sizes="40px"`);
    expect(html).toContain("© <!-- -->2026<!-- --> Louisiana Helpr");
    expect(html).not.toContain("__");
    expect(html.startsWith('<footer aria-hidden="true" inert="" class="px-5')).toBe(true);
    expect(shellFooterHtml(EMBLEM, Date.parse("2027-01-01T03:00:00Z"))).toContain("© <!-- -->2026<!-- --> "); // still Dec 31 in Louisiana
    // No emblem file known (no preload tag): neither the nav mark nor the footer is drawn.
    expect(browseShellHtml([ROW], NOW, null)).not.toContain("<footer");
  });
});
