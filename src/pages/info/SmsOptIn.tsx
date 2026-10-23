import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { SMS_OPT_IN_TITLE, SmsOptInBody } from "./SmsOptInBody";

/**
 * HOW TO OPT IN TO LOUISIANA HELPR TEXT ALERTS (owner, 2026-10-23: Twilio's A2P 10DLC campaign form needs a public
 * link to the opt-in, not an upload). A public page on the shared PublicHeaderPage shell; the body is SmsOptInBody,
 * which the build also prerenders into the raw HTML (scripts/prerender-static-pages.mjs) for readers that run no
 * JavaScript. Guards: src/test/smsOptInPage.test.tsx, src/test/staticPagesRawHtml.test.ts.
 */
export default function SmsOptIn() {
  usePageMeta(PUBLIC_PAGE_META["/sms-opt-in"]);
  return (
    <PublicHeaderPage title={SMS_OPT_IN_TITLE} backTo="/" wrapTitle bottomPaddingClassName="pb-8">
      <SmsOptInBody />
    </PublicHeaderPage>
  );
}
