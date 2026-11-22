import { useEffect, useState, type ComponentType } from "react";
import { useLocation } from "react-router-dom";
import { loadModule, untilReload } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import { giftGuides as G } from "@/content/giftGuides";
import { GUIDES, type CatalogGuide } from "@/content/giftGuideCatalog";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";
// The Facebook link alone, not the 25 Days page's words and reads (vite.config.ts sponsor-page-reads: ~46 KB gz off
// every guide page's critical path, 11-22).
import { LOUISIANA_HELPR_FACEBOOK } from "@/content/giftGuideConstants";
import { DEAL_DAY_SLUGS } from "@/content/giftGuideDeals.mjs";
import { CHUNK_PICK_COUNTS } from "@/content/giftGuidePicks";
import { EXTRAS_WORDS, FINDER_ANCHOR } from "@/content/giftGuideExtras1120";
import { GiftGuideTile } from "./GiftGuideTile";
import { GiftGuideTop10 } from "./GiftGuideTop10";

/**
 * OWNER 11-21 ~5:05 PM ("put the top 10 items back when you open the guide"): the "Top 10 gifts" row sits right under
 * the three tiles, above the 25 Days card (GiftGuideTop10.tsx; the list: src/content/giftGuideTop10.json).
 *
 * OWNER + LEAD 11-21 (supersedes the order below where they differ): the main column is the three tiles, sharing the
 * full width, each with a quiet "Her · 36 gifts" line and no heading over them; then the 25 Days giveaways card; nothing
 * else. The menu's "Find a gift" (or a shared finder link) shows the gift finder ALONE in the main column
 * (finderAsked; owner 11-21: "only the section I click in the left panel should be displayed"). The deals days, Free printables, the Holiday
 * Hub, the 25 Days sponsors and the fun tools are all in the left menu (owner: "i have already said free printables,
 * louisiana hub, sponsors go in the left panel ... and black friday deals, small business saturday and cyber monday"),
 * never in the main column.
 *
 * /gift-guides (owner 2026-11-21 2:47 AM: "launch the 3 guides remove the rest that are live ... should we jsut do him,
 * her and kids?"; after 11-20 PM's "The gift guide page is still a busy mess"): ONE title with its short subline and the
 * search row, a hairline across the page (GiftGuides.tsx), then, top to bottom: the three guides' cover tiles (For Her,
 * For Him, Kids); the 25 Days giveaways card (owner 11-21: "move the 25 days of giveaways up so people will see it
 * better"); the gift finder ("Find a gift") and the fun tools (Swipe, Secret Santa, Gift
 * planner; owner 11-21: "i also dont see the fun features anymore like the quiz"); the free printables and the deals
 * page as two cards ("there will also need to be a free section for our tags"; the codes themselves live only on the
 * deals page). The Holiday Hub and the 25 Days sponsors are entries in the left menu, not the main column (owner 11-21
 * ~12:05 PM: "move the holiday hub into the left column and remove it from the main holiday screen"; "move 25 day
 * sponsors to the left panel too and remove from main screen"; GiftGuidesSidebar.tsx). No Top 10, Gift of the Day, budget, store or color strips: they drew from the
 * retired guides (src/content/giftGuideLive.mjs). Guard: src/test/giftGuideOnlyThree1121.test.tsx.
 */

/** Live slugs that are pages, not guide tiles: the 25 Days sponsors page (a left-menu entry) and the deals days (left-menu entries). */
const NOT_TILES = new Set(["25-days-sponsors", ...DEAL_DAY_SLUGS]);

/** The landing's tiles: the live guides in the owner's order (Her, Him, Kids), each that holds picks. */
const liveGuideTiles = (): CatalogGuide[] =>
  LIVE_GUIDES_1121.filter((slug) => !NOT_TILES.has(slug)).flatMap((slug) => {
    const g = GUIDES.find((x) => x.slug === slug && !x.view);
    return g && !g.empty ? [g] : [];
  });

/** The first screen's covers load at once; there are only three. */
const PRIORITY_COVERS = 3;

