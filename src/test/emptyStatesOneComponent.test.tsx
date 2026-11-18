/**
 * M5 (iOS design audit 11-16): empty states came in four looks. Two of them were outliers: Declutter's lists drew
 * their own dashed card with a square tile (DeclutterEmptyCard, and Selling's "no match" box beside it), and Buying's
 * only way back to shopping was a bare underlined link. Every empty state now comes through the shared EmptyState:
 * the full variants for a page, `compact` for one list among several, and its action is a real button.
 *
 * Inventory from source: every non-test .tsx under src/components/declutter (git index, comments blanked). An offender
 * is a `border-dashed` box in a file that marks an empty list (a data-*-empty attribute) outside the photo pickers, or
 * the Buying link without a Button around it. Plus a render of DeclutterEmptyCard: the shared compact card, no dash.
 *
 * @mutate src/components/declutter/DeclutterEmptyCard.tsx |       <EmptyState variant="compact" icon={icon} title={title} body={children} action={action} /> |       <div className="border-dashed"><p>{title}</p>{children}{action}</div>
 * @mutate src/components/declutter/DeclutterMineViews.tsx |           <Button asChild variant="outline" size="sm" className="rounded-full">\n            <Link to="/declutter" data-ended-browse="">{t("decl.mv.findBrowse")}</Link>\n          </Button> |           <Link to="/declutter" data-ended-browse="">{t("decl.mv.findBrowse")}</Link>
 * @mutate src/components/declutter/DeclutterHomeView.tsx |         <DeclutterEmptyCard icon={Search} title={t("decl.sl.noMatch", { q: search.trim() })} |         <div className="border-dashed" /><DeclutterEmptyCard icon={Search} title={t("decl.sl.noMatch", { q: search.trim() })}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { Tags } from "lucide-react";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { DeclutterEmptyCard } from "@/components/declutter/DeclutterEmptyCard";

const DIR = "src/components/declutter";
// The photo pickers' "add a photo" squares are drop targets, not empty states.
const NOT_EMPTY_STATES = new Set(["DeclutterBunchPhotos.tsx", "DeclutterSellPhotos.tsx", "DeclutterSuggestedReply.tsx", "DeclutterBundleRow.tsx", "DeclutterBundleRequests.tsx"]);
const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
const code = (f: string) => blankComments(readFileSync(join(DIR, f), "utf8"));

describe("empty states are one component (M5)", () => {
  it("inventory: the Declutter components are read", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("no Declutter empty list draws its own dashed card", () => {
    const offenders = files.filter((f) => !NOT_EMPTY_STATES.has(f) && /border-dashed/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("DeclutterEmptyCard renders the shared EmptyState's compact card", () => {
    const { container } = render(<DeclutterEmptyCard icon={Tags} title="Nothing sold yet" data-seller-empty="">Sold items show here.</DeclutterEmptyCard>);
    expect(container.querySelector('[data-seller-empty] [data-empty-state="compact"]')).not.toBeNull();
    expect(container.querySelector('[data-empty-title]')?.textContent).toBe("Nothing sold yet");
    expect(container.innerHTML).not.toContain("border-dashed");
  });

  it("Buying's way back to shopping is a button, not a bare underlined link", () => {
    const mine = code("DeclutterMineViews.tsx");
    expect(mine).toMatch(/<Button asChild variant="outline"[^>]*>\s*<Link to="\/declutter" data-ended-browse="">/);
    expect(mine).not.toMatch(/data-ended-browse=""[^>]*underline/);
  });
});
