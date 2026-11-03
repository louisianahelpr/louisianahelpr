/**
 * An <img> that sets `loading` must set it BEFORE `src` (Blockers 7, 2026-11-03; the same WebKit rule as Q740's
 * crossOrigin, src/test/imgCrossOriginBeforeSrc.test.tsx).
 *
 * React 18 writes an element's attributes in prop order, and WebKit (Safari, and so the iOS app's WKWebView) starts
 * the image fetch the moment `src` lands on the new element. A `loading="lazy"` written after `src` comes too late:
 * the photo loads at once, however far below the screen it is. a11y-prod-webkit 41598471444 asked for
 * `render/image/.../declutter/...?width=480` x1536 (Chromium: under 186), and its /declutter burst was 222 vs
 * Chromium's 60. Measured locally (Playwright WebKit, iPhone 13 at 375x812, a build against a stubbed backend,
 * 200 Browse cards, ~/.lh-shots/blockers7/): src-first 200 card photos per /declutter load, loading-first 14
 * (Chromium 14 either way); after a 5000 px scroll the cards in view still load (14 -> 30, 8 of 8 visible loaded).
 *
 * Two checks: the rendered Browse card <img> carries `loading` before `src` (lazy and eager); and every JSX <img>
 * in src/ that passes `loading` passes it before `src`.
 *
 * @mutate src/components/declutter/DeclutterItemCard.tsx | {...(firstRow ? FIRST_ROW_PHOTO : LATER_PHOTO)}\n            src={photoStage === "card" ? photoCardUrl(photoPath) : photoPublicUrl(photoPath)} | src={photoStage === "card" ? photoCardUrl(photoPath) : photoPublicUrl(photoPath)}\n            {...(firstRow ? FIRST_ROW_PHOTO : LATER_PHOTO)}
 * @mutate src/components/ui/optimized-image.tsx |         loading={resolvedLoading}\n        ref={ref}\n        src={finalSrc} |         ref={ref}\n        src={finalSrc}\n        loading={resolvedLoading}
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (p: string, opts?: { transform?: { width?: number } }) => ({
          data: {
            publicUrl: opts?.transform
              ? `https://ref.supabase.co/storage/v1/render/image/public/${bucket}/${p}?width=${opts.transform.width}`
              : `https://ref.supabase.co/storage/v1/object/public/${bucket}/${p}`,
          },
        }),
      }),
    },
  },
}));

import { ItemCard } from "@/components/declutter/DeclutterItemCard";
import { resetFirstRowPhotoGate } from "@/components/declutter/firstRowPhotoGate";
import type { DeclutterItem } from "@/lib/declutter/api";

const SRC_DIR = path.resolve(__dirname, "..");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith(".tsx") && !/\.test\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every `<img ...>` JSX opening tag, with its file. Braces are balanced so `{a > b}` does not end the tag. */
function imgTags(): { file: string; tag: string }[] {
  const tags: { file: string; tag: string }[] = [];
  for (const file of tsxFiles(SRC_DIR)) {
    const text = blankComments(fs.readFileSync(file, "utf8"));
    const re = /<img\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      let depth = 0;
      let i = m.index + 4;
      for (; i < text.length; i++) {
        const c = text[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      tags.push({ file: path.relative(SRC_DIR, file), tag: text.slice(m.index, i + 1) });
    }
  }
  return tags;
}

/** Position of a JSX prop at the tag's own level (not inside a `{...}` expression). */
function propIndex(tag: string, name: string): number {
  let depth = 0;
  for (let i = 0; i < tag.length; i++) {
    const c = tag[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && tag.startsWith(name, i) && /\s/.test(tag[i - 1] ?? "") && /[=\s]/.test(tag[i + name.length] ?? "")) {
      return i;
    }
  }
  return -1;
}

const item: DeclutterItem = {
  id: "i1", seller_id: "s1", status: "live", title: "Lamp", description: "", category: "home", condition_stars: 4, delivery_size: "small",
  price_cents: 2500, current_price_cents: 2500, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-30T00:00:00Z",
  live_at: "2026-10-30T00:00:00Z", porch_ok: true,
};

describe("<img loading> is set before src (WebKit honours lazy only then)", () => {
  beforeEach(() => resetFirstRowPhotoGate());
  afterEach(() => cleanup());

  it.each([false, true])("the Browse card's photo carries loading before src (firstRow=%s)", async (firstRow) => {
    const r = render(<MemoryRouter><ItemCard item={item} photoPath="u/declutter/i1/p.jpg" miles={1} approximate={false} firstRow={firstRow} /></MemoryRouter>);
    await vi.waitFor(() => expect(r.container.querySelector("img")).not.toBeNull());
    const img = r.container.querySelector("img")!;
    const names = Array.from(img.attributes).map((a) => a.name);
    expect(img.getAttribute("loading")).toBe(firstRow ? "eager" : "lazy");
    expect(names.indexOf("loading")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("loading")).toBeLessThan(names.indexOf("src"));
    expect(names.indexOf("loading")).toBeLessThan(names.indexOf("srcset"));
  });

  it("every JSX <img> that passes loading passes it before src", () => {
    const tags = imgTags();
    // Inventory floor: the scan really found the app's images, and the lazy ones among them.
    expect(tags.length).toBeGreaterThan(30);
    const withLoading = tags.filter((t) => propIndex(t.tag, "loading") >= 0);
    expect(withLoading.length).toBeGreaterThan(10);
    const wrong = withLoading
      .filter((t) => {
        const s = propIndex(t.tag, "src");
        return s >= 0 && s < propIndex(t.tag, "loading");
      })
      .map((t) => t.file);
    expect(wrong).toEqual([]);
  });
});