function LiveGuides() {
  const tiles = liveGuideTiles();
  if (tiles.length === 0) return null;
  // Lead 11-21 landing polish: no visible "Browse the guides" heading (the tiles explain themselves; it stays for screen
  // readers), the three tiles share the full content width, each with a quiet "Her · 36 gifts" line under it.
  return (
    <section aria-labelledby="gift-browse" className="gg-browse" data-gift-browse="">
      <h2 id="gift-browse" className="sr-only">{G.browseTitle}</h2>
      <ul className="gg-wrap gg-wrap-three" data-gift-live-guides="">
        {tiles.map((g, i) => <GiftGuideTile key={g.slug} g={g} priority={i < PRIORITY_COVERS} count={CHUNK_PICK_COUNTS[g.slug]} />)}
      </ul>
    </section>
  );
}

/**
 * Whether the gift finder is asked for: the left menu's "Find a gift" (/gift-guides#gift-finder) or a shared
 * finder link (/gift-guides?who=her&budget=50&vibe=cozy). Otherwise the main column is only the tiles and the 25 Days
 * card (owner 11-21: the main column is ONLY the three tiles and the 25 Days card; the quiz is a fun tool in the menu).
 */
export const finderAsked = (search: string, hash: string) => hash === `#${FINDER_ANCHOR}` || new URLSearchParams(search).has("who");

/**
 * The gift quiz (#gift-finder or ?who=) loads its own chunk (train 1121h): drawn only on its own view, never on a guide
 * page, and with the quiz in it /gift-guides/<slug> measured 355 KB gz against its 352.8 KB budget. It says "Loading"
 * until the chunk is in, and says so plainly if the chunk fails.
 */
const loadFinder = () => loadModule(() => import("./GiftGuideFinder"));
/** Once loaded, a later visit to the quiz view draws it at once (no Loading flash on Start over or Back). */
let loadedFinder: ComponentType | null = null;
function LazyGiftFinder() {
  const [Finder, setFinder] = useState<ComponentType | null>(() => loadedFinder);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (loadedFinder) return;
    let live = true;
    // An empty module (a stale-chunk reload on its way) waits on untilReload(); the loading line stays meanwhile.
    void loadFinder()
      .then((m) => m ?? untilReload())
      .then(
        (m) => {
          loadedFinder = m.GiftFinder;
          if (live) setFinder(() => m.GiftFinder);
        },
        (e) => {
          // Not silent: reported, and the view says the quiz could not load.
          report(e as Error, { tags: { source: "GiftGuideLanding.loadFinder" } });
          if (live) setFailed(true);
        },
      );
    return () => {
      live = false;
    };
  }, []);
  if (failed) return <p className="gg-soon" role="alert">{EXTRAS_WORDS.finderLoadFailed}</p>;
  if (!Finder) return <p className="gg-soon" role="status">{EXTRAS_WORDS.finderLoading}</p>;
  return <Finder />;
}

export function GiftGuideLanding() {
  const { search, hash } = useLocation();
  // Owner 11-21: "if I click find a gift in 3 steps the guides shouldn't be opened up here. only the section I click in
  // the left panel should be displayed, nothing else": the finder view is the finder alone.
  if (finderAsked(search, hash)) return <div className="gg-landing" data-gift-landing="" data-gift-finder-view=""><LazyGiftFinder /></div>;
  return (
    <div className="gg-landing" data-gift-landing="">
      {/* Owner 11-21 (greeting mockup option B, "without gifts"): on the landing only, above the three guides, a cream
          card in a red-white-green candy-cane border: "Happy holidays, y'all" in the guides' Bodoni italic, one line
          under it. Words only; CSS only (no image). Guard: src/test/giftGuideGreeting1122.test.tsx. */}
      <div className="gg-greet" data-gift-greeting="">
        <div className="gg-greet-in">
          <p className="gg-greet-h">{G.greetTitle}</p>
          <p className="gg-greet-p">{G.greetLine}</p>
        </div>
      </div>
      <LiveGuides />
      <GiftGuideTop10 />
      {/* Owner 2026-11-18: the 25 Days card; owner 11-21 moved it up, right under the guides. App.tsx has no shopper
          giveaway page (/25days is the sponsors' page), so it links to the Facebook page the giveaways run on. */}
      <aside className="gg-helpr" aria-label={G.giveaways.title} data-gift-giveaways="">
        <div>
          <b>{G.giveaways.title}</b>
          <span>{G.giveaways.body}</span>
        </div>
        <a href={LOUISIANA_HELPR_FACEBOOK} target="_blank" rel="noopener noreferrer" className="gg-helpr-btn" data-gift-social="">{G.giveaways.cta}</a>
      </aside>
    </div>
  );
}
