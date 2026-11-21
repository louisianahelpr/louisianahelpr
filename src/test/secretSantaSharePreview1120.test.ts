/**
 * The Secret Santa reveal link's preview (holiday audit C7, 11-20): /gift-guides/secret-santa/<code>/<token> had no
 * share rewrite, so iMessage, WhatsApp and Messenger showed the marketplace homepage card ("Louisiana's local
 * partner..."), with an index,follow head and the homepage as canonical. It now has its own noindex card: "Your Secret
 * Santa match is ready", a do-not-forward line, the gift guides' holiday picture, and never a name (the share function
 * does not read the group at all).
 *
 * @mutate vercel.json |       "destination": "/api/share?_og=santa&_code=:code&_tok=:token" |       "destination": "/index.html"
 * @mutate api/share.ts |   if (declared === "santa") return | if (declared === "never") return
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const ORIGIN = "https://www.louisianahelpr.com";
const CODE = "abcdef0123";
const TOKEN = "c".repeat(64);

async function fetchShare(query: string): Promise<Response> {
  ensureOgShellSnapshot(resolve("."));
  const sharePath = ["..", "..", "api", "share"].join("/");
  const handler = (await import(/* @vite-ignore */ sharePath)).default as { fetch: (r: Request) => Promise<Response> };
  return handler.fetch(new Request(`${ORIGIN}/api/share?${query}`));
}

describe("Secret Santa reveal link preview (api/share.ts)", () => {
  it("vercel.json sends the reveal link to the share function ahead of the app shell", () => {
    const rewrites = (JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] }).rewrites;
    const src = "/gift-guides/secret-santa/:code/:token";
    const all = rewrites.map((r, i) => ({ ...r, i })).filter((r) => r.source === src);
    expect(all.length).toBe(2);
    expect(all[0].destination).toBe("/api/share?_og=santa&_code=:code&_tok=:token");
    expect(all[1].destination).toBe("/index.html");
    expect(rewrites.length).toBeGreaterThan(50);
  });

  it("has its own noindex card with no name, canonical to the link itself", async () => {
    const res = await fetchShare(`_og=santa&_code=${CODE}&_tok=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag") ?? "").toMatch(/noindex/);
    const head = (await res.text()).split("</head>")[0];
    expect(head).toContain('content="Your Secret Santa match is ready 🎁"');
    expect(head).toMatch(/Tap to see who you(&#39;|'|&#x27;)re buying for/);
    expect(head).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(head).toContain("/gift-guides/og/landing.jpg");
    expect(head).toContain(`${ORIGIN}/gift-guides/secret-santa/${CODE}/${TOKEN}`);
    expect(head).not.toContain("Louisiana's local partner");
    expect(head).not.toContain("Hire help, find work");
  });

  it("a malformed code or token never reaches og:url", async () => {
    const bad = (await (await fetchShare(`_og=santa&_code=%3Cscript%3E&_tok=${TOKEN}`)).text()).split("</head>")[0];
    expect(bad).not.toContain("script%3E");
    expect(bad).not.toContain("<script>/");
    expect(bad).toContain(`${ORIGIN}/gift-guides/draw-names`);
  });
});
