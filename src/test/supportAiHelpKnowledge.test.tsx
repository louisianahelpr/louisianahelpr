import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { LegalFullTextBody } from "@/pages/info/legal/LegalFullTextBody";
import { FAQ_SECTIONS } from "@/pages/info/helpCenter/helpCenterContent";
import { helpKnowledgeModule } from "@/pages/info/helpCenter/helpKnowledgeText";

// The support AI (support-ai-answer) answers only from the Help Center. Edge
// functions cannot import src/, so it reads a generated copy; a stale copy would
// have it answer from Help text we no longer show (owner 2026-11-03, B70).
// @mutate supabase/functions/_shared/helpKnowledge.ts | ## Getting Started | ## Getting Going
const GENERATED = resolve(process.cwd(), "supabase/functions/_shared/helpKnowledge.ts");

/**
 * The Terms as /terms/full renders them (every section open), as plain text. Rendered with no data loaded, so a
 * DB-read figure (the setup fee) reads as the page's honest no-number wording, never a stale number.
 */
function termsText(): string {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><LegalFullTextBody doc="terms" /></MemoryRouter>
    </QueryClientProvider>,
  );
  const el = document.createElement("div");
  el.innerHTML = html.replace(/<\/(p|li|h[1-6]|div|tr|summary)>|<br\s*\/?>/g, "$&\n");
  return (el.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

describe("support AI Help Center copy", () => {
  it("matches what the Help Center shows today", () => {
    const want = helpKnowledgeModule(termsText());
    if (process.env.UPDATE_HELP_KNOWLEDGE === "1") writeFileSync(GENERATED, want);
    expect(readFileSync(GENERATED, "utf8")).toBe(want);
  });

  it("carries the Terms' full text, not only its summary", () => {
    const text = readFileSync(GENERATED, "utf8");
    expect(text).toContain("Terms of Service");
    expect(text).toContain("independent contractors");
    expect(text.length).toBeGreaterThan(30_000);
  });

  it("carries every Help Center question", () => {
    const text = readFileSync(GENERATED, "utf8");
    const questions = FAQ_SECTIONS.flatMap((s) => s.items.map((i) => i.q));
    expect(questions.length).toBeGreaterThan(20);
    for (const q of questions) expect(text).toContain(JSON.stringify(q).slice(1, -1));
  });
});
