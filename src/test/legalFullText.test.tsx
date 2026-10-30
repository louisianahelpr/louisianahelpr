/**
 * /terms/full AND /privacy/full: THE WHOLE POLICY, OPEN ON LOAD (owner, 2026-10-23, for Twilio's A2P review, which
 * opens the linked policy and must find the SMS Terms and the SMS opt-in sentence without tapping anything).
 *
 * The full pages render the SAME TermsContent / PrivacyContent as the accordion (/terms, /privacy, /legal), with
 * PolicyFullTextContext set. This checks, per document:
 *   - the full page has no accordion: no trigger button, nothing collapsed, no aria-expanded;
 *   - every section and every item the accordion has (opened one section at a time) is on the full page, by title,
 *     with no extras, so the two can never list different things;
 *   - the exact Twilio wording is in the full page's text;
 * and that both routes, their own heads and their rewrites are registered.
 *
 * @mutate src/pages/info/legal/LegalFullTextBody.tsx | <PolicyFullTextContext.Provider value={true}> | <PolicyFullTextContext.Provider value={false}>
 * @mutate src/components/policy/CollapsedPolicy.tsx | <h2 className="m-0 font-sans font-bold text-foreground leading-tight text-ds-15">{title}</h2> | <h2 className="m-0 font-sans font-bold text-foreground leading-tight text-ds-15">{subtitle}</h2>
 * @mutate src/components/policy/CollapsedPolicy.tsx |         <h3 className="m-0 flex items-center gap-2.5 | <h4 className="m-0 flex items-center gap-2.5
 * @mutate src/App.tsx |       <Route path="/privacy/full" element= |       <Route path="/privacy/fulltext" element=
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null })); // Its top bar's Help needs the app's providers.
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
// The setup-fee row reads platform_settings; null is its loading state (the row then quotes no number).
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useOnboardingFee")>()),
  useOnboardingFeeCents: () => null,
}));

import { LegalFullTextBody } from "@/pages/info/legal/LegalFullTextBody";
import LegalFullText from "@/pages/info/LegalFullText";
import { TermsContent } from "@/pages/info/legal/TermsSection";
import { PrivacyContent } from "@/pages/info/legal/PrivacySection";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
afterEach(cleanup);

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** The full page's own body (LegalFullTextBody), the one the route and the build-time prerender render. */
function renderFull(doc: "terms" | "privacy") {
  return render(
    <MemoryRouter>
      <LegalFullTextBody doc={doc} />
    </MemoryRouter>,
  );
}

/** The accordion, every section opened in turn: [section heading text, item titles]. */
function accordionTitles(content: ReactElement): { sections: string[]; rows: string[] } {
  const { container, unmount } = render(<MemoryRouter>{content}</MemoryRouter>);
  const sections = [...container.querySelectorAll("[data-policy-section]")];
  const headings = sections.map((s) => text(s.querySelector("h2")!));
  const rows: string[] = [];
  for (const s of sections) {
    fireEvent.click(within(s.querySelector("h2") as HTMLElement).getByRole("button"));
    const rowButtons = [...s.querySelectorAll("button")].filter((b) => !b.closest("h2"));
    rows.push(...rowButtons.map(text));
  }
  unmount();
  return { sections: headings, rows };
}

const DOCS = [
  {
    doc: "terms" as const,
    content: <TermsContent />,
    path: "/terms/full" as const,
    h1: "Terms of Service",
    mustSay: [
      "SMS Terms",
      "Louisiana Helpr text alerts are optional.",
      "Message frequency varies.",
      "Message and data rates may apply.",
      "Reply STOP to cancel or HELP for help",
      "Carriers are not liable for delayed or undelivered messages.",
    ],
  },
  {
    doc: "privacy" as const,
    content: <PrivacyContent />,
    path: "/privacy/full" as const,
    h1: "Privacy Policy",
    mustSay: [
      "Louisiana Helpr",
      "We do not sell or share your SMS opt-in data or personal information with third parties for marketing purposes.",
    ],
  },
];

describe("/terms/full and /privacy/full show the whole policy, open on load", () => {
  for (const d of DOCS) {
    it(`${d.path}: the page (the route's element) is titled "${d.h1}" and mounts the full-text body`, async () => {
      const { container, findByRole } = render(<MemoryRouter><LegalFullText doc={d.doc} /></MemoryRouter>);
      expect((await findByRole("heading", { level: 1 })).textContent).toBe(d.h1);
      expect(container.querySelectorAll(`[data-legal-full-text="${d.doc}"]`).length).toBe(1);
    });

    it(`${d.path}: nothing to tap, nothing collapsed`, () => {
      const { container } = renderFull(d.doc);
      expect(container.querySelectorAll("[data-policy-section]").length).toBeGreaterThan(4);
      expect(container.querySelectorAll("[aria-expanded]").length).toBe(0);
      expect(container.querySelectorAll('[data-state="closed"]').length).toBe(0);
      expect(container.querySelectorAll("h2 button, h3 button").length).toBe(0);
    });

    it(`${d.path}: every section and item the accordion has, and no other`, () => {
      const acc = accordionTitles(d.content);
      expect(acc.rows.length).toBeGreaterThan(10);
      const { container } = renderFull(d.doc);
      const fullSections = [...container.querySelectorAll("[data-policy-section] h2")].map(text);
      const fullRows = [...container.querySelectorAll("[data-policy-row] h3")].map(text);
      expect(fullSections.length).toBe(acc.sections.length);
      fullSections.forEach((title, i) => expect(acc.sections[i].startsWith(title), `${acc.sections[i]} / ${title}`).toBe(true));
      expect(fullRows).toEqual(acc.rows);
    });

    it(`${d.path}: carries the exact SMS wording Twilio looks for`, () => {
      const { container } = renderFull(d.doc);
      const all = text(container);
      for (const s of d.mustSay) expect(all, s).toContain(s);
    });

    it(`${d.path}: a public route titled "${d.h1}", with its own head and rewrite`, () => {
      const app = read("src/App.tsx");
      expect(app).toContain(`<Route path="${d.path}" element={<RouteErrorBoundary>{routeEl(<PageTransition><LegalFullText doc="${d.doc}" />`);
      expect(read("src/pages/info/legal/LegalFullTextBody.tsx")).toContain(`path: "${d.path}", title: "${d.h1}"`);
      expect(PUBLIC_PAGE_META[d.path].canonical).toBe(`https://www.louisianahelpr.com${d.path}`);
      const vercel = JSON.parse(read("vercel.json")) as { rewrites: { source: string; destination: string }[] };
      expect(vercel.rewrites.find((r) => r.source === d.path)?.destination).toBe(`/api/share?_og=page&_id=${d.path.slice(1)}`);
    });
  }
});
