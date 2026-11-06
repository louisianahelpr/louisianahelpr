/**
 * Q2705 /browse empty state in the raw HTML (measured 11-06: prod had 0 guest-visible open jobs, so the HTML shell
 * drew nothing and the page's LCP was the empty state's sentence at ~4.6 s live on Slow 4G, painted only by the app).
 *
 * Pins, each against the app's own code:
 *   1. SHELL_EMPTY_HTML is React's static render of DashboardGuest's unfiltered web empty state (its `flex` wrapper,
 *      EmptyState with the Search icon, its title and body, GuestEmptyStateActions unfiltered) byte for byte, made a
 *      picture only (aria-hidden + inert); DashboardGuest still draws exactly that state;
 *   2. it is drawn ONLY when the read succeeded and the feed will draw no job (every row expired, or none), never on
 *      a failed read, never while any live row exists (a crew with spots left is not drawn as a card, but the app
 *      draws it, so the HTML must not say "nothing today");
 *   3. it sits where the cards would (inside the same page-measure body, footer after it) and marks the overlay
 *      data-shell-empty, which adoptBrowseShell drops on a filtered URL (the app's copy differs there).
 *
 * @mutate src/lib/browseShellCards.mjs |   return !rows.some((j) => j && typeof j === "object" && (!j.expires_at \|\| Date.parse(j.expires_at) > now)); |   return true;
 * @mutate src/lib/browseShellCards.mjs |   if (!Array.isArray(rows)) return false; |   if (!Array.isArray(rows)) return true;
 * @mutate src/lib/browseShellCards.mjs |   if (jobs.length === 0 && !empty) return ""; |   if (jobs.length === 0) return "";
 * @mutate src/lib/browseShellCards.mjs |     (empty ? SHELL_EMPTY_HTML : | (false ? SHELL_EMPTY_HTML :
 * @mutate src/lib/browseShellCards.mjs | <p class="font-sans text-ds-13 leading-relaxed max-w-[26rem] | <p class="font-sans text-ds-14 leading-relaxed max-w-[26rem]
 * @mutate src/lib/browseShellCards.mjs | ${empty ? ' data-shell-empty=""' : ""} | ${""}
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LucideProvider, Search } from "lucide-react";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import fs from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { EmptyState } from "@/components/ui/EmptyState";
import { GuestEmptyStateActions } from "@/components/dashboard/GuestEmptyStateActions";
import { browseShellHtml, SHELL_EMPTY_HTML, shellFeedIsEmpty, withBrowseShell } from "@/lib/browseShellCards.mjs";

const TITLE = "Nothing today, neighbor.";
const BODY = "New jobs post throughout the day — fresh work lands here as neighbors post it. Check back soon.";
const NOW = Date.parse("2026-11-06T18:00:00Z");
const EMBLEM = { src: "/assets/helpr-logo-256-abc.webp", srcset: "/assets/helpr-logo-96-abc.webp 96w, /assets/helpr-logo-256-abc.webp 256w" };
const noop = vi.fn();

function realEmptyState(): string {
  // DashboardGuest's web branch (emptyWrapperClass "flex"), inside App.tsx's LucideProvider (Q2027: one icon weight).
  return renderToStaticMarkup(
    <LucideProvider strokeWidth={ICON_STROKE_PX} nonScalingStroke>
      <div className="flex">
        <EmptyState
          icon={Search}
          title={TITLE}
          body={BODY}
          action={
            <GuestEmptyStateActions
              hasFilters={false}
              nearbyActive={false}
              nextMiles={10}
              onWiden={noop}
              onShowAllLocations={noop}
              onClearFilters={noop}
              onNotify={noop}
              onHire={noop}
            />
          }
        />
      </div>
    </LucideProvider>,
  );
}

describe("/browse's raw HTML draws the guest feed's empty state when no job is open", () => {
  it("SHELL_EMPTY_HTML is the real empty state's render, byte for byte, as a picture only", () => {
    const real = realEmptyState().replace(/^<div class="flex">/, '<div aria-hidden="true" inert="" class="flex">');
    expect(real, "the guest empty state changed: paste this string into SHELL_EMPTY_HTML").toBe(SHELL_EMPTY_HTML);
    expect(SHELL_EMPTY_HTML.length).toBeGreaterThan(1500);
    expect(SHELL_EMPTY_HTML).toContain(`>${TITLE}<`);
    expect(SHELL_EMPTY_HTML).toContain("Notify me when work lands");
  });

  it("DashboardGuest still draws that exact state on the web", () => {
    const src = blankComments(fs.readFileSync("src/pages/home/DashboardGuest.tsx", "utf8"));
    expect(src).toContain(`: "${TITLE}"`);
    expect(src).toContain(`: "${BODY}"`);
    expect(src).toContain('const emptyWrapperClass = isNativePlatform ? "flex-1 min-h-full flex" : "flex";');
    expect(src).toMatch(/<EmptyState\s+icon=\{Search\}/);
    expect(src).toMatch(/<GuestEmptyStateActions\s+hasFilters=\{filters\.hasFilters\}/);
  });

  it("drawn only on a successful read with no live row", () => {
    const expired = { title: "Old", category: "yard_work", budget: 50, location: "Lafayette, LA", status: "open", expires_at: "2026-11-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z" };
    const crew = { title: "Crew", category: "moving", budget: 90, location: "Lafayette, LA", status: "accepted", is_group_job: true, created_at: "2026-11-05T00:00:00Z" };
    expect(shellFeedIsEmpty([], NOW)).toBe(true);
    expect(shellFeedIsEmpty([expired], NOW)).toBe(true);
    expect(shellFeedIsEmpty(null, NOW)).toBe(false);
    expect(shellFeedIsEmpty(undefined, NOW)).toBe(false);
    expect(shellFeedIsEmpty([crew], NOW)).toBe(false);
    expect(shellFeedIsEmpty([expired, crew], NOW)).toBe(false);

    for (const rows of [[], [expired]]) {
      const html = browseShellHtml(rows, NOW, EMBLEM);
      expect(html).toContain('<div id="lh-browse-shell" data-shell-empty="" class=');
      expect(html).toContain(SHELL_EMPTY_HTML);
      expect(html).not.toContain("data-feed-card");
    }
    // A live crew the HTML does not draw as a card: no empty state, no shell at all (the page as it was).
    expect(browseShellHtml([crew], NOW, EMBLEM)).toBe("");
    expect(browseShellHtml(null, NOW, EMBLEM)).toBe("");
    const page = '<html><body><div id="root"><div id="boot-loader" role="status"></div></div></body></html>';
    expect(withBrowseShell(page, null, NOW)).toBe(page);
    expect(withBrowseShell(page, [], NOW)).toContain('<div id="boot-loader" role="status"><div id="lh-browse-shell" data-shell-empty=""');
  });

  it("sits where the cards would, in the same body, the footer after it", () => {
    const html = browseShellHtml([], NOW, EMBLEM);
    expect(html).toContain(`<div class="px-5 sm:px-8 lg:px-12 pb-16"><div class="mx-auto page-measure">${SHELL_EMPTY_HTML}</div></div></div><footer `);
    expect(html).toContain('<h1 class="text-page-title leading-tight truncate">Browse jobs</h1>');
    const card = { title: "Mow the front yard", category: "yard_work", budget: 85, location: "Lafayette, LA", status: "open", created_at: "2026-10-31T12:00:00Z" };
    const cards = browseShellHtml([card], NOW, EMBLEM);
    expect(cards).not.toContain("data-shell-empty");
    expect(cards).not.toContain(TITLE);
  });
});
