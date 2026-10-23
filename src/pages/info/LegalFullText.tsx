import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { LEGAL_FULL_TEXT_DOCS, LegalFullTextBody, type LegalFullTextDoc } from "./legal/LegalFullTextBody";

/**
 * THE TERMS AND THE PRIVACY POLICY AS ONE PLAIN DOCUMENT EACH (owner, 2026-10-23: Twilio's A2P review opens the
 * linked policy and must find the SMS Terms and the "we do not sell or share your SMS opt-in data" sentence without
 * tapping anything). The body is LegalFullTextBody (every section open, no accordion); the accordion pages (/terms,
 * /privacy, /legal) are unchanged. The same body is prerendered into the raw HTML at build time
 * (scripts/prerender-static-pages.mjs) for readers that run no JavaScript.
 * Guards: src/test/legalFullText.test.tsx, src/test/staticPagesRawHtml.test.ts.
 */
export default function LegalFullText({ doc }: { doc: LegalFullTextDoc }) {
  const { path, title, back } = LEGAL_FULL_TEXT_DOCS[doc];
  usePageMeta(PUBLIC_PAGE_META[path]);
  return (
    <PublicHeaderPage title={title} backTo={back} bottomPaddingClassName="pb-8">
      <LegalFullTextBody doc={doc} />
    </PublicHeaderPage>
  );
}
