import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { guideBySlug } from "@/content/giftGuideCatalog";
import { SAMS_BF_SLUG, SAMS_BF_WORDS as W, SAMS_MEMBERSHIP } from "@/content/samsClubBlackFriday1125";
import { GiftOut } from "./GiftOut";

/**
 * The two pieces the Sam's Club Black Friday deals guide adds (owner 2026-11-25 ~4:55 PM; src/content/samsClubBlackFriday1125.ts):
 *  - SamsJoinCard: first on the guide, because the deals are for members only: the membership prices and a "Join Sam's
 *    Club" button (our Later link to the Sam's Club join page), then the sale's dates;
 *  - SamsBlackFridayFeature: the card on the Black Friday page that opens the guide, with the guide's green cover.
 * Plain markup and a few CSS rules (no new script on the guide page's first paint, Q178).
 * Guard: src/test/samsClubBlackFriday1125.test.tsx.
 */
const SAMS_CSS = `
.gg-sams-join{display:flex;flex-direction:column;gap:6px;margin:4px 0 14px;padding:14px;border-radius:14px;border:1px solid var(--gg-line);background:hsl(var(--card));color:var(--gg-ink)}
.gg-sams-join small{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gg-muted)}
.gg-sams-join h2{margin:0;font-size:18px;line-height:1.25;font-weight:700}
.gg-sams-join p{margin:0;font-size:14px;line-height:1.45}
.gg-sams-join .gg-sams-dates{font-size:13px;color:var(--gg-muted)}
.gg-sams-join a{align-self:flex-start;display:inline-flex;align-items:center;min-height:44px;margin-top:4px;padding:0 18px;border-radius:999px;background:hsl(var(--bark));color:#fff;font-weight:700;font-size:15px;text-decoration:none}
.gg-sams-feature{display:flex;align-items:center;gap:14px;margin:4px 0 14px;padding:12px;border-radius:14px;border:1px solid var(--gg-line);background:hsl(var(--card));color:var(--gg-ink);text-decoration:none}
.gg-sams-feature img{width:88px;height:88px;flex:none;border-radius:10px;object-fit:cover}
.gg-sams-feature b{display:block;font-size:16px}
.gg-sams-feature span{display:block;font-size:13px;color:var(--gg-muted);margin-top:2px}
.gg-sams-feature i{display:inline-flex;align-items:center;min-height:36px;margin-top:6px;padding:0 14px;border-radius:999px;background:hsl(var(--bark));color:#fff;font-style:normal;font-weight:700;font-size:13px}
`;

/** The "Join Sam's Club" card at the top of the Sam's Club Black Friday guide. */
export function SamsJoinCard() {
  return (
    <section className="gg-sams-join" aria-labelledby="gg-sams-join-title" data-gift-sams-join="">
      <style>{SAMS_CSS}</style>
      <small>{W.joinKicker}</small>
      <h2 id="gg-sams-join-title">{W.joinTitle}</h2>
      <p>{W.joinLine}</p>
      <p className="gg-sams-dates" data-gift-sams-dates="">{W.dates}</p>
      <GiftOut href={SAMS_MEMBERSHIP.href} data-gift-sams-join-link="">
        {W.joinCta} ›<span className="sr-only"> ({G.newTab})</span>
      </GiftOut>
    </section>
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
        {g.cover && <img loading="lazy" decoding="async" src={g.cover} alt="" width={88} height={88} />}
        <span>
          <b>{W.featureTitle}</b>
          <span>{W.featureLine}</span>
          <i aria-hidden="true">{W.featureCta} ›</i>
        </span>
      </Link>
    </>
  );
}
