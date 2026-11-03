import { FAQ_SECTIONS } from "./helpCenterContent";

/**
 * The Help Center and the Terms (as /terms/full renders them; the test passes that text in) as plain text, the ONLY source the support AI may answer
 * from (supabase/functions/support-ai-answer). Edge functions cannot import
 * src/, so the text is written to supabase/functions/_shared/helpKnowledge.ts
 * and src/test/supportAiHelpKnowledge.test.tsx fails when that copy differs from
 * what the Help Center shows today (UPDATE_HELP_KNOWLEDGE=1 rewrites it).
 */
export function helpKnowledgeText(termsText: string): string {
  const faq = FAQ_SECTIONS.map((section) =>
    [`## ${section.topic}`, ...section.items.map((item) => `Q: ${item.q}\nA: ${item.a}`)].join("\n\n"),
  ).join("\n\n");
  return `# Help Center\n\n${faq}\n\n# Terms of Service (summary and full text)\n\n${termsText}`;
}

/** The generated module's whole source, byte for byte. */
export function helpKnowledgeModule(termsText: string): string {
  return `// GENERATED from src/pages/info/helpCenter/helpCenterContent.ts and the Terms (/terms/full) by
// src/test/supportAiHelpKnowledge.test.tsx (UPDATE_HELP_KNOWLEDGE=1). Do not edit by hand:
// change the Help Center, then regenerate. The support AI answers ONLY from this text.
export const HELP_KNOWLEDGE = ${JSON.stringify(helpKnowledgeText(termsText))};
`;
}
