import { Link } from "react-router-dom";
import { searchPageBySlug, searchPageSiblings, searchPagesOf } from "@/content/guideSearchPages.mjs";
import { searchBackLink } from "@/content/guideSearchView";

// The search pages' chunk (loaded by GiftGuides.tsx, never on a guide page's first paint): the page view and head too.
export { searchGuide, searchNeedsTags } from "@/content/guideSearchView";
export { searchPageBySlug, searchPageMeta } from "@/content/guideSearchPages.mjs";

/**
 * Search pages (owner 2026-11-23, "add a lot of different searches so it's seen a lot more"): no menu or header entry.
 *   - A main guide (Her, Him, Kids) ends with one small "Popular searches" line of plain links to its search pages
 *     (the owner can remove it later).
 *   - A search page ends with its intro (never under the banner: owner 11-18, no subtitle under a title), the link back
 *     to its full guide and its sibling searches.
 * Same small type as "Also sponsoring" (gg-also). Guard: src/test/guideSearchPages1123.test.ts.
 */
const POPULAR_SEARCHES = "Popular searches";
const MORE_SEARCHES = "More gift searches";

function SearchList({ title, pages }: { title: string; pages: { slug: string; h1: string }[] }) {
  if (!pages.length) return null;
  return (
    <section className="gg-also gg-searches" aria-labelledby="gift-searches-h" data-gift-searches="">
      <h2 id="gift-searches-h" className="gg-also-h">{title}</h2>
      <ul className="gg-also-list">
        {pages.map((p) => <li key={p.slug}><Link to={`/gift-guides/${p.slug}`} data-gift-search-link={p.slug}>{p.h1}</Link></li>)}
      </ul>
    </section>
  );
}

/** The bottom of a guide page: a main guide's Popular searches, or a search page's intro, way back and siblings. */
export function GuideSearchLinks({ slug }: { slug: string }) {
  const page = searchPageBySlug(slug);
  if (!page) return <SearchList title={POPULAR_SEARCHES} pages={searchPagesOf(slug)} />;
  const back = searchBackLink(page);
  return (
    <>
      <div className="gg-also" data-gift-search-about="">
        <p className="gg-search-intro">{page.intro}</p>
        <Link to={back.href} className="gg-link" data-gift-search-back="">{back.label}</Link>
      </div>
      <SearchList title={MORE_SEARCHES} pages={searchPageSiblings(page)} />
    </>
  );
}

// Lead 11-24: on a phone the shared "·" (giftGuidesStyles.ts, before every item but the first) began each wrapped line.
// Here the dot trails each item but the last, inside its item, on a wrapping row: a wrapped line starts with a link.
// Polish audit 1127 #144: the trailing dot then sat at the end of most wrapped lines. No separator now: a wrapping row
// of links 12px apart, rows 4px apart. Guard: src/test/guideSearchLinksWrap1124.test.ts.
export const GUIDE_SEARCH_CSS = `
.gg-searches{margin-top:24px}
.gg-searches .gg-also-list{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
.gg-searches .gg-also-list li+li::before{content:none}
.gg-also-list a{display:inline-block;padding:4px 0;color:var(--gg-olive);text-decoration:none}
.gg-also-list a:hover,.gg-also-list a:focus-visible{text-decoration:underline}
.gg-search-intro{margin:0;max-width:60ch;font-size:14px;line-height:1.55;color:var(--gg-muted)}
`;
