import { useState } from "react";
import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";

/**
 * One 25 Days sponsor's tile (round logo or initials, name under it). The landing's scrolling logo row that used it is
 * gone (owner 2026-11-21: "move 25 day sponsors to the left panel too and remove from main screen"; knip then flagged
 * the row unused, so it was deleted). Guard: src/test/giftGuideSponsorTileName.test.tsx.
 */
export interface SponsorLogo { name: string; slug: string; logo?: string; href: string; external?: boolean; dark?: boolean; group?: "la" | "us" }

/** "Le Petit Theatre" -> "LP"; "aosu" -> "A". */
const initials = (name: string) => name.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function Logo({ s }: { s: SponsorLogo }) {
  const [ok, setOk] = useState(true);
  return (
    <span className={s.dark ? "gg-spons-logo is-dark" : "gg-spons-logo"} aria-hidden="true">
      {s.logo && ok ? <img loading="lazy" decoding="async" src={s.logo} alt="" width={80} height={80} onError={() => setOk(false)} /> : <b>{initials(s.name)}</b>}
    </span>
  );
}

export function SponsorTile({ s }: { s: SponsorLogo }) {
  const body = (
    <>
      <Logo s={s} />
      <span className="gg-spons-name">{s.name}</span>
    </>
  );
  return (
    <li data-gift-sponsor={s.slug}>
      {s.external && /^https:\/\//.test(s.href) ? (
        // No aria-label: a sponsor with no logo shows its initials, and a label that left that visible text out failed
        // axe's label-content-name-mismatch on the landing (a11y sweep 11-20). The name comes from the content.
        <a href={s.href} target="_blank" rel="noopener noreferrer" className="gg-spons-a">{body}{" "}<span className="sr-only">({G.newTab})</span></a>
      ) : (
        <Link to={s.href.startsWith("/") ? s.href : G.sponsorRow.allHref} className="gg-spons-a">{body}</Link>
      )}
    </li>
  );
}
