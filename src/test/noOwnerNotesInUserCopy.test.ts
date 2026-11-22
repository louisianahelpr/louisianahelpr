/**
 * Dev notes never ship to people (lead 2026-11-21: the /25days SEO body read "...on the Louisiana Helpr Facebook post
 * (owner 2026-11-21: all the rules are on Facebook, not the website)."). A note like "(owner 2026-11-21: ...)" belongs in
 * a comment; inside a string it reaches the pre-JS page, the meta tags or the screen.
 *
 * Class check over the VALUES (never the source text, so comments cannot trip it): every info page's rendered SEO body,
 * every public / legal / landing / noindex page meta entry, and every string of the /25days + /sponsor copy
 * (sponsorPage) carry no "owner 20NN".
 * @mutate src/lib/seoBodies.mjs | the official rules are on the Louisiana Helpr Facebook post.", | the official rules are on the Louisiana Helpr Facebook post (owner 2026-11-21: all the rules are on Facebook, not the website).",
 */
import { describe, expect, it } from "vitest";
import { INFO_BODY_PATHS, infoPageBody } from "@/lib/seoBodies.mjs";
import { LANDING_PAGE_META, LEGAL_PAGE_META, NOINDEX_PAGE_META, PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { sponsorPage } from "@/content/sponsorPage";

const NOTE = /\bowner 20\d\d\b/i;

/** Every string inside a value (functions are called with a sample argument where they take one). */
function strings(v: unknown, path = "", out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof v === "string") out.push([path, v]);
  else if (typeof v === "function") {
    try {
      const r = (v as (...a: unknown[]) => unknown)("Sample", 2, "Sample");
      strings(r, `${path}()`, out);
    } catch {
      // A function that needs a real argument shape: its literal text is still checked by the copy guards; skip it here.
    }
  } else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
  return out;
}

describe("no dev note reaches user-facing copy", () => {
  const meta = strings({ PUBLIC_PAGE_META, LEGAL_PAGE_META, NOINDEX_PAGE_META, LANDING_PAGE_META });
  const sponsor = strings(sponsorPage);
  it("reads the copy (cannot pass vacuously)", () => {
    expect(INFO_BODY_PATHS.length).toBeGreaterThan(5);
    expect(meta.length).toBeGreaterThan(50);
    expect(sponsor.length).toBeGreaterThan(50);
  });
  it("no info page's SEO body says 'owner 20NN'", () => {
    expect(INFO_BODY_PATHS.filter((p) => NOTE.test(infoPageBody(p) ?? ""))).toEqual([]);
  });
  it("no page meta and no /25days or /sponsor string says 'owner 20NN'", () => {
    expect([...meta, ...sponsor].filter(([, s]) => NOTE.test(s)).map(([p]) => p)).toEqual([]);
  });
});
