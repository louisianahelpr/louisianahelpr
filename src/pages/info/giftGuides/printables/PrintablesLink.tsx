import { Link } from "react-router-dom";
import { PRINTABLES_WORDS as W, printablePath, printablesForGuide } from "@/content/printables";

/**
 * On a gift guide (owner 2026-11-20): a link to each free printable that names this guide in its `guides` and is
 * switched on (Gift Wrap & Cards: the gift tags; Teachers and Healthcare: the thank-you cards; the food guides: the
 * recipe cards, once each is ready). Nothing when none is. Guard: src/test/printables1120.test.tsx.
 */
export function PrintablesLink({ slug }: { slug: string }) {
  const list = printablesForGuide(slug);
  if (!list.length) return null;
  return (
    <p className="m-0 mb-2 flex flex-wrap gap-x-4">
      {list.map((p) => (
        <Link key={p.id} to={printablePath(p)} className="gg-link" data-gift-printable-link={p.id}>
          {W.guideLink(p.title)} ›
        </Link>
      ))}
    </p>
  );
}
