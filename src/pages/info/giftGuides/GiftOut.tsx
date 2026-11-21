import type { ReactNode } from "react";
import { track } from "@/lib/analytics";

/**
 * The one place a /gift-guides outbound link is drawn, so none can miss the rel or the new tab. Every outbound link is
 * an affiliate (or affiliate-holding) link: it is marked sponsored + noopener and opens a new tab. The scheme is fixed here, not by
 * the content file: whatever a value starts with, the link is https.
 * Each open (click, or a middle-click to a new tab) logs one "gift_out_click" with the link, our only record of which
 * picks people open: scripts/gift-guide-earn-rank.mjs ranks the guides' default order from it (lead 11-21).
 */
export function GiftOut({ href, className, children, ...data }: { href: string; className?: string; children: ReactNode } & Record<`data-${string}`, string>) {
  const url = `https://${href.replace(/^https:\/\//, "")}`;
  const opened = () => track("gift_out_click", { href: url });
  return (
    <a href={url} onClick={opened} onAuxClick={(e) => { if (e.button === 1) opened(); }} target="_blank" rel="sponsored noopener" className={className} data-gift-out="" {...data}>
      {children}
    </a>
  );
}
