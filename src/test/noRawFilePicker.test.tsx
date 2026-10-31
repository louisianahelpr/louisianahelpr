/**
 * No raw "Choose File" box (Declutter deep audit #49, 2026-10-28, shot 84a-helpr-vehicle-390): the truck photo and
 * the Helpr's pickup and drop-off photos showed the browser's own grey "Choose File" button and "no file chosen".
 * A photo step wears the shared PhotoPickButton (src/components/ui/PhotoPickButton.tsx): the real file input stays,
 * labelled and with capture="environment", but visually hidden, and a styled camera pill opens it.
 *
 * Inventory from source: every `<input type="file">` in a .tsx under src/ (tests excluded). One is an offender when
 * its className does not hide it (`sr-only` or `hidden`). LEGACY is an exact countdown list.
 *
 * @mutate src/components/declutter/StopActions.tsx |         <PhotoPickButton id={`${id}-pick`} picked={pickPhoto} disabled={pickedUp.isPending \|\| (opensAt !== null && stop.handed_over_at === null)} onPick={setPickPhoto} /> |         <input id={`${id}-pick`} type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPickPhoto(f); }} />
 * @mutate src/components/ui/PhotoPickButton.tsx |         className="peer sr-only" |         className="peer"
 * @mutate src/components/declutter/StopActions.tsx |       <PhotoPickButton id={`${id}-drop`} picked={dropPhoto} onPick={setDropPhoto} /> |       <input id={`${id}-drop`} type="file" accept="image/*" capture="environment" className="block w-full max-w-full text-ds-13" onChange={(e) => setDropPhoto(e.target.files?.[0] ?? null)} />
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";
import { PhotoPickButton } from "@/components/ui/PhotoPickButton";

const ROOT = resolve(__dirname, "../..");

/**
 * Raw file pickers not yet on PhotoPickButton. Countdown list: never add.
 * MaintenanceRequestForm (Homes rentals): several photos at once, not a camera step; outside #49.
 */
// @two-way src/test/noRawFilePicker.test.tsx:the legacy list only shrinks
const LEGACY = new Set([
  "src/components/rentals/MaintenanceRequestForm.tsx",
]);

/** Each JSX `<input ...>` tag, braces counted so `onChange={(e) => { ... }}` never ends the tag early. */
function inputTags(src: string): string[] {
  const out: string[] = [];
  let at = src.indexOf("<input");
  while (at !== -1) {
    let depth = 0;
    let i = at + 6;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(at, i + 1));
    at = src.indexOf("<input", i);
  }
  return out;
}

function visibleFilePickers(src: string): string[] {
  return inputTags(blankComments(src))
    .filter((t) => /\btype=["']file["']/.test(t))
    .filter((t) => !/className=(?:"[^"]*\b(?:sr-only|hidden)\b[^"]*"|\{[^}]*\b(?:sr-only|hidden)\b)/.test(t))
    .map((t) => t.replace(/\s+/g, " ").slice(0, 110));
}

describe("photo steps wear the shared photo button, never a raw Choose File box (deep audit #49)", () => {
  it("catches the original truck photo input, with a nested-brace onChange", () => {
    expect(visibleFilePickers(`<input id={photoId} type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />`)).toHaveLength(1);
    expect(visibleFilePickers(`<input type="file" onChange={(e) => { if (f) setAsk({ kind: "away", file: f }); }} />`)).toHaveLength(1);
    expect(visibleFilePickers(`<input type="file" className="peer sr-only" />`)).toEqual([]);
  });

  it("no visible file input in src/ outside the legacy list", () => {
    const files = walkSource([join(ROOT, "src")]).filter((f) => f.endsWith(".tsx") && !/\.test\.|\/test\//.test(f));
    expect(files.length).toBeGreaterThan(300);
    const withPickers = files.filter((f) => /type=["']file["']/.test(readFileSync(f, "utf8")));
    expect(withPickers.length).toBeGreaterThan(5);
    const hits = withPickers
      .map((f) => f.slice(ROOT.length + 1))
      .filter((rel) => !LEGACY.has(rel))
      .flatMap((rel) => visibleFilePickers(readFileSync(join(ROOT, rel), "utf8")).map((t) => `${rel}: ${t}`));
    expect(hits, "use PhotoPickButton (src/components/ui/PhotoPickButton.tsx)").toEqual([]);
  });

  it("the legacy list only shrinks", () => {
    for (const rel of LEGACY) expect(visibleFilePickers(readFileSync(join(ROOT, rel), "utf8")).length, `${rel} is clean: remove it from LEGACY`).toBeGreaterThan(0);
  });

  it("PhotoPickButton: a labelled back-camera input, hidden from sight; the pill names the photo once chosen", () => {
    const onPick = vi.fn();
    const { rerender } = render(
      <>
        <label htmlFor="p1">Photo of your truck</label>
        <PhotoPickButton id="p1" onPick={onPick} />
      </>,
    );
    const input = screen.getByLabelText("Photo of your truck") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.getAttribute("capture")).toBe("environment");
    expect(input.getAttribute("accept")).toBe("image/*");
    expect(input.className.split(/\s+/)).toContain("sr-only");
    expect(screen.getByText("Take a photo")).toBeInTheDocument();
    const file = new File(["x"], "truck.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith(file);
    rerender(
      <>
        <label htmlFor="p1">Photo of your truck</label>
        <PhotoPickButton id="p1" onPick={onPick} picked={file} />
      </>,
    );
    expect(screen.getByText("truck.jpg")).toBeInTheDocument();
    expect(screen.getByText("Take another")).toBeInTheDocument();
  });
});
