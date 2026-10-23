import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LEGAL_FULL_TEXT_DOCS, LegalFullTextBody } from "@/pages/info/legal/LegalFullTextBody";
import { SMS_OPT_IN_TITLE, SmsOptInBody } from "@/pages/info/SmsOptInBody";

/**
 * PAGES WHOSE TEXT IS IN THE RAW HTML, BEFORE ANY JAVASCRIPT (owner/lead, 2026-10-23). Twilio's A2P checker fetches
 * /terms/full, /privacy/full and /sms-opt-in without running JavaScript; the SPA shell alone has no page text, so it
 * reported them as unreadable. The build renders each page's OWN body component (the one the route renders) to
 * static markup here; scripts/prerender-static-pages.mjs writes the result to scripts/generated/static-pages.js and
 * api/share.ts (which already serves these routes' heads, vercel.json) puts it inside #root. React's createRoot
 * clears #root on its first render, so with JavaScript the app replaces it as usual.
 *
 * Same source, so the text cannot drift: a reword of the Terms or the opt-in box changes this output on the next
 * build. Guard: src/test/staticPagesRawHtml.test.ts.
 */
const legal = (doc: "terms" | "privacy") => {
  const Body = () => <LegalFullTextBody doc={doc} />;
  return { title: LEGAL_FULL_TEXT_DOCS[doc].title, Body };
};

const STATIC_PAGES: Record<"/terms/full" | "/privacy/full" | "/sms-opt-in", { title: string; Body: ComponentType }> = {
  "/terms/full": legal("terms"),
  "/privacy/full": legal("privacy"),
  "/sms-opt-in": { title: SMS_OPT_IN_TITLE, Body: SmsOptInBody },
};
export type StaticPagePath = keyof typeof STATIC_PAGES;
export const STATIC_PAGE_PATHS = Object.keys(STATIC_PAGES) as StaticPagePath[];

/**
 * What each page's raw HTML must carry (as rendered markup: React escapes & and quotes). The build fails without it
 * (scripts/prerender-static-pages.mjs) and so does the guard.
 */
export const STATIC_PAGE_MUST_SAY: Record<StaticPagePath, string[]> = {
  "/terms/full": [
    "<h1",
    ">Terms of Service</h1>",
    "SMS Terms",
    "Louisiana Helpr text alerts are optional.",
    "Message frequency varies.",
    "Message and data rates may apply.",
    "Reply STOP to cancel or HELP for help",
    "Carriers are not liable for delayed or undelivered messages.",
  ],
  "/privacy/full": [
    ">Privacy Policy</h1>",
    "Text messages",
    "Louisiana Helpr",
    "We do not sell or share your SMS opt-in data or personal information with third parties for marketing purposes.",
  ],
  "/sms-opt-in": [
    `>${SMS_OPT_IN_TITLE}</h1>`,
    '<img src="/sms-opt-in-form.png"',
    '<img src="/sms-opt-in-confirmed.png"',
    "Text me alerts from Louisiana Helpr about my jobs, offers and new messages at this number.",
    "Consent is not a condition of using Louisiana Helpr.",
    'href="/terms/full"',
    'href="/privacy/full"',
  ],
};

/** One page's body as static markup: an <article> with the page's H1 and its own body component. */
function renderStaticPage(path: StaticPagePath): string {
  const { title, Body } = STATIC_PAGES[path];
  // No query ever runs during a static render; a row that reads one (the Terms' setup-fee row) renders its
  // no-number wording, as it does while loading.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <article id="static-page" data-static-page={path} className="px-5 sm:px-8 lg:px-12 py-6 bg-premium-page font-sans text-foreground">
          <h1 className="page-measure mx-auto mb-4 text-page-title leading-tight">{title}</h1>
          <Body />
        </article>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export function renderStaticPages(): Record<StaticPagePath, string> {
  return Object.fromEntries(STATIC_PAGE_PATHS.map((p) => [p, renderStaticPage(p)])) as Record<StaticPagePath, string>;
}

/** The paths whose markup is missing a required string (empty = all good). */
export function staticPageGaps(pages: Record<string, string>): string[] {
  const gaps: string[] = [];
  for (const p of STATIC_PAGE_PATHS) {
    const html = pages[p] ?? "";
    for (const s of STATIC_PAGE_MUST_SAY[p]) if (!html.includes(s)) gaps.push(`${p}: missing ${JSON.stringify(s)}`);
  }
  return gaps;
}
