import { PolicyFullTextContext } from "@/components/policy/CollapsedPolicy";
import { TermsContent } from "./TermsSection";
import { PrivacyContent } from "./PrivacySection";

/**
 * The body of /terms/full and /privacy/full: the SAME TermsContent / PrivacyContent that /legal shows, with
 * PolicyFullTextContext set, so every section and item is open, no accordion. Used by the page (LegalFullText.tsx)
 * AND by the build-time prerender (src/prerender/staticPages.tsx), so the text a crawler gets without JavaScript is
 * the text the app renders. Kept free of page chrome (no PublicLayout, auth or navbar) for that reason.
 */
export const LEGAL_FULL_TEXT_DOCS = {
  terms: { path: "/terms/full", title: "Terms of Service", back: "/terms", Content: TermsContent },
  privacy: { path: "/privacy/full", title: "Privacy Policy", back: "/privacy", Content: PrivacyContent },
} as const;

export type LegalFullTextDoc = keyof typeof LEGAL_FULL_TEXT_DOCS;

export function LegalFullTextBody({ doc }: { doc: LegalFullTextDoc }) {
  const { Content } = LEGAL_FULL_TEXT_DOCS[doc];
  return (
    <div className="page-measure mx-auto" data-legal-full-text={doc}>
      <PolicyFullTextContext.Provider value={true}>
        <Content />
      </PolicyFullTextContext.Provider>
    </div>
  );
}
