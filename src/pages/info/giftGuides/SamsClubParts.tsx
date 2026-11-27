import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { guideBySlug } from "@/content/giftGuideCatalog";
import { SAMS_BF_SLUG, SAMS_BF_WORDS as W, SAMS_MEMBERSHIP } from "@/content/samsClubBlackFriday1125";
import { GiftOut } from "./GiftOut";

/**
 * The two pieces the Sam's Club Black Friday deals guide adds (owner 2026-11-25 ~4:55 PM; src/content/samsClubBlackFriday1125.ts):
 *  - SamsJoinCard: first on the guide, because the deals are for members only: one line with the membership prices, the
 *    sale's days and a "Join" text link (our Later link to the Sam's Club join page) (polish audit 1127 #92);
 *  - SamsBlackFridayFeature: the one-row link on the Black Friday page that opens the guide (polish audit 1127 #96).
 * Plain markup and a few CSS rules (no new script on the guide page's first paint, Q178).
 * Guard: src/test/samsClubBlackFriday1125.test.tsx.
 */
const SAMS_CSS = `
/* Polish audit 1127 #96: the Black Friday page's Sam's Club link is one 56px row (15px/600 ink, a chevron), 16px under
   the cover; no thumbnail, body line or pill (its title looked disabled and its ~5px mini-cover was unreadable). */
.gg-sams-feature{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px;margin:16px 0;padding:0 16px;border-radius:14px;border:1px solid var(--gg-line);background:hsl(var(--card));color:var(--gg-ink);font-size:15px;font-weight:600;text-decoration:none}
.gg-sams-feature:hover,.gg-sams-feature:focus-visible{text-decoration:underline}
/* Polish audit 1127 #92: the guide's members-only note is one 14px cream line with "Join" a text link (was a 280px card
   with a second olive pill on the first screen). */
.gg-sams-tip{margin:4px 0 16px;padding:10px 12px;border-radius:10px;background:#F6F3EC;font-size:14px;line-height:1.45;color:var(--gg-ink)}
.gg-sams-tip a{color:var(--gg-olive);font-weight:700;text-decoration:underline;text-underline-offset:3px}
`;

/** The "Join Sam's Club" card at the top of the Sam's Club Black Friday guide. */
export function SamsJoinCard() {
  return (
    <>
      <style>{SAMS_CSS}</style>
      <p className="gg-sams-tip" data-gift-sams-join="">
        {W.tip}{" "}
        <GiftOut href={SAMS_MEMBERSHIP.href} data-gift-sams-join-link="">
          {W.joinShort} ›<span className="sr-only"> ({G.newTab})</span>
        </GiftOut>
      </p>
    </>
  );
}

/** The card on the Black Friday page that opens the Sam's Club guide (while the guide is live). */
export function SamsBlackFridayFeature() {
  const g = guideBySlug(SAMS_BF_SLUG);
  if (!g) return null;
  return (
    <>
      <style>{SAMS_CSS}</style>
      <Link to={`/gift-guides/${SAMS_BF_SLUG}`} className="gg-sams-feature" data-gift-sams-feature="">
        <span>{W.featureTitle}</span>
        <span aria-hidden="true">›</span>
      </Link>
    </>
  );
}
