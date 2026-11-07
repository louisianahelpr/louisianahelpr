/**
 * NO HTML SHELL REPEATS AN ID OF ITS PAGE (Q1816, e2e-real-backend #3813; lead 11-07: "extend the guard to every shell").
 *
 * index.html carries shells (#lh-<page>-shell ... data-lh-shell="end") that are static copies of what a page renders,
 * shown until the page has painted. Rendered with the page's own ids, the document held two #email and two #password
 * inputs on /login while both were up (a duplicate id, WCAG 4.1.1; e2e "#password resolved to 2 elements"), and the
 * landing shell carried React's useId (":R4:") for its search box.
 *
 * THE CHECK, over EVERY shell block in index.html (found by its data-lh-shell="start" marker, so a shell added later
 * is covered with no list to update): every id in a block starts with "lh-shell-<shell>-" (scripts/shell-ids.mjs
 * scopeShellIds, applied by each shell's writer test), no id appears twice in the whole document (login and signup
 * both have an email field), and every for / aria-labelledby / aria-describedby / aria-controls in a block points at
 * an id inside that same block.
 *
 * @mutate index.html | id="lh-shell-login-password" | id="password"
 * @mutate index.html | id="lh-shell-landing-:R4:" | id=":R4:"
 * @mutate index.html | id="lh-shell-signup-email" | id="lh-shell-login-email"
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SHELL_END } from "../../scripts/inline-shell-css.mjs";
import { SHELL_ID_PREFIX } from "../../scripts/shell-ids.mjs";

const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const START = /<div id="(lh-[a-z]+-shell)"[^>]*data-lh-shell="start"[^>]*>/g;
const blocks = [...html.matchAll(START)].map((m) => {
  const from = (m.index ?? 0) + m[0].length;
  return { shell: m[1], page: m[1].replace(/^lh-|-shell$/g, ""), body: html.slice(from, html.indexOf(SHELL_END, from)) };
});
const idsIn = (s: string) => [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const refsIn = (s: string) =>
  [...s.matchAll(/\s(?:for|aria-labelledby|aria-describedby|aria-controls)="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));

describe("no HTML shell repeats an id of its page", () => {
  it("finds every shell (floor)", () => {
    expect(blocks.length).toBeGreaterThan(5);
    for (const b of blocks) expect(b.body.length, b.shell).toBeGreaterThan(500);
    expect(blocks.flatMap((b) => idsIn(b.body)).length, "ids to check").toBeGreaterThan(5);
  });

  it("every id inside a shell carries the shell prefix", () => {
    const bad = blocks.flatMap((b) => idsIn(b.body).filter((id) => !id.startsWith(`${SHELL_ID_PREFIX}${b.page}-`)).map((id) => `${b.shell}: id="${id}"`));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("no id appears twice anywhere in index.html", () => {
    const all = idsIn(html);
    expect(all.length).toBeGreaterThan(10);
    const dup = [...new Set(all.filter((id, i) => all.indexOf(id) !== i))];
    expect(dup, dup.join("\n")).toEqual([]);
  });

  it("each shell's ids are its own: unique within the shell, and every reference resolves inside it", () => {
    const bad: string[] = [];
    for (const b of blocks) {
      const ids = idsIn(b.body);
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dup.length) bad.push(`${b.shell}: id twice in one shell: ${dup.join(", ")}`);
      for (const r of refsIn(b.body)) if (!ids.includes(r)) bad.push(`${b.shell}: points at "${r}", not an id in this shell`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
