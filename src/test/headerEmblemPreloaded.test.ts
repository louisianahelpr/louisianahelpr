/*
 * The header's H emblem is preloaded from index.html so it arrives with the
 * page (owner, 2026-09-25: "on the legal pages it was taking awhile for the h
 * logo to show"). The preload must name exactly the files and `sizes` the
 * rendered <img> uses, or the browser fetches a file the <img> then ignores.
 *
 * @mutate index.html | imagesizes="40px" | imagesizes="32px"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const mark = readFileSync(resolve(ROOT, "src/components/HelprMark.tsx"), "utf8");
const navbar = readFileSync(resolve(ROOT, "src/components/Navbar.tsx"), "utf8");

const preload = /<link\s+rel="preload"\s+as="image"([^>]*)>/.exec(html)?.[1] ?? "";

describe("the header emblem is preloaded as the <img> renders it", () => {
  it("the public header renders the md emblem", () => {
    expect(navbar).toMatch(/<HelprMark[^>]*size="md"[^>]*emblemOnly/);
  });

  it("index.html preloads the same files and sizes", () => {
    expect(preload, "no image preload in index.html").not.toBe("");
    const imported = [...mark.matchAll(/from "@\/assets\/(helpr-logo-\d+\.webp)"/g)].map((m) => m[1]);
    expect(imported.length, "HelprMark imports no emblem files").toBeGreaterThan(1);
    for (const f of imported) expect(preload, `the preload does not name ${f}`).toContain(`/src/assets/${f}`);
    const mdSizes = /size === "md" \? "(\d+px)"/.exec(mark)?.[1];
    expect(mdSizes, "could not read HelprMark's md sizes").toBeTruthy();
    expect(preload).toContain(`imagesizes="${mdSizes}"`);
  });
});
