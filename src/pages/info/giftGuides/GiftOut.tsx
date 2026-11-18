import type { ReactNode } from "react";

/**
 * The one place a /gift-guides outbound link is drawn, so none can miss the rel or the new tab. Every outbound link is
 * an affiliate (or affiliate-holding) link: it is marked sponsored + noopener and opens a new tab. The scheme is fixed here, not by
 * the content file: whatever a value starts with, the link is https.
 */
export function GiftOut({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={`https://${href.replace(/^https:\/\//, "")}`} target="_blank" rel="sponsored noopener" className={className} data-gift-out="">
      {children}
    </a>
  );
}
