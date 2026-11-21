import type { ReactNode } from "react";
import { track } from "@/lib/analytics";

/**
 * The outbound click's analytics props (holiday audit D H2, 11-20): the link's host and path, never its query or
 * fragment (an affiliate tag or a tracking id), so every Shop click is counted without any member data. The page it
 * was clicked on is the row's own `url` column (track() records the redacted pathname). Exported for its test.
 */
export function giftOutProps(href: string): { host: string; link: string } | null {
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\./, "");
    return { host, link: `${host}${u.pathname.replace(/\/+$/, "")}` };
  } catch {
    // Not a URL the browser can parse: the link still opens; it is just not counted.
    return null;
  }
}

/**
 * The one place a /gift-guides outbound link is drawn, so none can miss the rel or the new tab. Every outbound link is
 * an affiliate (or affiliate-holding) link: it is marked sponsored + noopener and opens a new tab. The scheme is fixed here, not by
 * the content file: whatever a value starts with, the link is https.
 *
 * Each click queues ONE gift_out_click analytics row (holiday audit D H2): track() only buffers it, never waits on the
 * network and never cancels the link, and the batch goes out when the new tab hides this page (analytics.ts flushes on
 * visibilitychange). scripts/gift-guide-picks.mjs ranks the landing's Top 10 by these counts.
 */
export function GiftOut({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const url = `https://${href.replace(/^https:\/\//, "")}`;
  return (
    <a href={url} target="_blank" rel="sponsored noopener" className={className} data-gift-out=""
      onClick={() => {
        const props = giftOutProps(url);
        if (props) track("gift_out_click", props);
      }}>
      {children}
    </a>
  );
}
