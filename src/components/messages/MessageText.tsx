import { Fragment } from "react";
import { Link } from "react-router-dom";

/**
 * A chat message's plain text. A long unbroken word wraps instead of leaving the bubble, and a link to Louisiana Helpr
 * itself can be tapped (Messages audit L1, L2). Only our own domain: other sites stay plain text, so a stranger's message
 * can never hand the reader a tappable link off the app. The link is rebuilt from the parsed path, never from the raw
 * text. Guard: src/components/messages/MessageText.test.tsx.
 */
const OWN_LINK = /(?<![\w/.@-])(?:https?:\/\/)?(?:www\.)?louisianahelpr\.com(?![.-]?\w)(?:\/[^\s<>"']*)?/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/** The in-app path for a link to our own domain, or null when the text is not really one. */
export function ownLinkPath(raw: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.hostname !== "louisianahelpr.com" && url.hostname !== "www.louisianahelpr.com") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { // new URL throws on a malformed address: it is plain text, not a link.
    return null;
  }
}

export function MessageText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(OWN_LINK)) {
    const start = m.index ?? 0;
    const raw = m[0].replace(TRAILING_PUNCTUATION, "");
    const path = ownLinkPath(raw);
    if (!path) continue;
    parts.push(<Fragment key={`t${start}`}>{text.slice(at, start)}</Fragment>);
    parts.push(<Link key={`l${start}`} to={path} className="underline hover:no-underline">{raw}</Link>);
    at = start + raw.length;
  }
  parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <p className="[overflow-wrap:anywhere]">{parts}</p>;
}
