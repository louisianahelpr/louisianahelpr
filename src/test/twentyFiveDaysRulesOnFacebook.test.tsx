/**
 * GUARD (owner 2026-11-21, Sat ~7 PM): "All the rules will be on Facebook not our website." The entry method changed
 * the same night (each day is its own entry, explained on that day's Facebook post), so the site's old copy ("One entry
 * covers all 25 days", the /25days/rules page) was wrong as well as off-policy.
 *
 *   1. No user-facing source says how entries work or quotes the old rules: no "covers all 25", "one entry covers",
 *      "enter once", "win once", "one win per person" anywhere in src/ (non-test), api/ or supabase/functions/.
 *   2. /25days says, in one plain line, that how to enter and the official rules are on our Facebook post, beside the
 *      entry button (sponsor_settings.entry_url, else the Facebook Page). Its entrant sections carry no rule.
 *   3. /25days/rules serves no rules: vercel.json redirects it to /25days (no rewrite renders it), App.tsx has no route
 *      for it (a route would shadow the redirect: publicSiteFilesValid), it has no head metadata, nothing links to it,
 *      and the old page file is gone.
 *
 * @mutate src/content/sponsorPage.ts | rulesOnFacebook: "How to enter and the official rules are on our Facebook post.", | rulesOnFacebook: "One entry covers all 25 days of drawings.",
 * @mutate src/components/sponsor/Sections.tsx | data-testid="rules-on-facebook">{E.rulesOnFacebook}</p> | data-testid="rules-on-facebook"></p>
 * @mutate src/App.tsx |       <Route path="/25days" element= |       <Route path="/25days/rules" element={<Navigate to="/25days" replace />} />\n      <Route path="/25days" element=
 * @mutate vercel.json |       "source": "/25days/rules",\n      "destination": "/25days", |       "source": "/25days/rulesx",\n      "destination": "/25days",
 * @mutate src/lib/publicPageMeta.mjs | Louisiana neighbors. How to enter is on our Facebook post." | Louisiana neighbors. One entry covers all 25 days."
 * @mutate src/lib/seoBodies.mjs | It is free to enter. How to enter and the official rules | It is free to enter, and one entry covers all 25 days. How to enter and the official rules
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { sponsorPage } from "@/content/sponsorPage";
import { BusinessAsk, EntrantHero, Faq, Footer, Lineup } from "@/components/sponsor/Sections";
import { NOINDEX_PAGE_META, PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { infoPageBody } from "@/lib/seoBodies.mjs";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** The old rules and entry method, in every wording that reached the site. */
const OLD_RULES = /covers all 25|one entry covers|enter once|can win once|one win per person|official giveaway rules/i;
const LINE = "How to enter and the official rules are on our Facebook post.";

function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}

/** User-facing source: src/ (no tests), api/, supabase/functions/. Comments blanked. */
function userFacingSources(): Array<{ f: string; code: string }> {
  const isCode = (f: string) => /\.(tsx?|mjs|js)$/.test(f) && !/\.test\.|\/test\/|\.d\.mts$/.test(f);
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]);
  const files = [...trackedFiles("src"), ...walk("api"), ...walk("supabase/functions")].filter(isCode);
  return files.map((f) => ({ f, code: blankComments(read(f)) }));
}

describe("25 Days: the rules live on Facebook, not on the website (owner 2026-11-21)", () => {
  it("no user-facing source quotes the old rules or entry method", () => {
    const sources = userFacingSources();
    expect(sources.length).toBeGreaterThan(1000);
    const hits = sources.flatMap(({ f, code }) =>
      code.split("\n").flatMap((line, i) => (OLD_RULES.test(line) ? [`${f}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])));
    expect(hits).toEqual([]);
    const strings = allStrings(sponsorPage);
    expect(strings.length).toBeGreaterThan(150);
    expect(strings.filter((s) => OLD_RULES.test(s))).toEqual([]);
  });

  it("/25days says the rules are on our Facebook post, beside the entry button, and shows no rule", () => {
    expect(sponsorPage.entrant.rulesOnFacebook).toBe(LINE);
    const { container } = render(
      <MemoryRouter initialEntries={["/25days"]}>
        <EntrantHero enterUrl="https://www.facebook.com/share/p/entry-post" />
        <Lineup />
        <BusinessAsk />
        <Footer />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-testid='rules-on-facebook']")?.textContent).toBe(LINE);
    expect(container.querySelector("[data-testid='giveaway-enter']")?.getAttribute("href")).toBe("https://www.facebook.com/share/p/entry-post");
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(1000);
    expect(text).not.toMatch(OLD_RULES);
    expect(text).not.toMatch(/residents 18|18 and older|drawn at random|within 48 hours/i);
    expect(container.querySelector("a[href='/25days/rules']")).toBeNull();
    // The brand FAQ on /sponsor points at the same Facebook post, never a rules page.
    const faq = render(<MemoryRouter><Faq /></MemoryRouter>).container;
    expect(faq.textContent).toContain(LINE);
    expect(faq.querySelector("a[href='/25days/rules']")).toBeNull();
  });

  it("the search and link-preview text for /25days carries no rule", () => {
    const meta = PUBLIC_PAGE_META["/25days"];
    for (const t of [meta.description, meta.ogDescription ?? "", infoPageBody("/25days") ?? ""]) {
      expect(t, t).not.toMatch(OLD_RULES);
      expect(t, t).not.toMatch(/residents 18/i);
    }
    expect(infoPageBody("/25days")).not.toContain("/25days/rules");
    expect(Object.keys(NOINDEX_PAGE_META)).not.toContain("/25days/rules");
  });

  it("/25days/rules redirects to /25days, no app route serves it, and nothing links to it", () => {
    const v = JSON.parse(read("vercel.json")) as {
      redirects: Array<{ source: string; destination: string }>;
      rewrites: Array<{ source: string; destination: string }>;
    };
    expect(v.redirects.find((r) => r.source === "/25days/rules")?.destination).toBe("/25days");
    expect(v.rewrites.filter((r) => r.source === "/25days/rules")).toEqual([]);
    const app = blankComments(read("src/App.tsx"));
    expect(app).toContain('<Route path="/25days" element=');
    expect(app).not.toContain('path="/25days/rules"');
    expect(fs.existsSync(path.join(ROOT, "src/pages/sponsor/SponsorRulesPage.tsx"))).toBe(false);
    const links = userFacingSources()
      .filter(({ code }) => code.includes("/25days/rules"))
      .map(({ f }) => f);
    expect(links).toEqual([]);
  });
});
