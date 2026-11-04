/**
 * One brand mark (owner 2026-11-03, Q2042 option 1): the H alone everywhere.
 * The last live "Helpr · LA" lockup was the Declutter guest join panel. Every
 * <HelprMark> the app draws passes `emblemOnly`, so the wordmark ("Helpr" +
 * "· LA") is never drawn.
 *
 * @mutate src/components/declutter/DeclutterGuest.tsx |       <HelprMark to="/" size="sm" emblemOnly /> |       <HelprMark to="/" size="sm" />
 * The PDF letterhead (src/lib/pdfDocument.ts, every shared PDF) is the H image
 * alone too (owner 2026-11-03): no "Helpr" wordmark text, no "· LA" tail.
 *
 * @mutate src/lib/pdfDocument.ts |   doc.addImage(HELPR_MARK_PNG, "PNG", MARGIN, 52, MARK_W, MARK_H);\n |   doc.addImage(HELPR_MARK_PNG, "PNG", MARGIN, 52, MARK_W, MARK_H);\n  doc.text("Helpr", MARGIN + MARK_W + 10, 78);\n
 * @mutate src/lib/pdfDocument.ts |   doc.addImage(HELPR_MARK_PNG, "PNG", MARGIN, 52, MARK_W, MARK_H);\n |   doc.text("Helpr \u00b7 LA", MARGIN, 78);\n
 * @mutate src/components/PageHeader.tsx | <HelprMark to="/home" size="md" emblemOnly /> | <HelprMark to="/home" size="md" hideEmblem />
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { blankComments } from "./helpers/blankNonCode";

const files = execFileSync("git", ["ls-files", "src/*.tsx", "src/**/*.tsx"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !/\.test\.tsx$/.test(f) && fs.existsSync(f));

const uses = files.flatMap((f) => {
  const code = blankComments(fs.readFileSync(f, "utf8"));
  return [...code.matchAll(/<HelprMark\b[^>]*>/g)].map((m) => ({ f, tag: m[0] }));
});

describe("the brand mark is the H alone", () => {
  it("finds the app's HelprMark uses", () => {
    expect(uses.length).toBeGreaterThan(12);
    expect(uses.some((u) => u.f === "src/components/declutter/DeclutterGuest.tsx")).toBe(true);
  });

  it("every HelprMark is emblemOnly (no 'Helpr · LA' wordmark)", () => {
    const wordmarks = uses.filter((u) => !/\bemblemOnly\b/.test(u.tag)).map((u) => `${u.f}: ${u.tag}`);
    expect(wordmarks).toEqual([]);
  });

  it("the PDF letterhead draws the H image and no wordmark text", () => {
    const pdf = blankComments(fs.readFileSync("src/lib/pdfDocument.ts", "utf8"));
    expect(pdf).toMatch(/doc\.addImage\(HELPR_MARK_PNG,/);
    const texts = [...pdf.matchAll(/\.text\(\s*("[^"]*"|'[^']*'|`[^`]*`)/g)].map((m) => m[1]);
    expect(texts.filter((t) => /Helpr|\bLA\b|\\u00b7|\u00b7/.test(t))).toEqual([]);
  });
});
