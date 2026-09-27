/**
 * An <img> that sets `crossOrigin` must set it BEFORE `src` (Q740).
 *
 * React applies attributes in prop order, and WebKit (Safari, and so the iOS
 * app's WKWebView) starts an image load the moment `src` is set. With `src`
 * first, every element sends a no-cors request and then a second, CORS one
 * when `crossOrigin` lands, and neither is shared with the next <img> of the
 * same URL. Measured 2026-09-27 in Playwright WebKit, 40 <img> of one avatar
 * URL: src-first 41 requests, crossOrigin-first 1 (Chromium 1 either way).
 * On prod /posts?filter=done that was 101 requests for one Helpr's avatar, and
 * `GET /storage/v1/object/public/avatars/:id/avatar.jpg` ×719 pushed the
 * a11y-prod-webkit sweep over its 400/min backend ceiling.
 *
 * Two checks: every JSX <img> in src/ (the inventory) that passes
 * `crossOrigin` passes it before `src`; and the rendered UserAvatar <img>
 * really carries the attributes in that order (jsdom keeps set order).
 *
 * @mutate src/components/UserAvatar.tsx | crossOrigin={corsMode === "anonymous" ? "anonymous" : undefined}\n          loading="lazy"\n          decoding="async"\n          src={imageSrc} | loading="lazy"\n          decoding="async"\n          src={imageSrc}\n          crossOrigin={corsMode === "anonymous" ? "anonymous" : undefined}
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { UserAvatar } from "@/components/UserAvatar";
import { blankComments } from "./helpers/blankNonCode";

const SRC_DIR = path.resolve(__dirname, "..");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
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
    // Comments blanked: one inside a tag that mentions `<img>` would
    // otherwise end the tag early.
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

describe("<img crossOrigin> is set before src (WebKit request dedupe)", () => {
  it("every JSX <img> that passes crossOrigin passes it before src", () => {
    const tags = imgTags();
    // Inventory floor: the scan really found the app's images.
    expect(tags.length).toBeGreaterThan(30);
    const withCors = tags.filter((t) => propIndex(t.tag, "crossOrigin") >= 0);
    expect(withCors.length).toBeGreaterThanOrEqual(1);
    const wrong = withCors
      .filter((t) => {
        const s = propIndex(t.tag, "src");
        return s >= 0 && s < propIndex(t.tag, "crossOrigin");
      })
      .map((t) => t.file);
    expect(wrong).toEqual([]);
  });

  it("the rendered UserAvatar <img> gets crossorigin before src", () => {
    const { container } = render(
      <UserAvatar
        userId="u1"
        src="https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/avatars/u1/avatar.jpg?t=1"
        name="Hallie Helpr"
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    const names = Array.from(img!.attributes).map((a) => a.name);
    expect(names).toContain("crossorigin");
    expect(names.indexOf("crossorigin")).toBeLessThan(names.indexOf("src"));
  });
});
