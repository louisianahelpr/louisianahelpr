/**
 * Q2705 (Builder 4, 2026-11-09): the built index.html ships without index.html's history comments. On the build of main
 * 873309be70 they were 26 comments, 24,227 B raw / 8,760 B brotli of a 30,661 B brotli page, every byte ahead of the
 * first frame on Slow 4G. scripts/perf/stripHtmlComments.mjs drops them in the build (vite.config.ts
 * html-strip-comments); the source keeps them.
 *
 * The class: a build that ships HTML comments again (the plugin unwired, or the strip missing some), or a strip that
 * changes an inline script or style (scripts are allowed by their exact sha256, so one changed byte blanks the app).
 *   (a) vite.config.ts registers a build transform that returns stripHtmlComments(html);
 *   (b) on the real index.html: no comment is left outside script/style, there were comments to strip (floor),
 *       and every script and style block is byte-identical and in the same order;
 *   (c) a comment that mentions "<script>" is still a comment, and "<!--" inside a script is script text.
 *
 * @mutate vite.config.ts | handler: (html: string) => stripHtmlComments(html) | handler: (html: string) => html
 * @mutate scripts/perf/stripHtmlComments.mjs |     if (!m[0].startsWith("<!--")) { |     if (true) {
 * @mutate scripts/perf/stripHtmlComments.mjs |   return out + tidy(markup + html.slice(last)); |   return out + tidy(markup);
 * @mutate scripts/perf/stripHtmlComments.mjs | const TOKEN = /<!--[\s\S]*?-->\|<(script\|style) | const TOKEN = /<(script\|style)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { stripHtmlComments } from "../../scripts/perf/stripHtmlComments.mjs";

const TOKEN = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** The browser tokenizer's view: comments and raw-text blocks, earliest first. */
const tokens = (html: string) => [...html.matchAll(TOKEN)].map((m) => m[0]);
const blocks = (html: string) => tokens(html).filter((t) => !t.startsWith("<!--"));
const comments = (html: string) => tokens(html).filter((t) => t.startsWith("<!--"));

const source = readFileSync(resolve("index.html"), "utf8");

describe("the built index.html carries no HTML comments (Q2705)", () => {
  it("(a) vite.config.ts strips them in a build-time index.html transform", () => {
    const cfg = blankComments(readFileSync(resolve("vite.config.ts"), "utf8"));
    const plugin = cfg.slice(cfg.indexOf('name: "html-strip-comments"'));
    expect(cfg).toContain('import { stripHtmlComments } from "./scripts/perf/stripHtmlComments.mjs"');
    expect(plugin.slice(0, 400)).toMatch(/apply: "build"[\s\S]*transformIndexHtml: \{ order: "post", handler: \(html: string\) => stripHtmlComments\(html\) \}/);
  });

  it("(b) on index.html: no comment left, every script and style block byte-identical", () => {
    const out = stripHtmlComments(source);
    // Inventory floor: index.html documents itself in comments; a strip with nothing to strip proves nothing.
    expect(comments(source).length).toBeGreaterThan(20);
    expect(comments(out)).toEqual([]);
    const before = blocks(source);
    expect(before.length).toBeGreaterThan(10);
    expect(blocks(out)).toEqual(before);
    // Markup survives: the shells, the entry and the root.
    for (const id of ['id="root"', 'id="lh-landing-shell"', 'src="/src/entry.ts"']) expect(out).toContain(id);
    expect(out.length).toBeLessThan(source.length);
  });

  it("(c) a comment quoting <script> is a comment; <!-- inside a script is script text", () => {
    const html = '<head>\n  <!-- each inline <script> is hashed -->\n  <script>var s = "<!-- x -->";\n\n</script>\n  <p>a</p>\n</head>';
    expect(stripHtmlComments(html)).toBe('<head>\n  <script>var s = "<!-- x -->";\n\n</script>\n  <p>a</p>\n</head>');
  });
});
