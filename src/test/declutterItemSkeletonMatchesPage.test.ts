/**
 * THE ITEM PAGE'S LOADING FRAME IS THE ITEM PAGE'S OWN SHAPE (Q1837).
 *
 * loading-states-refresh 41949893912 (2026-11-05 02:01Z, helper, its own draft
 * item) measured /declutter/item/:id at row 208px -> 44px, 3 -> 2 rows: the
 * skeleton painted a visible "Item" title in an unpinned header where the page
 * has back + help only, pinned, and two 80%-wide photo bones where the page
 * shows one full-width square. Read from source: the class is "the skeleton's
 * AppPage header props and photo frame drift from the page's".
 *
 * @mutate src/components/declutter/DeclutterSkeletons.tsx | <AppPage title="Item" backTo="/declutter" phoneHidesTitle hidesTitle stickyHeader> | <AppPage title="Item" backTo="/declutter">
 * @mutate src/components/declutter/DeclutterSkeletons.tsx | <AppPage title="Item" backTo="/declutter" phoneHidesTitle hidesTitle stickyHeader> | <AppPage title="Item" backTo="/declutter" phoneHidesTitle hidesTitle>
 * @mutate src/components/declutter/DeclutterSkeletons.tsx |           <Skeleton className={`${ITEM_PHOTO_FRAME_BASE} ${ITEM_PHOTO_ASPECT.item}`} /> |           <Skeleton className="shrink-0 w-[80%] max-w-sm aspect-square rounded-2xl bg-photo-empty" />
 * @mutate scripts/audit/measure-loading-states.mjs | !e.closest("[data-sonner-toaster]") && !e.closest(".sticky-title-row")) | !e.closest("[data-sonner-toaster]"))
 * @mutate src/components/declutter/DeclutterSkeletons.tsx | <Skeleton className="h-52 w-full rounded-2xl" style={{ minHeight: reserve }} aria-hidden /> | <Skeleton className="h-52 w-full rounded-2xl" aria-hidden />
 * @mutate src/hooks/useScreenfulBelow.ts | Math.round(window.innerHeight - el.getBoundingClientRect().top) | 0
 * @mutate src/components/declutter/DeclutterGallery.tsx | const ASPECT = ITEM_PHOTO_ASPECT; | const ASPECT = { item: "aspect-square bg-photo-empty", banner: "aspect-[16/9] bg-photo-empty" } as const;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const HEADER_FLAGS = ["phoneHidesTitle", "hidesTitle", "stickyHeader", "wrapTitle"] as const;

/** The boolean header props on the first `<AppPage ...>` tag after `from`. */
const appPageFlags = (src: string, from: number) => {
  const start = src.indexOf("<AppPage", from);
  const tag = src.slice(start, src.indexOf(">", src.indexOf("title=", start)) + 1);
  return { start, flags: HEADER_FLAGS.filter((f) => new RegExp(`\\b${f}\\b`).test(tag)) };
};

describe("the Declutter item skeleton is the item page's shape (Q1837)", () => {
  const view = read("src/components/declutter/DeclutterItemView.tsx");
  const skeletons = read("src/components/declutter/DeclutterSkeletons.tsx");
  const fnStart = skeletons.indexOf("export function DeclutterItemSkeleton");
  const fn = skeletons.slice(fnStart, skeletons.indexOf("\n}\n", fnStart));

  it("wears the page's own header props", () => {
    const page = appPageFlags(view, view.indexOf("title={it.title}") - 200);
    expect(page.start, "DeclutterItemView's <AppPage title={it.title}> not found").toBeGreaterThan(0);
    expect(page.flags.length, "the item page sets its header props").toBeGreaterThan(1);
    const bone = appPageFlags(skeletons, fnStart);
    expect(fnStart, "DeclutterItemSkeleton not found").toBeGreaterThan(0);
    expect(bone.flags, "the skeleton's header must be the page's (title shown or not, pinned or not)").toEqual(page.flags);
  });

  it("draws ONE photo bone, in the gallery's own frame", () => {
    const bones = [...fn.matchAll(/<Skeleton\b[^>]*>/g)].map((m) => m[0]);
    expect(bones.length).toBeGreaterThan(1); // the photo and the details card
    const photo = bones.filter((b) => /ITEM_PHOTO_ASPECT\.item|aspect-/.test(b));
    expect(photo, "exactly one photo bone").toHaveLength(1);
    expect(photo[0], "built from the shared frame, not a hand-typed size").toContain("${ITEM_PHOTO_FRAME_BASE} ${ITEM_PHOTO_ASPECT.item}");
    const gallery = read("src/components/declutter/DeclutterGallery.tsx");
    expect(gallery, "the gallery draws its photo in the same shared frame").toMatch(/const FRAME_BASE = ITEM_PHOTO_FRAME_BASE;\s*const ASPECT = ITEM_PHOTO_ASPECT;/);
  });

  it("the loading-state re-measure looks through a pinned title row, as through the toaster", () => {
    // The sticky header is wider than the page column, so a probe at the page's top stopped inside it and compared
    // the item page's body skeleton with a 44px header row (run 41949893912, 2026-11-05).
    const pinned = read("src/components/profile/ProfileTabHeader.tsx");
    expect(pinned, "the pinned row's class is what the measurer skips").toContain("sticky-title-row");
    const measurer = read("scripts/audit/measure-loading-states.mjs");
    const probe = /document\.elementsFromPoint\(pr\.px, pr\.py\)\.find\(\(e\) => ([^\n]+)\);/.exec(measurer);
    expect(probe, "the loaded probe's elementsFromPoint filter not found").not.toBeNull();
    expect(probe![1]).toContain('!e.closest("[data-sonner-toaster]")');
    expect(probe![1]).toContain('!e.closest(".sticky-title-row")');
  });

  it("the details bone reserves the rest of the screen (owner ruling 2026-09-19: fills the screen, grows below)", () => {
    expect(fn).toMatch(/const \{ ref: columnRef, reserve \} = useScreenfulBelow\(\);/);
    expect(fn).toMatch(/<div ref=\{columnRef\}[^>]*>\s*<Skeleton [^>]*style=\{\{ minHeight: reserve \}\}/);
    const hook = read("src/hooks/useScreenfulBelow.ts");
    expect(hook, "the reserve is measured from the viewport, not a constant").toMatch(/window\.innerHeight - el\.getBoundingClientRect\(\)\.top/);
  });
});
